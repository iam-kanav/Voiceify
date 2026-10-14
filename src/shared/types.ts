// Types shared by the main process, preload bridge, renderer, and the local API/MCP server.

/** A task is a kind of work the engine can do. New features (sound effects, video…) add new tasks. */
export type Task = 'tts' | 'asr'

export type Capability =
  | 'preset-voices' // built-in speakers (CustomVoice)
  | 'instruct' // natural-language style/emotion control
  | 'voice-design' // create a voice from a text description
  | 'voice-clone' // clone from reference audio
  | 'emotion-tags' // inline [Happy] style tags (fine-tunes)
  | 'transcribe' // speech → text (helper for cloning)

export type Quant = '4bit' | '5bit' | '6bit' | '8bit' | 'bf16'

/** Extra files fetched alongside a model (e.g. a tokenizer or voice embeddings it would otherwise download at runtime). */
export interface ExtraFile {
  repo: string
  path: string
  revision?: string
  /** Where to save it inside the model folder (defaults to `path`). */
  saveAs?: string
  size: number
}

export type ModelSource =
  | { type: 'hf-mlx'; repo: string; extras?: ExtraFile[] } // ready-to-run MLX weights
  | { type: 'hf-convert'; repo: string; qBits?: 4 | 6 | 8; extras?: ExtraFile[] } // PyTorch weights converted locally

/** A setting a provider understands, with a plain-language explanation. Rendered as a slider. */
export interface ParamSpec {
  /** Key in GenerationSettings.params. */
  key: string
  /** Keyword argument the engine passes to the model. */
  engineKey: string
  label: string
  help: string
  min: number
  max: number
  step: number
  default: number
  integer?: boolean
  /** Tucked under "Advanced". */
  advanced?: boolean
  left?: string
  right?: string
}

/** A model family (e.g. Qwen3-TTS, Pocket TTS). See src/shared/providers.ts. */
export interface Provider {
  id: string
  name: string
  vendor: string
  license: string
  url: string
  task: Task
  /** One line shown in pickers. */
  tagline: string
  description: string
  strengths: string[]
  limits: string[]
  colors: [string, string]
  /** Language ids it can speak (see ALL_LANGUAGES). */
  languages: string[]
  features: { builtInVoices: boolean; styleInstructions: boolean; voiceCloning: boolean; voiceDesign: boolean }
  params: ParamSpec[]
  /** Built-in voices that ship with this provider's models. */
  voices: Voice[]
}

export interface ModelVariant {
  id: string
  /** Provider id, see PROVIDERS in catalog.ts. */
  provider: string
  name: string
  family: string // groups variants in the UI, e.g. "Qwen3-TTS 1.7B CustomVoice"
  familyId: string
  task: Task
  capabilities: Capability[]
  params: string // "0.6B" | "1.7B"
  quant: Quant
  source: ModelSource
  sizeBytes: number
  /** Relative scores 1–5, used for UI bars and recommendations. */
  quality: number
  speed: number
  minRamGB: number
  description: string
  tags?: string[]
  community?: boolean
  // ---- Plain-language presentation (what the user sees) ----
  /** What the model is for, e.g. "Built-in Voices", "Voice Cloning". Groups the Models page. */
  role: string
  roleId: string
  /** "Large" / "Small" (+ params in parentheses where shown). */
  sizeLabel: string
  /** "8-bit", "Full precision", … */
  precisionLabel: string
  /** One-line trade-off for this exact variant, e.g. "Best balance of quality and speed". */
  summary: string
  /** Official open-source model name, e.g. "Qwen3-TTS 1.7B CustomVoice". */
  officialName: string
}

/** Speed actually observed on this computer (median over recent generations). */
export interface LocalSpeed {
  /** Seconds of audio produced per second of processing (>1 = faster than real time). */
  speedup: number
  samples: number
}

export type InstallState =
  | { status: 'not-installed' }
  | { status: 'queued' }
  | { status: 'downloading'; received: number; total: number; bytesPerSec: number; file?: string }
  | { status: 'converting'; message?: string }
  | { status: 'installed'; path: string; installedAt: number; sizeBytes: number }
  | { status: 'error'; error: string }

export interface ModelInfo extends ModelVariant {
  install: InstallState
  localSpeed?: LocalSpeed
  recommended: boolean
  recommendedReason?: string
  loaded: boolean
}

export interface SystemInfo {
  chip: string
  memoryGB: number
  arch: string
  macos: string
  appleSilicon: boolean
  platform: string
  /** Inference backend available on this device. MLX today; others (e.g. CUDA/DirectML on Windows) later. */
  backend: 'mlx' | null
  freeDiskGB: number
  tier: 'entry' | 'standard' | 'pro' | 'max'
}

export type EngineStatus =
  | { state: 'missing' }
  | { state: 'installing'; step: string; progress: number }
  | { state: 'starting' }
  | { state: 'ready'; version: string; mlx: string; loaded: string[] }
  | { state: 'error'; error: string }

// ---------- Voices ----------

export type VoiceKind = 'preset' | 'cloned' | 'designed'

export interface Voice {
  id: string
  name: string
  kind: VoiceKind
  description: string
  gender?: 'male' | 'female' | 'neutral'
  language?: string
  accent?: string
  tags?: string[]
  /** Provider whose models ship this preset voice. */
  provider?: string
  /** Preset speaker id for CustomVoice models. */
  speaker?: string
  /** Reference clip (WAV, stored in the app's voices dir) for cloned/designed voices. */
  refAudio?: string
  refText?: string
  /** Natural-language description used by VoiceDesign. */
  designPrompt?: string
  /** Optional preview clip. */
  previewAudio?: string
  colors: [string, string]
  createdAt: number
}

// ---------- Generation ----------

export type GenerationMode = 'preset' | 'clone' | 'design'

export interface GenerationSettings {
  language: string // "auto" | "english" | …
  /** Natural-language style/emotion/pace control (providers with styleInstructions). */
  instruct?: string
  /** Provider-specific settings keyed by ParamSpec.key; missing keys use the provider's defaults. */
  params: Record<string, number>
}

export interface GenerateRequest {
  text: string
  /** Which model family should speak (e.g. "qwen3-tts", "pocket-tts"). Defaults to the voice's own or the default provider. */
  provider?: string
  voiceId?: string
  /** For direct voice design previews (no saved voice). */
  designPrompt?: string
  modelId?: string
  settings?: Partial<GenerationSettings> & { temperature?: number }
  stream?: boolean
  source?: 'app' | 'mcp' | 'api'
}

export interface HistoryItem {
  id: string
  text: string
  provider?: string
  voiceId?: string
  voiceName: string
  modelId: string
  mode: GenerationMode
  settings: GenerationSettings
  audioPath: string
  durationSec: number
  sampleRate: number
  processingSec: number
  rtf: number
  /** The model had to be loaded first, so processing time includes loading (excluded from speed stats). */
  coldStart?: boolean
  createdAt: number
  source: 'app' | 'mcp' | 'api'
  /** Designed-voice previews are kept out of the main history list. */
  ephemeral?: boolean
}

export interface GenerationChunk {
  jobId: string
  /** 16-bit PCM mono. */
  pcm: Uint8Array
  sampleRate: number
  final?: boolean
}

export interface DownloadProgressEvent {
  modelId: string
  install: InstallState
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  apiPort: number
  apiEnabled: boolean
  maxLoadedModels: number
  /** Default variant per "provider/capability" (e.g. "qwen3-tts/preset-voices"). */
  defaultModels: Record<string, string>
  /** Model family selected when nothing else decides. */
  defaultProvider: string
  onboardingComplete: boolean
  defaultGeneration: GenerationSettings
}

export interface ApiServerInfo {
  running: boolean
  port: number
  url: string
  mcpUrl: string
  bridgePath: string
  nodeCommand: string
  electronBinary: string
  error?: string
}
