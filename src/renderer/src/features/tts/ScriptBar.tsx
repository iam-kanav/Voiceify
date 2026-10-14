import { useMemo, useRef, useState } from 'react'
import { Plus, UserRound } from 'lucide-react'
import type { ModelInfo, Voice } from '@shared/types'
import { PROVIDER_BY_ID, TTS_PROVIDERS } from '@shared/providers'
import { parseScript, resolveSpeaker, scriptSpeakers } from '@shared/script'
import { Popover } from '@/components/Popover'
import { InfoTip } from '@/components/InfoTip'
import { VoiceAvatar } from '@/components/VoiceAvatar'
import { isInstalled } from '@/lib/models'
import { cn } from '@/lib/api'

export interface SpeakerCheck {
  name: string
  voice?: Voice
  /** Why this speaker can't be used yet. */
  problem?: string
}

/** Who speaks in the script, and whether each name maps to a usable voice. */
export function checkSpeakers(text: string, voices: Voice[], models: ModelInfo[], provider: string): SpeakerCheck[] {
  return scriptSpeakers(parseScript(text)).map((name) => {
    const voice = resolveSpeaker(name, voices, provider)
    if (!voice) return { name, problem: `No voice called “${name}”` }
    if (voice.kind === 'preset') {
      const fam = PROVIDER_BY_ID.get(voice.provider ?? 'qwen3-tts')
      const ok = models.some((m) => isInstalled(m) && m.provider === fam?.id && m.capabilities.includes('preset-voices'))
      if (!ok) return { name, voice, problem: `${voice.name} needs a ${fam?.name ?? ''} Built-in Voices model` }
    }
    return { name, voice }
  })
}

/** Speakers found in the script, plus a picker that inserts `[@Name]: ` at the cursor. */
export function ScriptBar({
  text,
  voices,
  models,
  provider,
  onInsert
}: {
  text: string
  voices: Voice[]
  models: ModelInfo[]
  provider: string
  onInsert: (tag: string) => void
}) {
  const speakers = useMemo(() => checkSpeakers(text, voices, models, provider), [text, voices, models, provider])
  // Styles only work with families that follow instructions (e.g. not Pocket TTS).
  const ignoredStyles = useMemo(() => {
    const names = new Set<string>()
    for (const seg of parseScript(text)) {
      if (!seg.style || !seg.speaker) continue
      const v = resolveSpeaker(seg.speaker, voices, provider)
      const fam = PROVIDER_BY_ID.get(v?.kind === 'preset' ? (v.provider ?? 'qwen3-tts') : provider)
      if (v && fam && !fam.features.styleInstructions) names.add(v.name)
    }
    return [...names]
  }, [text, voices, provider])
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  // Voices whose family has a model installed come first; your own voices use the selected family.
  const usable = (v: Voice) =>
    v.kind === 'preset'
      ? models.some((m) => isInstalled(m) && m.provider === v.provider && m.capabilities.includes('preset-voices'))
      : models.some((m) => isInstalled(m) && TTS_PROVIDERS.some((p) => p.id === m.provider))
  const pickable = [...voices].sort((a, b) => Number(usable(b)) - Number(usable(a)))

  return (
    <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-6 py-2">
      <span className="flex items-center gap-1 pr-1 text-xs font-medium text-ink-2">
        Speakers
        <InfoTip width={320}>
          Write <b>[@Name]:</b> before each part. Everything after a tag is read by that voice until the next tag; text before the first tag uses
          the default voice on the right. Add a style after a comma, e.g. <b>[@Ryan, whispering]:</b> (models that follow style instructions).
          Built-in voices always use their own model; your own voices use the selected model family.
        </InfoTip>
      </span>
      {speakers.length === 0 && <span className="text-xs text-ink-3">None yet. Add one to start a part.</span>}
      {speakers.map((s) => (
        <span
          key={s.name}
          title={s.problem ?? `${s.voice?.name} · ${s.voice?.kind === 'preset' ? PROVIDER_BY_ID.get(s.voice.provider ?? 'qwen3-tts')?.name : 'your voice'}`}
          className={cn(
            'flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-[12px]',
            !s.voice ? 'border-danger/40 bg-danger/5 text-danger' : s.problem ? 'border-amber-500/40 bg-amber-500/5' : 'border-line'
          )}
        >
          {s.voice ? (
            <VoiceAvatar colors={s.voice.colors} size={18} />
          ) : (
            <span className="flex size-[18px] items-center justify-center rounded-full bg-danger/10">
              <UserRound className="size-3" />
            </span>
          )}
          {s.voice?.name ?? s.name}
          {s.voice && (
            <span className="text-[10.5px] text-ink-3">{s.voice.kind === 'preset' ? PROVIDER_BY_ID.get(s.voice.provider ?? 'qwen3-tts')?.name : 'Yours'}</span>
          )}
          {!s.voice && <span className="text-[10.5px]">unknown</span>}
        </span>
      ))}
      <button
        ref={anchor}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 py-0.5 text-[12px] text-ink-2 transition-colors hover:bg-subtle hover:text-ink"
      >
        <Plus className="size-3.5" />
        Add speaker
      </button>
      {ignoredStyles.length > 0 && (
        <span className="text-[11px] text-ink-3">
          Styles are ignored for {ignoredStyles.join(', ')} (model doesn’t follow style instructions)
        </span>
      )}
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={280}>
        {pickable.map((v) => {
          const ok = usable(v)
          return (
            <button
              key={v.id}
              onClick={() => {
                onInsert(`[@${v.name}]: `)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-muted"
            >
              <VoiceAvatar colors={v.colors} size={24} />
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate text-sm', !ok && 'text-ink-3')}>{v.name}</span>
                <span className="block truncate text-[11px] text-ink-3">
                  {v.kind === 'preset' ? PROVIDER_BY_ID.get(v.provider ?? 'qwen3-tts')?.name : v.kind === 'cloned' ? 'Your cloned voice' : 'Your designed voice'}
                  {!ok && ' · model not installed'}
                </span>
              </span>
            </button>
          )
        })}
      </Popover>
    </div>
  )
}
