import type { Capability, ModelInfo, Voice } from '@shared/types'

export const CAPABILITY_LABEL: Record<Capability, string> = {
  'preset-voices': 'Built-in voices',
  instruct: 'Style instructions',
  'voice-design': 'Voice design',
  'voice-clone': 'Voice cloning',
  'emotion-tags': 'Emotion tags',
  transcribe: 'Transcription'
}

export const isInstalled = (m: ModelInfo) => m.install.status === 'installed'
const hasInstalled = (models: ModelInfo[], cap: Capability) => models.some((m) => isInstalled(m) && m.capabilities.includes(cap))

/**
 * Capability a voice needs. Saved designed voices replay through the cloning model so they keep
 * the exact timbre you picked; only if that's missing (but Voice Design is installed) do we
 * re-create them from their description.
 */
export function capabilityFor(voice: Voice | undefined, models: ModelInfo[]): Capability {
  if (!voice || voice.kind === 'preset') return 'preset-voices'
  if (voice.kind === 'designed' && !hasInstalled(models, 'voice-clone') && hasInstalled(models, 'voice-design')) {
    return 'voice-design'
  }
  return 'voice-clone'
}

/** Installed models that can speak this voice. Designed voices only fall back to Voice Design when cloning isn't available. */
export function compatibleModels(voice: Voice | undefined, models: ModelInfo[]) {
  const cap = capabilityFor(voice, models)
  return models.filter((m) => isInstalled(m) && m.capabilities.includes(cap))
}

/** Mirror of the main-process resolver so the UI can show which model will run. */
export function resolveModel(cap: Capability, models: ModelInfo[], preferred?: string, defaults?: Partial<Record<Capability, string>>) {
  const c = models.filter((m) => isInstalled(m) && m.capabilities.includes(cap))
  return (
    c.find((m) => m.id === preferred) ??
    c.find((m) => m.id === defaults?.[cap]) ??
    c.find((m) => m.recommended) ??
    [...c].sort((a, b) => b.quality - a.quality || b.speed - a.speed)[0]
  )
}

export function recommendedFor(cap: Capability, models: ModelInfo[]) {
  return models.find((m) => m.recommended && m.capabilities.includes(cap) && !m.community)
}
