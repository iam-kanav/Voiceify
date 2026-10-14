import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { Check, Cpu, Download, ExternalLink, HardDrive, Loader2, MemoryStick, Plus, Sparkles, Star, Trash2, X } from 'lucide-react'
import type { ModelInfo } from '@shared/types'
import { formatBytes, PRECISION_HELP, PROVIDERS, ROLES, SIZE_HELP } from '@shared/catalog'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Button, Card, Input, Meter, ProgressBar, Tabs } from '@/components/ui'
import { InfoTip } from '@/components/InfoTip'
import { ModelGate } from '@/components/ModelGate'
import { Modal } from '@/components/Modal'
import { errorMessage, toast } from '@/components/Toast'
import { useApp } from '@/stores/app'
import { isInstalled } from '@/lib/models'
import { cn, studio } from '@/lib/api'
import { usePlayerPadding } from '@/lib/useGenerate'

type Filter = 'all' | 'installed' | 'recommended'

const ROLE_ORDER = ['built-in-voices', 'voice-cloning', 'voice-design', 'transcription', 'community', 'custom']
const GRID = 'grid grid-cols-[minmax(220px,1.6fr)_76px_92px_92px_128px_292px] items-center gap-4'

export default function Models() {
  const models = useApp((s) => s.models)
  const system = useApp((s) => s.system)
  const engine = useApp((s) => s.engine)
  const [filter, setFilter] = useState<Filter>('all')
  const pad = usePlayerPadding()

  const recommended = models.filter((m) => m.recommended && !m.community)
  const missingRec = recommended.filter((m) => m.install.status === 'not-installed' || m.install.status === 'error')
  const installedBytes = models.reduce((n, m) => n + (m.install.status === 'installed' ? m.install.sizeBytes : 0), 0)

  const roles = useMemo(() => {
    const visible = models.filter((m) =>
      filter === 'installed' ? m.install.status !== 'not-installed' : filter === 'recommended' ? m.recommended : true
    )
    return ROLE_ORDER.map((roleId) => ({ roleId, rows: visible.filter((m) => m.roleId === roleId) })).filter((r) => r.rows.length)
  }, [models, filter])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Models"
        subtitle="Voiceify runs open-source AI models on your computer. Each task needs its own model — install the ones you use."
      />
      <div className={cn('scroll flex-1 space-y-8 px-8 pb-10', pad)}>
        {(engine.state === 'missing' || engine.state === 'error') && <ModelGate cap="preset-voices" />}
        {engine.state === 'installing' && (
          <Card className="p-5">
            <div className="flex items-center justify-between text-sm font-medium">
              <span>Installing the voice engine · {engine.step}</span>
              <span className="tabular-nums text-ink-3">{Math.round(engine.progress * 100)}%</span>
            </div>
            <ProgressBar value={engine.progress} className="mt-3" />
          </Card>
        )}

        {system && (
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-line p-5">
              <Stat icon={<Cpu className="size-4" />} label="Processor" value={system.chip} />
              <Stat icon={<MemoryStick className="size-4" />} label="Memory" value={`${system.memoryGB} GB`} />
              <Stat icon={<HardDrive className="size-4" />} label="Free disk" value={`${system.freeDiskGB} GB`} />
              <Stat icon={<Download className="size-4" />} label="Models on disk" value={formatBytes(installedBytes)} />
            </div>
            <div className="flex items-center gap-4 bg-subtle/70 p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink text-canvas">
                <Sparkles className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Recommended for this computer</div>
                {recommended.length ? (
                  <>
                    <div className="mt-0.5 text-[13px] text-ink-3">Picked for {system.memoryGB} GB of memory, so they run smoothly.</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {recommended.map((m) => (
                        <Badge key={m.id} tone={m.install.status === 'installed' ? 'green' : 'neutral'}>
                          {m.install.status === 'installed' && <Check className="size-3" />}
                          {m.role} · {m.sizeLabel} · {m.precisionLabel}
                        </Badge>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="mt-0.5 text-[13px] text-ink-3">This device isn’t supported by the current voice engine yet.</div>
                )}
              </div>
              {missingRec.length > 0 ? (
                <Button
                  icon={<Download className="size-4" />}
                  onClick={() => missingRec.forEach((m) => studio.installModel(m.id).catch((e) => toast.error('Download failed', errorMessage(e))))}
                >
                  Download all ({formatBytes(missingRec.reduce((n, m) => n + m.sizeBytes, 0))})
                </Button>
              ) : recommended.length ? (
                <Badge tone="green">
                  <Check className="size-3" /> All installed
                </Badge>
              ) : null}
            </div>
          </Card>
        )}

        <div className="flex items-center justify-between">
          <Tabs
            id="model-filter"
            value={filter}
            onChange={setFilter}
            tabs={[
              { id: 'all', label: 'All models' },
              { id: 'installed', label: 'Installed' },
              { id: 'recommended', label: 'Recommended' }
            ]}
          />
          <CustomModel />
        </div>

        {roles.map(({ roleId, rows }, i) => (
          <RoleSection key={roleId} roleId={roleId} rows={rows} index={i} />
        ))}

        <p className="text-xs text-ink-3">
          Weights are downloaded from Hugging Face. Quality and speed bars are relative estimates; “On this computer” shows the speed measured from your own
          generations.
        </p>
      </div>
    </div>
  )
}

function RoleSection({ roleId, rows, index }: { roleId: string; rows: ModelInfo[]; index: number }) {
  const role = ROLES[roleId]
  const providers = [...new Set(rows.map((r) => r.provider))].map((id) => PROVIDERS.find((p) => p.id === id)).filter(Boolean)
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: index * 0.04 } }}>
      <div className="mb-3 flex items-end justify-between gap-6">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-tight">{role.label}</h2>
          <p className="mt-0.5 max-w-3xl text-[13px] text-ink-2">{role.blurb}</p>
          <p className="mt-0.5 max-w-3xl text-[13px] text-ink-3">{role.why}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {providers.map((p) => (
            <button
              key={p!.id}
              onClick={() => studio.openExternal(p!.url)}
              className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink"
              title={p!.description}
            >
              Open-source model: {p!.name} by {p!.vendor} · {p!.license}
              <ExternalLink className="size-3" />
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-line">
        <div className={cn(GRID, 'border-b border-line bg-subtle px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-ink-3')}>
          <span className="flex items-center gap-1">
            Version
            <InfoTip width={320}>
              <p>{SIZE_HELP}</p>
              <p className="mt-1.5 opacity-80">{PRECISION_HELP}</p>
            </InfoTip>
          </span>
          <span>Download</span>
          <span className="flex items-center gap-1">
            Quality <InfoTip>Relative estimate based on model size and compression. Full precision Large = best.</InfoTip>
          </span>
          <span className="flex items-center gap-1">
            Speed <InfoTip>Relative estimate. Smaller and more compressed models generate faster and use less memory.</InfoTip>
          </span>
          <span className="flex items-center gap-1">
            Your speed
            <InfoTip>Real speed measured from your own generations. “2.0×” means 10 seconds of speech takes about 5 seconds to make.</InfoTip>
          </span>
          <span className="text-right">Status</span>
        </div>
        {rows.map((m) => (
          <ModelRow key={m.id} model={m} />
        ))}
      </div>
    </motion.section>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-ink-3">{icon}</span>
      <div>
        <div className="text-[11px] text-ink-3">{label}</div>
        <div className="text-sm font-medium">{value}</div>
      </div>
    </div>
  )
}

function ModelRow({ model: m }: { model: ModelInfo }) {
  const settings = useApp((s) => s.settings)
  const engine = useApp((s) => s.engine)
  const updateSettings = useApp((s) => s.updateSettings)
  const s = m.install
  const primary = m.capabilities[0]
  const isDefault = settings?.defaultModels[primary] === m.id
  const install = () => studio.installModel(m.id).catch((e) => toast.error('Download failed', errorMessage(e)))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const models = useApp((st) => st.models)
  const lastForRole = models.filter((x) => x.roleId === m.roleId && isInstalled(x)).length === 1

  return (
    <div className={cn(GRID, 'border-b border-line px-4 py-3 last:border-b-0')}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {m.sizeLabel} ({m.params}) · {m.precisionLabel}
          </span>
          {m.recommended && (
            <span title={m.recommendedReason} className="shrink-0">
              <Badge tone="green">Recommended</Badge>
            </span>
          )}
          {m.loaded && (
            <Badge tone="blue" className="shrink-0">
              In memory
            </Badge>
          )}
          {isDefault && (
            <span title="Your default — used when the model picker is on Automatic">
              <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-ink-2">{m.summary}</div>
        <div className="truncate text-[11px] text-ink-3" title={m.source.repo}>
          {m.officialName}
          {m.source.type === 'hf-convert' ? ' · converted after download' : ''}
        </div>
      </div>
      <span className="text-sm tabular-nums text-ink-2">{formatBytes(m.sizeBytes)}</span>
      <Meter value={m.quality} />
      <Meter value={m.speed} />
      <span className="text-xs text-ink-3">
        {m.localSpeed ? `${m.localSpeed.speedup.toFixed(1)}× real time` : s.status === 'installed' ? 'Generate to measure' : '—'}
      </span>
      <div className="flex items-center justify-end gap-1.5">
        {s.status === 'not-installed' && (
          <Button
            size="sm"
            variant="outline"
            icon={<Download className="size-3.5" />}
            onClick={install}
            disabled={m.source.type === 'hf-convert' && engine.state !== 'ready'}
          >
            Download
          </Button>
        )}
        {s.status === 'queued' && (
          <span className="flex items-center gap-2 text-xs text-ink-3">
            <Loader2 className="size-3.5 animate-spin" /> Starting…
          </span>
        )}
        {s.status === 'downloading' && (
          <div className="flex w-full items-center gap-2">
            <div className="min-w-0 flex-1">
              <ProgressBar value={s.received / Math.max(1, s.total)} />
              <div className="mt-1 flex justify-between text-[11px] tabular-nums text-ink-3">
                <span>{Math.round((s.received / Math.max(1, s.total)) * 100)}%</span>
                <span>{s.bytesPerSec ? `${formatBytes(s.bytesPerSec)}/s` : ''}</span>
              </div>
            </div>
            <button onClick={() => studio.cancelInstall(m.id)} className="text-ink-3 hover:text-ink" title="Cancel download">
              <X className="size-4" />
            </button>
          </div>
        )}
        {s.status === 'converting' && (
          <div className="w-full">
            <ProgressBar value={0} indeterminate />
            <div className="mt-1 text-[11px] text-ink-3">Converting for your computer…</div>
          </div>
        )}
        {s.status === 'error' && (
          <>
            <span className="truncate text-xs text-danger" title={s.error}>
              {s.error}
            </span>
            <Button size="sm" variant="outline" onClick={install}>
              Retry
            </Button>
          </>
        )}
        {s.status === 'installed' && (
          <>
            {!isDefault && m.task === 'tts' && (
              <span className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => updateSettings({ defaultModels: { ...settings?.defaultModels, [primary]: m.id } })}
                >
                  Use by default
                </Button>
                <InfoTip>When a voice’s model is set to “Automatic”, your default (★) is used. Otherwise Voiceify uses the recommended one.</InfoTip>
              </span>
            )}
            <Badge tone="green">
              <Check className="size-3" /> Installed
            </Badge>
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex size-7 items-center justify-center rounded-full text-ink-3 hover:bg-muted hover:text-danger"
              title="Delete from disk"
            >
              <Trash2 className="size-3.5" />
            </button>
          </>
        )}
      </div>
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Remove ${m.name}?`}
        description={`This frees ${formatBytes(m.sizeBytes)}. You can download it again any time.${
          lastForRole ? ` It’s your only ${m.role} model, so ${m.role.toLowerCase()} won’t work until you install one again.` : ''
        }`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                setConfirmDelete(false)
                await studio.deleteModel(m.id)
                toast.info(`Removed ${m.name}`, `Freed ${formatBytes(m.sizeBytes)}`)
              }}
            >
              Remove model
            </Button>
          </>
        }
      >
        <div />
      </Modal>
    </div>
  )
}

function CustomModel() {
  const [open, setOpen] = useState(false)
  const [repo, setRepo] = useState('')
  const [busy, setBusy] = useState(false)
  if (!open) {
    return (
      <span className="flex items-center gap-1">
        <Button variant="ghost" size="sm" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
          Add from Hugging Face
        </Button>
        <InfoTip>
          Advanced: add any compatible model repository (for example a community fine-tune) by its Hugging Face id, like “owner/model-name”.
        </InfoTip>
      </span>
    )
  }
  const add = async () => {
    setBusy(true)
    try {
      const m = await studio.addCustomModel(repo)
      toast.success(`Added ${m.name}`, 'Find it under “Custom Models” and click Download.')
      setRepo('')
      setOpen(false)
    } catch (e) {
      toast.error('Could not add model', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <motion.div initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} className="flex items-center gap-2">
      <Input
        autoFocus
        value={repo}
        onChange={(e) => setRepo(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        placeholder="owner/model-name"
        className="h-9 w-72"
      />
      <Button size="sm" onClick={add} loading={busy} disabled={!repo.trim()}>
        Add
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </motion.div>
  )
}
