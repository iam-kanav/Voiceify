import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, FileAudio, Languages, Pause, Play, Share, Speech, Trash2, X } from 'lucide-react'
import type { ModelInfo, Transcript } from '@shared/types'
import { ASR_PROVIDERS, PROVIDER_BY_ID, STT_LANGUAGES } from '@shared/providers'
import { formatBytes, PRECISION_HELP } from '@shared/catalog'
import { clock, type TranscriptFormat } from '@shared/subtitles'
import { PageHeader } from '@/components/PageHeader'
import { Dropzone, Recorder } from '@/components/AudioInput'
import { Popover, Select } from '@/components/Popover'
import { InfoTip } from '@/components/InfoTip'
import { ModelGate } from '@/components/ModelGate'
import { VoiceAvatar } from '@/components/VoiceAvatar'
import { SaveButton, ensureSaveMode } from '@/components/SaveMode'
import { Badge, Button, IconButton, Tabs, Toggle } from '@/components/ui'
import { errorMessage, toast } from '@/components/Toast'
import { ModelChooser } from '@/features/tts/ModelChooser'
import { useApp } from '@/stores/app'
import { usePlayer } from '@/stores/player'
import { cn, dayLabel, formatTime, studio, uid } from '@/lib/api'
import { decodeToMono, encodeWav } from '@/lib/wav'
import { isInstalled, resolveModel } from '@/lib/models'
import { usePlayerPadding } from '@/lib/useGenerate'
import { useRaf } from '@/lib/useRaf'

/** Speech recognition models expect 16 kHz mono. */
const ASR_SR = 16000

interface SourceAudio {
  name: string
  wav: Uint8Array
  url: string
  duration: number
}

/** Choices persist; the picked file and the running job survive page switches. */
const useStt = create<{
  provider: string
  modelByProvider: Record<string, string>
  language: string
  translate: boolean
}>()(
  persist(() => ({ provider: 'qwen3-asr', modelByProvider: {} as Record<string, string>, language: 'auto', translate: false as boolean }), {
    name: 'stt-state'
  })
)

const useSession = create<{
  file: SourceAudio | null
  busy: { name: string; startedAt: number; estimate?: number } | null
  selectedId: string | null
  /** Source audio kept in memory for transcripts made this session, so timestamps can be played. */
  audioById: Record<string, { url: string; name: string }>
}>(() => ({ file: null, busy: null, selectedId: null, audioById: {} }))

export default function SpeechToText() {
  const models = useApp((s) => s.models)
  const transcripts = useApp((s) => s.transcripts)
  const defaults = useApp((s) => s.settings?.defaultModels)
  const { provider: providerId, modelByProvider, language, translate } = useStt()
  const { file, busy, selectedId } = useSession()
  const [decoding, setDecoding] = useState(false)
  const pad = usePlayerPadding()

  const provider = PROVIDER_BY_ID.get(providerId) ?? ASR_PROVIDERS[0]
  const canTranslate = provider.id === 'whisper'
  const wantsTranslate = canTranslate && translate
  const cap = wantsTranslate ? 'translate' : 'transcribe'
  const modelId = modelByProvider[provider.id] ?? 'auto'
  const options = models.filter((m) => isInstalled(m) && m.provider === provider.id && m.capabilities.includes(cap))
  const active = resolveModel(cap, models, modelId === 'auto' ? undefined : modelId, defaults, provider.id)
  const languages = STT_LANGUAGES.filter((l) => provider.languages.includes(l.id))
  const selected = transcripts.find((t) => t.id === selectedId) ?? (busy ? undefined : transcripts[0])

  const ingest = async (data: ArrayBuffer, name: string) => {
    setDecoding(true)
    try {
      const mono = await decodeToMono(data, ASR_SR)
      if (mono.length < ASR_SR * 0.5) throw new Error('That clip is too short to transcribe.')
      const wav = encodeWav(mono, ASR_SR)
      const old = useSession.getState().file
      if (old && !Object.values(useSession.getState().audioById).some((a) => a.url === old.url)) URL.revokeObjectURL(old.url)
      const url = URL.createObjectURL(new Blob([wav.slice().buffer], { type: 'audio/wav' }))
      useSession.setState({ file: { name, wav, url, duration: mono.length / ASR_SR } })
    } catch (e) {
      toast.error('Couldn’t read this file', /decode/i.test(errorMessage(e)) ? 'This format isn’t supported. Try WAV, MP3, M4A, FLAC, OGG or a video file.' : errorMessage(e))
    } finally {
      setDecoding(false)
    }
  }

  const start = async () => {
    if (!file || busy || !active) return
    if (!(await ensureSaveMode())) return
    // Estimate from earlier runs of the same model on this computer.
    const past = transcripts.filter((t) => t.modelId === active.id && t.durationSec > 5)
    const speed = past.length ? past.reduce((n, t) => n + t.durationSec / Math.max(0.1, t.processingSec), 0) / past.length : undefined
    useSession.setState({ busy: { name: file.name, startedAt: Date.now(), estimate: speed ? file.duration / speed : undefined }, selectedId: null })
    try {
      const t = await studio.transcribeAudio({
        audio: file.wav,
        name: file.name,
        provider: provider.id,
        modelId: modelId === 'auto' ? undefined : modelId,
        language,
        task: wantsTranslate ? 'translate' : 'transcribe'
      })
      useSession.setState((s) => ({ selectedId: t.id, file: null, audioById: { ...s.audioById, [t.id]: { url: file.url, name: file.name } } }))
      if (!t.text) toast.info('No speech found', 'The model didn’t hear any words in this audio.')
    } catch (e) {
      toast.error('Transcription failed', errorMessage(e))
    } finally {
      useSession.setState({ busy: null })
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Speech to Text" subtitle="Transcribe any audio or video file, privately on your computer." />
      <div className={cn('flex min-h-0 flex-1 border-t border-line', pad)}>
        <section className="scroll w-[min(440px,42%)] shrink-0 space-y-6 border-r border-line p-6">
          <ProviderCards value={provider.id} onChange={(id) => useStt.setState({ provider: id })} />

          <ModelChooser
            provider={provider.id}
            voice={undefined}
            cap={cap}
            options={options}
            active={active}
            value={modelId}
            onChange={(id) => useStt.setState((s) => ({ modelByProvider: { ...s.modelByProvider, [provider.id]: id } }))}
            help={
              <>
                <p>Which installed version of {provider.name} transcribes your audio.</p>
                <p className="mt-1.5 opacity-80">Bigger models are more accurate with accents, noise and rare words; smaller ones are faster.</p>
                <p className="mt-1.5 opacity-80">{PRECISION_HELP}</p>
              </>
            }
          />

          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[13px] font-medium">
              Spoken language
              <InfoTip>Auto-detect works well. Choosing the language helps with short clips, heavy accents, or audio that mixes languages.</InfoTip>
            </div>
            <Select
              value={languages.some((l) => l.id === language) ? language : 'auto'}
              onChange={(v) => useStt.setState({ language: v })}
              options={[{ value: 'auto', label: 'Auto-detect' }, ...languages.map((l) => ({ value: l.id, label: l.label }))]}
            />
          </div>

          {canTranslate && (
            <div className="flex items-start justify-between gap-4 rounded-2xl border border-line p-3.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                  <Languages className="size-4 text-ink-3" /> Translate to English
                </div>
                <div className="mt-0.5 text-xs text-ink-3">Writes speech in any language as English text. Needs Whisper Large (Turbo can’t translate).</div>
              </div>
              <Toggle checked={translate} onChange={(v) => useStt.setState({ translate: v })} />
            </div>
          )}

          <div className="space-y-2">
            <div className="text-[13px] font-medium">Audio</div>
            <AnimatePresence mode="wait" initial={false}>
              {file ? (
                <motion.div key="file" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <FileCard file={file} onRemove={() => useSession.setState({ file: null })} />
                </motion.div>
              ) : (
                <motion.div key="pick" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid grid-cols-2 gap-3">
                  <Dropzone
                    className="h-32"
                    busy={decoding}
                    title="Upload a file"
                    hint="Any audio or video, any length"
                    onFile={(f) => f.arrayBuffer().then((b) => ingest(b, f.name))}
                  />
                  <Recorder className="h-32" stopHint="Click to stop" onDone={(b) => ingest(b, `Recording ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`)} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {!active ? (
            <ModelGate cap={cap} provider={provider.id} compact />
          ) : (
            <Button size="lg" className="w-full" disabled={!file || !!busy} loading={!!busy} onClick={start} icon={!busy && <Speech className="size-4" />}>
              {busy ? 'Transcribing…' : wantsTranslate ? 'Transcribe & translate' : 'Transcribe'}
            </Button>
          )}

          {transcripts.length > 0 && <Recent transcripts={transcripts} selectedId={selected?.id} />}
        </section>

        <section className="flex min-w-0 flex-1 flex-col">
          {busy ? (
            <Working busy={busy} />
          ) : selected ? (
            <TranscriptView key={selected.id} t={selected} models={models} />
          ) : (
            <Empty />
          )}
        </section>
      </div>
    </div>
  )
}

/** The model family, as two big cards (Whisper / Qwen3-ASR). */
function ProviderCards({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const models = useApp((s) => s.models)
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[13px] font-medium">
        Model
        <InfoTip width={320}>
          Both run entirely on this computer. Qwen3-ASR is very accurate on clear speech. Whisper handles 99 languages and noisy audio, gives sentence-level
          timestamps for subtitles, and its Large version can translate into English.
        </InfoTip>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {ASR_PROVIDERS.map((p) => {
          const fam = models.filter((m) => m.provider === p.id)
          const installed = fam.some(isInstalled)
          const downloading = fam.find((m) => m.install.status === 'downloading')
          const starter = fam.find((m) => m.recommended) ?? fam.find((m) => m.quant === '8bit') ?? fam[0]
          const on = p.id === value
          return (
            <button
              key={p.id}
              onClick={() => onChange(p.id)}
              className={cn('relative rounded-2xl border p-3 text-left transition-all', on ? 'border-ink bg-subtle' : 'border-line-strong hover:bg-subtle')}
            >
              <div className="flex items-center gap-2">
                <VoiceAvatar colors={p.colors} size={24} />
                <span className="text-sm font-semibold">{p.name}</span>
              </div>
              <div className="mt-1 text-[11px] text-ink-3">by {p.vendor}</div>
              <div className="mt-1.5 text-xs leading-snug text-ink-2">{p.tagline}</div>
              <div className="mt-2 text-[11px]">
                {installed ? (
                  <span className="text-success">Installed</span>
                ) : downloading && downloading.install.status === 'downloading' ? (
                  <span className="text-ink-3">Downloading {Math.round((downloading.install.received / Math.max(1, downloading.install.total)) * 100)}%</span>
                ) : (
                  <span className="text-ink-3">Not installed{starter ? ` · from ${formatBytes(Math.min(...fam.map((m) => m.sizeBytes)))}` : ''}</span>
                )}
              </div>
              {on && (
                <motion.span layoutId="stt-provider" className="absolute right-2.5 top-2.5 flex size-5 items-center justify-center rounded-full bg-accent text-accent-ink">
                  <Check className="size-3" />
                </motion.span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function FileCard({ file, onRemove }: { file: SourceAudio; onRemove: () => void }) {
  const clip = usePlayer((s) => s.clip)
  const status = usePlayer((s) => s.status)
  const [id] = useState(() => `stt-${uid()}`)
  const playing = clip?.id === id && status === 'playing'
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line p-3">
      <button
        onClick={() => (clip?.id === id ? usePlayer.getState().toggle() : usePlayer.getState().play({ id, title: file.name, subtitle: 'Source audio', url: file.url }))}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink active:scale-90"
      >
        {playing ? <Pause className="size-3.5" fill="currentColor" /> : <Play className="ml-0.5 size-3.5" fill="currentColor" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <FileAudio className="size-4 shrink-0 text-ink-3" />
          <span className="truncate">{file.name}</span>
        </div>
        <div className="text-xs text-ink-3">{clock(file.duration)}</div>
      </div>
      <IconButton label="Remove" onClick={onRemove}>
        <X className="size-4" />
      </IconButton>
    </div>
  )
}

function Working({ busy }: { busy: { name: string; startedAt: number; estimate?: number } }) {
  const [elapsed, setElapsed] = useState(0)
  useRaf(() => setElapsed((Date.now() - busy.startedAt) / 1000), true)
  const left = busy.estimate ? Math.max(0, busy.estimate - elapsed) : undefined
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-10 text-center">
      <div className="flex h-10 items-end gap-1">
        {Array.from({ length: 9 }).map((_, i) => (
          <motion.span
            key={i}
            className="w-1.5 rounded-full bg-ink/70"
            animate={{ height: [8, 30, 12, 24, 8] }}
            transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.09, ease: 'easeInOut' }}
          />
        ))}
      </div>
      <div>
        <div className="text-[15px] font-semibold">Transcribing {busy.name}</div>
        <div className="mt-1 text-[13px] tabular-nums text-ink-3">
          {formatTime(elapsed)} elapsed
          {left !== undefined && (left > 1 ? ` · about ${formatTime(left)} left` : ' · almost done')}
        </div>
        <div className="mt-3 text-xs text-ink-3">The first run loads the model, which takes a few extra seconds.</div>
      </div>
    </div>
  )
}

function Empty() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
        <Speech className="size-5 text-ink-2" />
      </div>
      <div className="mt-4 text-[15px] font-semibold">Your transcript appears here</div>
      <p className="mt-1 max-w-sm text-[13px] text-ink-3">
        Drop in a voice memo, meeting, podcast or video. Nothing leaves your computer. Export as text or as subtitles (SRT/VTT).
      </p>
    </div>
  )
}

function TranscriptView({ t, models }: { t: Transcript; models: ModelInfo[] }) {
  const audio = useSession((s) => s.audioById[t.id])
  const [view, setView] = useState<'text' | 'timestamps'>('text')
  const [text, setText] = useState(t.text)
  const [copied, setCopied] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const exportBtn = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const model = models.find((m) => m.id === t.modelId)
  const family = PROVIDER_BY_ID.get(t.provider)
  const speed = t.processingSec > 0 ? t.durationSec / t.processingSec : 0

  // Edits are saved as you type.
  useEffect(() => () => clearTimeout(timer.current), [])
  const edit = (v: string) => {
    setText(v)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => studio.updateTranscript(t.id, { text: v }).catch(() => undefined), 500)
  }

  const playFrom = async (sec: number) => {
    if (!audio) return
    const id = `stt-src-${t.id}`
    const p = usePlayer.getState()
    if (p.clip?.id !== id) await p.play({ id, title: audio.name, subtitle: 'Source audio', url: audio.url })
    usePlayer.getState().seek(sec)
    if (usePlayer.getState().status === 'paused') usePlayer.getState().toggle()
  }

  const exportAs = async (format: TranscriptFormat) => {
    setExportOpen(false)
    clearTimeout(timer.current)
    if (text !== t.text) await studio.updateTranscript(t.id, { text })
    const path = await studio.exportTranscript(t.id, format)
    if (path) toast.success('Exported', path)
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start gap-3 border-b border-line px-8 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{t.name}</span>
            {t.saved === false && <Badge tone="amber">Not saved</Badge>}
            {t.task === 'translate' && <Badge tone="blue">Translated to English</Badge>}
          </div>
          <div className="mt-0.5 truncate text-xs text-ink-3">
            {clock(t.durationSec)}
            {t.language && ` · ${t.language}`} · {model?.name ?? family?.name ?? t.modelId}
            {speed > 0 && ` · took ${t.processingSec < 60 ? `${t.processingSec.toFixed(1)} s` : formatTime(t.processingSec)} (${speed.toFixed(speed >= 10 ? 0 : 1)}× real time)`}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {t.saved === false && <SaveButton saved={false} onSave={() => studio.updateTranscript(t.id, { saved: true })} />}
          <IconButton
            label={copied ? 'Copied' : 'Copy text'}
            onClick={() => {
              navigator.clipboard.writeText(text)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
          </IconButton>
          <span ref={exportBtn} className="inline-flex">
            <IconButton label="Export…" onClick={() => setExportOpen((o) => !o)}>
              <Share className="size-4" />
            </IconButton>
          </span>
          <Popover open={exportOpen} onClose={() => setExportOpen(false)} anchor={exportBtn} width={240} align="end">
            {(
              [
                ['txt', 'Text (.txt)', 'Just the words'],
                ['srt', 'Subtitles (.srt)', 'For video editors and players'],
                ['vtt', 'Web subtitles (.vtt)', 'For web video']
              ] as const
            ).map(([f, label, sub]) => (
              <button
                key={f}
                disabled={f !== 'txt' && !t.segments.length}
                onClick={() => exportAs(f)}
                className="flex w-full flex-col rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-muted disabled:opacity-40"
              >
                <span className="text-sm">{label}</span>
                <span className="text-xs text-ink-3">{sub}</span>
              </button>
            ))}
          </Popover>
          <IconButton
            label="Delete"
            onClick={() => {
              studio.deleteTranscript(t.id)
              useSession.setState({ selectedId: null })
            }}
          >
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </div>

      {t.segments.length > 0 && (
        <div className="flex items-center justify-between px-8 pt-4">
          <Tabs
            id="stt-view"
            value={view}
            onChange={setView}
            tabs={[
              { id: 'text', label: 'Text' },
              { id: 'timestamps', label: 'Timestamps' }
            ]}
          />
          {view === 'timestamps' && (
            <span className="text-xs text-ink-3">{audio ? 'Click a line to play it' : 'Audio isn’t kept, so lines can’t be played back later'}</span>
          )}
        </div>
      )}

      {view === 'text' || !t.segments.length ? (
        <textarea
          value={text}
          onChange={(e) => edit(e.target.value)}
          placeholder="No speech was found in this audio."
          className="scroll flex-1 resize-none bg-transparent px-8 pb-6 pt-4 text-[16px] leading-[1.75] text-ink outline-none placeholder:text-ink-3"
        />
      ) : (
        <div className="scroll flex-1 px-6 pb-6 pt-3">
          {t.segments.map((s, i) => (
            <button
              key={i}
              onClick={() => playFrom(s.start)}
              disabled={!audio}
              className="group flex w-full gap-4 rounded-xl px-2 py-1.5 text-left transition-colors enabled:hover:bg-subtle"
            >
              <span className="w-24 shrink-0 pt-0.5 text-xs tabular-nums text-ink-3 group-enabled:group-hover:text-ink">
                {clock(s.start)} – {clock(s.end)}
              </span>
              <span className="text-[15px] leading-relaxed">{s.text}</span>
            </button>
          ))}
        </div>
      )}
    </motion.div>
  )
}

function Recent({ transcripts, selectedId }: { transcripts: Transcript[]; selectedId?: string }) {
  const groups = new Map<string, Transcript[]>()
  for (const t of transcripts.slice(0, 50)) {
    const k = dayLabel(t.createdAt)
    groups.set(k, [...(groups.get(k) ?? []), t])
  }
  return (
    <div className="space-y-2 border-t border-line pt-5">
      <div className="text-[13px] font-medium">Recent</div>
      {[...groups].map(([day, items]) => (
        <div key={day}>
          <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-ink-3">{day}</div>
          {items.map((t) => (
            <div
              key={t.id}
              onClick={() => useSession.setState({ selectedId: t.id })}
              className={cn('group flex cursor-pointer items-start gap-3 rounded-xl p-2 transition-colors hover:bg-muted', t.id === selectedId && 'bg-muted')}
            >
              <FileAudio className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium">{t.name}</span>
                  {t.saved === false && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" title="Not saved" />}
                </div>
                <div className="line-clamp-1 text-xs text-ink-3">{t.text || 'No speech found'}</div>
              </div>
              <span className="shrink-0 text-[11px] text-ink-3">{clock(t.durationSec)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
