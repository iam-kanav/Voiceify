// Types shared by the main process, preload bridge, renderer, and the local API/MCP server.

/** A task is a kind of work the engine can do. New features (sound effects, video…) add new tasks. */
export type Task = 'tts' | 'asr' | 'sfx' | 'enhance'

export type Capability =
  | 'preset-voices' // built-in speakers (CustomVoice)
  | 'instruct' // natural-language style/emotion control
  | 'voice-design' // create a voice from a text description
  | 'voice-clone' // clone from reference audio
  | 'emotion-tags' // inline [Happy] style tags (fine-tunes)
  | 'transcribe' // speech → text
  | 'translate' // speech in any language → English text
  | 'fingerprint' // turns a saved voice into a speaker embedding the Built-in Voices model can use
  | 'sound-effects' // text → sound effects
  | 'enhance-speech' // noisy / low-quality speech → clean speech

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
  | { type: 'hf-mlx'; repo: string; revision?: string; extras?: ExtraFile[] } // ready-to-run MLX weights (pinned when `revision` is set)
  | { type: 'hf-convert'; repo: string; qBits?: 4 | 6 | 8; extras?: ExtraFile[] } // PyTorch weights converted locally
  /** Only the tensors starting with `prefix` from one safetensors file (plus config.json), fetched with ranged requests. */
  | { type: 'hf-tensors'; repo: string; revision?: string; file: string; prefix: string; saveAs: string; extras?: ExtraFile[] }
  /** Only the listed files of a (large, multi-model) repo, plus a config.json Voiceify writes itself. */
  | { type: 'hf-files'; repo: string; revision: string; files: { path: string; size: number }[]; config: Record<string, unknown>; extras?: ExtraFile[] }

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
  /** Shown after the value (e.g. " s"). */
  unit?: string
  /** Shown instead of 0, when 0 means "off" (e.g. "Natural"). */
  zeroLabel?: string
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
  /** How to describe its languages when the list above is only a sample (e.g. "600+ languages"). */
  languagesLabel?: string
  /** Works out the language from the text itself, so there's no language setting to pick. */
  autoLanguage?: boolean
  /** Uses a cloned voice's transcript for a closer match (others only need the audio). */
  usesTranscript?: boolean
  /** An extra, not part of the recommended starter set ("Download all"). */
  optional?: boolean
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
  /**
   * Voice fingerprint (speaker embedding, .npy) that lets Qwen3-TTS Built-in Voices (Large) speak
   * this voice like a built-in one, including style instructions. Made automatically.
   */
  fingerprint?: string
  /** Optional preview clip. */
  previewAudio?: string
  colors: [string, string]
  createdAt: number
}

// ---------- Generation ----------

export type GenerationMode = 'preset' | 'clone' | 'design' | 'fingerprint' | 'sfx' | 'script' | 'enhance'

export interface GenerationSettings {
  language: string // "auto" | "english" | …
  /** Natural-language style/emotion/pace control (providers with styleInstructions). */
  instruct?: string
  /** Provider-specific settings keyed by ParamSpec.key; missing keys use the provider's defaults. */
  params: Record<string, number>
}

export interface GenerateRequest {
  text: string
  /** Which model family should speak (e.g. "qwen3-tts", "voxcpm2"). Defaults to the voice's own or the default provider. For voice design previews: which family designs. */
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
  /** false = not kept yet ("Only what I save" mode); removed when Voiceify quits. Missing = kept. */
  saved?: boolean
  /** Sound effects: how this clip was made (`text` holds the prompt). */
  sfx?: SoundEffectSettings & { seed: number; variation: number; of: number }
  /** Speech enhancement: how this clip was made (`text` holds the source file name). */
  enhance?: EnhanceSettings & { mode: EnhanceMode; inputSec: number }
  /** Script mode: who said what, and when (`text` holds the whole script). */
  script?: { pauseSec: number; segments: ScriptPart[] }
}

export interface ScriptPart {
  voiceId?: string
  voiceName: string
  provider: string
  modelId: string
  mode: GenerationMode
  text: string
  style?: string
  start: number
  end: number
}

/** Script mode: several voices in one text. See src/shared/script.ts for the format. */
export interface ScriptRequest {
  script: string
  /** Reads untagged text; defaults like a normal generation. */
  defaultVoiceId?: string
  /** Model family for your own voices (built-in voices always use their own family). */
  provider?: string
  /** Each family's settings (language, instructions, parameters). Instructions apply to untagged text. */
  settingsByProvider?: Record<string, Partial<GenerationSettings>>
  /** Specific model per family; omitted = automatic. */
  modelByProvider?: Record<string, string>
  /** Silence between speakers, in seconds (default 0.35). */
  pauseSec?: number
  stream?: boolean
  source?: 'app' | 'mcp' | 'api'
}

// ---------- Speech enhancement ----------

/** "enhance" = denoise, then restore quality and bandwidth (generative); "denoise" = remove noise only (fast). */
export type EnhanceMode = 'enhance' | 'denoise'

export interface EnhanceSettings {
  /** ODE steps of the enhancer (its step count). Default 32. */
  nfe: number
  /** How much of the denoised signal the enhancer starts from (0 = none, 1 = only denoised). */
  lambd: number
  /** Prior temperature: how much the enhancer may regenerate (0 = conservative). */
  tau: number
  solver: 'midpoint' | 'euler'
}

export interface EnhanceRequest {
  /** WAV bytes (any rate; mono or stereo) or a path to a local audio file. */
  audio: Uint8Array | string
  /** File name or "Recording", for display. */
  name?: string
  mode?: EnhanceMode
  modelId?: string
  settings?: Partial<EnhanceSettings>
  source?: 'app' | 'mcp' | 'api'
}

// ---------- Sound effects ----------

export interface SoundEffectSettings {
  /** Length of the clip in seconds (0.5–120). */
  seconds: number
  /** Sampling steps; the model is tuned for 8. */
  steps: number
  /** Prompt strength. 1 = the model's own balance (fastest); higher follows the prompt more literally. */
  cfg: number
  /** What to steer away from (only used when cfg > 1). */
  negativePrompt?: string
}

export interface SoundEffectRequest {
  prompt: string
  modelId?: string
  settings?: Partial<SoundEffectSettings>
  /** Variations made in one pass (1–4). */
  count?: number
  /** Random if omitted. */
  seed?: number
  source?: 'app' | 'mcp' | 'api'
}

// ---------- Speech to text ----------

export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export interface TranscribeRequest {
  /** 16 kHz mono WAV bytes, or a path to a local audio file. */
  audio: Uint8Array | string
  /** File name or "Recording", for display. */
  name?: string
  /** Model family ("qwen3-asr", "whisper") or a specific variant id. */
  provider?: string
  modelId?: string
  /** "auto" or a language id from STT_LANGUAGES. */
  language?: string
  /** Whisper can translate speech into English text. */
  task?: 'transcribe' | 'translate'
  source?: 'app' | 'mcp' | 'api'
}

export interface Transcript {
  id: string
  name: string
  text: string
  segments: TranscriptSegment[]
  /** Detected (or chosen) language, as reported by the model. */
  language?: string
  task: 'transcribe' | 'translate'
  provider: string
  modelId: string
  durationSec: number
  processingSec: number
  createdAt: number
  source: 'app' | 'mcp' | 'api'
  /** Same meaning as HistoryItem.saved. */
  saved?: boolean
}

export interface GenerationChunk {
  jobId: string
  /** 16-bit PCM mono. */
  pcm: Uint8Array
  sampleRate: number
  final?: boolean
}

export interface GenerationProgress {
  jobId: string
  step: number
  total: number
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
  /**
   * What happens to things you generate: 'all' keeps everything in History; 'manual' keeps only
   * what you press Save on (the rest is removed when Voiceify quits). Unset until the first
   * generation asks.
   */
  saveMode?: 'all' | 'manual'
  /**
   * Your own starting values for each model family's settings (Settings → Model settings), keyed by
   * provider id then ParamSpec.key. Used by the app pages, agents and the API; missing = model default.
   */
  providerDefaults?: Record<string, Record<string, number>>
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
