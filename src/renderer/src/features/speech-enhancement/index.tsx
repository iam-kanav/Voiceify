import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { AnimatePresence, motion } from 'motion/react'
import { AudioWaveform, ChevronDown, ExternalLink, FileAudio, FolderOpen, Pause, Play, Share, Square, Trash2, X } from 'lucide-react'
import type { HistoryItem } from '@shared/types'
import { ENHANCE_PROVIDERS } from '@shared/providers'
import { PageHeader } from '@/components/PageHeader'
import { Dropzone, Recorder } from '@/components/AudioInput'
import { ModelGate } from '@/components/ModelGate'
import { Slider } from '@/components/Slider'
import { InfoTip } from '@/components/InfoTip'
import { Waveform } from '@/components/Waveform'
import { SaveButton, ensureSaveMode } from '@/components/SaveMode'
import { Badge, Button, IconButton, ProgressBar, Tabs } from '@/components/ui'
import { errorMessage, toast } from '@/components/Toast'
import { useApp } from '@/stores/app'
import { enhanceValues, useEnhance } from '@/stores/enhance'
import { playHistoryItem, usePlayer } from '@/stores/player'
import { usePlayerPadding } from '@/lib/useGenerate'
import { useRevealOnPhone } from '@/lib/useReveal'
import { isInstalled } from '@/lib/models'
import { useFilePeaks } from '@/lib/useFilePeaks'
import { decodeToMono, encodeWav, peaks } from '@/lib/wav'
import { clock } from '@shared/subtitles'
import { cn, isWeb, dayLabel, formatTime, studio, uid } from '@/lib/api'

const PROVIDER = ENHANCE_PROVIDERS[0]
const COLORS = PROVIDER.colors
const SPEC = Object.fromEntries(PROVIDER.params.map((p) => [p.key, p]))
/** The model works at 44.1 kHz; decoding there keeps every bit of the source. */
const SR = 44100

interface Source {
  name: string
  wav: Uint8Array
  url: string
  duration: number
  bars: number[]
}

/** The picked file, the running job and the last result survive page switches. */
const useSession = create<{
  file: Source | null
  busy: { jobId: string; name: string; step: number; total: number } | null
  latestId: string | null
  /** Original audio for results made this session, so they can be compared. */
  originals: Record<string, Source>
}>(() => ({ file: null, busy: null, latestId: null, originals: {} }))

export default function SpeechEnhancement() {
  const s = useEnhance()
  const { file, busy, latestId, originals } = useSession()
  const results = useRevealOnPhone<HTMLElement>(busy?.jobId)
  useApp((st) => st.settings?.providerDefaults?.[PROVIDER.id]) // re-render when Settings defaults change
  const models = useApp((st) => st.models)
  const engine = useApp((st) => st.engine)
  const history = useApp((st) => st.history)
  const pad = usePlayerPadding()
  const [decoding, setDecoding] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const v = enhanceValues(s, PROVIDER.id)
  const overridden = s.nfe !== undefined || s.lambd !== undefined || s.tau !== undefined
  const model = models.find((m) => m.capabilities.includes('enhance-speech') && isInstalled(m))
  const items = useMemo(() => history.filter((h) => h.mode === 'enhance'), [history])
  const latest = items.find((h) => h.id === latestId)

  useEffect(
    () =>
      studio.on('generationProgress', ({ jobId, step, total }) => {
        const b = useSession.getState().busy
        if (b?.jobId === jobId) useSession.setState({ busy: { ...b, step, total } })
      }),
    []
  )

  const ingest = async (data: ArrayBuffer, name: string) => {
    setDecoding(true)
    try {
      const mono = await decodeToMono(data, SR)
      if (mono.length < SR * 0.25) throw new Error('That clip is too short to enhance.')
      const wav = encodeWav(mono, SR)
      const url = URL.createObjectURL(new Blob([wav.slice().buffer], { type: 'audio/wav' }))
      useSession.setState({ file: { name, wav, url, duration: mono.length / SR, bars: peaks(mono, 96) } })
    } catch (e) {
      toast.error('Couldn’t read this file', /decode/i.test(errorMessage(e)) ? 'This format isn’t supported. Try WAV, MP3, M4A, FLAC, OGG or a video file.' : errorMessage(e))
    } finally {
      setDecoding(false)
    }
  }

  const run = async () => {
    if (!file || busy || !model) return
    if (!(await ensureSaveMode())) return
    const jobId = uid()
    useSession.setState({ busy: { jobId, name: file.name, step: 0, total: 0 } })
    try {
      const item = await studio.enhanceAudio({ jobId, audio: file.wav, name: file.name, mode: s.mode, modelId: model.id, settings: v })
      useSession.setState((st) => ({ latestId: item.id, file: null, originals: { ...st.originals, [item.id]: file } }))
      playHistoryItem(item, COLORS)
    } catch (e) {
      const msg = errorMessage(e)
      if (!/cancelled/i.test(msg)) toast.error('Couldn’t enhance that recording', msg)
    } finally {
      useSession.setState({ busy: null })
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Speech Enhancement"
        subtitle="Remove background noise and restore the quality of speech recordings, on your computer."
        right={
          <button onClick={() => studio.openExternal(PROVIDER.url)} className="flex items-center gap-1 text-xs text-ink-3 transition-colors hover:text-ink">
            Resemble Enhance by Resemble AI <ExternalLink className="size-3" />
          </button>
        }
      />
      <div className={cn('flex min-h-0 flex-1 border-t border-line max-md:flex-col max-md:overflow-y-auto', pad)}>
        <section className="scroll w-[min(440px,42%)] shrink-0 space-y-6 border-r border-line p-6 max-md:w-full max-md:overflow-visible max-md:border-r-0 max-md:p-4">
          <div className="space-y-2">
            <div className="text-[13px] font-medium">Recording</div>
            <AnimatePresence mode="wait" initial={false}>
              {file ? (
                <motion.div key="file" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <SourceCard src={file} onRemove={() => useSession.setState({ file: null })} />
                </motion.div>
              ) : (
                <motion.div key="pick" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid grid-cols-2 gap-3">
                  <Dropzone className="h-32" busy={decoding} title="Upload a file" hint="Any audio or video" onFile={(f) => f.arrayBuffer().then((b) => ingest(b, f.name))} />
                  <Recorder className="h-32" stopHint="Click to stop" onDone={(b) => ingest(b, `Recording ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`)} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[13px] font-medium">
              Mode
              <InfoTip width={300}>
                <b>Enhance</b> removes noise, then rebuilds the voice at studio quality: it restores lost high frequencies and reduces distortion. <b>Denoise only</b> just
                removes background noise and is several times faster, with a lighter touch.
              </InfoTip>
            </div>
            <Tabs
              id="enhance-mode"
              value={s.mode}
              onChange={(mode) => useEnhance.setState({ mode })}
              tabs={[
                { id: 'enhance', label: 'Enhance' },
                { id: 'denoise', label: 'Denoise only' }
              ]}
            />
          </div>

          {s.mode === 'enhance' && (
            <>
              <Slider
                label={SPEC.steps.label}
                value={v.nfe}
                min={SPEC.steps.min}
                max={SPEC.steps.max}
                step={1}
                onChange={(x) => useEnhance.setState({ nfe: Math.round(x) })}
                left={SPEC.steps.left}
                right={SPEC.steps.right}
                format={(x) => String(Math.round(x))}
                hint={SPEC.steps.help}
              />
              <Slider
                label={SPEC.denoiseStrength.label}
                value={v.lambd}
                min={0}
                max={1}
                step={SPEC.denoiseStrength.step}
                onChange={(x) => useEnhance.setState({ lambd: x })}
                left={SPEC.denoiseStrength.left}
                right={SPEC.denoiseStrength.right}
                format={(x) => x.toFixed(2)}
                hint={SPEC.denoiseStrength.help}
              />
              <div>
                <button onClick={() => setAdvanced((a) => !a)} className="flex w-full items-center justify-between text-[13px] font-medium text-ink-2 hover:text-ink">
                  Advanced
                  <ChevronDown className={cn('size-4 transition-transform', advanced && 'rotate-180')} />
                </button>
                <AnimatePresence initial={false}>
                  {advanced && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-5 pt-4">
                        <Slider
                          label={SPEC.priorTemperature.label}
                          value={v.tau}
                          min={0}
                          max={1}
                          step={SPEC.priorTemperature.step}
                          onChange={(x) => useEnhance.setState({ tau: x })}
                          left={SPEC.priorTemperature.left}
                          right={SPEC.priorTemperature.right}
                          format={(x) => x.toFixed(2)}
                          hint={SPEC.priorTemperature.help}
                        />
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-1.5 text-[13px] font-medium">
                            Solver
                            <InfoTip>Midpoint (the original default) is more accurate per step. Euler is simpler; it makes one evaluation per step, so it needs more steps for the same smoothness.</InfoTip>
                          </div>
                          <Tabs
                            id="enhance-solver"
                            value={s.solver}
                            onChange={(solver) => useEnhance.setState({ solver })}
                            tabs={[
                              { id: 'midpoint', label: 'Midpoint' },
                              { id: 'euler', label: 'Euler' }
                            ]}
                          />
                        </div>
                        <div className="flex items-center justify-between text-xs text-ink-3">
                          <span>Defaults come from Settings → Model settings.</span>
                          {overridden && (
                            <button className="underline hover:text-ink" onClick={() => useEnhance.setState({ nfe: undefined, lambd: undefined, tau: undefined })}>
                              Reset to defaults
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          )}

          {!model ? (
            <ModelGate cap="enhance-speech" provider={PROVIDER.id} compact />
          ) : busy ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Button size="lg" className="flex-1" loading disabled>
                  {busy.total ? `${Math.round((busy.step / busy.total) * 100)}%` : 'Starting…'}
                </Button>
                <Button size="lg" variant="outline" onClick={() => studio.cancelGeneration(busy.jobId)} icon={<Square className="size-3.5" fill="currentColor" />}>
                  Stop
                </Button>
              </div>
              <ProgressBar value={busy.total ? busy.step / busy.total : 0} indeterminate={!busy.total} />
            </div>
          ) : (
            <Button size="lg" className="w-full" disabled={!file || engine.state !== 'ready'} onClick={run} icon={<AudioWaveform className="size-4" />}>
              {s.mode === 'denoise' ? 'Remove noise' : 'Enhance speech'}
            </Button>
          )}

          <p className="text-[11px] leading-relaxed text-ink-3">
            Resemble Enhance © Resemble AI, MIT License. Works on speech; music and sound effects in the recording are not preserved.
          </p>
        </section>

        <section ref={results} className="scroll flex min-w-0 flex-1 flex-col max-md:min-h-[55dvh] max-md:flex-none max-md:overflow-visible max-md:border-t max-md:border-line">
          {busy ? (
            <Working busy={busy} />
          ) : latest ? (
            <Result item={latest} original={originals[latest.id]} />
          ) : (
            !items.length && <Empty />
          )}
          {items.length > 0 && <Recent items={items} exclude={busy ? undefined : latestId} originals={originals} />}
        </section>
      </div>
    </div>
  )
}

function SourceCard({ src, onRemove }: { src: Source; onRemove: () => void }) {
  const [id] = useState(() => `enh-src-${uid()}`)
  const clip = usePlayer((st) => st.clip)
  const status = usePlayer((st) => st.status)
  const playing = clip?.id === id && status === 'playing'
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line p-3">
      <button
        onClick={() => (clip?.id === id ? usePlayer.getState().toggle() : usePlayer.getState().play({ id, title: src.name, subtitle: 'Original', url: src.url }))}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink active:scale-90"
      >
        {playing ? <Pause className="size-3.5" fill="currentColor" /> : <Play className="ml-0.5 size-3.5" fill="currentColor" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <FileAudio className="size-4 shrink-0 text-ink-3" />
          <span className="truncate">{src.name}</span>
        </div>
        <div className="text-xs text-ink-3">{clock(src.duration)}</div>
      </div>
      <IconButton label="Remove" onClick={onRemove}>
        <X className="size-4" />
      </IconButton>
    </div>
  )
}

/** Original vs result, each playable, with the result's actions. */
function Result({ item, original }: { item: HistoryItem; original?: Source }) {
  const bars = useFilePeaks(item.audioPath)
  const e = item.enhance
  return (
    <div className="border-b border-line px-8 max-md:px-4 py-6">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-3">{item.voiceName}</div>
      <div className="mb-1 text-[15px] font-semibold">{item.text}</div>
      {e && (
        <div className="mb-4 text-xs text-ink-3">
          {e.mode === 'denoise' ? 'Denoise only' : `Enhance · ${e.nfe} steps · strength ${e.lambd.toFixed(2)} · ${e.solver}`} · took {item.processingSec.toFixed(1)} s for{' '}
          {formatTime(e.inputSec)}
        </div>
      )}
      <div className="grid gap-3">
        {original && <PlayRow id={`orig-${item.id}`} label="Original" url={original.url} bars={original.bars} duration={original.duration} />}
        <PlayRow id={item.id} label={item.voiceName} item={item} bars={bars} duration={item.durationSec} highlight />
      </div>
      {!original && <p className="mt-3 text-xs text-ink-3">The original isn’t kept after you leave Voiceify, so only the result can be played.</p>}
    </div>
  )
}

function PlayRow({ id, label, url, item, bars, duration, highlight }: { id: string; label: string; url?: string; item?: HistoryItem; bars: number[]; duration: number; highlight?: boolean }) {
  const clip = usePlayer((st) => st.clip)
  const status = usePlayer((st) => st.status)
  const current = clip?.id === id
  const playing = current && status === 'playing'
  const play = () => {
    if (current && status !== 'loading') return usePlayer.getState().toggle()
    if (item) return playHistoryItem(item, COLORS)
    usePlayer.getState().play({ id, title: label, subtitle: 'Original', url })
  }
  return (
    <div className={cn('group flex items-center gap-4 rounded-2xl border p-3 transition-colors', current ? 'border-line-strong bg-subtle' : 'border-line')}>
      <button onClick={play} className={cn('flex size-10 shrink-0 items-center justify-center rounded-full active:scale-90', highlight ? 'bg-accent text-accent-ink' : 'bg-muted text-ink')}>
        {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="ml-0.5 size-4" fill="currentColor" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 text-xs text-ink-3">
          <span className="font-medium text-ink-2">{label}</span>·<span>{formatTime(duration)}</span>
          {item?.saved === false && <Badge tone="amber">Not saved</Badge>}
        </div>
        <Waveform peaks={bars} active={current} height={28} onSeek={(f) => (current ? usePlayer.getState().seek(f * duration) : play())} />
      </div>
      {item && (
        <div className="flex shrink-0 items-center gap-0.5">
          {item.saved === false && <SaveButton compact saved={false} onSave={() => studio.saveHistory(item.id)} />}
          <ItemActions item={item} />
        </div>
      )}
    </div>
  )
}

function ItemActions({ item }: { item: HistoryItem }) {
  return (
    <>
      {!isWeb && (
        <IconButton label="Show in Finder" onClick={() => studio.revealInFinder(item.audioPath)}>
          <FolderOpen className="size-4" />
        </IconButton>
      )}
      <IconButton
        label="Export as WAV…"
        onClick={async () => {
          const p = await studio.exportAudio(item.id)
          if (p) toast.success('Exported', p)
        }}
      >
        <Share className="size-4" />
      </IconButton>
      <IconButton label="Delete" onClick={() => studio.deleteHistory(item.id)}>
        <Trash2 className="size-4" />
      </IconButton>
    </>
  )
}

function Working({ busy }: { busy: { name: string; step: number; total: number } }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-10 py-16 text-center">
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
        <div className="text-[15px] font-semibold">Cleaning up {busy.name}</div>
        <div className="mt-1 text-[13px] tabular-nums text-ink-3">
          {busy.total ? `${Math.round((busy.step / busy.total) * 100)}% done` : 'Loading the model…'}
        </div>
      </div>
    </div>
  )
}

function Empty() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
        <AudioWaveform className="size-5 text-ink-2" />
      </div>
      <div className="mt-4 text-[15px] font-semibold">Your cleaned-up recordings appear here</div>
      <p className="mt-1 max-w-sm text-[13px] text-ink-3">
        Drop in a noisy voice memo, a Zoom call, a phone recording or an old interview. Compare the original and the result side by side.
      </p>
    </div>
  )
}

function Recent({ items, exclude, originals }: { items: HistoryItem[]; exclude?: string | null; originals: Record<string, Source> }) {
  const groups = useMemo(() => {
    const g = new Map<string, HistoryItem[]>()
    for (const h of items.filter((x) => x.id !== exclude).slice(0, 200)) {
      const k = dayLabel(h.createdAt)
      g.set(k, [...(g.get(k) ?? []), h])
    }
    return [...g]
  }, [items, exclude])
  const clip = usePlayer((st) => st.clip)
  const status = usePlayer((st) => st.status)
  if (!groups.length) return null
  return (
    <div className="px-6 py-5">
      <div className="mb-2 px-2 text-[13px] font-medium">Recent</div>
      {groups.map(([day, rows]) => (
        <div key={day} className="mb-3">
          <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-ink-3">{day}</div>
          {rows.map((h) => {
            const current = clip?.id === h.id
            const playing = current && status === 'playing'
            return (
              <div
                key={h.id}
                onClick={() => (current && status !== 'loading' ? usePlayer.getState().toggle() : playHistoryItem(h, COLORS))}
                className={cn('group flex cursor-pointer items-center gap-3 rounded-xl p-2 transition-colors hover:bg-muted', current && 'bg-muted')}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-subtle text-ink-2">
                  {playing ? <Pause className="size-3" fill="currentColor" /> : <Play className="ml-0.5 size-3" fill="currentColor" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{h.text}</div>
                  <div className="text-[11px] text-ink-3">
                    {h.voiceName} · {formatTime(h.durationSec)}
                    {originals[h.id] ? ' · original available' : ''}
                    {h.saved === false && ' · not saved'}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                  <ItemActions item={h} />
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
