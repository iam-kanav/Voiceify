import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { formatBytes } from '@shared/catalog'
import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2, FileAudio, Loader2, Pause, Play, Trash2, Wand } from 'lucide-react'
import { Badge, Button, Field, Input, Textarea } from '@/components/ui'
import { ModelGate } from '@/components/ModelGate'
import { VoiceAvatar } from '@/components/VoiceAvatar'
import { errorMessage, toast } from '@/components/Toast'
import { useApp } from '@/stores/app'
import { selectVoiceById } from '@/stores/tts'
import { usePlayer } from '@/stores/player'
import { cn, formatTime, studio, uid } from '@/lib/api'
import { decodeToMono, encodeWav, normalize, peaks as computePeaks, TARGET_SR, trimSilence } from '@/lib/wav'
import { isInstalled } from '@/lib/models'
import { usePlayerPadding } from '@/lib/useGenerate'
import { PortabilityNote } from './PortabilityNote'
import { Dropzone, Recorder } from '@/components/AudioInput'

const SCRIPT =
  'The quick brown fox jumps over the lazy dog. I love long walks on quiet mornings, a hot cup of coffee, and the sound of rain against the window. Honestly, it’s the little things that make a day feel special.'

interface Clip {
  wav: Uint8Array
  url: string
  duration: number
  peaks: number[]
  source: string
  /** The original was longer than 30 s and was cut. */
  trimmed: boolean
}

/** Kept outside the component so a half-finished clone survives switching tabs or pages. */
interface CloneState {
  name: string
  nameAuto: boolean
  description: string
  transcript: string
  clip: Clip | null
  savedId: string | null
}
const useClone = create<CloneState>(() => ({ name: '', nameAuto: false, description: '', transcript: '', clip: null, savedId: null }))
const setName = (name: string, auto = false) => useClone.setState({ name, nameAuto: auto })
const setDescription = (description: string) => useClone.setState({ description })
const setTranscript = (transcript: string) => useClone.setState({ transcript })
const setClip = (clip: Clip | null) => useClone.setState({ clip })
const setSavedId = (savedId: string | null) => useClone.setState({ savedId })

export function ClonePanel() {
  const models = useApp((s) => s.models)
  const navigate = useApp((s) => s.navigate)
  const hasClone = models.some((m) => isInstalled(m) && m.capabilities.includes('voice-clone'))
  const hasAsr = models.some((m) => isInstalled(m) && m.capabilities.includes('transcribe'))
  const asrModel = models.find((m) => m.id === 'qwen3-asr-0.6b-8bit')
  const { name, nameAuto, description, transcript, clip, savedId } = useClone()
  const [processing, setProcessing] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const pad = usePlayerPadding()

  // If the transcription model finishes downloading after a clip was added, transcribe right away.
  useEffect(() => {
    if (hasAsr && clip && !transcript && !transcribing) autoTranscribe(clip.wav)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAsr])

  const ingest = async (data: ArrayBuffer, source: string) => {
    setProcessing(true)
    try {
      const mono = await decodeToMono(data)
      const trimmed = normalize(trimSilence(mono, TARGET_SR, 30))
      const duration = trimmed.length / TARGET_SR
      if (duration < 3) throw new Error('That clip is too short. Use at least 3 seconds of clear speech.')
      const wav = encodeWav(trimmed)
      if (clip) URL.revokeObjectURL(clip.url)
      const url = URL.createObjectURL(new Blob([wav.slice().buffer], { type: 'audio/wav' }))
      const wasTrimmed = mono.length / TARGET_SR > 30.5
      setClip({ wav, url, duration, peaks: computePeaks(trimmed, 90), source, trimmed: wasTrimmed })
      setSavedId(null)
      // A new clip means new words: always re-transcribe.
      setTranscript('')
      if (!name || nameAuto) setName(source === 'Recording' ? 'My voice' : source.replace(/\.[^.]+$/, '').slice(0, 40) || 'My voice', true)
      if (hasAsr) autoTranscribe(wav)
    } catch (e) {
      toast.error('Could not use this audio', errorMessage(e))
    } finally {
      setProcessing(false)
    }
  }

  const autoTranscribe = async (wav = clip?.wav) => {
    if (!wav) return
    setTranscribing(true)
    try {
      const { text } = await studio.transcribe(wav)
      // Ignore the result if the user swapped clips meanwhile.
      if (useClone.getState().clip?.wav === wav) setTranscript(text)
    } catch (e) {
      toast.error('Transcription failed', errorMessage(e))
    } finally {
      setTranscribing(false)
    }
  }

  const save = async () => {
    if (!clip) return
    setSaving(true)
    try {
      const v = await studio.createClonedVoice({ name: name.trim() || 'My voice', description, audio: clip.wav, refText: transcript.trim() || undefined })
      setSavedId(v.id)
    } catch (e) {
      toast.error('Could not create voice', errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    if (clip) URL.revokeObjectURL(clip.url)
    useClone.setState({ name: '', nameAuto: false, description: '', transcript: '', clip: null, savedId: null })
  }

  const test = async () => {
    if (!savedId) return
    setTesting(true)
    const voice = useApp.getState().voices.find((v) => v.id === savedId)
    try {
      const item = await studio.generate({
        jobId: uid(),
        text: 'Hi! This is my new voice. How does it sound to you?',
        voiceId: savedId,
        stream: false
      })
      await usePlayer.getState().play({ id: item.id, title: voice?.name ?? 'Cloned voice', subtitle: item.text, path: item.audioPath, colors: voice?.colors, item })
    } catch (e) {
      toast.error('Couldn’t play a test', errorMessage(e))
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <div className={cn('flex min-h-0 flex-1 border-t border-line', pad)}>
        <section className="scroll w-[min(600px,52%)] shrink-0 space-y-6 border-r border-line p-8">
          {!hasClone ? <ModelGate cap="voice-clone" /> : !savedId && <PortabilityNote mode="clone" />}

          <AnimatePresence mode="wait">
            {savedId ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="rounded-2xl border border-line p-8 text-center"
              >
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }}>
                  <CheckCircle2 className="mx-auto size-10 text-success" />
                </motion.div>
                <h3 className="mt-4 text-[15px] font-semibold">“{name || 'My voice'}” is saved</h3>
                <p className="mt-1 text-sm text-ink-3">
                  {hasClone
                    ? 'Find it in Voices. Connected AI apps (Agents & MCP) can use it too.'
                    : 'You can use it as soon as the Voice Cloning model finishes downloading.'}
                </p>
                <div className="mt-5 flex justify-center gap-2">
                  <Button variant="outline" onClick={reset}>
                    Clone another
                  </Button>
                  {hasClone && (
                    <Button variant="outline" onClick={test} loading={testing} icon={<Play className="size-3.5" />}>
                      Hear a test
                    </Button>
                  )}
                  <Button onClick={() => (selectVoiceById(savedId), navigate('tts'))}>Use in Text to Speech</Button>
                </div>
              </motion.div>
            ) : (
              <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                <Field label="Name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My narration voice" />
                </Field>

                <Field label="Reference audio" hint="Any audio or video file works. Silence is trimmed and the first 30 s are used — 3 s is enough, 10–20 s of clean speech from one speaker works best.">
                  {clip ? (
                    <ClipCard
                      clip={clip}
                      onRemove={() => {
                        URL.revokeObjectURL(clip.url)
                        useClone.setState({ clip: null, transcript: '', ...(nameAuto ? { name: '', nameAuto: false } : {}) })
                      }}
                    />
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <Dropzone onFile={(f) => f.arrayBuffer().then((b) => ingest(b, f.name))} busy={processing} />
                      <Recorder onDone={(b) => ingest(b, 'Recording')} />
                    </div>
                  )}
                </Field>

                <Field
                  label="Transcript"
                  right={
                    hasAsr ? (
                      <button
                        disabled={!clip || transcribing}
                        onClick={() => autoTranscribe()}
                        className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink disabled:opacity-40"
                      >
                        {transcribing ? <Loader2 className="size-3.5 animate-spin" /> : <Wand className="size-3.5" />}
                        Re-transcribe
                      </button>
                    ) : asrModel && (asrModel.install.status === 'not-installed' || asrModel.install.status === 'error') ? (
                      <button
                        onClick={() => studio.installModel(asrModel.id).catch((e) => toast.error('Download failed', errorMessage(e)))}
                        className="text-xs text-ink-3 underline-offset-2 hover:text-ink hover:underline"
                      >
                        {asrModel.install.status === 'error' ? 'Retry download' : `Auto-fill transcript (download ${formatBytes(asrModel.sizeBytes)})`}
                      </button>
                    ) : asrModel && asrModel.install.status === 'downloading' ? (
                      <span className="text-xs text-ink-3">
                        Downloading transcription model… {Math.round((asrModel.install.received / Math.max(1, asrModel.install.total)) * 100)}%
                      </span>
                    ) : asrModel && (asrModel.install.status === 'queued' || asrModel.install.status === 'converting') ? (
                      <span className="text-xs text-ink-3">Preparing transcription model…</span>
                    ) : null
                  }
                  hint={
                    hasAsr
                      ? 'Filled in automatically — fix anything that’s off. An accurate transcript makes the clone sound more like the original.'
                      : 'Type the exact words spoken in the clip, or download the transcription model to fill this in automatically. Left empty, the voice is copied from its tone alone, which is less accurate.'
                  }
                >
                  <Textarea
                    rows={3}
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    placeholder={transcribing ? 'Transcribing…' : 'What is said in the sample?'}
                  />
                </Field>

                <Field label="Description (optional)">
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Calm, friendly, mid-30s" />
                </Field>

                <Button size="lg" className="w-full" disabled={!clip || transcribing} loading={saving} onClick={save}>
                  {transcribing ? 'Transcribing…' : 'Save cloned voice'}
                </Button>
                {!hasClone && clip && (
                  <p className="-mt-3 text-center text-xs text-ink-3">You can save now and use the voice once the Voice Cloning model is installed.</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <section className="scroll flex-1 p-8">
          <div className="mx-auto max-w-md space-y-6">
            <div className="flex items-center gap-3">
              <VoiceAvatar colors={['#0ea5e9', '#22c55e']} size={44} />
              <div>
                <div className="text-[15px] font-semibold">Tips for a great clone</div>
                <div className="text-[13px] text-ink-3">As little as 3 seconds is enough.</div>
              </div>
            </div>
            <ul className="space-y-3 text-[13px] text-ink-2">
              {[
                'Record in a quiet room, ~15 cm from the mic.',
                'Speak naturally, in the style you want to reproduce.',
                'Avoid music, reverb, laughter or overlapping speakers.',
                'Keep the transcript accurate — the clone is aligned against it.',
                'Your clone can speak English, Chinese, Japanese, Korean, German, French, Russian, Portuguese, Spanish and Italian.'
              ].map((t) => (
                <li key={t} className="flex gap-2.5">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  {t}
                </li>
              ))}
            </ul>
            <div className="rounded-2xl border border-line p-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-medium">Need something to read?</span>
                <Badge>~15 s</Badge>
              </div>
              <p className="text-[14px] leading-relaxed text-ink-2">{SCRIPT}</p>
              <button onClick={() => setTranscript(SCRIPT)} className="mt-3 text-xs text-ink-3 underline-offset-2 hover:text-ink hover:underline">
                Use as transcript
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}

function ClipCard({ clip, onRemove }: { clip: Clip; onRemove: () => void }) {
  const cur = usePlayer((s) => s.clip)
  const status = usePlayer((s) => s.status)
  const [id] = useState(() => `clone-${uid()}`)
  const playing = cur?.id === id && status === 'playing'
  const quality = clip.trimmed
    ? { t: 'Trimmed to the first 30 s', tone: 'neutral' as const }
    : clip.duration < 8
      ? { t: 'Works — 10 s or more sounds better', tone: 'amber' as const }
      : { t: 'Great length', tone: 'green' as const }
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-line p-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => (cur?.id === id ? usePlayer.getState().toggle() : usePlayer.getState().play({ id, title: 'Reference sample', subtitle: clip.source, url: clip.url }))}
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink active:scale-90"
        >
          {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="ml-0.5 size-4" fill="currentColor" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileAudio className="size-4 text-ink-3" />
            <span className="truncate">{clip.source}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
            {formatTime(clip.duration)} <Badge tone={quality.tone}>{quality.t}</Badge>
          </div>
        </div>
        <button onClick={onRemove} className="flex size-8 items-center justify-center rounded-full text-ink-3 hover:bg-muted hover:text-danger">
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="mt-3 flex h-10 items-center gap-[2px]">
        {clip.peaks.map((p, i) => (
          <span key={i} className="flex-1 rounded-full bg-line-strong" style={{ height: `${Math.max(8, p * 100)}%` }} />
        ))}
      </div>
    </motion.div>
  )
}
