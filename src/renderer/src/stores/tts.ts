import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Voice } from '@shared/types'
import { useApp } from './app'
import { DEFAULT_PROVIDER, paramsFor, providersForVoice } from '@shared/providers'

interface TtsState {
  text: string
  /** Selected model family (e.g. "qwen3-tts", "pocket-tts"). */
  provider: string
  /** Selected voice per model family, so switching families keeps each one's pick. */
  voiceByProvider: Record<string, string>
  /** 'auto' or a specific variant id, per family. */
  modelByProvider: Record<string, string>
  /** Each family's own settings (they understand different parameters). */
  paramsByProvider: Record<string, Record<string, number>>
  language: string
  instruct: string
  /** Script mode: `[@Name]:` tags switch voices. */
  scriptMode: boolean
  /** Silence between speakers in script mode, seconds. */
  scriptPause: number
  setText: (t: string) => void
  setProvider: (p: string) => void
  setVoice: (id: string, provider?: string) => void
  setModel: (id: string) => void
  setParam: (key: string, value: number) => void
  setLanguage: (l: string) => void
  setInstruct: (i: string) => void
  reset: () => void
}

export const useTts = create<TtsState>()(
  persist(
    (set, get) => ({
      text: '',
      provider: DEFAULT_PROVIDER,
      voiceByProvider: { 'qwen3-tts': 'preset:ryan', 'pocket-tts': 'preset:pocket-tts:alba' },
      modelByProvider: {},
      paramsByProvider: {},
      language: 'auto',
      instruct: '',
      scriptMode: false,
      scriptPause: 0.35,
      setText: (text) => set({ text }),
      setProvider: (provider) => set({ provider }),
      setVoice: (id, provider) => set((s) => ({ voiceByProvider: { ...s.voiceByProvider, [provider ?? s.provider]: id } })),
      setModel: (id) => set((s) => ({ modelByProvider: { ...s.modelByProvider, [s.provider]: id } })),
      setParam: (key, value) =>
        set((s) => ({
          paramsByProvider: { ...s.paramsByProvider, [s.provider]: { ...currentParams(s), [key]: value } }
        })),
      setLanguage: (language) => set({ language }),
      setInstruct: (instruct) => set({ instruct }),
      reset: () => set((s) => ({ paramsByProvider: { ...s.paramsByProvider, [s.provider]: paramsFor(get().provider, {}, userDefaults(s.provider)) }, instruct: '', language: 'auto' }))
    }),
    {
      name: 'tts-state',
      version: 2,
      // v1 stored one flat settings object (Qwen-only). Carry over what still applies.
      migrate: (old: unknown) => {
        const o = (old ?? {}) as { text?: string; voiceId?: string; settings?: Record<string, unknown> }
        const st = o.settings ?? {}
        return {
          text: o.text ?? '',
          provider: DEFAULT_PROVIDER,
          voiceByProvider: { 'qwen3-tts': o.voiceId ?? 'preset:ryan', 'pocket-tts': 'preset:pocket-tts:alba' },
          modelByProvider: {},
          paramsByProvider: {},
          language: typeof st.language === 'string' ? st.language : 'auto',
          instruct: typeof st.instruct === 'string' ? st.instruct : ''
        } as unknown as TtsState
      }
    }
  )
)

/** Your own starting values for a family (Settings → Model settings). */
export function userDefaults(provider: string) {
  return useApp.getState().settings?.providerDefaults?.[provider] ?? {}
}

/** A family's settings on this page, with your defaults and then the model's filled in. */
export function paramsOf(s: Pick<TtsState, 'paramsByProvider'>, provider: string) {
  return paramsFor(provider, s.paramsByProvider[provider], userDefaults(provider))
}

/** The current family's settings with defaults filled in. */
export function currentParams(s: Pick<TtsState, 'provider' | 'paramsByProvider'>) {
  return paramsOf(s, s.provider)
}

/**
 * Use a voice in Text to Speech. Built-in voices switch to their own model family; your own
 * voices stay on the current family if it can clone, otherwise move to one that can.
 */
export function selectVoice(voice: Voice) {
  const s = useTts.getState()
  const families = providersForVoice(voice).map((p) => p.id)
  const provider = families.includes(s.provider) ? s.provider : (families[0] ?? s.provider)
  useTts.setState({ provider, voiceByProvider: { ...s.voiceByProvider, [provider]: voice.id } })
}

export function selectVoiceById(id: string) {
  const voice = useApp.getState().voices.find((v) => v.id === id)
  if (voice) selectVoice(voice)
}
