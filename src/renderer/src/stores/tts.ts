import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GenerationSettings } from '@shared/types'
import { DEFAULT_GENERATION } from '@shared/voices'

interface TtsState {
  text: string
  voiceId: string
  modelId: string // 'auto' or a model id
  settings: GenerationSettings
  setText: (t: string) => void
  setVoice: (id: string) => void
  setModel: (id: string) => void
  patch: (p: Partial<GenerationSettings>) => void
  reset: () => void
}

export const useTts = create<TtsState>()(
  persist(
    (set) => ({
      text: '',
      voiceId: 'preset:ryan',
      modelId: 'auto',
      settings: DEFAULT_GENERATION,
      setText: (text) => set({ text }),
      setVoice: (voiceId) => set({ voiceId }),
      setModel: (modelId) => set({ modelId }),
      patch: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
      reset: () => set({ settings: DEFAULT_GENERATION })
    }),
    { name: 'tts-state' }
  )
)
