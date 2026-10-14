import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Sound Effects page choices (kept between sessions). History uses it to reopen a sound. */
export const useSfx = create<{
  prompt: string
  seconds: number
  count: number
  cfg: number
  negativePrompt: string
  steps: number
  fixedSeed: boolean
  seed: number
}>()(
  persist(() => ({ prompt: '', seconds: 5, count: 2, cfg: 1, negativePrompt: '', steps: 8, fixedSeed: false as boolean, seed: 42 }), { name: 'sfx-state' })
)
