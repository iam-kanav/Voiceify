import { motion } from 'motion/react'
import { Download } from 'lucide-react'
import type { Capability } from '@shared/types'
import { formatBytes } from '@shared/catalog'
import { useApp } from '@/stores/app'
import { recommendedFor } from '@/lib/models'
import { PROVIDER_BY_ID } from '@shared/providers'
import { studio } from '@/lib/api'
import { Button, ProgressBar } from './ui'
import { errorMessage, toast } from './Toast'

/** What the user wants to do → which model unlocks it, in plain words. */
const GATE_COPY: Partial<Record<Capability, { title: string; body: string }>> = {
  'preset-voices': { title: 'Download a voice model to start', body: 'Built-in voices are spoken by the Built-in Voices model.' },
  instruct: { title: 'Style instructions need the Large model', body: 'Built-in Voices (Large) follows instructions like “whisper” or “sound excited”.' },
  'voice-design': { title: 'Voice Design needs its model', body: 'The Voice Design model invents new voices from your description.' },
  'voice-clone': {
    title: 'Voice Cloning needs its model',
    body: 'The Voice Cloning model copies a voice from audio. It also speaks the voices you clone or design and save.'
  },
  transcribe: { title: 'Speech to Text needs a model', body: 'A speech recognition model writes down what is said in any audio or video file.' },
  translate: { title: 'Translation needs Whisper Large', body: 'Whisper Large v3 can write speech in any language as English text. (Whisper Turbo can’t translate.)' },
  'sound-effects': { title: 'Sound Effects needs its model', body: 'Stable Audio 3 Small SFX turns a description into sound effects.' }
}

/** Inline call-to-action shown when the engine or a model for `cap` is missing. */
export function ModelGate({ cap, compact, provider }: { cap: Capability; compact?: boolean; provider?: string }) {
  const models = useApp((s) => s.models)
  const engine = useApp((s) => s.engine)
  const navigate = useApp((s) => s.navigate)
  const family = provider ? PROVIDER_BY_ID.get(provider) : undefined
  const inFamily = (m: (typeof models)[number]) => !provider || m.provider === provider
  const rec =
    recommendedFor(cap, models, provider) ??
    models.find((m) => inFamily(m) && m.capabilities.includes(cap) && m.quant === '8bit') ??
    models.find((m) => inFamily(m) && m.capabilities.includes(cap))

  if (engine.state === 'missing' || engine.state === 'error') {
    return (
      <Callout
        compact={compact}
        title={engine.state === 'missing' ? 'Finish setting up the voice engine' : 'The voice engine ran into a problem'}
        body={
          engine.state === 'missing'
            ? 'A one-time download (about 350 MB) of the software that runs models on this computer.'
            : `${engine.error} Reinstalling usually fixes it.`
        }
        action={
          <Button size="sm" onClick={() => studio.installEngine()}>
            {engine.state === 'missing' ? 'Install engine' : 'Reinstall'}
          </Button>
        }
      />
    )
  }
  if (!rec) return null
  const s = rec.install
  const progress = s.status === 'downloading' ? s.received / Math.max(1, s.total) : 0
  return (
    <Callout
      compact={compact}
      title={family && family.id !== 'qwen3-tts' && cap !== 'translate' ? `Download ${family.name} to use it` : (GATE_COPY[cap]?.title ?? 'This needs a model')}
      body={
        s.status === 'downloading' ? (
          <div className="mt-2 space-y-1.5">
            <ProgressBar value={progress} />
            <div className="text-xs text-ink-3">
              Downloading {rec.name} · {formatBytes(s.received)} / {formatBytes(s.total)}
            </div>
          </div>
        ) : s.status === 'converting' || s.status === 'queued' ? (
          <div className="mt-2">
            <ProgressBar value={0} indeterminate />
          </div>
        ) : s.status === 'error' ? (
          <span className="text-danger">Download failed: {s.error}</span>
        ) : (
          <>
            {family && family.id !== 'qwen3-tts' && cap !== 'translate' ? family.description : GATE_COPY[cap]?.body} Recommended for this computer: <b className="font-medium text-ink">{rec.name}</b> ({formatBytes(rec.sizeBytes)}).
          </>
        )
      }
      action={
        s.status === 'not-installed' || s.status === 'error' ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('models', { family: rec.provider })}>
              All models
            </Button>
            <Button
              size="sm"
              icon={<Download className="size-3.5" />}
              onClick={() => studio.installModel(rec.id).catch((e) => toast.error('Download failed', errorMessage(e)))}
            >
              {s.status === 'error' ? 'Retry' : 'Download'}
            </Button>
          </div>
        ) : null
      }
    />
  )
}

function Callout({ title, body, action, compact }: { title: string; body: React.ReactNode; action: React.ReactNode; compact?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border border-dashed border-line-strong bg-subtle ${compact ? 'p-3.5' : 'p-5'}`}
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-[13px] text-ink-3">{body}</div>
      {action && <div className="mt-3">{action}</div>}
    </motion.div>
  )
}
