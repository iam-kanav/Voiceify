import type { AppSettings, GenerationSettings, Voice } from './types'

/** Preset speakers shipped inside provider models (Qwen3-TTS CustomVoice: 9 speakers). */
export const PRESET_VOICES: Voice[] = [
  preset('Ryan', 'male', 'English', 'Dynamic male voice with strong rhythmic drive.', ['Energetic', 'Narration'], ['#f97316', '#db2777']),
  preset('Aiden', 'male', 'English', 'Sunny American male voice with a clear midrange.', ['Friendly', 'Conversational'], ['#0ea5e9', '#6366f1']),
  preset('Vivian', 'female', 'Chinese', 'Bright, slightly edgy young female voice.', ['Bright', 'Expressive'], ['#ec4899', '#8b5cf6']),
  preset('Serena', 'female', 'Chinese', 'Warm, gentle young female voice.', ['Warm', 'Soft'], ['#f59e0b', '#ef4444']),
  preset('Uncle_Fu', 'male', 'Chinese', 'Seasoned male voice with a low, mellow timbre.', ['Deep', 'Mature'], ['#78716c', '#0f766e'], 'Uncle Fu'),
  preset('Dylan', 'male', 'Chinese', 'Youthful Beijing male voice with a clear, natural timbre.', ['Beijing dialect', 'Young'], ['#22c55e', '#0891b2']),
  preset('Eric', 'male', 'Chinese', 'Lively Chengdu male voice with a slightly husky brightness.', ['Sichuan dialect', 'Lively'], ['#eab308', '#16a34a']),
  preset('Ono_Anna', 'female', 'Japanese', 'Playful Japanese female voice with a light, nimble timbre.', ['Playful', 'Light'], ['#f472b6', '#38bdf8'], 'Ono Anna'),
  preset('Sohee', 'female', 'Korean', 'Warm Korean female voice with rich emotion.', ['Warm', 'Emotive'], ['#a855f7', '#f43f5e'])
]

function preset(
  speaker: string,
  gender: 'male' | 'female',
  language: string,
  description: string,
  tags: string[],
  colors: [string, string],
  name = speaker
): Voice {
  return {
    id: `preset:${speaker.toLowerCase()}`,
    name,
    kind: 'preset',
    provider: 'qwen3-tts',
    speaker,
    gender,
    language,
    description,
    tags,
    colors,
    createdAt: 0
  }
}

export const DEFAULT_GENERATION: GenerationSettings = {
  language: 'auto',
  temperature: 0.9,
  topP: 1.0,
  topK: 50,
  repetitionPenalty: 1.05,
  instruct: ''
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  apiPort: 47821,
  apiEnabled: true,
  maxLoadedModels: 1,
  defaultModels: {},
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
