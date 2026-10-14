import type { Capability, ExtraFile, ModelVariant, Quant, SystemInfo } from './types'

export { PROVIDERS } from './providers'

/**
 * The model catalog. Every downloadable model lives here; the UI, recommendation engine, MCP
 * server and engine all read from it. To support a new task (e.g. sound effects), add entries
 * with a new `task` and a matching engine handler.
 *
 * Sizes are exact repo totals from the Hugging Face API (weights + speech tokenizer).
 */

const QUANTS: Quant[] = ['bf16', '8bit', '6bit', '5bit', '4bit']

// Relative scores. 8-bit is practically lossless for these models; 4-bit audibly flattens delivery.
const QUANT_QUALITY: Record<Quant, number> = { '4bit': 3, '5bit': 3.5, '6bit': 4, '8bit': 4.75, bf16: 5 }
const QUANT_SPEED: Record<Quant, number> = { '4bit': 5, '5bit': 4.75, '6bit': 4.5, '8bit': 4, bf16: 3 }

/** Plain-language explanation of each precision level (shown in tooltips and pickers). */
export const PRECISION_INFO: Record<Quant, { label: string; note: string }> = {
  bf16: { label: 'Full precision', note: 'The original, uncompressed model. Highest fidelity, but the largest and slowest.' },
  '8bit': { label: '8-bit', note: 'Compressed to 8 bits per weight. Sounds virtually identical to full precision while being smaller and faster.' },
  '6bit': { label: '6-bit', note: 'Smaller and faster again, with a slight loss of expressiveness.' },
  '5bit': { label: '5-bit', note: 'Smaller still; delivery can occasionally sound flatter.' },
  '4bit': { label: '4-bit', note: 'Smallest and fastest. Noticeably flatter, less expressive delivery.' }
}

export const PRECISION_HELP =
  'Precision is how much a model is compressed. Fewer bits = smaller download, less memory and faster speech, at some cost to expressiveness. 8-bit is the sweet spot for most computers.'

export const SIZE_HELP =
  'Large models sound more natural and follow instructions better. Small models are faster and use less memory.'

/** What each kind of model is for, in plain language. Shown as section headers and in pickers. */
export const ROLES: Record<string, { label: string; blurb: string; why: string }> = {
  'built-in-voices': {
    label: 'Built-in Voices',
    blurb: 'Speaks your text with 9 professionally recorded voices in 10 languages.',
    why: 'Use this for everyday text to speech. The Large version also follows style instructions like “whisper” or “sound excited”.'
  },
  'voice-design': {
    label: 'Voice Design',
    blurb: 'Invents a brand-new voice from a written description.',
    why: 'Needed for Create Voice → Design. Describe age, accent, tone and pace and it creates a matching voice.'
  },
  'voice-cloning': {
    label: 'Voice Cloning',
    blurb: 'Copies a voice from a few seconds of audio.',
    why: 'Needed for Create Voice → Clone, and to speak with any voice you cloned or designed and saved.'
  },
  transcription: {
    label: 'Speech to Text',
    blurb: 'Writes down what is said in any audio or video file.',
    why: 'Powers Speech to Text, and fills in the transcript when you clone a voice, which makes clones noticeably more accurate.'
  },
  'voices-and-cloning': {
    label: 'Voices & Cloning',
    blurb: 'One small model speaks the built-in voices and clones yours.',
    why: 'Everything Pocket TTS does comes in a single download. Pick a precision; 8-bit is the sweet spot.'
  },
  community: {
    label: 'Community Fine-tunes',
    blurb: 'Variants trained by the open-source community for special skills.',
    why: 'Optional extras. They are converted to run on your computer after download.'
  },
  custom: {
    label: 'Custom Models',
    blurb: 'Models you added from Hugging Face.',
    why: 'Advanced: any compatible model repository you add yourself.'
  }
}

interface FamilyDef {
  familyId: string
  params: '0.6B' | '1.7B'
  kind: 'Base' | 'CustomVoice' | 'VoiceDesign'
  roleId: keyof typeof ROLES
  capabilities: Capability[]
  description: string
  sizes: Record<Quant, number>
}

const FAMILIES: FamilyDef[] = [
  {
    familyId: 'qwen3-tts-1.7b-customvoice',
    params: '1.7B',
    kind: 'CustomVoice',
    roleId: 'built-in-voices',
    capabilities: ['preset-voices', 'instruct'],
    description: 'Most natural delivery, and follows style instructions (emotion, tone, pace).',
    sizes: { '4bit': 2312059416, '5bit': 2504079912, '6bit': 2696100432, '8bit': 3080141538, bf16: 4520195613 }
  },
  {
    familyId: 'qwen3-tts-0.6b-customvoice',
    params: '0.6B',
    kind: 'CustomVoice',
    roleId: 'built-in-voices',
    capabilities: ['preset-voices'],
    description: 'Same voices, faster and lighter. Does not follow style instructions.',
    sizes: { '4bit': 1693604738, '5bit': 1763597582, '6bit': 1833590308, '8bit': 1973575388, bf16: 2498419405 }
  },
  {
    familyId: 'qwen3-tts-1.7b-voicedesign',
    params: '1.7B',
    kind: 'VoiceDesign',
    roleId: 'voice-design',
    capabilities: ['voice-design', 'instruct'],
    description: 'The only Voice Design size released.',
    sizes: { '4bit': 2312058795, '5bit': 2504079291, '6bit': 2696099811, '8bit': 3080140867, bf16: 4520194992 }
  },
  {
    familyId: 'qwen3-tts-1.7b-base',
    params: '1.7B',
    kind: 'Base',
    roleId: 'voice-cloning',
    capabilities: ['voice-clone'],
    description: 'Closest match to the original speaker and the most stable output.',
    sizes: { '4bit': 2336076686, '5bit': 2528097176, '6bit': 2720117690, '8bit': 3104158788, bf16: 4544212739 }
  },
  {
    familyId: 'qwen3-tts-0.6b-base',
    params: '0.6B',
    kind: 'Base',
    roleId: 'voice-cloning',
    capabilities: ['voice-clone'],
    description: 'Faster and lighter cloning; still a good match, especially in English.',
    sizes: { '4bit': 1711328624, '5bit': 1781321436, '6bit': 1851314126, '8bit': 1991299138, bf16: 2516143009 }
  }
]

const sizeLabel = (params: string) => (params === '0.6B' ? 'Small' : 'Large')

function summaryFor(params: string, q: Quant) {
  const small = params === '0.6B'
  if (q === 'bf16') return small ? 'Small, uncompressed' : 'Maximum fidelity · needs the most memory'
  if (q === '8bit') return small ? 'Fast and light · good quality' : 'Best balance of quality and speed'
  if (q === '6bit') return small ? 'Very fast and light' : 'A little smaller and faster'
  if (q === '5bit') return 'Smaller · slight quality loss'
  return small ? 'Smallest and fastest · basic quality' : 'Smallest and fastest · flatter delivery'
}

const official: ModelVariant[] = FAMILIES.flatMap((f) =>
  QUANTS.map((q) => {
    const sizeGB = f.sizes[q] / 1e9
    const paramBoost = f.params === '1.7B' ? 0 : -0.75
    const role = ROLES[f.roleId].label
    return {
      id: `${f.familyId}-${q}`,
      provider: 'qwen3-tts',
      name: `${role} · ${sizeLabel(f.params)} · ${PRECISION_INFO[q].label}`,
      family: `${role} · ${sizeLabel(f.params)}`,
      familyId: f.familyId,
      role,
      roleId: f.roleId,
      sizeLabel: sizeLabel(f.params),
      precisionLabel: PRECISION_INFO[q].label,
      summary: summaryFor(f.params, q),
      officialName: `Qwen3-TTS ${f.params} ${f.kind}`,
      task: 'tts' as const,
      capabilities: f.capabilities,
      params: f.params,
      quant: q,
      source: { type: 'hf-mlx' as const, repo: `mlx-community/Qwen3-TTS-12Hz-${f.params}-${f.kind}-${q}` },
      sizeBytes: f.sizes[q],
      quality: Math.max(1, Math.min(5, QUANT_QUALITY[q] + paramBoost)),
      speed: Math.min(5, QUANT_SPEED[q] + (f.params === '0.6B' ? 0.75 : -0.25)),
      minRamGB: Math.ceil(sizeGB * 1.6 + 2),
      description: f.description,
      tags: [f.params]
    }
  })
)

// Pocket TTS fetches its tokenizer and built-in voice embeddings from Hugging Face at load time;
// we download them alongside the model so it runs offline.
const POCKET_TOKENIZER: ExtraFile = {
  repo: 'kyutai/pocket-tts-without-voice-cloning',
  path: 'tokenizer.model',
  revision: 'd4fdd22ae8c8e1cb3634e150ebeff1dab2d16df3',
  size: 59339
}
const POCKET_EMBEDDINGS: ExtraFile[] = (
  [
    ['alba', 512088],
    ['azelma', 659544],
    ['cosette', 512088],
    ['eponine', 573528],
    ['fantine', 540760],
    ['javert', 512088],
    ['jean', 512088],
    ['marius', 512088]
  ] as const
).map(([name, size]) => ({ repo: 'mlx-community/pocket-tts', path: `embeddings/${name}.safetensors`, size }))

const POCKET: [Quant, string, number, number, string][] = [
  ['bf16', 'mlx-community/pocket-tts', 240322540, 3.8, 'Uncompressed · still tiny'],
  ['8bit', 'mlx-community/pocket-tts-8bit', 140263565, 3.7, 'Best balance · near-identical quality'],
  ['6bit', 'mlx-community/pocket-tts-6bit', 114789791, 3.4, 'Smaller · slight quality loss'],
  ['4bit', 'mlx-community/pocket-tts-4bit', 89316161, 3, 'Smallest · flatter delivery']
]

const pocket: ModelVariant[] = POCKET.map(([q, repo, size, quality, summary]) => {
  const extras = q === 'bf16' ? [POCKET_TOKENIZER] : [POCKET_TOKENIZER, ...POCKET_EMBEDDINGS]
  const total = size + (q === 'bf16' ? 0 : POCKET_EMBEDDINGS.reduce((n, e) => n + e.size, 0)) + POCKET_TOKENIZER.size
  return {
    id: `pocket-tts-${q}`,
    provider: 'pocket-tts',
    name: `Pocket TTS · ${PRECISION_INFO[q].label}`,
    family: 'Pocket TTS',
    familyId: 'pocket-tts',
    role: ROLES['voices-and-cloning'].label,
    roleId: 'voices-and-cloning',
    sizeLabel: '100M',
    precisionLabel: PRECISION_INFO[q].label,
    summary,
    officialName: 'Kyutai Pocket TTS (100M)',
    task: 'tts',
    capabilities: ['preset-voices', 'voice-clone'],
    params: '0.1B',
    quant: q,
    source: { type: 'hf-mlx', repo, extras },
    sizeBytes: total,
    quality,
    speed: 5,
    minRamGB: 2,
    description: 'Built-in voices and voice cloning in one small model. English.',
    tags: ['100M']
  }
})

const helpers: ModelVariant[] = [
  {
    id: 'qwen3-asr-0.6b-8bit',
    provider: 'qwen3-asr',
    name: 'Qwen3-ASR · Small · 8-bit',
    family: 'Qwen3-ASR · Small',
    familyId: 'qwen3-asr-0.6b',
    role: 'Speech to Text',
    roleId: 'transcription',
    sizeLabel: 'Small',
    precisionLabel: '8-bit',
    summary: 'Fast and accurate for clean recordings',
    officialName: 'Qwen3-ASR 0.6B',
    task: 'asr',
    capabilities: ['transcribe'],
    params: '0.6B',
    quant: '8bit',
    source: { type: 'hf-mlx', repo: 'mlx-community/Qwen3-ASR-0.6B-8bit' },
    sizeBytes: 1010773761,
    quality: 4,
    speed: 5,
    minRamGB: 4,
    description: 'Fast and accurate for clean recordings.',
    tags: ['0.6B']
  },
  {
    id: 'qwen3-asr-1.7b-8bit',
    provider: 'qwen3-asr',
    name: 'Qwen3-ASR · Large · 8-bit',
    family: 'Qwen3-ASR · Large',
    familyId: 'qwen3-asr-1.7b',
    role: 'Speech to Text',
    roleId: 'transcription',
    sizeLabel: 'Large',
    precisionLabel: '8-bit',
    summary: 'More accurate for noisy or accented audio',
    officialName: 'Qwen3-ASR 1.7B',
    task: 'asr',
    capabilities: ['transcribe'],
    params: '1.7B',
    quant: '8bit',
    source: { type: 'hf-mlx', repo: 'mlx-community/Qwen3-ASR-1.7B-8bit' },
    sizeBytes: 2467859030,
    quality: 5,
    speed: 4,
    minRamGB: 6,
    description: 'More accurate for noisy or accented audio.',
    tags: ['1.7B']
  }
]

// Whisper (OpenAI). The MLX weights ship without the Hugging Face tokenizer files mlx-audio needs,
// so those come from OpenAI's original repo (pinned) and are saved next to the weights.
const WHISPER_PROCESSOR: [string, number][] = [
  ['added_tokens.json', 34648],
  ['generation_config.json', 0],
  ['merges.txt', 493869],
  ['normalizer.json', 52666],
  ['preprocessor_config.json', 340],
  ['special_tokens_map.json', 0],
  ['tokenizer.json', 0],
  ['tokenizer_config.json', 282843],
  ['vocab.json', 1036558]
]
const WHISPER_SOURCES = {
  turbo: { repo: 'openai/whisper-large-v3-turbo', revision: '41f01f3fe87f28c78e2fbf8b568835947dd65ed9', sizes: { 'generation_config.json': 3772, 'special_tokens_map.json': 2186, 'tokenizer.json': 2710337 } },
  large: { repo: 'openai/whisper-large-v3', revision: '06f233fe06e710322aca913c1bc4249a0d71fce1', sizes: { 'generation_config.json': 3903, 'special_tokens_map.json': 2072, 'tokenizer.json': 2480617 } }
} as const

function whisperExtras(kind: keyof typeof WHISPER_SOURCES): ExtraFile[] {
  const src = WHISPER_SOURCES[kind]
  return WHISPER_PROCESSOR.map(([path, size]) => ({
    repo: src.repo,
    revision: src.revision,
    path,
    size: (src.sizes as Record<string, number>)[path] ?? size
  }))
}

const WHISPER: { kind: 'turbo' | 'large'; q: Quant; size: number; quality: number; speed: number; summary: string }[] = [
  { kind: 'turbo', q: 'bf16', size: 1614796978, quality: 4.6, speed: 4, summary: 'Uncompressed Turbo' },
  { kind: 'turbo', q: '8bit', size: 864478595, quality: 4.5, speed: 4.5, summary: 'Best balance · fast and accurate' },
  { kind: 'turbo', q: '4bit', size: 464282421, quality: 4, speed: 5, summary: 'Smallest · slightly less accurate' },
  { kind: 'large', q: 'bf16', size: 3084094947, quality: 5, speed: 2.5, summary: 'Most accurate · slowest' },
  { kind: 'large', q: '8bit', size: 1645709735, quality: 4.9, speed: 3, summary: 'Near-identical accuracy, smaller' },
  { kind: 'large', q: '4bit', size: 878510421, quality: 4.3, speed: 3.5, summary: 'Smaller · some accuracy loss' }
]

const whisper: ModelVariant[] = WHISPER.map(({ kind, q, size, quality, speed, summary }) => {
  const extras = whisperExtras(kind)
  const turbo = kind === 'turbo'
  const label = turbo ? 'Turbo' : 'Large'
  const repoQuant = q === 'bf16' ? 'fp16' : q
  return {
    id: `whisper-large-v3${turbo ? '-turbo' : ''}-${repoQuant}`,
    provider: 'whisper',
    name: `Whisper ${label} · ${PRECISION_INFO[q].label}`,
    family: `Whisper ${label}`,
    familyId: turbo ? 'whisper-large-v3-turbo' : 'whisper-large-v3',
    role: ROLES.transcription.label,
    roleId: 'transcription',
    sizeLabel: label,
    precisionLabel: PRECISION_INFO[q].label,
    summary,
    officialName: turbo ? 'OpenAI Whisper Large v3 Turbo (809M)' : 'OpenAI Whisper Large v3 (1.55B)',
    task: 'asr',
    capabilities: turbo ? ['transcribe'] : ['transcribe', 'translate'],
    params: turbo ? '0.8B' : '1.55B',
    quant: q,
    source: { type: 'hf-mlx', repo: `mlx-community/whisper-large-v3${turbo ? '-turbo' : ''}-${repoQuant}`, extras },
    sizeBytes: size + extras.reduce((n, e) => n + e.size, 0),
    quality,
    speed,
    minRamGB: Math.ceil((size / 1e9) * 1.6 + 2),
    description: turbo
      ? 'A distilled Large v3: about as accurate, several times faster. Transcription only.'
      : 'The full Large v3 model. Most accurate, and can translate speech into English.',
    tags: [turbo ? '809M' : '1.55B']
  }
})

const community: ModelVariant[] = [
  {
    id: 'spragai-emotion-tags-1.7b-8bit',
    provider: 'qwen3-tts',
    name: 'Emotion Tags · Large · 8-bit',
    family: 'Emotion Tags (community)',
    familyId: 'community-emotion-tags',
    role: 'Community Fine-tunes',
    roleId: 'community',
    sizeLabel: 'Large',
    precisionLabel: '8-bit',
    summary: 'Built-in voices + inline emotion tags',
    officialName: 'SpragAI/qwen3-tts-emotion-tags (fine-tune of Qwen3-TTS 1.7B CustomVoice)',
    task: 'tts',
    capabilities: ['preset-voices', 'instruct', 'emotion-tags'],
    params: '1.7B',
    quant: '8bit',
    source: { type: 'hf-convert', repo: 'SpragAI/qwen3-tts-emotion-tags', qBits: 8 },
    sizeBytes: 4523160708,
    quality: 4.5,
    speed: 4,
    minRamGB: 10,
    description:
      'The built-in voices, plus emotion tags you can type inline: [Angry] [Sad] [Happy] [Fast] [Gentle] [Tired] [Fearful] [Disgusted] [Surprised]. English only. Converted to run on your computer after download.',
    tags: ['Fine-tuned', 'English'],
    community: true
  }
]

export const CATALOG: ModelVariant[] = [...official, ...pocket, ...helpers, ...whisper, ...community]

export const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.id, m]))

export function hasCapability(m: ModelVariant, c: Capability) {
  return m.capabilities.includes(c)
}

/**
 * Recommend one model per core capability based on this computer's memory. Every variant runs on
 * any supported device with enough memory; the picks favour 8-bit, which keeps near-full quality while
 * using a third less memory and running faster than full precision.
 */
export function recommendationsFor(sys: SystemInfo): Map<string, string> {
  const rec = new Map<string, string>()
  const mem = sys.memoryGB
  const pick = (family: string, q: Quant, reason: string) => rec.set(`${family}-${q}`, reason)

  if (!sys.backend) return rec
  if (mem <= 8) {
    const why = `Light enough for ${mem} GB of memory`
    pick('qwen3-tts-0.6b-customvoice', '8bit', why)
    pick('qwen3-tts-0.6b-base', '8bit', why)
    pick('qwen3-tts-1.7b-voicedesign', '4bit', `Smallest Voice Design option, to fit in ${mem} GB`)
  } else if (mem <= 24) {
    const why = `Best balance of quality and speed for ${mem} GB of memory`
    pick('qwen3-tts-1.7b-customvoice', '8bit', why)
    pick('qwen3-tts-1.7b-base', '8bit', why)
    pick('qwen3-tts-1.7b-voicedesign', '8bit', why)
  } else {
    const why = `${mem} GB of memory is enough for full quality`
    pick('qwen3-tts-1.7b-customvoice', 'bf16', why)
    pick('qwen3-tts-1.7b-base', 'bf16', why)
    pick('qwen3-tts-1.7b-voicedesign', 'bf16', why)
  }
  rec.set('qwen3-asr-0.6b-8bit', 'Small and fast; also fills in clone transcripts')
  rec.set('pocket-tts-8bit', mem <= 8 ? `Fast and tiny — ideal for ${mem} GB of memory` : 'Tiny (140 MB) and very fast — great for drafts and long reads')
  return rec
}

export const LANGUAGES = [
  { id: 'auto', label: 'Auto-detect' },
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

export function formatBytes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`
  return `${n} B`
}
