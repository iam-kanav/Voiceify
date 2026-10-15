import { useRef, useState } from 'react'
import { Check, ChevronDown, Download, Loader2, Minus } from 'lucide-react'
import type { ModelInfo, Provider } from '@shared/types'
import { formatBytes } from '@shared/catalog'
import { TTS_PROVIDERS } from '@shared/providers'
import { Popover } from '@/components/Popover'
import { InfoTip } from '@/components/InfoTip'
import { VoiceAvatar } from '@/components/VoiceAvatar'
import { Badge, ProgressBar } from '@/components/ui'
import { errorMessage, toast } from '@/components/Toast'
import { useApp } from '@/stores/app'
import { familyInstalled, isInstalled } from '@/lib/models'
import { cn, studio } from '@/lib/api'

/** What a model family can and can't do, as short chips. */
export function featureChips(p: Provider): { label: string; on: boolean }[] {
  return [
    { label: p.voices.length ? `${p.voices.length} built-in voices` : 'Built-in voices', on: p.features.builtInVoices },
    { label: p.languages.length > 1 ? `${p.languages.length} languages` : 'English only', on: true },
    { label: 'Your own voices', on: p.features.voiceCloning },
    { label: 'Style instructions', on: p.features.styleInstructions },
    { label: 'Voice design', on: p.features.voiceDesign }
  ]
}

export function FeatureChips({ provider, compact }: { provider: Provider; compact?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1">
      {featureChips(provider)
        .filter((c) => !compact || c.on)
        .map((c) => (
          <span
            key={c.label}
            className={cn(
              'inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px]',
              c.on ? 'bg-muted text-ink-2' : 'text-ink-3 line-through decoration-ink-3/50'
            )}
          >
            {c.on ? <Check className="size-3" /> : <Minus className="size-3" />}
            {c.label}
          </span>
        ))}
    </div>
  )
}

/** The model to download when someone picks a family they don't have yet (its built-in voices, if it has any). */
function starterModel(models: ModelInfo[], providerId: string) {
  const all = models.filter((m) => m.provider === providerId && !m.community)
  const voices = all.filter((m) => m.capabilities.includes('preset-voices'))
  const fam = voices.length ? voices : all
  return fam.find((m) => m.recommended) ?? fam.find((m) => m.quant === '8bit') ?? fam[0]
}

export function ProviderPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const models = useApp((s) => s.models)
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const current = TTS_PROVIDERS.find((p) => p.id === value) ?? TTS_PROVIDERS[0]

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[13px] font-medium">
        Model
        <InfoTip width={320}>
          Voiceify runs several open-source voice models, each with its own strengths (and most with their own built-in voices). Pick the one that suits
          the job. Voices you clone or design work with every model that supports your own voices.
        </InfoTip>
      </div>
      <button
        ref={btn}
        onClick={() => setOpen((o) => !o)}
        className="w-full rounded-2xl border border-line-strong bg-surface p-3 text-left transition-colors hover:bg-subtle"
      >
        <div className="flex items-center gap-3">
          <VoiceAvatar colors={current.colors} size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold">{current.name}</span>
              <span className="text-[11px] text-ink-3">by {current.vendor}</span>
            </div>
            <div className="truncate text-xs text-ink-3">{current.tagline}</div>
          </div>
          <ChevronDown className={cn('size-4 shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
        </div>
        <div className="mt-2.5">
          <FeatureChips provider={current} compact />
        </div>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={btn} width={400} align="end">
        <div className="px-2 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-wider text-ink-3">Choose a model</div>
        {TTS_PROVIDERS.map((p) => {
          const installed = familyInstalled(models, p.id)
          const starter = starterModel(models, p.id)
          const busy = models.some(
            (m) => m.provider === p.id && ['queued', 'downloading', 'converting'].includes(m.install.status)
          )
          const progress = models.find((m) => m.provider === p.id && m.install.status === 'downloading')?.install
          return (
            <div
              key={p.id}
              onClick={() => {
                onChange(p.id)
                setOpen(false)
              }}
              className={cn(
                'cursor-pointer rounded-xl p-3 transition-colors hover:bg-muted',
                p.id === value && 'bg-muted'
              )}
            >
              <div className="flex items-start gap-3">
                <VoiceAvatar colors={p.colors} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{p.name}</span>
                    <span className="text-[11px] text-ink-3">{p.vendor}</span>
                    {p.id === value && <Check className="ml-auto size-4" />}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-2">{p.description}</p>
                  <div className="mt-2">
                    <FeatureChips provider={p} />
                  </div>
                  <div className="mt-2.5" onClick={(e) => e.stopPropagation()}>
                    {installed ? (
                      <Badge tone="green">
                        <Check className="size-3" /> Installed
                      </Badge>
                    ) : busy ? (
                      progress && progress.status === 'downloading' ? (
                        <div className="flex items-center gap-2 text-[11px] text-ink-3">
                          <ProgressBar className="w-32" value={progress.received / Math.max(1, progress.total)} />
                          Downloading…
                        </div>
                      ) : (
                        <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
                          <Loader2 className="size-3 animate-spin" /> Preparing…
                        </span>
                      )
                    ) : starter ? (
                      <button
                        onClick={() => {
                          onChange(p.id)
                          studio.installModel(starter.id).catch((e) => toast.error('Download failed', errorMessage(e)))
                        }}
                        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line-strong px-3 text-xs font-medium hover:bg-surface"
                      >
                        <Download className="size-3.5" /> Download {p.name} ({formatBytes(starter.sizeBytes)})
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
        <div className="px-2 pb-1 pt-2 text-[11px] text-ink-3">
          More sizes and precisions are on the Models page. {models.filter(isInstalled).length} {models.filter(isInstalled).length === 1 ? "model" : "models"} installed.
        </div>
      </Popover>
    </div>
  )
}
