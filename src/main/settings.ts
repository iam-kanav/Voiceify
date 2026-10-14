import type { AppSettings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/voices'
import { CATALOG_BY_ID } from '@shared/catalog'
import { JsonStore } from './store'

let store: JsonStore<AppSettings> | null = null

export function settingsStore() {
  if (!store) store = new JsonStore<AppSettings>('settings', DEFAULT_SETTINGS)
  return store
}

export function getSettings(): AppSettings {
  const s = settingsStore().get()
  // Older versions keyed defaults by capability only ("preset-voices"); key them by provider now.
  const defaultModels: Record<string, string> = {}
  for (const [k, v] of Object.entries(s.defaultModels ?? {})) {
    defaultModels[k.includes('/') ? k : `${CATALOG_BY_ID.get(v)?.provider ?? 'qwen3-tts'}/${k}`] = v
  }
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    defaultModels,
    defaultGeneration: { ...DEFAULT_SETTINGS.defaultGeneration, ...s.defaultGeneration }
  }
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  settingsStore().update((s) => ({ ...s, ...patch }))
  return getSettings()
}
