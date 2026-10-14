import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { paramsFor, SFX_PROVIDERS } from '@shared/providers'
import { useApp } from './app'

interface SfxState {
  prompt: string
  count: number
  negativePrompt: string
  fixedSeed: boolean
  seed: number
  /** Page overrides; unset = your default from Settings → Model settings (then the model's). */
  seconds?: number
  steps?: number
  cfg?: number
}

/** Sound Effects page choices (kept between sessions). History uses it to reopen a sound. */
export const useSfx = create<SfxState>()(
  persist((): SfxState => ({ prompt: '', count: 2, negativePrompt: '', fixedSeed: false, seed: 42 }), {
    name: 'sfx-state',
    version: 2,
    // v1 stored fixed seconds/steps/cfg; drop them so Settings defaults apply.
    migrate: (old) => {
      const o = (old ?? {}) as Partial<SfxState>
      return { prompt: o.prompt ?? '', count: o.count ?? 2, negativePrompt: o.negativePrompt ?? '', fixedSeed: !!o.fixedSeed, seed: o.seed ?? 42 }
    }
  })
)

/** Seconds / steps / prompt strength in effect: page override → your default → model default. */
export function sfxValues(s: Pick<SfxState, 'seconds' | 'steps' | 'cfg'>, provider = SFX_PROVIDERS[0]?.id ?? 'stable-audio') {
  const own = useApp.getState().settings?.providerDefaults?.[provider] ?? {}
  const page: Record<string, number> = {}
  if (s.seconds !== undefined) page.seconds = s.seconds
  if (s.steps !== undefined) page.steps = s.steps
  if (s.cfg !== undefined) page.cfg = s.cfg
  const v = paramsFor(provider, page, own)
  return { seconds: v.seconds, steps: v.steps, cfg: v.cfg }
}
