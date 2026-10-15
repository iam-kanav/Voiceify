import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Cpu, Download, ExternalLink, HardDrive, Loader2, MemoryStick, Plus, Sparkles, Star, Trash2, X } from 'lucide-react'
import type { ModelInfo, Provider, Task } from '@shared/types'
import { VoiceAvatar } from '@/components/VoiceAvatar'
import { FeatureChips } from '@/features/tts/ProviderPicker'
import { formatBytes, PRECISION_HELP, PROVIDERS, ROLES, SIZE_HELP } from '@shared/catalog'
import { PROVIDER_BY_ID } from '@shared/providers'
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

/** Roles that are a whole family on their own (one download does everything), so their header would repeat the family. */
const SINGLE_ROLE = ['voices-and-cloning', 'design-and-cloning', 'cloning-only']
const ROLE_ORDER = ['built-in-voices', 'voices-and-cloning', 'design-and-cloning', 'cloning-only', 'voice-cloning', 'voice-design', 'voice-fingerprints', 'transcription', 'sound-effects', 'speech-enhancement', 'community', 'custom']
/** What each kind of model is for, as tabs above the family grid. Community and custom models are voice models. */
const CATEGORIES: { id: Task; label: string }[] = [
  { id: 'tts', label: 'Text to Speech' },
  { id: 'asr', label: 'Speech to Text' },
  { id: 'sfx', label: 'Sound Effects' },
  { id: 'enhance', label: 'Speech Enhancement' }
]
const categoryOf = (p: Provider | undefined): Task => p?.task ?? 'tts'

const GRID = 'grid grid-cols-[minmax(220px,1.6fr)_76px_92px_92px_128px_292px] items-center gap-4'

export default function Models() {
  const models = useApp((s) => s.models)
  const system = useApp((s) => s.system)
  const engine = useApp((s) => s.engine)
  const [filter, setFilter] = useState<Filter>('all')
  const route = useApp((s) => s.route)
  const navigate = useApp((s) => s.navigate)
  const pad = usePlayerPadding()

  // The starter set: optional extras keep their Recommended badge but aren't downloaded by "Download all".
  const recommended = models.filter((m) => m.recommended && !m.community && !PROVIDER_BY_ID.get(m.provider)?.optional)
  const missingRec = recommended.filter((m) => m.install.status === 'not-installed' || m.install.status === 'error')
  const installedBytes = models.reduce((n, m) => n + (m.install.status === 'installed' ? m.install.sizeBytes : 0), 0)

  // Model family → what each model does → versions.
  const families = useMemo(() => {
    const visible = models.filter((m) =>
      filter === 'installed' ? m.install.status !== 'not-installed' : filter === 'recommended' ? m.recommended : true
    )
    const extrasRoles = ['community', 'custom']
    const out = PROVIDERS.map((p) => ({
      provider: p as Provider | undefined,
      roles: ROLE_ORDER.filter((r) => !extrasRoles.includes(r))
        .map((roleId) => ({ roleId, rows: visible.filter((m) => m.provider === p.id && m.roleId === roleId) }))
        .filter((r) => r.rows.length)
    }))
    out.push({
      provider: undefined,
      roles: extrasRoles.map((roleId) => ({ roleId, rows: visible.filter((m) => m.roleId === roleId) })).filter((r) => r.rows.length)
    })
    return out
  }, [models, filter])

  // One family at a time, picked from a strip (keeps the page short as families are added).
  const pickable = families.filter(
    (f) => f.provider || models.some((m) => m.roleId === 'community' || m.roleId === 'custom')
  )
  const familyId = route.params?.family && pickable.some((f) => (f.provider?.id ?? 'extras') === route.params?.family)
    ? route.params.family
    : (pickable[0]?.provider?.id ?? 'extras')
  const selected = pickable.find((f) => (f.provider?.id ?? 'extras') === familyId)
  const pick = (id: string) => navigate('models', { family: id })
  // Narrow the grid to one kind of model; picking a kind opens its first family.
  const [category, setCategory] = useState<'all' | Task>('all')
  const inCategory = (c: 'all' | Task) => pickable.filter((f) => c === 'all' || categoryOf(f.provider) === c)
  const pickCategory = (c: 'all' | Task) => {
    setCategory(c)
    const first = inCategory(c)[0]
    if (c !== 'all' && first && categoryOf(selected?.provider) !== c) pick(first.provider?.id ?? 'extras')
  }
  // Arriving with a family from elsewhere (e.g. "Other versions") shows its kind.
  useEffect(() => {
    setCategory((c) => (c === 'all' || c === categoryOf(selected?.provider) ? c : 'all'))
  }, [familyId, selected?.provider])
  // Within a family that does several jobs (e.g. Qwen3-TTS), narrow to one job.
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const familyRoles = selected?.roles ?? []
  const roleId = familyRoles.some((r) => r.roleId === roleFilter) ? roleFilter : 'all'
  const shownRoles = roleId === 'all' ? familyRoles : familyRoles.filter((r) => r.roleId === roleId)

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
                        <button key={m.id} onClick={() => pick(m.provider)} title={`Show ${m.family}`}>
                          <Badge tone={m.install.status === 'installed' ? 'green' : 'neutral'} className="cursor-pointer hover:opacity-80">
                            {m.install.status === 'installed' && <Check className="size-3" />}
                            {m.name}
                          </Badge>
                        </button>
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

        <FamilyPicker
          families={inCategory(category).map((f) => f.provider)}
          value={familyId}
          onChange={pick}
          category={category}
          categories={[
            { id: 'all' as const, label: `All · ${pickable.length}` },
            ...CATEGORIES.map((c) => ({ id: c.id, label: `${c.label} · ${inCategory(c.id).length}` })).filter((c) => !c.label.endsWith(' 0'))
          ]}
          onCategory={pickCategory}
        />

        {/* The filters stay pinned while a long list of versions scrolls by. */}
        <div className="sticky top-0 z-20 -mx-8 space-y-4 border-b border-line bg-canvas/90 px-8 pb-4 pt-4 backdrop-blur-xl">

        <div className="flex items-center justify-between">
          <Tabs
            id="model-filter"
            value={filter}
            onChange={setFilter}
            tabs={[
              { id: 'all', label: 'All versions' },
              { id: 'installed', label: 'Installed' },
              { id: 'recommended', label: 'Recommended' }
            ]}
          />
          <CustomModel />
        </div>
        {familyRoles.length > 1 && (
          <Tabs
            id="model-role"
            value={roleId}
            onChange={setRoleFilter}
            className="flex-wrap"
            tabs={[
              { id: 'all', label: `Everything · ${familyRoles.reduce((n, r) => n + r.rows.length, 0)}` },
              ...familyRoles.map((r) => ({ id: r.roleId, label: `${ROLES[r.roleId]?.label ?? r.roleId} · ${r.rows.length}` }))
            ]}
          />
        )}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={familyId}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-6"
          >
            {selected?.provider ? (
              <FamilyHeader provider={selected.provider} />
            ) : (
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Community &amp; custom</h2>
                <p className="mt-0.5 text-[13px] text-ink-3">Fine-tunes and models you added from Hugging Face.</p>
              </div>
            )}
            {shownRoles.length ? (
              shownRoles.map(({ roleId, rows }) => (
                <RoleSection
                  key={roleId}
                  roleId={roleId}
                  rows={rows}
                  showRole={!selected?.provider || familyRoles.length > 1 || !SINGLE_ROLE.includes(roleId)}
                />
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-line-strong p-8 text-center text-sm text-ink-3">
                {filter === 'installed'
                  ? `You haven’t installed any ${selected?.provider?.name ?? 'custom'} models yet.`
                  : 'Nothing recommended here for this computer.'}{' '}
                <button onClick={() => setFilter('all')} className="font-medium text-ink underline-offset-2 hover:underline">
                  Show all versions
                </button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <p className="text-xs text-ink-3">
          Weights are downloaded from Hugging Face. Quality and speed bars are relative estimates; “Your speed” is measured from your own
          generations.
        </p>
      </div>
    </div>
  )
}

/** Grid of model families, four to a row. */
function FamilyPicker({
  families,
  value,
  onChange,
  category,
  categories,
  onCategory
}: {
  families: (Provider | undefined)[]
  value: string
  onChange: (id: string) => void
  category: 'all' | Task
  categories: { id: 'all' | Task; label: string }[]
  onCategory: (c: 'all' | Task) => void
}) {
  const models = useApp((s) => s.models)
  return (
    <div className="mx-auto w-full max-w-6xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[13px] font-medium">
          Model family
          <InfoTip>Each family is a different open-source model with its own voices, strengths and sizes. Pick one to see its versions.</InfoTip>
        </div>
        <Tabs id="model-category" value={category} onChange={onCategory} tabs={categories} />
      </div>
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {families.map((p) => {
          const id = p?.id ?? 'extras'
          const mine = models.filter((m) => (p ? m.provider === p.id && m.roleId !== 'community' && m.roleId !== 'custom' : m.roleId === 'community' || m.roleId === 'custom'))
          const installed = mine.filter(isInstalled).length
          const busy = mine.some((m) => ['queued', 'downloading', 'converting'].includes(m.install.status))
          const active = id === value
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={cn(
                'relative flex items-start gap-3 rounded-2xl border p-3 text-left transition-colors',
                active ? 'border-ink' : 'border-line hover:border-line-strong hover:bg-subtle'
              )}
            >
              {active && (
                <motion.span
                  layoutId="family-active"
                  className="absolute inset-0 rounded-2xl bg-subtle"
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                />
              )}
              <span className="relative">
                <VoiceAvatar colors={p?.colors ?? ['#a1a1aa', '#52525b']} size={32} />
              </span>
              <span className="relative min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{p?.name ?? 'Community & custom'}</span>
                  {/* The kind is only worth saying when every kind is shown. */}
                  {category === 'all' && p?.task === 'asr' && <span className="text-[10px] text-ink-3">Speech to Text</span>}
                  {category === 'all' && p?.task === 'sfx' && <span className="text-[10px] text-ink-3">Sound Effects</span>}
                  {category === 'all' && p?.task === 'enhance' && <span className="text-[10px] text-ink-3">Enhancement</span>}
                </span>
                <span className="block truncate text-[11.5px] text-ink-3">{p ? `${p.vendor} · ${p.tagline}` : 'Fine-tunes and your additions'}</span>
                <span className={cn('mt-1 block text-[11px]', installed ? 'text-success' : 'text-ink-3')}>
                  {busy ? 'Downloading…' : installed ? `${installed} installed` : 'Not installed'} · {mine.length} version{mine.length === 1 ? '' : 's'}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function FamilyHeader({ provider: p }: { provider: Provider }) {
  const models = useApp((s) => s.models)
  const installed = models.filter((m) => m.provider === p.id && isInstalled(m)).length
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-4 p-5">
        <VoiceAvatar colors={p.colors} size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-xl font-semibold tracking-tight">{p.name}</h2>
            <span className="text-xs text-ink-3">
              by {p.vendor} · {p.license}
            </span>
            {installed > 0 && <Badge tone="green">{installed} installed</Badge>}
            <button onClick={() => studio.openExternal(p.url)} className="ml-auto flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
              Model card <ExternalLink className="size-3" />
            </button>
          </div>
          <p className="mt-1 max-w-3xl text-[13px] text-ink-2">{p.description}</p>
          {p.task === 'tts' && (
            <div className="mt-3">
              <FeatureChips provider={p} />
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px border-t border-line bg-line text-[12.5px]">
        <div className="bg-surface px-5 py-3">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-3">Good at</div>
          <ul className="space-y-0.5 text-ink-2">
            {p.strengths.map((x) => (
              <li key={x}>• {x}</li>
            ))}
          </ul>
        </div>
        <div className="bg-surface px-5 py-3">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-3">Keep in mind</div>
          <ul className="space-y-0.5 text-ink-2">
            {p.limits.map((x) => (
              <li key={x}>• {x}</li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  )
}

function RoleSection({ roleId, rows, showRole }: { roleId: string; rows: ModelInfo[]; showRole: boolean }) {
  const role = ROLES[roleId]
  return (
    <section>
      {showRole && (
        <div className="mb-3 min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight">{role.label}</h3>
          <p className="mt-0.5 max-w-3xl text-[13px] text-ink-2">{role.blurb}</p>
          <p className="mt-0.5 max-w-3xl text-[13px] text-ink-3">{role.why}</p>
        </div>
      )}
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
    </section>
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
  // Defaults are kept per family and job ("voxcpm2/voice-clone"); a model counts for every job it does.
  const isDefault = settings?.defaultModels[`${m.provider}/${primary}`] === m.id
  // Helpers (e.g. Voice Fingerprints) aren't picked or measured; they just need to be there.
  const helper = m.capabilities.includes('fingerprint')
  const install = () => studio.installModel(m.id).catch((e) => toast.error('Download failed', errorMessage(e)))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const models = useApp((st) => st.models)
  const lastForRole = models.filter((x) => x.roleId === m.roleId && isInstalled(x)).length === 1

  return (
    <div className={cn(GRID, 'border-b border-line px-4 py-3 last:border-b-0')}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {m.sizeLabel === 'Large' || m.sizeLabel === 'Small' ? `${m.sizeLabel} (${m.params}) · ${m.precisionLabel}` : m.precisionLabel}
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
      {helper ? <span /> : <Meter value={m.quality} />}
      {helper ? <span /> : <Meter value={m.speed} />}
      <span className="text-xs text-ink-3">
        {helper ? '' : m.localSpeed ? `${m.localSpeed.speedup.toFixed(1)}× real time` : s.status === 'installed' ? 'Generate to measure' : '—'}
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
            {!isDefault && !helper && m.task === 'tts' && (
              <span className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    updateSettings({
                      defaultModels: { ...settings?.defaultModels, ...Object.fromEntries(m.capabilities.map((c) => [`${m.provider}/${c}`, m.id])) }
                    })
                  }
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
