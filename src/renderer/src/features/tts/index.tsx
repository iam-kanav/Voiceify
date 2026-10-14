import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  BookOpen,
  ChevronDown,
  Clapperboard,
  Gamepad2,
  Globe2,
  Laugh,
  Loader2,
  Megaphone,
  Mic,
  Play,
  RotateCcw,
  Square,
  Trash2,
  Wind
} from 'lucide-react'
import { LANGUAGES } from '@shared/catalog'
import { INSTRUCT_PRESETS } from '@shared/voices'
import { PageHeader } from '@/components/PageHeader'
import { VoicePicker } from '@/components/VoicePicker'
import { Select } from '@/components/Popover'
import { Slider } from '@/components/Slider'
import { InfoTip } from '@/components/InfoTip'
import { ModelChooser } from './ModelChooser'
import { Badge, Button, Kbd, Tabs, Textarea } from '@/components/ui'
import { VoiceAvatar } from '@/components/VoiceAvatar'
import { useApp } from '@/stores/app'
import { useTts } from '@/stores/tts'
import { playHistoryItem, usePlayer } from '@/stores/player'
import { useGenerate, usePlayerPadding } from '@/lib/useGenerate'
import { capabilityFor, compatibleModels, resolveModel } from '@/lib/models'
import { cn, dayLabel, formatTime, studio } from '@/lib/api'

const STARTERS = [
  { icon: BookOpen, label: 'Bedtime story', text: 'Once upon a time, in a village tucked between two silver mountains, there lived a clockmaker who could hear the heartbeat of every clock she ever built.' },
  { icon: Megaphone, label: 'Product demo', text: 'Meet Lumen — the desk lamp that learns your rhythm. Brighter mornings, calmer evenings, and not a single switch to flip.' },
  { icon: Globe2, label: 'Language sampler', text: 'Hello! 你好！こんにちは！안녕하세요! Bonjour! Hola! Ciao! Hallo! Привет! Olá!' },
  { icon: Clapperboard, label: 'Dramatic line', text: "It's in the top drawer... wait, it's empty? No way, that's impossible! I'm sure I put it there!" },
  { icon: Gamepad2, label: 'Game character', text: 'Traveler! You look like you could use a sword. Or three. I only take gold, gems, or exceptionally good stories.' },
  { icon: Mic, label: 'Podcast intro', text: "Welcome back to Deep Signal, the show where we unpack the ideas shaping tomorrow. Today's episode is a big one." },
  { icon: Wind, label: 'Calm meditation', text: 'Find a comfortable position. Let your shoulders soften. Breathe in slowly... and breathe out, letting the day drift away.' },
  { icon: Laugh, label: 'Quick joke', text: "Why don't skeletons fight each other? Because they just don't have the guts!" }
]

export default function TextToSpeech() {
  const { text, setText, voiceId, setVoice, modelId, setModel, settings, patch, reset } = useTts()
  const voices = useApp((s) => s.voices)
  const navigate = useApp((s) => s.navigate)
  const models = useApp((s) => s.models)
  const appSettings = useApp((s) => s.settings)
  const engine = useApp((s) => s.engine)
  const { run, cancel, busy } = useGenerate()
  const pad = usePlayerPadding()
  const [tab, setTab] = useState<'settings' | 'history'>('settings')
  const [advanced, setAdvanced] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const voice = voices.find((v) => v.id === voiceId) ?? voices.find((v) => v.id === 'preset:ryan')
  const cap = capabilityFor(voice, models)
  const options = compatibleModels(voice, models)
  const active =
    options.find((m) => m.id === modelId) ?? resolveModel(cap, models, undefined, appSettings?.defaultModels)
  const supportsInstruct = voice?.kind === 'preset' && !!active?.capabilities.includes('instruct')
  const supportsTags = !!active?.capabilities.includes('emotion-tags')
  const canGenerate = !!text.trim() && !!active && engine.state === 'ready' && !busy
  // Why Generate is disabled, plus a one-click fix where there is one.
  const blocker: { text: string; action?: { label: string; run: () => void } } | null =
    engine.state === 'starting'
      ? { text: 'Starting the voice engine…' }
      : engine.state === 'installing'
        ? { text: `Installing the voice engine… ${Math.round(engine.progress * 100)}%` }
        : engine.state === 'missing'
          ? { text: 'The voice engine isn’t installed.', action: { label: 'Install engine', run: () => studio.installEngine() } }
          : engine.state === 'error'
            ? { text: 'The voice engine stopped.', action: { label: 'Restart engine', run: () => studio.restartEngine() } }
            : !active
              ? { text: 'This voice needs a model.', action: { label: 'Open Models', run: () => navigate('models') } }
              : !text.trim()
                ? { text: 'Type something to generate' }
                : null

  // Keep the chosen model valid when the voice changes.
  useEffect(() => {
    if (modelId !== 'auto' && !options.some((m) => m.id === modelId)) setModel('auto')
  }, [modelId, options, setModel])

  const generate = () => {
    if (!canGenerate || !voice) return
    run(
      {
        text,
        voiceId: voice.id,
        modelId: modelId === 'auto' ? undefined : modelId,
        settings: { ...settings, instruct: supportsInstruct ? settings.instruct : '' }
      },
      { title: voice.name, colors: voice.colors }
    )
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Text to Speech" subtitle="Turn text into lifelike speech, entirely on your computer." />
      <div className={cn('flex min-h-0 flex-1 border-t border-line', pad)}>
        {/* Editor */}
        <section className="relative flex min-w-0 flex-1 flex-col">
          <textarea
            ref={textRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type or paste anything, and Voiceify will read it aloud…"
            className="scroll flex-1 resize-none bg-transparent px-8 pt-6 pb-4 text-[17px] leading-[1.7] text-ink outline-none placeholder:text-ink-3"
          />
          <AnimatePresence>
            {!text && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8, transition: { duration: 0.12 } }}
                className="pointer-events-none absolute inset-x-8 bottom-24"
              >
                <div className="mb-3 text-[13px] text-ink-3">Try an example</div>
                <div className="pointer-events-auto flex flex-wrap gap-2">
                  {STARTERS.map((s, i) => (
                    <motion.button
                      key={s.label}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0, transition: { delay: 0.03 * i } }}
                      onClick={() => {
                        setText(s.text)
                        textRef.current?.focus()
                      }}
                      className="flex h-9 items-center gap-2 rounded-xl border border-line px-3 text-[13px] text-ink-2 transition-colors hover:bg-subtle hover:text-ink"
                    >
                      <s.icon className="size-4" />
                      {s.label}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="flex h-16 shrink-0 items-center gap-3 border-t border-line px-6">
            <span className="whitespace-nowrap text-xs tabular-nums text-ink-3">
              {text.length.toLocaleString()} characters
            </span>
            {text && (
              <button onClick={() => setText('')} className="text-xs text-ink-3 transition-colors hover:text-ink">
                Clear
              </button>
            )}
            {!blocker && <span className="hidden whitespace-nowrap text-xs text-ink-3 2xl:inline">· Any length — long text is split automatically</span>}
            <div className="flex-1" />
            {!busy && blocker && (
              <span className="flex items-center gap-2 whitespace-nowrap text-xs text-ink-3">
                {(engine.state === 'starting' || engine.state === 'installing') && <Loader2 className="size-3.5 animate-spin" />}
                {blocker.text}
                {blocker.action && (
                  <Button size="sm" variant="outline" onClick={blocker.action.run}>
                    {blocker.action.label}
                  </Button>
                )}
              </span>
            )}
            {busy ? (
              <Button variant="outline" onClick={cancel} icon={<Square className="size-3.5" fill="currentColor" />}>
                Stop
              </Button>
            ) : null}
            <Button onClick={generate} disabled={!canGenerate} loading={busy} size="md" className="min-w-[160px]" title={blocker?.text}>
              {busy ? 'Generating…' : 'Generate speech'}
              {!busy && <Kbd>⌘↵</Kbd>}
            </Button>
          </div>
        </section>

        {/* Right panel */}
        <aside className="flex w-[384px] shrink-0 flex-col border-l border-line">
          <div className="flex h-12 shrink-0 items-center border-b border-line px-4">
            <Tabs
              id="tts-panel"
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'settings', label: 'Voice settings' },
                { id: 'history', label: 'History' }
              ]}
            />
          </div>
          <div className="scroll flex-1">
            <AnimatePresence mode="wait" initial={false}>
              {tab === 'settings' ? (
                <motion.div
                  key="settings"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-6 p-5"
                >
                  <div className="space-y-2">
                    <div className="text-[13px] font-medium">Voice</div>
                    <VoicePicker value={voice?.id ?? ''} onChange={setVoice} />
                  </div>

                  <ModelChooser voice={voice} cap={cap} options={options} active={active} value={modelId} onChange={setModel} />

                  {voice?.kind === 'preset' ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-[13px] font-medium">
                          Style instructions
                          <InfoTip>
                            Tell the voice how to speak in plain words: emotion, tone, pace, volume. Works with the Large Built-in Voices model
                            (Qwen3-TTS 1.7B CustomVoice); the Small one ignores instructions.
                          </InfoTip>
                        </span>
                        {!supportsInstruct && active && <Badge tone="amber">Needs the Large model</Badge>}
                      </div>
                      <Textarea
                        rows={2}
                        disabled={!supportsInstruct}
                        value={settings.instruct ?? ''}
                        onChange={(e) => patch({ instruct: e.target.value })}
                        placeholder="e.g. Speak warmly and a little faster, with a hint of excitement"
                        className="disabled:opacity-50"
                      />
                      {supportsInstruct && (
                        <div className="flex flex-wrap gap-1.5">
                          {INSTRUCT_PRESETS.slice(0, 6).map((p) => (
                            <button
                              key={p}
                              onClick={() => patch({ instruct: p })}
                              className={cn(
                                'rounded-full border px-2.5 py-1 text-[11.5px] transition-colors',
                                settings.instruct === p ? 'border-ink bg-ink text-canvas' : 'border-line text-ink-2 hover:bg-muted'
                              )}
                            >
                              {p.replace(/\.$/, '')}
                            </button>
                          ))}
                        </div>
                      )}
                      {supportsTags && (
                        <p className="text-xs text-ink-3">
                          This model also understands inline tags: [Happy] [Sad] [Angry] [Gentle] [Fast] [Tired] [Fearful] [Surprised] [Disgusted]
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="rounded-xl bg-subtle px-3 py-2.5 text-xs text-ink-3">
                      Style instructions are available for built-in voices. Cloned and designed voices keep the delivery of their original sample.
                    </p>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-[13px] font-medium">
                      Language
                      <InfoTip>Auto-detect works for most text. Pick a language if names, numbers or mixed-language text are read with the wrong accent.</InfoTip>
                    </div>
                    <Select
                      value={settings.language}
                      onChange={(language) => patch({ language })}
                      options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))}
                    />
                  </div>

                  <Slider
                    label="Expressiveness"
                    value={settings.temperature}
                    min={0.1}
                    max={1.5}
                    step={0.01}
                    onChange={(temperature) => patch({ temperature })}
                    left="Steady"
                    right="Expressive"
                    format={(v) => v.toFixed(2)}
                    hint="How much the voice varies its delivery. Steady = predictable and even; Expressive = livelier, but occasionally odd. (Sampling temperature; 0.9 is the model’s default.)"
                  />

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
                              label="Top P"
                              value={settings.topP}
                              min={0.1}
                              max={1}
                              step={0.01}
                              onChange={(topP) => patch({ topP })}
                              hint="Limits choices to the most likely sounds. Lower values make speech more conservative. Leave at 1.0 unless output sounds erratic."
                            />
                            <Slider
                              label="Top K"
                              value={settings.topK}
                              min={1}
                              max={100}
                              step={1}
                              onChange={(topK) => patch({ topK })}
                              format={(v) => String(Math.round(v))}
                              hint="How many candidate sounds the model considers at each step. Lower = safer, higher = more varied. Default 50."
                            />
                            <Slider
                              label="Repetition penalty"
                              value={settings.repetitionPenalty}
                              min={1}
                              max={1.5}
                              step={0.01}
                              onChange={(repetitionPenalty) => patch({ repetitionPenalty })}
                              hint="Discourages the model from getting stuck repeating sounds or words. Raise slightly if you hear loops or stutters. Default 1.05."
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <button onClick={reset} className="flex items-center gap-1.5 text-xs text-ink-3 transition-colors hover:text-ink">
                    <RotateCcw className="size-3.5" />
                    Reset to defaults
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="history"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  transition={{ duration: 0.15 }}
                >
                  <MiniHistory />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </aside>
      </div>
    </div>
  )
}

function MiniHistory() {
  const history = useApp((s) => s.history)
  const voices = useApp((s) => s.voices)
  const clip = usePlayer((s) => s.clip)
  const groups = useMemo(() => {
    const g = new Map<string, typeof history>()
    for (const h of history.slice(0, 100)) {
      const k = dayLabel(h.createdAt)
      g.set(k, [...(g.get(k) ?? []), h])
    }
    return [...g]
  }, [history])

  if (!history.length) {
    return <div className="px-6 py-16 text-center text-sm text-ink-3">Your generations will appear here.</div>
  }
  return (
    <div className="p-3">
      {groups.map(([day, items]) => (
        <div key={day} className="mb-3">
          <div className="px-2 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-wider text-ink-3">{day}</div>
          {items.map((h) => {
            const v = voices.find((x) => x.id === h.voiceId)
            return (
              <div
                key={h.id}
                onClick={() => playHistoryItem(h, v?.colors)}
                className={cn(
                  'group flex cursor-pointer items-start gap-3 rounded-xl p-2 transition-colors hover:bg-muted',
                  clip?.id === h.id && 'bg-muted'
                )}
              >
                <div className="relative">
                  <VoiceAvatar colors={v?.colors ?? ['#a1a1aa', '#52525b']} size={28} />
                  <Play className="absolute inset-0 m-auto size-3 text-white opacity-0 transition-opacity group-hover:opacity-100" fill="white" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-[13px] leading-snug">{h.text}</div>
                  <div className="mt-1 text-[11px] text-ink-3">
                    {h.voiceName} · {formatTime(h.durationSec)}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    studio.deleteHistory(h.id)
                  }}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  title="Delete"
                >
                  <Trash2 className="size-3.5 text-ink-3 hover:text-danger" />
                </button>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
