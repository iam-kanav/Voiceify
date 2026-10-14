import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, FolderOpen, Monitor, Moon, RefreshCw, Sun, Wrench } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Button, Card, Tabs } from '@/components/ui'
import { InfoTip } from '@/components/InfoTip'
import { SAVE_MODES } from '@/components/SaveMode'
import { useApp } from '@/stores/app'
import { cn, studio } from '@/lib/api'
import { usePlayerPadding } from '@/lib/useGenerate'
import { ModelSettings } from './ModelSettings'

const ENGINE_BADGE = {
  ready: { label: 'Ready', tone: 'green' },
  starting: { label: 'Starting…', tone: 'amber' },
  installing: { label: 'Installing…', tone: 'amber' },
  missing: { label: 'Not installed', tone: 'neutral' },
  error: { label: 'Problem', tone: 'red' }
} as const

export default function Settings() {
  const settings = useApp((s) => s.settings)!
  const system = useApp((s) => s.system)
  const update = useApp((s) => s.updateSettings)
  const engine = useApp((s) => s.engine)
  const logs = useApp((s) => s.engineLog)
  const [showLog, setShowLog] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)
  const pad = usePlayerPadding()

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [logs, showLog])

  const mem = system?.memoryGB ?? 16
  const suggested = mem <= 16 ? 1 : mem <= 32 ? 2 : 3

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Settings" />
      <div className={cn('scroll flex-1 px-8 pb-10', pad)}>
        <div className="max-w-3xl space-y-4">
          <Row title="Appearance" body="Light, dark, or follow your system setting.">
            <Tabs
              id="theme"
              value={settings.theme}
              onChange={(theme) => update({ theme })}
              tabs={[
                { id: 'light', label: <span className="flex items-center gap-1.5"><Sun className="size-3.5" />Light</span> },
                { id: 'dark', label: <span className="flex items-center gap-1.5"><Moon className="size-3.5" />Dark</span> },
                { id: 'system', label: <span className="flex items-center gap-1.5"><Monitor className="size-3.5" />System</span> }
              ]}
            />
          </Row>

          <Row
            title="Keeping what you generate"
            body={
              (SAVE_MODES.find((m) => m.id === settings.saveMode) ?? SAVE_MODES[0]).body +
              ' Results made by AI apps and the local API are always kept.'
            }
          >
            <Tabs
              id="save-mode"
              value={settings.saveMode ?? 'all'}
              onChange={(saveMode) => update({ saveMode })}
              tabs={SAVE_MODES.map((m) => ({ id: m.id, label: m.title }))}
            />
          </Row>

          <Row
            title={
              <span className="flex items-center gap-1.5">
                Models kept loaded
                <InfoTip>
                  Loading a model takes a few seconds the first time you use it. Keeping more loaded makes switching between voice types (for example a
                  built-in voice, then a cloned one) instant, but each uses about 2–5 GB of memory.
                </InfoTip>
              </span>
            }
            body={`This computer has ${mem} GB of memory — we suggest ${suggested}.`}
          >
            <div className="flex items-center gap-2">
              <Tabs
                id="max-loaded"
                value={String(settings.maxLoadedModels) as '1' | '2' | '3'}
                onChange={(v) => update({ maxLoadedModels: Number(v) })}
                tabs={[
                  { id: '1', label: '1' },
                  { id: '2', label: '2' },
                  { id: '3', label: '3' }
                ]}
              />
              <Button size="sm" variant="ghost" onClick={() => studio.unloadModels()} disabled={engine.state !== 'ready'} title="Unloads models until you next generate">
                Free memory now
              </Button>
            </div>
          </Row>

          <ModelSettings />

          <Row title="Storage" body="Models, your voices and generated audio are stored in Voiceify’s data folder on this computer.">
            <Button size="sm" variant="outline" icon={<FolderOpen className="size-4" />} onClick={() => studio.openDataFolder()}>
              Open folder
            </Button>
          </Row>

          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  Voice engine
                  <Badge tone={ENGINE_BADGE[engine.state].tone}>{ENGINE_BADGE[engine.state].label}</Badge>
                </div>
                <div className="mt-0.5 text-[13px] text-ink-3">
                  {engine.state === 'installing'
                    ? `${engine.step} (${Math.round(engine.progress * 100)}%)`
                    : engine.state === 'error'
                      ? `${engine.error} Try Restart, or Reinstall if that doesn’t help.`
                      : 'The software that runs voice models on this computer.'}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                icon={<RefreshCw className="size-4" />}
                onClick={() => studio.restartEngine()}
                disabled={engine.state !== 'ready' && engine.state !== 'error'}
                title="Fixes most glitches"
              >
                Restart
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={<Wrench className="size-4" />}
                onClick={() => studio.installEngine()}
                disabled={engine.state === 'installing'}
                title="Re-downloads the engine (about 350 MB). Your models and voices are kept."
              >
                {engine.state === 'missing' ? 'Install' : 'Reinstall'}
              </Button>
            </div>
            <button onClick={() => setShowLog((v) => !v)} className="mt-4 flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
              Technical details
              <ChevronDown className={cn('size-3.5 transition-transform', showLog && 'rotate-180')} />
            </button>
            <AnimatePresence initial={false}>
              {showLog && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="mt-2 text-xs text-ink-3">
                    {engine.state === 'ready' ? `Python 3.12 · MLX ${engine.mlx} · mlx-audio ${engine.version}` : null}
                  </div>
                  <pre ref={logRef} className="scroll mt-2 h-56 select-text rounded-xl bg-subtle p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">
                    {logs.length ? logs.join('\n') : 'No log output yet.'}
                  </pre>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Row({ title, body, children }: { title: ReactNode; body?: string; children: ReactNode }) {
  return (
    <Card className="flex items-center gap-6 p-5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        {body && <div className="mt-0.5 text-[13px] text-ink-3">{body}</div>}
      </div>
      {children}
    </Card>
  )
}
