import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { Provider } from '@shared/types'
import { formatParam, paramsFor, PROVIDERS } from '@shared/providers'
import { Slider } from '@/components/Slider'
import { VoiceAvatar } from '@/components/VoiceAvatar'
import { Badge, Card, Tabs } from '@/components/ui'
import { useApp } from '@/stores/app'
import { isInstalled } from '@/lib/models'

/** What "steps" means for each family, so nobody hunts for a knob a model doesn't have. */
const STEP_NOTES: Record<string, string> = {
  'qwen3-tts': 'Qwen3-TTS speaks token by token, so it has no step count; its quality knobs are the sampling settings below.',
  'pocket-tts': '“Quality steps” is Pocket TTS’s decoding step count.',
  voxcpm2: '“Quality steps” is VoxCPM2’s diffusion step count; 6 is noticeably faster than the default 10.',
  omnivoice: '“Quality steps” is how many refining passes OmniVoice makes; 16 is about twice as fast as the default 32.',
  'stable-audio': '“Quality steps” is the diffusion step count; the model is tuned for 8.'
}

/** Your own starting values for every model setting (used by the app, agents and the local API). */
export function ModelSettings() {
  const families = PROVIDERS.filter((p) => p.params.length > 0)
  const [familyId, setFamilyId] = useState(families[0]?.id ?? '')
  const family = families.find((f) => f.id === familyId) ?? families[0]
  if (!family) return null
  return (
    <Card className="p-5">
      <div className="text-sm font-semibold">Model settings</div>
      <div className="mt-0.5 text-[13px] text-ink-3">
        Starting values for each model family, including step counts. They apply in Text to Speech, Sound Effects and Speech Enhancement,
        and to AI apps and the local API. Changes you make on those pages stay on that page.
      </div>
      <div className="mt-4 max-md:-mx-5 max-md:overflow-x-auto max-md:px-5">
        <Tabs id="model-settings-family" value={family.id} onChange={setFamilyId} tabs={families.map((f) => ({ id: f.id, label: f.name }))} className="max-md:w-max" />
      </div>
      <FamilyDefaults key={family.id} provider={family} />
    </Card>
  )
}

function FamilyDefaults({ provider: p }: { provider: Provider }) {
  const settings = useApp((s) => s.settings)!
  const update = useApp((s) => s.updateSettings)
  const models = useApp((s) => s.models)
  const saved = settings.providerDefaults?.[p.id] ?? {}
  const [values, setValues] = useState(() => paramsFor(p.id, {}, saved))
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const installed = models.some((m) => m.provider === p.id && isInstalled(m))
  const changed = p.params.some((spec) => values[spec.key] !== spec.default)

  useEffect(() => () => clearTimeout(timer.current), [])

  const commit = (next: Record<string, number>) => {
    setValues(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      // Store only what differs from the model's default.
      const own = Object.fromEntries(p.params.filter((s) => next[s.key] !== s.default).map((s) => [s.key, next[s.key]]))
      const all = { ...(useApp.getState().settings?.providerDefaults ?? {}) }
      if (Object.keys(own).length) all[p.id] = own
      else delete all[p.id]
      update({ providerDefaults: all })
    }, 250)
  }

  return (
    <div className="mt-5">
      <div className="mb-4 flex items-center gap-3">
        <VoiceAvatar colors={p.colors} size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            {p.name}
            {!installed && <Badge>Not installed</Badge>}
          </div>
          <div className="text-xs text-ink-3">{STEP_NOTES[p.id] ?? p.tagline}</div>
        </div>
        {changed && (
          <button
            onClick={() => commit(paramsFor(p.id))}
            className="flex items-center gap-1.5 text-xs text-ink-3 transition-colors hover:text-ink"
          >
            <RotateCcw className="size-3.5" />
            Reset to model defaults
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-5">
        {p.params.map((spec) => (
          <Slider
            key={spec.key}
            label={spec.label}
            value={values[spec.key]}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            onChange={(v) => commit({ ...values, [spec.key]: spec.integer ? Math.round(v) : v })}
            left={spec.left}
            right={spec.right}
            format={(v) => formatParam(spec, v)}
            hint={`${spec.help}${values[spec.key] !== spec.default ? ` (Model default: ${spec.default}.)` : ''}`}
          />
        ))}
      </div>
    </div>
  )
}
