import type { AppSettings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/voices'
import { JsonStore } from './store'

let store: JsonStore<AppSettings> | null = null

export function settingsStore() {
  if (!store) store = new JsonStore<AppSettings>('settings', DEFAULT_SETTINGS)
  return store
}

export function getSettings(): AppSettings {
  const s = settingsStore().get()
  return { ...DEFAULT_SETTINGS, ...s, defaultGeneration: { ...DEFAULT_SETTINGS.defaultGeneration, ...s.defaultGeneration } }
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  settingsStore().update((s) => ({ ...s, ...patch }))
  return getSettings()
}
