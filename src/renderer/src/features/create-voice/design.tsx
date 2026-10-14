import { useState } from 'react'
import { create } from 'zustand'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Loader2, Pause, Play, Shuffle, Sparkles } from 'lucide-react'
import type { HistoryItem } from '@shared/types'
import { formatBytes, LANGUAGES } from '@shared/catalog'
import { DESIGN_EXAMPLES, randomColors } from '@shared/voices'
import { Button, Field, Input, Tabs, Textarea } from '@/components/ui'
import { Select } from '@/components/Popover'
import { Slider } from '@/components/Slider'
import { ModelGate } from '@/components/ModelGate'
import { Modal } from '@/components/Modal'
import { VoiceAvatar } from '@/components/VoiceAvatar'
import { errorMessage, toast } from '@/components/Toast'
import { useApp } from '@/stores/app'
import { useTts } from '@/stores/tts'
import { usePlayer } from '@/stores/player'
import { cn, formatTime, studio, uid } from '@/lib/api'
import { isInstalled, recommendedFor } from '@/lib/models'
import { InfoTip } from '@/components/InfoTip'
import { usePlayerPadding } from '@/lib/useGenerate'

const DEFAULT_PREVIEW =
  "Every voice tells a story. Some whisper secrets, others command the room — and this one was designed just for you, from nothing but a few words."

interface Preview {
  key: string
  status: 'pending' | 'running' | 'done' | 'error'
  item?: HistoryItem
  colors: [string, string]
  error?: string
  /** The description this take was generated from (the text box may change afterwards). */
  prompt: string
}

/** Kept outside the component so work survives switching tabs or pages. */
interface DesignState {
  prompt: string
  previewText: string
  language: string
  temperature: number
  count: '1' | '2' | '3'
  previews: Preview[]
  running: boolean
}

const useDesign = create<DesignState>(() => ({
  prompt: '',
  previewText: DEFAULT_PREVIEW,
  language: 'auto',
  temperature: 0.9,
  count: '3',
  previews: [],
  running: false
}))

function setter<K extends keyof DesignState>(key: K) {
  return (v: DesignState[K] | ((prev: DesignState[K]) => DesignState[K])) =>
    useDesign.setState((s) => ({ [key]: typeof v === 'function' ? (v as (p: DesignState[K]) => DesignState[K])(s[key]) : v }) as Partial<DesignState>)
}
const setPrompt = setter('prompt')
const setPreviewText = setter('previewText')
const setLanguage = setter('language')
const setTemperature = setter('temperature')
const setCount = setter('count')
const setPreviews = setter('previews')
const setRunning = setter('running')

let cancelled = false
let currentJob: string | null = null

export function DesignPanel() {
  const models = useApp((s) => s.models)
  const navigate = useApp((s) => s.navigate)
  const hasModel = models.some((m) => isInstalled(m) && m.capabilities.includes('voice-design'))
  const { prompt, previewText, language, temperature, count, previews, running } = useDesign()
  const [saving, setSaving] = useState<Preview | null>(null)
  const pad = usePlayerPadding()

  const generate = async () => {
    if (!prompt.trim() || running) return
    cancelled = false
    const n = Number(count)
    const description = prompt.trim()
    const batch: Preview[] = Array.from({ length: n }, (_, i) => ({
      key: uid(),
      status: i === 0 ? 'running' : 'pending',
      colors: randomColors(prompt + i + Date.now()),
      prompt: description
    }))
    setPreviews(batch)
    setRunning(true)
    for (let i = 0; i < n; i++) {
      if (cancelled) break
      const key = batch[i].key
      setPreviews((p) => p.map((x) => (x.key === key ? { ...x, status: 'running' } : x)))
      const jobId = uid()
      currentJob = jobId
      try {
        const item = await studio.generate({
          jobId,
          text: previewText.trim() || DEFAULT_PREVIEW,
          designPrompt: description,
          stream: false,
          // Spread the previews out a little so each one sounds distinct.
          settings: { language, temperature: Math.min(1.4, temperature + i * 0.08) }
        })
        setPreviews((p) => p.map((x) => (x.key === key ? { ...x, status: 'done', item } : x)))
        if (i === 0) playPreview({ ...batch[0], item, status: 'done' })
      } catch (e) {
        const msg = errorMessage(e)
        setPreviews((p) => p.map((x) => (x.key === key ? { ...x, status: 'error', error: msg } : x)))
        if (!/cancelled/i.test(msg)) toast.error('Preview failed', msg)
        break
      }
    }
    currentJob = null
    setRunning(false)
    setPreviews((p) => p.filter((x) => x.status !== 'pending'))
  }

  const stop = () => {
    cancelled = true
    if (currentJob) studio.cancelGeneration(currentJob)
  }

  return (
    <>
      <div className={cn('flex min-h-0 flex-1 border-t border-line', pad)}>
        <section className="scroll w-[min(560px,48%)] shrink-0 space-y-6 border-r border-line p-8">
          {!hasModel && <ModelGate cap="voice-design" />}
          <Field
            label="Voice description"
            right={
              <button
                onClick={() => setPrompt(DESIGN_EXAMPLES[Math.floor(Math.random() * DESIGN_EXAMPLES.length)].prompt)}
                className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink"
              >
                <Shuffle className="size-3.5" /> Random
              </button>
            }
            hint="Mention age, gender, accent, pitch, timbre, emotion and pace for best results."
          >
            <Textarea
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. A warm, raspy female voice in her 60s with a soft Irish lilt, speaking slowly like a beloved storyteller."
            />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {DESIGN_EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                onClick={() => setPrompt(ex.prompt)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs transition-colors',
                  prompt === ex.prompt ? 'border-ink bg-ink text-canvas' : 'border-line text-ink-2 hover:bg-muted'
                )}
              >
                {ex.label}
              </button>
            ))}
          </div>
          <Field label="Text to preview" hint={`${previewText.length} characters · 60–300 works best`}>
            <Textarea rows={4} value={previewText} onChange={(e) => setPreviewText(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Language">
              <Select value={language} onChange={setLanguage} options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))} />
            </Field>
            <Field
              label={
                <span className="flex items-center gap-1.5">
                  Number of takes
                  <InfoTip>Each take is generated a little differently, so you can pick the one you like best.</InfoTip>
                </span>
              }
            >
              <Tabs
                id="design-count"
                value={count}
                onChange={setCount}
                className="h-10 rounded-xl border border-line-strong px-1"
                tabs={[
                  { id: '1', label: '1' },
                  { id: '2', label: '2' },
                  { id: '3', label: '3' }
                ]}
              />
            </Field>
          </div>
          <Slider
            label="Expressiveness"
            value={temperature}
            min={0.5}
            max={1.3}
            onChange={setTemperature}
            left="Steady"
            right="Expressive"
            format={(v) => v.toFixed(2)}
            hint="How freely the model interprets your description. Steady gives safer, more predictable voices; Expressive gives livelier, more surprising ones. (Sampling temperature, default 0.9.)"
          />
          <div className="flex gap-2">
            <Button
              size="lg"
              className="flex-1"
              onClick={generate}
              loading={running}
              disabled={!prompt.trim() || !hasModel}
              icon={<Sparkles className="size-4" />}
            >
              {running ? 'Designing…' : 'Generate previews'}
            </Button>
            {running && (
              <Button size="lg" variant="outline" onClick={stop}>
                Stop
              </Button>
            )}
          </div>
        </section>

        <section className="scroll flex-1 p-8">
          {!previews.length ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="relative mb-6">
                <VoiceAvatar colors={['#8b5cf6', '#ec4899']} size={88} active={running} />
              </div>
              <h3 className="text-[15px] font-semibold">Your previews will appear here</h3>
              <p className="mt-1 max-w-xs text-sm text-ink-3">Generate a few takes, listen, and save the one you love to your voice library.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="mb-1 text-[13px] font-medium text-ink-2">Previews</div>
              <AnimatePresence initial={false}>
                {previews.map((p, i) => (
                  <PreviewCard key={p.key} preview={p} index={i} onSave={() => setSaving(p)} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>
      </div>

      <SaveVoiceModal
        preview={saving}
        onClose={() => setSaving(null)}
        onSaved={(id) => {
          setSaving(null)
          toast.success('Voice saved to your library', (
            <button className="underline" onClick={() => (useTts.getState().setVoice(id), navigate('tts'))}>
              Use it in Text to Speech
            </button>
          ))
        }}
      />
    </>
  )
}

function playPreview(p: Preview) {
  if (!p.item) return
  usePlayer.getState().play({ id: p.item.id, title: 'Designed voice', subtitle: p.item.text, path: p.item.audioPath, colors: p.colors, item: p.item })
}

function PreviewCard({ preview, index, onSave }: { preview: Preview; index: number; onSave: () => void }) {
  const clip = usePlayer((s) => s.clip)
  const status = usePlayer((s) => s.status)
  const isCurrent = clip?.id === preview.item?.id
  const playing = isCurrent && status === 'playing'
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0, transition: { delay: index * 0.05 } }}
      exit={{ opacity: 0, scale: 0.97 }}
      className={cn('flex items-center gap-4 rounded-2xl border bg-surface p-4 transition-colors', isCurrent ? 'border-line-strong' : 'border-line')}
    >
      <button
        disabled={preview.status !== 'done'}
        onClick={() => (isCurrent ? usePlayer.getState().toggle() : playPreview(preview))}
        className="relative flex size-12 shrink-0 items-center justify-center"
      >
        <VoiceAvatar colors={preview.colors} size={48} active={preview.status === 'running' || playing} />
        <span className="absolute inset-0 flex items-center justify-center text-white">
          {preview.status === 'running' ? (
            <Loader2 className="size-5 animate-spin" />
          ) : preview.status === 'done' ? (
            playing ? <Pause className="size-5" fill="white" /> : <Play className="ml-0.5 size-5" fill="white" />
          ) : null}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Preview {index + 1}</div>
        <div className="text-xs text-ink-3">
          {preview.status === 'pending' && 'Waiting…'}
          {preview.status === 'running' && 'Designing voice…'}
          {preview.status === 'done' && preview.item && `${formatTime(preview.item.durationSec)} · generated in ${preview.item.processingSec.toFixed(1)}s`}
          {preview.status === 'error' && <span className="text-danger">{preview.error}</span>}
        </div>
      </div>
      {preview.status === 'done' && (
        <Button size="sm" variant="outline" icon={<Check className="size-3.5" />} onClick={onSave}>
          Save voice
        </Button>
      )}
    </motion.div>
  )
}

function SaveVoiceModal({
  preview,
  onClose,
  onSaved
}: {
  preview: Preview | null
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const models = useApp((s) => s.models)
  const canClone = models.some((m) => isInstalled(m) && m.capabilities.includes('voice-clone'))
  const cloneModel = recommendedFor('voice-clone', models)
  const save = async () => {
    if (!preview?.item) return
    setBusy(true)
    try {
      const v = await studio.saveDesignedVoice({ name: name.trim() || 'Designed voice', designPrompt: preview.prompt, historyId: preview.item.id })
      setName('')
      onSaved(v.id)
    } catch (e) {
      toast.error('Could not save voice', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={!!preview}
      onClose={onClose}
      title="Save designed voice"
      description="This take becomes the voice’s reference recording, so it sounds the same every time you use it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            Save voice
          </Button>
        </>
      }
    >
      <div className="space-y-1.5">
        <div className="text-[13px] font-medium">Voice name</div>
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Old Storyteller" onKeyDown={(e) => e.key === 'Enter' && save()} />
      </div>
      {!canClone && (
        <div className="mt-4 rounded-xl bg-amber-500/10 p-3 text-[13px] text-amber-800 dark:text-amber-300">
          <div className="font-medium">To keep this exact voice, also install Voice Cloning</div>
          <p className="mt-0.5 opacity-90">
            Saved voices are spoken by the Voice Cloning model, which copies this take. Without it, the voice is re-created from your description each
            time and will sound a little different.
          </p>
          {cloneModel && cloneModel.install.status === 'not-installed' && (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => studio.installModel(cloneModel.id)}>
              Download Voice Cloning ({formatBytes(cloneModel.sizeBytes)})
            </Button>
          )}
          {cloneModel && cloneModel.install.status === 'downloading' && <p className="mt-2 text-xs">Downloading Voice Cloning…</p>}
        </div>
      )}
    </Modal>
  )
}
