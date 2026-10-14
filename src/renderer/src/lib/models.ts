import type { Capability, ModelInfo, Voice } from '@shared/types'

export const CAPABILITY_LABEL: Record<Capability, string> = {
  'preset-voices': 'Built-in voices',
  instruct: 'Style instructions',
  'voice-design': 'Voice design',
  'voice-clone': 'Voice cloning',
  'emotion-tags': 'Emotion tags',
  transcribe: 'Speech to text',
  translate: 'Translate to English',
  fingerprint: 'Voice fingerprints',
  'sound-effects': 'Sound effects'
}

export const isInstalled = (m: ModelInfo) => m.install.status === 'installed'
const installedWith = (models: ModelInfo[], cap: Capability, provider?: string) =>
  models.filter((m) => isInstalled(m) && m.capabilities.includes(cap) && (!provider || m.provider === provider))

/**
 * Capability a voice needs from the given model family. Saved designed voices replay through a
 * cloning model so they keep the exact timbre you picked; only when the family has none (but can
 * design) are they re-created from their description.
 */
export function capabilityFor(voice: Voice | undefined, models: ModelInfo[], provider?: string): Capability {
  if (!voice || voice.kind === 'preset') return 'preset-voices'
  if (
    voice.kind === 'designed' &&
    !installedWith(models, 'voice-clone', provider).length &&
    installedWith(models, 'voice-design', provider).length
  ) {
    return 'voice-design'
  }
  return 'voice-clone'
}

/** Built-in Voices (Large) models that can speak a saved voice from its fingerprint (Qwen3-TTS only). */
export function fingerprintModels(voice: Voice | undefined, models: ModelInfo[], provider?: string) {
  if (!voice || voice.kind === 'preset' || provider !== 'qwen3-tts') return []
  return installedWith(models, 'preset-voices', provider).filter((m) => m.params === '1.7B' && m.capabilities.includes('instruct'))
}

/** Installed models in this family that can speak this voice. */
export function compatibleModels(voice: Voice | undefined, models: ModelInfo[], provider?: string) {
  const base = installedWith(models, capabilityFor(voice, models, provider), provider)
  const fp = voice?.fingerprint ? fingerprintModels(voice, models, provider) : []
  return [...base, ...fp]
}

/**
 * The model "Automatic" picks for a voice. Mirrors the main process: your own voices use their
 * fingerprint (Built-in Voices, Large) when you add style instructions or have no cloning model.
 */
export function autoModel(voice: Voice | undefined, models: ModelInfo[], provider: string, instruct: string, defaults?: Record<string, string>) {
  const fp = voice?.fingerprint ? fingerprintModels(voice, models, provider) : []
  const canClone = installedWith(models, 'voice-clone', provider).length > 0
  if (fp.length && (instruct.trim() || !canClone)) {
    const pick = resolveModel('preset-voices', models, undefined, defaults, provider)
    return fp.find((m) => m.id === pick?.id) ?? fp[0]
  }
  return resolveModel(capabilityFor(voice, models, provider), models, undefined, defaults, provider)
}

/** Mirror of the main-process resolver so the UI can show which model will run. */
export function resolveModel(cap: Capability, models: ModelInfo[], preferred?: string, defaults?: Record<string, string>, provider?: string) {
  const c = installedWith(models, cap, provider)
  return (
    c.find((m) => m.id === preferred) ??
    c.find((m) => m.id === defaults?.[`${provider ?? c[0]?.provider}/${cap}`]) ??
    c.find((m) => m.recommended) ??
    [...c].sort((a, b) => b.quality - a.quality || b.speed - a.speed)[0]
  )
}

export function recommendedFor(cap: Capability, models: ModelInfo[], provider?: string) {
  return models.find((m) => m.recommended && m.capabilities.includes(cap) && !m.community && (!provider || m.provider === provider))
}

/** Can saved voices be spoken exactly (a cloning model, or Qwen3-TTS Built-in Voices Large via fingerprints)? */
export const canSpeakOwnVoices = (models: ModelInfo[], provider?: string) =>
  installedWith(models, 'voice-clone', provider).length > 0 ||
  ((!provider || provider === 'qwen3-tts') &&
    installedWith(models, 'preset-voices', 'qwen3-tts').some((m) => m.params === '1.7B' && m.capabilities.includes('instruct')))

/** Is any model from this family installed? */
export const familyInstalled = (models: ModelInfo[], provider: string) => models.some((m) => m.provider === provider && isInstalled(m))
