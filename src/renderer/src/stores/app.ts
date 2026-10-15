import { create } from 'zustand'
import type { ApiServerInfo, AppSettings, EngineStatus, HistoryItem, ModelInfo, SystemInfo, Transcript, Voice } from '@shared/types'
import { isWeb, studio } from '@/lib/api'

export type Route = { id: string; params?: Record<string, string> }

let initStarted = false

interface AppState {
  ready: boolean
  initError: string | null
  route: Route
  system: SystemInfo | null
  settings: AppSettings | null
  engine: EngineStatus
  engineLog: string[]
  models: ModelInfo[]
  voices: Voice[]
  history: HistoryItem[]
  transcripts: Transcript[]
  api: ApiServerInfo | null
  navigate: (id: string, params?: Record<string, string>) => void
  init: () => Promise<void>
  refreshModels: () => Promise<void>
  refreshVoices: () => Promise<void>
  refreshHistory: () => Promise<void>
  refreshTranscripts: () => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  initError: null,
  route: { id: 'tts' },
  system: null,
  settings: null,
  engine: { state: 'starting' },
  engineLog: [],
  models: [],
  voices: [],
  history: [],
  transcripts: [],
  api: null,

  navigate: (id, params) => set({ route: { id, params } }),

  init: async () => {
    // StrictMode runs effects twice in development; subscribe only once.
    if (initStarted) return
    initStarted = true
    let loaded
    try {
      loaded = await Promise.all([
      studio.getSystemInfo(),
      studio.getSettings(),
      studio.getEngineStatus(),
      studio.listModels(),
      studio.listVoices(),
      studio.listHistory(),
      studio.getApiServerInfo(),
      studio.listTranscripts()
      ])
    } catch (e) {
      initStarted = false
      set({ initError: e instanceof Error ? e.message : String(e) })
      return
    }
    const [system, mac, engine, models, voices, history, api, transcripts] = loaded
    const settings = withLocalTheme(mac)
    set({ system, settings, engine, models, voices, history, api, transcripts, ready: true, initError: null })
    applyTheme(settings.theme)

    studio.on('engineStatus', (engine) => {
      set({ engine })
      if (engine.state === 'ready') get().refreshModels()
    })
    studio.on('engineLog', (line) => set((s) => ({ engineLog: [...s.engineLog.slice(-400), line] })))
    studio.on('modelProgress', ({ modelId, install }) =>
      set((s) => ({ models: s.models.map((m) => (m.id === modelId ? { ...m, install } : m)) }))
    )
    studio.on('modelsChanged', () => get().refreshModels())
    studio.on('voicesChanged', () => get().refreshVoices())
    studio.on('historyChanged', () => get().refreshHistory())
    studio.on('transcriptsChanged', () => get().refreshTranscripts())
    studio.on('apiServer', (api) => set({ api }))
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const t = get().settings?.theme
      if (t === 'system') applyTheme(t)
    })
  },

  refreshModels: async () => set({ models: await studio.listModels() }),
  refreshVoices: async () => set({ voices: await studio.listVoices() }),
  refreshHistory: async () => set({ history: await studio.listHistory() }),
  refreshTranscripts: async () => set({ transcripts: await studio.listTranscripts() }),
  updateSettings: async (patch) => {
    // A phone keeps its own theme rather than changing the Mac's.
    if (isWeb && patch.theme) {
      localStorage.setItem('theme', patch.theme)
      const { theme, ...rest } = patch
      applyTheme(theme)
      patch = rest
    }
    const settings = withLocalTheme(await studio.updateSettings(patch))
    set({ settings })
    if (patch.theme) applyTheme(settings.theme)
  }
}))

function withLocalTheme(s: AppSettings): AppSettings {
  const local = isWeb ? (localStorage.getItem('theme') as AppSettings['theme'] | null) : null
  return local ? { ...s, theme: local } : isWeb ? { ...s, theme: 'system' } : s
}

export function applyTheme(theme: AppSettings['theme']) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export const installedModels = (models: ModelInfo[]) => models.filter((m) => m.install.status === 'installed')
