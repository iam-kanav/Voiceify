import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, ArrowRight, Check, Cpu, Loader2, Lock, Zap } from 'lucide-react'
import type { ModelInfo } from '@shared/types'
import { PROVIDER_BY_ID } from '@shared/providers'
import { formatBytes } from '@shared/catalog'
import { Button, ProgressBar, Toggle } from '@/components/ui'
import { Select } from '@/components/Popover'
import { VoiceAvatar } from '@/components/VoiceAvatar'
import { LogoMark } from '@/components/Logo'
import { errorMessage, toast } from '@/components/Toast'
import { useApp } from '@/stores/app'
import { studio, cn } from '@/lib/api'

/**
 * First-run setup. Installs the local engine and the chosen models, and only finishes once
 * everything is ready, so the rest of the app never has to show setup UI.
 */

interface Group {
  key: string
  provider: string
  familyIds: string[]
  title: string
  body: string
  colors: [string, string]
}

/** Setup choices, grouped by model family. */
const GROUPS: Group[] = [
  {
    key: 'qwen-voices',
    provider: 'qwen3-tts',
    familyIds: ['qwen3-tts-1.7b-customvoice', 'qwen3-tts-0.6b-customvoice'],
    title: 'Built-in voices',
    body: '9 voices in 10 languages, with style instructions',
    colors: ['#27272a', '#71717a']
  },
  {
    key: 'qwen-design',
    provider: 'qwen3-tts',
    familyIds: ['qwen3-tts-1.7b-voicedesign'],
    title: 'Voice Design',
    body: 'Invent new voices from a text description',
    colors: ['#8b5cf6', '#ec4899']
  },
  {
    key: 'qwen-clone',
    provider: 'qwen3-tts',
    familyIds: ['qwen3-tts-1.7b-base', 'qwen3-tts-0.6b-base'],
    title: 'Voice Cloning',
    body: 'Speak with voices you clone or design',
    colors: ['#0ea5e9', '#22c55e']
  },
  {
    key: 'pocket',
    provider: 'pocket-tts',
    familyIds: ['pocket-tts'],
    title: 'Pocket TTS',
    body: 'Tiny, very fast English voices and cloning in one small download',
    colors: ['#14b8a6', '#0ea5e9']
  },
  {
    key: 'asr',
    provider: 'qwen3-asr',
    familyIds: ['qwen3-asr-0.6b', 'qwen3-asr-1.7b', 'whisper-large-v3-turbo', 'whisper-large-v3'],
    title: 'Speech to Text',
    body: 'Transcribe audio and video, and auto-fill voice-clone transcripts',
    colors: ['#f97316', '#eab308']
  }
]

type Step = 'welcome' | 'models' | 'install'

export function Onboarding() {
  const [step, setStep] = useState<Step>('welcome')
  const [chosen, setChosen] = useState<string[]>([])
  const engine = useApp((s) => s.engine)
  const update = useApp((s) => s.updateSettings)

  const begin = () => {
    if (engine.state === 'missing' || engine.state === 'error') studio.installEngine()
    setStep('models')
  }

  const install = (ids: string[]) => {
    setChosen(ids)
    for (const id of ids) studio.installModel(id).catch((e) => toast.error('Download failed', errorMessage(e)))
    setStep('install')
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.01, transition: { duration: 0.35 } }}
      className="fixed inset-0 z-[55] flex flex-col bg-canvas"
    >
      <div className="drag h-[52px] shrink-0" />
      <div className="scroll flex flex-1 justify-center px-8 pb-12">
        <AnimatePresence mode="wait">
          {step === 'welcome' && <Welcome key="welcome" onNext={begin} onSkip={() => update({ onboardingComplete: true })} />}
          {step === 'models' && (
            <ModelStep key="models" onNext={install} onBack={() => setStep('welcome')} onSkip={() => update({ onboardingComplete: true })} />
          )}
          {step === 'install' && <InstallStep key="install" ids={chosen} onDone={() => update({ onboardingComplete: true })} />}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

const stepMotion = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { type: 'spring' as const, stiffness: 260, damping: 30 }
}

function Welcome({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const system = useApp((s) => s.system)!
  const supported = !!system.backend
  return (
    <motion.div {...stepMotion} className="flex w-full max-w-xl flex-col items-center pt-[9vh] text-center">
      <motion.div initial={{ scale: 0.8, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 14 }}>
        <LogoMark size={96} />
      </motion.div>
      <h1 className="mt-8 text-4xl font-semibold tracking-tight">Welcome to Voiceify</h1>
      <p className="mt-3 text-[15px] text-ink-3">A private voice studio: text to speech, voice design and voice cloning with open-source AI models that run on your own computer.</p>
      <div className="mt-10 grid w-full grid-cols-3 gap-3 text-left">
        {[
          { icon: Cpu, t: system.chip, b: `${system.memoryGB} GB unified memory` },
          { icon: Lock, t: 'Private', b: 'Runs offline, no accounts' },
          { icon: Zap, t: 'Open-source models', b: 'Pick the size that suits your computer' }
        ].map((x) => (
          <div key={x.t} className="rounded-2xl border border-line p-4">
            <x.icon className="size-4 text-ink-2" />
            <div className="mt-3 text-sm font-medium">{x.t}</div>
            <div className="text-xs text-ink-3">{x.b}</div>
          </div>
        ))}
      </div>
      {!supported && (
        <p className="mt-6 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
          Voice models can’t run on this device yet — the current engine needs a Mac with an Apple chip (M1 or newer). Support for more devices is planned.
        </p>
      )}
      <Button size="lg" className="mt-10 px-8" onClick={onNext} disabled={!supported}>
        Set up Voiceify <ArrowRight className="size-4" />
      </Button>
      {supported ? (
        <p className="mt-4 text-xs text-ink-3">Takes a few minutes, mostly downloading models.</p>
      ) : (
        <button onClick={onSkip} className="mt-4 text-xs text-ink-3 hover:text-ink">
          Look around anyway
        </button>
      )}
    </motion.div>
  )
}

function ModelStep({ onNext, onBack, onSkip }: { onNext: (ids: string[]) => void; onBack: () => void; onSkip: () => void }) {
  const models = useApp((s) => s.models)
  const system = useApp((s) => s.system)!
  const initial = useMemo(() => {
    const sel: Record<string, { on: boolean; id: string }> = {}
    for (const g of GROUPS) {
      const opts = models.filter((m) => g.familyIds.includes(m.familyId))
      const rec = opts.find((m) => m.recommended) ?? opts[0]
      sel[g.key] = { on: true, id: rec?.id ?? '' }
    }
    return sel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [sel, setSel] = useState(initial)

  const chosen = GROUPS.filter((g) => sel[g.key].on)
    .map((g) => models.find((m) => m.id === sel[g.key].id))
    .filter((m): m is ModelInfo => !!m)
  const total = chosen.filter((m) => m.install.status !== 'installed').reduce((n, m) => n + m.sizeBytes, 0)

  return (
    <motion.div {...stepMotion} className="w-full max-w-2xl pt-[5vh]">
      <h1 className="text-3xl font-semibold tracking-tight">Choose your models</h1>
      <p className="mt-2 text-[15px] text-ink-3">
        Pre-selected for your {system.chip} with {system.memoryGB} GB. Go bigger for quality or smaller for speed — you can add more any time from
        Models.
      </p>

      <div className="mt-6 space-y-3">
        {GROUPS.map((g, i) => {
          const opts = models.filter((m) => g.familyIds.includes(m.familyId))
          const s = sel[g.key]
          const family = i === 0 || GROUPS[i - 1].provider !== g.provider ? PROVIDER_BY_ID.get(g.provider) : undefined
          return (
            <div key={g.key}>
              {family && (
                <div className={cn('mb-2 flex items-baseline gap-2 px-1', i > 0 && 'pt-3')}>
                  <span className="text-sm font-semibold">{family.task === 'asr' ? 'Speech to Text' : family.name}</span>
                  <span className="text-xs text-ink-3">{family.task === 'asr' ? 'Optional · Qwen3-ASR or OpenAI Whisper' : `${family.vendor} · ${family.tagline}`}</span>
                </div>
              )}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.05 * i } }}
              className={cn('flex items-center gap-4 rounded-2xl border p-4 transition-all', s.on ? 'border-line-strong' : 'border-line opacity-60')}
            >
              <VoiceAvatar colors={g.colors} size={40} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{g.title}</div>
                <div className="text-xs text-ink-3">{g.body}</div>
              </div>
              <div className="w-64">
                <Select
                  value={s.id}
                  onChange={(id) => setSel((p) => ({ ...p, [g.key]: { on: true, id } }))}
                  options={opts.map((m) => ({
                    value: m.id,
                    label: (
                      <span className="flex items-center gap-2">
                        {m.name}
                        {m.recommended && <span className="text-[10px] font-medium text-success">★</span>}
                      </span>
                    ),
                    description: `${m.family.split(' · ')[0]} · ${formatBytes(m.sizeBytes)}${m.recommendedReason ? ` · ${m.recommendedReason}` : ''}`
                  }))}
                />
              </div>
              <Toggle checked={s.on} onChange={(on) => setSel((p) => ({ ...p, [g.key]: { ...p[g.key], on } }))} />
            </motion.div>
            </div>
          )
        })}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="text-sm text-ink-3 hover:text-ink">
            Back
          </button>
          <span className="text-sm text-ink-3">
            {chosen.length} model{chosen.length === 1 ? '' : 's'} · {formatBytes(total)} to download
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onSkip}>
            Skip — I’ll choose later
          </Button>
          <Button size="lg" onClick={() => onNext(chosen.map((m) => m.id))} disabled={!chosen.length}>
            Install
          </Button>
        </div>
      </div>
    </motion.div>
  )
}

function InstallStep({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const engine = useApp((s) => s.engine)
  const models = useApp((s) => s.models)
  const rows = ids.map((id) => models.find((m) => m.id === id)).filter((m): m is ModelInfo => !!m)
  const engineReady = engine.state === 'ready'
  const allInstalled = rows.every((m) => m.install.status === 'installed')
  const done = engineReady && allInstalled

  const totals = rows.reduce(
    (acc, m) => {
      const s = m.install
      acc.total += m.sizeBytes
      acc.got += s.status === 'installed' ? m.sizeBytes : s.status === 'downloading' ? s.received : 0
      acc.rate += s.status === 'downloading' ? s.bytesPerSec : 0
      return acc
    },
    { total: 0, got: 0, rate: 0 }
  )
  const eta = totals.rate > 0 ? Math.ceil((totals.total - totals.got) / totals.rate / 60) : null

  const engineError = engine.state === 'error' ? engine.error : null
  useEffect(() => {
    if (engineError) toast.error('Voice engine install failed', engineError)
  }, [engineError])

  return (
    <motion.div {...stepMotion} className="w-full max-w-2xl pt-[5vh]">
      <h1 className="text-3xl font-semibold tracking-tight">{done ? 'You’re all set' : 'Setting up Voiceify'}</h1>
      <p className="mt-2 text-[15px] text-ink-3">
        {done
          ? 'Everything is installed and runs offline from now on.'
          : allInstalled
            ? 'Models are ready — finishing the local engine install…'
            : `Downloading ${formatBytes(totals.got)} of ${formatBytes(totals.total)}${eta ? ` · about ${eta} min left` : ''}. Keep the app open.`}
      </p>
      <ProgressBar className="mt-5 h-2" value={(totals.got / Math.max(1, totals.total)) * 0.95 + (engineReady ? 0.05 : 0)} />

      <div className="mt-6 overflow-hidden rounded-2xl border border-line">
        <Row
          title="Voice engine"
          subtitle={
            engine.state === 'ready'
              ? `MLX ${engine.mlx} · ready`
              : engine.state === 'installing'
                ? engine.step
                : engine.state === 'error'
                  ? engine.error
                  : 'Preparing…'
          }
          state={engine.state === 'ready' ? 'done' : engine.state === 'error' ? 'error' : 'busy'}
          progress={engine.state === 'installing' ? engine.progress : undefined}
          onRetry={() => studio.installEngine()}
        />
        {rows.map((m) => {
          const s = m.install
          return (
            <Row
              key={m.id}
              title={m.name}
              subtitle={
                s.status === 'installed'
                  ? `${m.family.split(' · ')[0]} · installed`
                  : s.status === 'downloading'
                    ? `${formatBytes(s.received)} of ${formatBytes(s.total)}${s.bytesPerSec ? ` · ${formatBytes(s.bytesPerSec)}/s` : ''}`
                    : s.status === 'converting'
                      ? 'Converting…'
                      : s.status === 'error'
                        ? s.error
                        : 'Waiting…'
              }
              state={s.status === 'installed' ? 'done' : s.status === 'error' ? 'error' : 'busy'}
              progress={s.status === 'downloading' ? s.received / Math.max(1, s.total) : undefined}
              onRetry={() => studio.installModel(m.id)}
            />
          )
        })}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <button onClick={onDone} className={cn('text-xs text-ink-3 hover:text-ink', done && 'invisible')}>
          Finish in the background
        </button>
        <Button size="lg" onClick={onDone} disabled={!done}>
          Start creating <ArrowRight className="size-4" />
        </Button>
      </div>
    </motion.div>
  )
}

function Row({
  title,
  subtitle,
  state,
  progress,
  onRetry
}: {
  title: string
  subtitle?: string
  state: 'busy' | 'done' | 'error'
  progress?: number
  onRetry: () => void
}) {
  return (
    <div className="flex items-center gap-4 border-b border-line px-4 py-3.5 last:border-b-0">
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full transition-colors',
          state === 'done' ? 'bg-success text-white' : state === 'error' ? 'bg-danger/10 text-danger' : 'bg-muted text-ink-3'
        )}
      >
        {state === 'done' ? <Check className="size-3.5" strokeWidth={3} /> : state === 'error' ? <AlertCircle className="size-3.5" /> : <Loader2 className="size-3.5 animate-spin" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className={cn('truncate text-xs', state === 'error' ? 'text-danger' : 'text-ink-3')}>{subtitle}</div>
      </div>
      {progress !== undefined && state === 'busy' && (
        <div className="flex w-40 items-center gap-2">
          <ProgressBar value={progress} />
          <span className="w-9 text-right text-xs tabular-nums text-ink-3">{Math.round(progress * 100)}%</span>
        </div>
      )}
      {state === 'error' && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}
