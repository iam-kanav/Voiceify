import type { Provider, Voice } from './types'

/**
 * Model providers: one entry per model family. Each one declares what it can do, which languages
 * it speaks, which settings it understands, and which voices it ships with. The UI renders from
 * this, so options a model doesn't support disappear and model-specific ones get their own
 * explanations.
 *
 * To add a provider: add it here, add its downloadable variants to catalog.ts, and teach
 * resources/engine/server.py to load and run it.
 */

export const ALL_LANGUAGES = [
  { id: 'english', label: 'English' },
  { id: 'chinese', label: 'Chinese' },
  { id: 'japanese', label: 'Japanese' },
  { id: 'korean', label: 'Korean' },
  { id: 'german', label: 'German' },
  { id: 'french', label: 'French' },
  { id: 'russian', label: 'Russian' },
  { id: 'portuguese', label: 'Portuguese' },
  { id: 'spanish', label: 'Spanish' },
  { id: 'italian', label: 'Italian' }
]

function voice(
  provider: string,
  speaker: string,
  gender: 'male' | 'female',
  language: string,
  description: string,
  tags: string[],
  colors: [string, string],
  name = speaker.charAt(0).toUpperCase() + speaker.slice(1)
): Voice {
  return {
    id: provider === 'qwen3-tts' ? `preset:${speaker.toLowerCase()}` : `preset:${provider}:${speaker.toLowerCase()}`,
    name,
    kind: 'preset',
    provider,
    speaker,
    gender,
    language,
    description,
    tags,
    colors,
    createdAt: 0
  }
}

export const PROVIDERS: Provider[] = [
  {
    id: 'qwen3-tts',
    name: 'Qwen3-TTS',
    vendor: 'Alibaba Qwen',
    license: 'Apache-2.0',
    url: 'https://huggingface.co/collections/Qwen/qwen3-tts',
    task: 'tts',
    tagline: 'Expressive and multilingual. Follows style instructions.',
    description:
      'A family of open-source speech models from Alibaba’s Qwen team. The most capable option: 10 languages, natural delivery, style instructions, voice design and voice cloning.',
    strengths: ['10 languages', 'Style instructions like “whisper” or “sound excited”', 'Designs brand-new voices from a description', 'High-fidelity cloning'],
    limits: ['Larger downloads (2–4.5 GB per model)', 'Each task uses a separate model'],
    colors: ['#6366f1', '#ec4899'],
    languages: ALL_LANGUAGES.map((l) => l.id),
    features: { builtInVoices: true, styleInstructions: true, voiceCloning: true, voiceDesign: true },
    params: [
      {
        key: 'temperature',
        engineKey: 'temperature',
        label: 'Expressiveness',
        help: 'How much the voice varies its delivery. Steady = predictable and even; Expressive = livelier, but occasionally odd. (Sampling temperature; 0.9 is the model’s default.)',
        min: 0.1,
        max: 1.5,
        step: 0.01,
        default: 0.9,
        left: 'Steady',
        right: 'Expressive'
      },
      {
        key: 'topP',
        engineKey: 'top_p',
        label: 'Top P',
        help: 'Limits choices to the most likely sounds. Lower values make speech more conservative. Leave at 1.0 unless output sounds erratic.',
        min: 0.1,
        max: 1,
        step: 0.01,
        default: 1,
        advanced: true
      },
      {
        key: 'topK',
        engineKey: 'top_k',
        label: 'Top K',
        help: 'How many candidate sounds the model considers at each step. Lower = safer, higher = more varied. Default 50.',
        min: 1,
        max: 100,
        step: 1,
        default: 50,
        integer: true,
        advanced: true
      },
      {
        key: 'repetitionPenalty',
        engineKey: 'repetition_penalty',
        label: 'Repetition penalty',
        help: 'Discourages the model from getting stuck repeating sounds or words. Raise slightly if you hear loops or stutters. Default 1.05.',
        min: 1,
        max: 1.5,
        step: 0.01,
        default: 1.05,
        advanced: true
      }
    ],
    voices: [
      voice('qwen3-tts', 'Ryan', 'male', 'English', 'Dynamic male voice with strong rhythmic drive.', ['Energetic', 'Narration'], ['#f97316', '#db2777']),
      voice('qwen3-tts', 'Aiden', 'male', 'English', 'Sunny American male voice with a clear midrange.', ['Friendly', 'Conversational'], ['#0ea5e9', '#6366f1']),
      voice('qwen3-tts', 'Vivian', 'female', 'Chinese', 'Bright, slightly edgy young female voice.', ['Bright', 'Expressive'], ['#ec4899', '#8b5cf6']),
      voice('qwen3-tts', 'Serena', 'female', 'Chinese', 'Warm, gentle young female voice.', ['Warm', 'Soft'], ['#f59e0b', '#ef4444']),
      voice('qwen3-tts', 'Uncle_Fu', 'male', 'Chinese', 'Seasoned male voice with a low, mellow timbre.', ['Deep', 'Mature'], ['#78716c', '#0f766e'], 'Uncle Fu'),
      voice('qwen3-tts', 'Dylan', 'male', 'Chinese', 'Youthful Beijing male voice with a clear, natural timbre.', ['Beijing dialect', 'Young'], ['#22c55e', '#0891b2']),
      voice('qwen3-tts', 'Eric', 'male', 'Chinese', 'Lively Chengdu male voice with a slightly husky brightness.', ['Sichuan dialect', 'Lively'], ['#eab308', '#16a34a']),
      voice('qwen3-tts', 'Ono_Anna', 'female', 'Japanese', 'Playful Japanese female voice with a light, nimble timbre.', ['Playful', 'Light'], ['#f472b6', '#38bdf8'], 'Ono Anna'),
      voice('qwen3-tts', 'Sohee', 'female', 'Korean', 'Warm Korean female voice with rich emotion.', ['Warm', 'Emotive'], ['#a855f7', '#f43f5e'])
    ]
  },
  {
    id: 'pocket-tts',
    name: 'Pocket TTS',
    vendor: 'Kyutai',
    license: 'CC-BY-4.0',
    url: 'https://huggingface.co/kyutai/pocket-tts',
    task: 'tts',
    tagline: 'Tiny and fast English voices. Clones too.',
    description:
      'A 100-million-parameter model from Kyutai that runs several times faster than real time on almost any computer. One small download covers built-in voices and voice cloning.',
    strengths: ['Tiny: 90–240 MB', 'Very fast, starts speaking almost instantly', 'Built-in voices and cloning in one model', 'Great for long reads and drafts'],
    limits: ['English only in Voiceify for now', 'No style instructions or voice design (design a voice with Qwen3-TTS, then use it here)'],
    colors: ['#14b8a6', '#0ea5e9'],
    languages: ['english'],
    features: { builtInVoices: true, styleInstructions: false, voiceCloning: true, voiceDesign: false },
    params: [
      {
        key: 'temperature',
        engineKey: 'temperature',
        label: 'Expressiveness',
        help: 'How much the voice varies its delivery. Steady = predictable and even; Expressive = livelier. (Sampling temperature; 0.7 is Pocket TTS’s default.)',
        min: 0.1,
        max: 1.2,
        step: 0.01,
        default: 0.7,
        left: 'Steady',
        right: 'Expressive'
      },
      {
        key: 'qualitySteps',
        engineKey: 'lsd_decode_steps',
        label: 'Quality steps',
        help: 'How many refinement passes each bit of audio gets. More steps can sound slightly cleaner but take longer. Default 1.',
        min: 1,
        max: 8,
        step: 1,
        default: 1,
        integer: true,
        advanced: true,
        left: 'Faster',
        right: 'Cleaner'
      }
    ],
    voices: [
      voice('pocket-tts', 'alba', 'female', 'English', 'Relaxed, casual female voice.', ['Casual', 'Warm'], ['#14b8a6', '#a3e635']),
      voice('pocket-tts', 'marius', 'male', 'English', 'Easygoing male voice, recorded like a selfie video.', ['Natural', 'Casual'], ['#0ea5e9', '#14b8a6']),
      voice('pocket-tts', 'javert', 'male', 'English', 'Steady, grounded male voice.', ['Calm', 'Steady'], ['#475569', '#0ea5e9']),
      voice('pocket-tts', 'jean', 'male', 'English', 'Clear male voice with free-flowing delivery.', ['Clear', 'Narration'], ['#6366f1', '#14b8a6']),
      voice('pocket-tts', 'fantine', 'female', 'English', 'Gentle female voice with a British accent.', ['Gentle', 'British'], ['#f472b6', '#14b8a6']),
      voice('pocket-tts', 'cosette', 'female', 'English', 'Expressive, animated female voice.', ['Expressive', 'Animated'], ['#f59e0b', '#14b8a6']),
      voice('pocket-tts', 'eponine', 'female', 'English', 'Bright female voice with a British accent.', ['Bright', 'British'], ['#e11d48', '#0ea5e9']),
      voice('pocket-tts', 'azelma', 'female', 'English', 'Soft female voice with a British accent.', ['Soft', 'British'], ['#a855f7', '#14b8a6'])
    ]
  },
  {
    id: 'qwen3-asr',
    name: 'Qwen3-ASR',
    vendor: 'Alibaba Qwen',
    license: 'Apache-2.0',
    url: 'https://huggingface.co/collections/Qwen/qwen3-asr',
    task: 'asr',
    tagline: 'Speech recognition helper.',
    description: 'Writes down what is said in an audio clip. Voiceify uses it to fill in transcripts when you clone a voice, which makes clones more accurate.',
    strengths: ['Accurate in 10+ languages', 'Small and fast'],
    limits: ['Optional: only used for voice cloning transcripts'],
    colors: ['#f97316', '#eab308'],
    languages: ALL_LANGUAGES.map((l) => l.id),
    features: { builtInVoices: false, styleInstructions: false, voiceCloning: false, voiceDesign: false },
    params: [],
    voices: []
  }
]

export const PROVIDER_BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]))
export const TTS_PROVIDERS = PROVIDERS.filter((p) => p.task === 'tts')
export const DEFAULT_PROVIDER = 'qwen3-tts'

export const PRESET_VOICES: Voice[] = PROVIDERS.flatMap((p) => p.voices)

/** Fill in a provider's default for every parameter it understands. */
export function paramsFor(providerId: string, overrides: Record<string, number> = {}): Record<string, number> {
  const p = PROVIDER_BY_ID.get(providerId)
  const out: Record<string, number> = {}
  for (const spec of p?.params ?? []) out[spec.key] = overrides[spec.key] ?? spec.default
  return out
}

/** Providers (TTS) that can speak a given voice. Built-in voices belong to one; your own voices work with any that can clone. */
export function providersForVoice(v: Voice | undefined): Provider[] {
  if (!v) return []
  if (v.kind === 'preset') return TTS_PROVIDERS.filter((p) => p.id === (v.provider ?? DEFAULT_PROVIDER))
  return TTS_PROVIDERS.filter((p) => p.features.voiceCloning || (v.kind === 'designed' && p.features.voiceDesign))
}
