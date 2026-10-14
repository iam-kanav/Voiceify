import type { AppSettings, GenerationSettings } from './types'

/** Built-in voices of every provider (defined in providers.ts). */
export { PRESET_VOICES } from './providers'

export const DEFAULT_GENERATION: GenerationSettings = {
  language: 'auto',
  instruct: '',
  params: {}
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  apiPort: 47821,
  apiEnabled: true,
  maxLoadedModels: 1,
  defaultModels: {},
  defaultProvider: 'qwen3-tts',
  onboardingComplete: false,
  defaultGeneration: DEFAULT_GENERATION
}

const PALETTE: [string, string][] = [
  ['#6366f1', '#ec4899'],
  ['#14b8a6', '#6366f1'],
  ['#f97316', '#facc15'],
  ['#0ea5e9', '#22c55e'],
  ['#e11d48', '#7c3aed'],
  ['#84cc16', '#06b6d4'],
  ['#f43f5e', '#fb923c'],
  ['#8b5cf6', '#0ea5e9']
]

export function randomColors(seed: string): [string, string] {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export const DESIGN_EXAMPLES = [
  {
    label: 'Wise wizard',
    prompt: 'An elderly male wizard with a deep, gravelly voice, speaking slowly and deliberately with a warm, knowing tone.'
  },
  {
    label: 'Podcast host',
    prompt: 'A confident woman in her early 30s with a clear American accent, upbeat and conversational, like a popular podcast host.'
  },
  {
    label: 'Movie trailer',
    prompt: 'A dramatic, booming male narrator for an action movie trailer, low pitch, intense and powerful with long pauses.'
  },
  {
    label: 'Nervous teen',
    prompt: 'Male, 17 years old, tenor range, a bit nervous and stuttering, vowels tighten when anxious but gaining confidence.'
  },
  {
    label: 'ASMR whisper',
    prompt: 'A soft, breathy female whisper, very calm and intimate, slow pace, close to the microphone.'
  },
  {
    label: 'British butler',
    prompt: 'A refined middle-aged British butler with a crisp Received Pronunciation accent, polite, measured and slightly dry.'
  }
]

export const INSTRUCT_PRESETS = [
  'Very happy and excited.',
  'Calm, soothing and slow.',
  'Speak quickly, with urgency.',
  'Speak in an incredulous tone, with a hint of panic.',
  'Whisper softly, as if telling a secret.',
  'Angry and frustrated.',
  'Sad, with a trembling voice.',
  'Professional news anchor delivery.',
  'Storytelling for children, warm and animated.'
]
