import type {
  ApiServerInfo,
  AppSettings,
  DownloadProgressEvent,
  EngineStatus,
  GenerateRequest,
  GenerationChunk,
  HistoryItem,
  ModelInfo,
  SystemInfo,
  Voice
} from './types'

/**
 * The contract between renderer and main. Every method maps 1:1 to an `ipcMain.handle` channel
 * named `studio:<method>`; every event is broadcast on `studio:event:<name>`.
 */
export interface StudioInvoke {
  getSystemInfo(): SystemInfo
  getSettings(): AppSettings
  updateSettings(patch: Partial<AppSettings>): AppSettings

  getEngineStatus(): EngineStatus
  installEngine(): void
  restartEngine(): void

  listModels(): ModelInfo[]
  installModel(id: string): void
  cancelInstall(id: string): void
  deleteModel(id: string): void
  addCustomModel(repo: string): ModelInfo
  unloadModels(): void

  listVoices(): Voice[]
  createClonedVoice(input: {
    name: string
    description?: string
    audio: Uint8Array // WAV bytes
    refText?: string
  }): Voice
  saveDesignedVoice(input: { name: string; description?: string; designPrompt: string; historyId: string }): Voice
  updateVoice(id: string, patch: Partial<Pick<Voice, 'name' | 'description' | 'tags' | 'refText'>>): Voice
  deleteVoice(id: string): void
  transcribe(audio: Uint8Array): { text: string }
  /** Path to a short sample of the voice (generated and cached for presets). */
  previewVoice(id: string): { path: string }

  generate(req: GenerateRequest & { jobId: string }): HistoryItem
  cancelGeneration(jobId: string): void

  listHistory(): HistoryItem[]
  deleteHistory(id: string): void
  clearHistory(): void
  exportAudio(id: string): string | null
  revealInFinder(path: string): void

  getApiServerInfo(): ApiServerInfo
  openExternal(url: string): void
  openDataFolder(): void
}

export interface StudioEvents {
  engineStatus: EngineStatus
  engineLog: string
  modelProgress: DownloadProgressEvent
  modelsChanged: null
  voicesChanged: null
  historyChanged: null
  generationChunk: GenerationChunk
  /** Asks the renderer to play a history item (e.g. an agent called text_to_speech with play=true). */
  playHistory: { id: string }
  apiServer: ApiServerInfo
}

export type StudioApi = {
  [K in keyof StudioInvoke]: (
    ...args: Parameters<StudioInvoke[K]>
  ) => Promise<Awaited<ReturnType<StudioInvoke[K]>>>
} & {
  on<E extends keyof StudioEvents>(event: E, cb: (payload: StudioEvents[E]) => void): () => void
  platform: string
}

export const INVOKE_METHODS: (keyof StudioInvoke)[] = [
  'getSystemInfo',
  'getSettings',
  'updateSettings',
  'getEngineStatus',
  'installEngine',
  'restartEngine',
  'listModels',
  'installModel',
  'cancelInstall',
  'deleteModel',
  'addCustomModel',
  'unloadModels',
  'listVoices',
  'createClonedVoice',
  'saveDesignedVoice',
  'updateVoice',
  'deleteVoice',
  'transcribe',
  'previewVoice',
  'generate',
  'cancelGeneration',
  'listHistory',
  'deleteHistory',
  'clearHistory',
  'exportAudio',
  'revealInFinder',
  'getApiServerInfo',
  'openExternal',
  'openDataFolder'
]

/** Custom protocol used by the renderer to stream local audio files (history, voices). */
export const MEDIA_SCHEME = 'studio-media'
