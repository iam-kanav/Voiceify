import { useRef, useState } from 'react'
import { Check, ChevronDown, Sparkles } from 'lucide-react'
import type { Capability, ModelInfo, Voice } from '@shared/types'
import { PRECISION_HELP, ROLES, SIZE_HELP } from '@shared/catalog'
import { Popover } from '@/components/Popover'
import { InfoTip } from '@/components/InfoTip'
import { ModelGate } from '@/components/ModelGate'
import { Badge } from '@/components/ui'
import { useApp } from '@/stores/app'
import { cn } from '@/lib/api'

export function speedText(m: ModelInfo | undefined) {
  if (!m?.localSpeed) return null
  const x = m.localSpeed.speedup
  return x >= 1 ? `${x.toFixed(1)}× faster than real time on this computer` : `${(1 / x).toFixed(1)}× slower than real time on this computer`
}

/**
 * Picks which installed model speaks for the selected voice. Each kind of voice needs a specific
 * kind of model, so we only offer compatible ones, explain them in plain language, and hide the
 * picker entirely when there's nothing to choose.
 */
export function ModelChooser({
  voice,
  cap,
  options,
  active,
  value,
  onChange,
  provider,
  help: helpOverride
}: {
  provider?: string
  /** Replaces the voice-centric explanation (e.g. for speech-to-text models). */
  help?: React.ReactNode
  voice: Voice | undefined
  cap: Capability
  options: ModelInfo[]
  active: ModelInfo | undefined
  value: string
  onChange: (id: string) => void
}) {
  const navigate = useApp((s) => s.navigate)
  const defaults = useApp((s) => s.settings?.defaultModels)
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const multiRole = new Set(options.map((o) => o.roleId)).size > 1
  // Named sizes ("Large", "Small", "Turbo") are worth showing; parameter counts ("100M") aren't.
  const sized = (m: ModelInfo) => !!m.sizeLabel && !/^\d/.test(m.sizeLabel)
  const label = (m: ModelInfo) =>
    `${multiRole ? `${m.role} · ` : ''}${sized(m) ? `${m.sizeLabel} · ` : ''}${m.precisionLabel}`

  const help = helpOverride ?? (
    <>
      <p>
        {voice?.kind === 'preset'
          ? 'Which installed version of this model speaks built-in voices.'
          : voice?.kind === 'designed' && cap === 'voice-design'
            ? 'No cloning model is installed for this family, so this voice is re-created from its description each time (it may sound a little different).'
            : 'Your own voices are spoken by a cloning model, which copies the voice from its reference recording.'}
      </p>
      <p className="mt-1.5 opacity-80">{SIZE_HELP}</p>
      <p className="mt-1.5 opacity-80">{PRECISION_HELP}</p>
    </>
  )

  const header = (
    <div className="flex items-center gap-1.5 text-[13px] font-medium">
      Version
      <InfoTip width={320}>{help}</InfoTip>
    </div>
  )

  if (!options.length) {
    return (
      <div className="space-y-2">
        {header}
        <ModelGate cap={cap} provider={provider} compact />
      </div>
    )
  }

  const speed = speedText(active)

  // Only one compatible version installed: say what's running, don't offer a pointless choice.
  if (options.length === 1) {
    const m = options[0]
    return (
      <div className="flex items-start justify-between gap-3 rounded-xl bg-subtle px-3 py-2.5">
        <div className="min-w-0 text-xs">
          <div className="flex items-center gap-1.5 text-ink-2">
            Running <b className="font-medium text-ink">{m.name}</b>
            <InfoTip width={320}>{help}</InfoTip>
          </div>
          <div className="mt-0.5 text-ink-3">{m.officialName}</div>
          {speed && <div className="text-ink-3">{speed}</div>}
        </div>
        <button onClick={() => navigate('models', provider ? { family: provider } : undefined)} className="shrink-0 text-xs text-ink-3 hover:text-ink">
          Other versions
        </button>
      </div>
    )
  }

  const isAuto = value === 'auto' || !options.some((o) => o.id === value)
  return (
    <div className="space-y-2">
      {header}
      <button
        ref={btn}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-2xl border border-line-strong bg-surface p-3 text-left transition-colors hover:bg-subtle"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{isAuto ? 'Automatic' : label(active!)}</div>
          <div className="truncate text-xs text-ink-3">
            {isAuto ? `Using ${active ? label(active) : '—'} · ${active?.officialName ?? ''}` : active?.officialName}
          </div>
        </div>
        <ChevronDown className={cn('size-4 shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      {speed && <div className="px-1 text-[11px] text-ink-3">{speed}</div>}
      <Popover open={open} onClose={() => setOpen(false)} anchor={btn} width={360} align="end">
        <Option
          selected={isAuto}
          title={
            <span className="flex items-center gap-1.5">
              <Sparkles className="size-3.5" /> Automatic
            </span>
          }
          subtitle={`Uses your default model (★ on the Models page), otherwise the one recommended for this computer. Right now: ${active ? label(active) : '—'}.`}
          onClick={() => {
            onChange('auto')
            setOpen(false)
          }}
        />
        <div className="my-1 h-px bg-line" />
        {options.map((m) => (
          <Option
            key={m.id}
            selected={!isAuto && m.id === value}
            title={
              <span className="flex items-center gap-1.5">
                {label(m)}
                {m.recommended && <Badge tone="green">Recommended</Badge>}
                {defaults?.[`${m.provider}/${cap}`] === m.id && <span title="Your default">★</span>}
              </span>
            }
            subtitle={`${m.summary}${multiRole ? ` · ${ROLES[m.roleId]?.blurb ?? ''}` : ''}`}
            meta={`${m.officialName}${m.localSpeed ? ` · ${m.localSpeed.speedup.toFixed(1)}× real time here` : ''}`}
            onClick={() => {
              onChange(m.id)
              setOpen(false)
            }}
          />
        ))}
      </Popover>
    </div>
  )
}

function Option({
  title,
  subtitle,
  meta,
  selected,
  onClick
}: {
  title: React.ReactNode
  subtitle: string
  meta?: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button onClick={onClick} className="flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-muted">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs text-ink-3">{subtitle}</div>
        {meta && <div className="mt-0.5 text-[11px] text-ink-3/80">{meta}</div>}
      </div>
      {selected && <Check className="mt-0.5 size-4 shrink-0" />}
    </button>
  )
}
