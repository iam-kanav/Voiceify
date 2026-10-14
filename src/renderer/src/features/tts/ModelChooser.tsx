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
  onChange
}: {
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
  const label = (m: ModelInfo) => `${multiRole ? `${m.role} · ` : ''}${m.sizeLabel} · ${m.precisionLabel}`

  const help = (
    <>
      <p>
        {voice?.kind === 'preset'
          ? 'Built-in voices are spoken by the Built-in Voices model (open-source Qwen3-TTS CustomVoice).'
          : voice?.kind === 'designed'
            ? 'Saved designed voices are spoken by the Voice Cloning model, which copies the preview you saved. Without it, the Voice Design model re-creates the voice from its description.'
            : 'Cloned voices are spoken by the Voice Cloning model (open-source Qwen3-TTS Base), which copies the voice from your sample.'}
      </p>
      <p className="mt-1.5 opacity-80">{SIZE_HELP}</p>
      <p className="mt-1.5 opacity-80">{PRECISION_HELP}</p>
    </>
  )

  const header = (
    <div className="flex items-center gap-1.5 text-[13px] font-medium">
      Model
      <InfoTip width={320}>{help}</InfoTip>
    </div>
  )

  if (!options.length) {
    return (
      <div className="space-y-2">
        {header}
        <ModelGate cap={cap} compact />
      </div>
    )
  }

  const speed = speedText(active)

  // Only one compatible model installed: show it, don't offer a pointless choice.
  if (options.length === 1) {
    const m = options[0]
    return (
      <div className="space-y-2">
        {header}
        <div className="rounded-2xl border border-line-strong p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">
              {m.role} · {m.sizeLabel} · {m.precisionLabel}
            </span>
            <button onClick={() => navigate('models')} className="text-xs text-ink-3 hover:text-ink">
              More options
            </button>
          </div>
          <div className="mt-0.5 text-xs text-ink-3">
            {m.officialName}
            {speed ? ` · ${speed}` : ''}
          </div>
        </div>
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
                {defaults?.[cap] === m.id && <span title="Your default">★</span>}
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
