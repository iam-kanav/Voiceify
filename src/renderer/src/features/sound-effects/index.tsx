import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { AnimatePresence, motion } from 'motion/react'
import {
  Bell,
  Car,
  ChevronDown,
  Dices,
  DoorOpen,
  ExternalLink,
  Flame,
  FolderOpen,
  Footprints,
  GlassWater,
  Loader2,
  Pause,
  Play,
  Share,
  Sparkles,
  Square,
  Trash2,
  Users,
  Zap
} from 'lucide-react'
import type { HistoryItem } from '@shared/types'
import { SFX_PROVIDERS } from '@shared/providers'
import { PageHeader } from '@/components/PageHeader'
import { ModelGate } from '@/components/ModelGate'
import { Slider } from '@/components/Slider'
import { InfoTip } from '@/components/InfoTip'
import { Waveform } from '@/components/Waveform'
import { SaveButton, ensureSaveMode } from '@/components/SaveMode'
import { Badge, Button, IconButton, Input, Kbd, Tabs, Textarea, Toggle } from '@/components/ui'
import { errorMessage, toast } from '@/components/Toast'
import { useApp } from '@/stores/app'
import { sfxValues, useSfx } from '@/stores/sfx'
import { playHistoryItem, usePlayer } from '@/stores/player'
import { usePlayerPadding } from '@/lib/useGenerate'
import { isInstalled } from '@/lib/models'
import { useFilePeaks } from '@/lib/useFilePeaks'
import { cn, dayLabel, formatTime, studio, uid } from '@/lib/api'

const PROVIDER = SFX_PROVIDERS[0]
const SPEC = Object.fromEntries(PROVIDER.params.map((p) => [p.key, p]))
const COLORS = PROVIDER.colors

const EXAMPLES = [
  { icon: Footprints, label: 'Footsteps', text: 'Slow footsteps on crunchy gravel, outdoors' },
  { icon: DoorOpen, label: 'Creaky door', text: 'A heavy wooden door creaks open slowly in an old castle' },
  { icon: Zap, label: 'Thunderstorm', text: 'Heavy rain on a tin roof with rolling thunder in the distance' },
  { icon: Flame, label: 'Campfire', text: 'Crackling campfire at night with gentle wind and crickets' },
  { icon: GlassWater, label: 'Glass shatter', text: 'A wine glass falls and shatters on a tiled kitchen floor' },
  { icon: Bell, label: 'UI chime', text: 'Bright, soft two-note notification chime for an app' },
  { icon: Car, label: 'Car passing', text: 'A sports car accelerates and passes by from left to right' },
  { icon: Users, label: 'Crowd cheer', text: 'Stadium crowd cheering and applauding after a goal' }
]
const LENGTHS = [2, 5, 10, 30, 60, 120]

/** The running job and its takes survive page switches. */
const useSession = create<{
  busy: { jobId: string; prompt: string; step: number; total: number; startedAt: number } | null
  /** Ids of the takes from the last run. */
  latest: string[]
}>(() => ({ busy: null, latest: [] }))

export default function SoundEffects() {
  const s = useSfx()
  // Re-render when Settings defaults change.
  useApp((st) => st.settings?.providerDefaults?.[PROVIDER.id])
  const v = sfxValues(s, PROVIDER.id)
  const overridden = s.seconds !== undefined || s.steps !== undefined || s.cfg !== undefined
  const { busy, latest } = useSession()
  const models = useApp((st) => st.models)
  const engine = useApp((st) => st.engine)
  const history = useApp((st) => st.history)
  const pad = usePlayerPadding()
  const [advanced, setAdvanced] = useState(false)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  const model = models.find((m) => m.capabilities.includes('sound-effects') && isInstalled(m))
  const sfxHistory = useMemo(() => history.filter((h) => h.mode === 'sfx'), [history])
  const latestItems = latest.map((id) => sfxHistory.find((h) => h.id === id)).filter((h): h is HistoryItem => !!h)
  const canGenerate = !!s.prompt.trim() && !!model && engine.state === 'ready' && !busy

  // Sampling progress for the running job.
  useEffect(
    () =>
      studio.on('generationProgress', ({ jobId, step, total }) => {
        const b = useSession.getState().busy
        if (b?.jobId === jobId) useSession.setState({ busy: { ...b, step, total } })
      }),
    []
  )

  const generate = async () => {
    if (!canGenerate || !model) return
    if (!(await ensureSaveMode())) return
    const jobId = uid()
    const prompt = s.prompt.trim()
    useSession.setState({ busy: { jobId, prompt, step: 0, total: v.steps, startedAt: Date.now() } })
    try {
      const items = await studio.generateSoundEffect({
        jobId,
        prompt,
        modelId: model.id,
        count: s.count,
        seed: s.fixedSeed ? s.seed : undefined,
        settings: { seconds: v.seconds, steps: v.steps, cfg: v.cfg, negativePrompt: s.negativePrompt }
      })
      useSession.setState({ latest: items.map((i) => i.id) })
      if (items[0]) playHistoryItem(items[0], COLORS)
    } catch (e) {
      const msg = errorMessage(e)
      if (!/cancelled/i.test(msg)) toast.error('Couldn’t make that sound', msg)
    } finally {
      useSession.setState({ busy: null })
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        generate()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const reuse = (h: HistoryItem) => {
    useSfx.setState({
      prompt: h.text,
      ...(h.sfx
        ? {
            seconds: h.sfx.seconds,
            steps: h.sfx.steps,
            cfg: h.sfx.cfg,
            negativePrompt: h.sfx.negativePrompt ?? '',
            // A batch shares one seed; reusing it reproduces the whole batch.
            seed: h.sfx.seed,
            fixedSeed: true,
            count: h.sfx.of
          }
        : {})
    })
    promptRef.current?.focus()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Sound Effects"
        subtitle="Describe a sound and get several takes to choose from, made on your computer."
        right={
          <button
            onClick={() => studio.openExternal('https://stability.ai/stable-audio')}
            className="flex items-center gap-1 text-xs text-ink-3 transition-colors hover:text-ink"
          >
            Powered by Stability AI <ExternalLink className="size-3" />
          </button>
        }
      />
      <div className={cn('flex min-h-0 flex-1 border-t border-line', pad)}>
        <section className="scroll w-[min(440px,42%)] shrink-0 space-y-6 border-r border-line p-6">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[13px] font-medium">
              Describe the sound
              <InfoTip>
                Be specific about the source, the action and the space: “a heavy door slams in a stone hallway” works better than “door”. Prompts work best in English.
              </InfoTip>
            </div>
            <Textarea
              ref={promptRef}
              rows={4}
              value={s.prompt}
              onChange={(e) => useSfx.setState({ prompt: e.target.value })}
              placeholder="e.g. Waves crashing on a rocky beach with seagulls overhead"
            />
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  onClick={() => {
                    useSfx.setState({ prompt: ex.text })
                    promptRef.current?.focus()
                  }}
                  className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-ink-2 transition-colors hover:bg-muted hover:text-ink"
                >
                  <ex.icon className="size-3.5" />
                  {ex.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Slider
              label="Length"
              value={v.seconds}
              min={0.5}
              max={120}
              step={0.5}
              onChange={(v) => useSfx.setState({ seconds: v })}
              format={(v) => (v < 60 ? `${v.toFixed(v % 1 ? 1 : 0)} s` : formatTime(v))}
              hint="How long each take is, up to two minutes. Short one-shots (hits, clicks) sound best at 1–3 s; ambience and backgrounds can run much longer."
            />
            <div className="flex flex-wrap gap-1.5">
              {LENGTHS.map((sec) => (
                <button
                  key={sec}
                  onClick={() => useSfx.setState({ seconds: sec })}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-[11.5px] transition-colors',
                    v.seconds === sec ? 'border-ink bg-ink text-canvas' : 'border-line text-ink-2 hover:bg-muted'
                  )}
                >
                  {sec < 60 ? `${sec} s` : `${sec / 60} min`}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[13px] font-medium">
              Takes
              <InfoTip>Each take is a different version of the same sound. They are made together, so extra takes cost very little time.</InfoTip>
            </div>
            <Tabs
              id="sfx-count"
              value={String(s.count) as '1' | '2' | '3' | '4'}
              onChange={(v) => useSfx.setState({ count: Number(v) })}
              tabs={[
                { id: '1', label: '1' },
                { id: '2', label: '2' },
                { id: '3', label: '3' },
                { id: '4', label: '4' }
              ]}
            />
          </div>

          <div>
            <button
              onClick={() => setAdvanced((a) => !a)}
              className="flex w-full items-center justify-between text-[13px] font-medium text-ink-2 hover:text-ink"
            >
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
                      label="Prompt strength"
                      value={v.cfg}
                      min={SPEC.cfg.min}
                      max={SPEC.cfg.max}
                      step={SPEC.cfg.step}
                      onChange={(x) => useSfx.setState({ cfg: x })}
                      left={SPEC.cfg.left}
                      right={SPEC.cfg.right}
                      format={(x) => (x === 1 ? 'Off' : x.toFixed(1))}
                      hint={SPEC.cfg.help}
                    />
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[13px] font-medium">
                        Avoid
                        <InfoTip>Sounds to steer away from, e.g. “music, voices, hiss”. Used when prompt strength is above Off.</InfoTip>
                      </div>
                      <Input
                        value={s.negativePrompt}
                        disabled={v.cfg <= 1}
                        onChange={(e) => useSfx.setState({ negativePrompt: e.target.value })}
                        placeholder={v.cfg <= 1 ? 'Raise prompt strength to use this' : 'e.g. music, voices, background noise'}
                        className="disabled:opacity-50"
                      />
                    </div>
                    <Slider
                      label="Quality steps"
                      value={v.steps}
                      min={SPEC.steps.min}
                      max={SPEC.steps.max}
                      step={1}
                      onChange={(x) => useSfx.setState({ steps: Math.round(x) })}
                      left={SPEC.steps.left}
                      right={SPEC.steps.right}
                      format={(x) => String(Math.round(x))}
                      hint={SPEC.steps.help}
                    />
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5 text-[13px] font-medium">
                        Fixed seed
                        <InfoTip>The same seed, prompt and settings give the same takes again. Leave off for something new every time.</InfoTip>
                      </div>
                      <div className="flex items-center gap-2">
                        {s.fixedSeed && (
                          <>
                            <Input
                              type="number"
                              value={s.seed}
                              onChange={(e) => useSfx.setState({ seed: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                              className="h-8 w-28"
                            />
                            <IconButton label="Random seed" onClick={() => useSfx.setState({ seed: Math.floor(Math.random() * 2 ** 31) })}>
                              <Dices className="size-4" />
                            </IconButton>
                          </>
                        )}
                        <Toggle checked={s.fixedSeed} onChange={(v) => useSfx.setState({ fixedSeed: v })} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-ink-3">
                      <span>Defaults come from Settings → Model settings.</span>
                      {overridden && (
                        <button className="underline hover:text-ink" onClick={() => useSfx.setState({ seconds: undefined, steps: undefined, cfg: undefined })}>
                          Reset to defaults
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {!model ? (
            <ModelGate cap="sound-effects" provider={PROVIDER.id} compact />
          ) : busy ? (
            <div className="flex gap-2">
              <Button size="lg" className="flex-1" loading disabled>
                {busy.step ? `Step ${busy.step} of ${busy.total}` : 'Starting…'}
              </Button>
              <Button size="lg" variant="outline" onClick={() => studio.cancelGeneration(busy.jobId)} icon={<Square className="size-3.5" fill="currentColor" />}>
                Stop
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Button size="lg" className="w-full" disabled={!canGenerate} onClick={generate} icon={<Sparkles className="size-4" />}>
                Generate {s.count > 1 ? `${s.count} takes` : 'sound'}
                <Kbd>⌘↵</Kbd>
              </Button>
              {engine.state !== 'ready' && (
                <p className="flex items-center justify-center gap-1.5 text-xs text-ink-3">
                  {(engine.state === 'starting' || engine.state === 'installing') && <Loader2 className="size-3.5 animate-spin" />}
                  {engine.state === 'starting' ? 'Starting the engine…' : engine.state === 'installing' ? 'Installing the engine…' : 'The engine isn’t running.'}
                </p>
              )}
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-ink-3">
            Powered by Stability AI. Stable Audio 3 is licensed under the{' '}
            <button className="underline hover:text-ink" onClick={() => studio.openExternal('https://stability.ai/community-license-agreement')}>
              Stability AI Community License
            </button>
            : free for personal use and for businesses under $1M in annual revenue; commercial users register with Stability AI.
          </p>
        </section>

        <section className="scroll flex min-w-0 flex-1 flex-col">
          {busy && <Working busy={busy} />}
          {!busy && latestItems.length > 0 && (
            <div className="border-b border-line px-8 py-6">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-3">Just made</div>
              <div className="mb-4 text-[15px] font-semibold">{latestItems[0].text}</div>
              <div className="grid gap-3">
                {latestItems.map((h) => (
                  <Take key={h.id} item={h} onReuse={() => reuse(h)} />
                ))}
              </div>
            </div>
          )}
          {!busy && !latestItems.length && !sfxHistory.length && <Empty />}
          {sfxHistory.length > 0 && <Recent items={sfxHistory} exclude={busy ? [] : latest} onReuse={reuse} />}
        </section>
      </div>
    </div>
  )
}

function Take({ item, onReuse }: { item: HistoryItem; onReuse: () => void }) {
  const clip = usePlayer((s) => s.clip)
  const status = usePlayer((s) => s.status)
  const current = clip?.id === item.id
  const playing = current && status === 'playing'
  const bars = useFilePeaks(item.audioPath)
  const play = () => (current && status !== 'loading' ? usePlayer.getState().toggle() : playHistoryItem(item, COLORS))
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('group flex items-center gap-4 rounded-2xl border border-line p-3 transition-colors', current && 'border-line-strong bg-subtle')}
    >
      <button onClick={play} className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink active:scale-90">
        {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="ml-0.5 size-4" fill="currentColor" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 text-xs text-ink-3">
          <span className="font-medium text-ink-2">{item.sfx && item.sfx.of > 1 ? `Take ${item.sfx.variation}` : 'Sound effect'}</span>·
          <span>{formatTime(item.durationSec)}</span>
          {item.saved === false && <Badge tone="amber">Not saved</Badge>}
        </div>
        <Waveform
          peaks={bars}
          active={current}
          height={28}
          onSeek={(f) => {
            if (current) usePlayer.getState().seek(f * item.durationSec)
            else playHistoryItem(item, COLORS)
          }}
        />
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {item.saved === false && <SaveButton compact saved={false} onSave={() => studio.saveHistory(item.id)} />}
        <TakeActions item={item} onReuse={onReuse} />
      </div>
    </motion.div>
  )
}

function TakeActions({ item, onReuse }: { item: HistoryItem; onReuse: () => void }) {
  return (
    <>
      <IconButton label="Use these settings again" onClick={onReuse}>
        <Dices className="size-4" />
      </IconButton>
      <IconButton label="Show in Finder" onClick={() => studio.revealInFinder(item.audioPath)}>
        <FolderOpen className="size-4" />
      </IconButton>
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

function Working({ busy }: { busy: { prompt: string; step: number; total: number } }) {
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
        <div className="text-[15px] font-semibold">Making “{busy.prompt}”</div>
        <div className="mt-1 text-[13px] tabular-nums text-ink-3">{busy.step ? `Step ${busy.step} of ${busy.total}` : 'Loading the model…'}</div>
      </div>
    </div>
  )
}

function Empty() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
        <Sparkles className="size-5 text-ink-2" />
      </div>
      <div className="mt-4 text-[15px] font-semibold">Your sound effects appear here</div>
      <p className="mt-1 max-w-sm text-[13px] text-ink-3">
        Foley, ambience, impacts, UI sounds, creatures and more, in 44.1 kHz stereo. Pick an example on the left to try it.
      </p>
    </div>
  )
}

function Recent({ items, exclude, onReuse }: { items: HistoryItem[]; exclude: string[]; onReuse: (h: HistoryItem) => void }) {
  const clip = usePlayer((s) => s.clip)
  const status = usePlayer((s) => s.status)
  const groups = useMemo(() => {
    const g = new Map<string, HistoryItem[]>()
    for (const h of items.filter((x) => !exclude.includes(x.id)).slice(0, 200)) {
      const k = dayLabel(h.createdAt)
      g.set(k, [...(g.get(k) ?? []), h])
    }
    return [...g]
  }, [items, exclude])
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
                    {h.sfx && h.sfx.of > 1 ? `Take ${h.sfx.variation} of ${h.sfx.of} · ` : ''}
                    {formatTime(h.durationSec)}
                    {h.saved === false && ' · not saved'}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                  <TakeActions item={h} onReuse={() => onReuse(h)} />
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
