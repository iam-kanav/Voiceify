import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Capability, GenerateRequest, GenerationMode, GenerationSettings, HistoryItem, ModelVariant, Provider, TranscribeRequest, Transcript, Voice } from '@shared/types'
import { ASR_PROVIDERS, DEFAULT_PROVIDER, paramsFor, PROVIDER_BY_ID, providersForVoice, STT_LANGUAGES, TTS_PROVIDERS } from '@shared/providers'
import { DEFAULT_GENERATION } from '@shared/voices'
import { engine } from '../engine/client'
import { bus } from '../events'
import { history } from '../library/history'
import { transcripts } from '../library/transcripts'
import { voices } from '../library/voices'
import { models } from '../models/manager'
import { paths } from '../paths'
import { getSettings } from '../settings'
import { fingerprintModels, hasFingerprint } from './fingerprints'

/**
 * High-level studio operations. The renderer (IPC), the REST API and the MCP server all go
 * through here, so every surface behaves identically.
 */

/** Plain-language: what the user is trying to do, and which model unlocks it. */
const CAP_NEEDS: Record<Capability, { task: string; model: string }> = {
  'preset-voices': { task: 'use built-in voices', model: 'Built-in Voices' },
  instruct: { task: 'use style instructions', model: 'Built-in Voices (Large)' },
  'voice-design': { task: 'design voices', model: 'Voice Design' },
  'voice-clone': { task: 'clone voices or use your saved voices', model: 'Voice Cloning' },
  'emotion-tags': { task: 'use emotion tags', model: 'Emotion Tags' },
  fingerprint: { task: 'make voice fingerprints', model: 'Voice Fingerprints' },
  transcribe: { task: 'transcribe audio', model: 'Speech to Text' },
  translate: { task: 'translate speech into English', model: 'Whisper Large' }
}

export class StudioError extends Error {
  constructor(
    message: string,
    public code: 'no-model' | 'bad-request' | 'engine' = 'bad-request'
  ) {
    super(message)
  }
}

interface Plan {
  mode: GenerationMode
  model: ModelVariant
  provider: Provider
  voice?: Voice
  voiceName: string
  /** Model-specific settings actually used (for history). */
  values: Record<string, number>
  /** Arguments for the engine's tts.generate. */
  params: Record<string, unknown>
}

function requireModel(cap: Capability, preferredId?: string, provider?: Provider): ModelVariant {
  if (preferredId) {
    const m = models.get(preferredId)
    if (m && models.installedPath(m.id) && !m.capabilities.includes(cap)) {
      throw new StudioError(`${m.name} can't ${CAP_NEEDS[cap].task}. Pick a ${CAP_NEEDS[cap].model} model instead.`)
    }
  }
  const model = models.resolve(cap, preferredId, provider?.id)
  if (!model) {
    if (cap === 'translate') {
      throw new StudioError('To translate speech into English, download Whisper Large on the Models page (Whisper Turbo can’t translate).', 'no-model')
    }
    const what = provider && provider.id !== 'qwen3-tts' ? `a ${provider.name}` : `a ${CAP_NEEDS[cap].model}`
    throw new StudioError(`To ${CAP_NEEDS[cap].task}${provider ? ` with ${provider.name}` : ''}, download ${what} model on the Models page.`, 'no-model')
  }
  return model
}

/** `model` may name a provider ("pocket-tts") or a specific variant ("pocket-tts-8bit"). */
function parseModelRef(ref?: string): { provider?: string; modelId?: string } {
  if (!ref) return {}
  if (PROVIDER_BY_ID.has(ref)) return { provider: ref }
  const m = models.get(ref)
  return m ? { provider: m.provider, modelId: m.id } : { modelId: ref }
}

/** Which model family speaks this voice. */
function pickProvider(voice: Voice | undefined, requested?: string): Provider {
  if (voice?.kind === 'preset') {
    const own = voice.provider ?? DEFAULT_PROVIDER
    if (requested && requested !== own) {
      const ownName = PROVIDER_BY_ID.get(own)?.name ?? own
      const reqName = PROVIDER_BY_ID.get(requested)?.name ?? requested
      throw new StudioError(`“${voice.name}” is a built-in ${ownName} voice, so ${reqName} can’t speak it. Pick one of ${reqName}’s voices, or one of your own.`)
    }
    return PROVIDER_BY_ID.get(own)!
  }
  if (requested) {
    const p = PROVIDER_BY_ID.get(requested)
    if (!p) throw new StudioError(`Unknown model “${requested}”.`)
    if (voice && !providersForVoice(voice).some((x) => x.id === p.id)) {
      throw new StudioError(`${p.name} can’t use your own voices.`)
    }
    return p
  }
  // Your own voices: the default family if it can clone and is installed, else any that can.
  const preferred = [getSettings().defaultProvider, ...TTS_PROVIDERS.map((p) => p.id)]
  const cloners = models.installedProviders('voice-clone')
  const pick = preferred.find((id) => cloners.includes(id))
  if (pick) return PROVIDER_BY_ID.get(pick)!
  if (voice?.kind === 'designed' && models.installedWith('voice-design').length) return PROVIDER_BY_ID.get('qwen3-tts')!
  return PROVIDER_BY_ID.get(getSettings().defaultProvider) ?? PROVIDER_BY_ID.get(DEFAULT_PROVIDER)!
}

function defaultVoice(provider?: string): Voice {
  const fam = provider ?? getSettings().defaultProvider
  const presetOf = (id: string) => PROVIDER_BY_ID.get(id)?.voices[0]
  if (models.installedWith('preset-voices', fam).length && presetOf(fam)) return presetOf(fam)!
  const own = voices.list().find((v) => v.kind !== 'preset')
  if (own) return own
  const anyFam = models.installedProviders('preset-voices')[0]
  return (anyFam && presetOf(anyFam)) || voices.find('preset:ryan')!
}

/** Turn the provider's settings into the engine's keyword arguments. */
function engineArgs(provider: Provider, settings: GenerationSettings & { temperature?: number }) {
  const legacy: Record<string, number> = settings.temperature !== undefined ? { temperature: settings.temperature } : {}
  const values = paramsFor(provider.id, { ...legacy, ...settings.params })
  const args: Record<string, unknown> = {}
  for (const spec of provider.params) args[spec.engineKey] = spec.integer ? Math.round(values[spec.key]) : values[spec.key]
  // Only multilingual models get a language; others always speak their one language.
  if (provider.languages.length > 1) args.language = settings.language
  return { values, args }
}

function plan(req: GenerateRequest, settings: GenerationSettings): Plan {
  const ref = parseModelRef(req.modelId)
  const requested = req.provider ?? ref.provider

  if (req.designPrompt && !req.voiceId) {
    const provider = PROVIDER_BY_ID.get('qwen3-tts')!
    const model = requireModel('voice-design', ref.modelId, provider)
    const { values, args } = engineArgs(provider, settings)
    return { mode: 'design', model, provider, voiceName: 'Voice Design', values, params: { ...args, instruct: req.designPrompt } }
  }

  const voice = req.voiceId ? voices.find(req.voiceId) : defaultVoice(requested)
  if (!voice) throw new StudioError(`The voice "${req.voiceId}" no longer exists. Pick another voice.`)
  const provider = pickProvider(voice, requested)
  const { values, args } = engineArgs(provider, settings)

  if (voice.kind === 'preset') {
    const model = requireModel('preset-voices', ref.modelId, provider)
    const instruct =
      provider.features.styleInstructions && model.capabilities.includes('instruct') ? settings.instruct?.trim() : undefined
    return {
      mode: 'preset',
      model,
      provider,
      voice,
      voiceName: voice.name,
      values,
      params: { ...args, voice: voice.speaker, instruct: instruct || undefined }
    }
  }

  // Your own voices can be spoken three ways (Qwen3-TTS):
  //  • fingerprint → Built-in Voices (Large) speaks it like a built-in voice; follows style instructions
  //  • clone       → Voice Cloning copies it from the reference recording (closest match)
  //  • design      → re-created from its description (designed voices, last resort)
  // Automatic: fingerprint when there are style instructions or no cloning model; otherwise clone.
  const canClone = models.installedWith('voice-clone', provider.id).length > 0
  const explicit = ref.modelId ? models.get(ref.modelId) : undefined
  const fpModels = provider.id === 'qwen3-tts' ? fingerprintModels() : []
  if (explicit?.capabilities.includes('preset-voices') && provider.id === 'qwen3-tts') {
    if (!fpModels.some((m) => m.id === explicit.id)) {
      throw new StudioError(`Your own voices work with Built-in Voices (Large). ${explicit.name} can’t speak them.`)
    }
    if (!hasFingerprint(voice)) {
      throw new StudioError(`“${voice.name}” is still being prepared for Built-in Voices. Try again in a moment, or pick Voice Cloning.`)
    }
  }
  const instruct = settings.instruct?.trim()
  const useFingerprint =
    hasFingerprint(voice) &&
    fpModels.length > 0 &&
    (explicit ? explicit.capabilities.includes('preset-voices') : !!instruct || !canClone)
  if (useFingerprint) {
    const fallback = models.resolve('preset-voices', undefined, provider.id)
    const model = (explicit && fpModels.find((m) => m.id === explicit.id)) || fpModels.find((m) => m.id === fallback?.id) || fpModels[0]
    return {
      mode: 'fingerprint',
      model,
      provider,
      voice,
      voiceName: voice.name,
      values,
      params: { ...args, speaker_embedding: voice.fingerprint, instruct: instruct || undefined }
    }
  }

  const wantsDesign =
    voice.kind === 'designed' &&
    !!voice.designPrompt &&
    provider.features.voiceDesign &&
    (explicit?.capabilities.includes('voice-design') || !canClone)
  if (wantsDesign) {
    const model = requireModel('voice-design', ref.modelId, provider)
    return { mode: 'design', model, provider, voice, voiceName: voice.name, values, params: { ...args, instruct: voice.designPrompt } }
  }
  if (!canClone && fpModels.length && !hasFingerprint(voice) && !explicit) {
    throw new StudioError(`“${voice.name}” is still being prepared for Built-in Voices. Try again in a moment.`)
  }

  const model = requireModel('voice-clone', ref.modelId, provider)
  if (!voice.refAudio) throw new StudioError(`“${voice.name}” is missing its reference audio. Clone it again from Create Voice.`)
  return {
    mode: 'clone',
    model,
    provider,
    voice,
    voiceName: voice.name,
    values,
    params: { ...args, ref_audio: voice.refAudio, ref_text: voice.refText || undefined }
  }
}

export interface GenerateOptions {
  jobId?: string
  onChunk?: (pcm: Buffer, sampleRate: number) => void
  ephemeral?: boolean
}

export async function generate(req: GenerateRequest, opts: GenerateOptions = {}): Promise<HistoryItem> {
  const text = (req.text ?? '').trim()
  if (!text) throw new StudioError('Text is empty.')

  const settings: GenerationSettings & { temperature?: number } = {
    ...DEFAULT_GENERATION,
    ...req.settings,
    params: { ...(req.settings?.params ?? {}) }
  }
  const p = plan(req, settings)
  const modelPath = models.installedPath(p.model.id)!
  const coldStart = !engine.isLoaded(modelPath)
  const id = `gen_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`
  const outPath = history.audioPathFor(id)
  const jobId = opts.jobId ?? id

  const result = await engine.request<{
    cancelled?: boolean
    duration: number
    sample_rate: number
    processing_time: number
    rtf: number
  }>(
    'tts.generate',
    { ...p.params, provider: p.provider.id, model_path: modelPath, text, out_path: outPath, stream: req.stream !== false },
    {
      id: jobId,
      onEvent: (event, data) => {
        if (event === 'chunk' && opts.onChunk) {
          const d = data as { pcm: string; sr: number }
          opts.onChunk(Buffer.from(d.pcm, 'base64'), d.sr)
        }
      }
    }
  )
  engine.markLoaded(modelPath)
  if (result.cancelled) throw new StudioError('Generation cancelled.')

  const item: HistoryItem = {
    id,
    text,
    voiceId: p.voice?.id,
    voiceName: p.voiceName,
    provider: p.provider.id,
    modelId: p.model.id,
    mode: p.mode,
    settings: { language: settings.language, instruct: (p.params.instruct as string) ?? '', params: p.values },
    audioPath: outPath,
    durationSec: result.duration,
    sampleRate: result.sample_rate,
    processingSec: result.processing_time,
    rtf: result.rtf,
    coldStart,
    createdAt: Date.now(),
    source: req.source ?? 'app',
    ephemeral: opts.ephemeral ?? (p.mode === 'design' && !req.voiceId)
  }
  if (!item.ephemeral && keepOnlySaved(item.source)) item.saved = false
  history.add(item)
  return item
}

export function cancel(jobId: string) {
  engine.cancel(jobId)
}

/**
 * In "Only what I save" mode, things made in the app wait for the user to press Save. Agent and API
 * results are always kept: the app that asked for them may still need the file.
 */
function keepOnlySaved(source: 'app' | 'mcp' | 'api') {
  return source === 'app' && getSettings().saveMode === 'manual'
}

function languageLabel(lang: string | undefined | null) {
  if (!lang) return undefined
  const l = String(lang).toLowerCase()
  return STT_LANGUAGES.find((x) => x.id === l || x.code === l)?.label ?? String(lang)
}

/** Speech to text: picks the model, runs it, and records the result. */
export async function transcribeAudio(req: TranscribeRequest): Promise<Transcript> {
  const ref = parseModelRef(req.modelId)
  const providerId = req.provider ?? ref.provider
  const provider = providerId ? PROVIDER_BY_ID.get(providerId) : undefined
  if (providerId && provider?.task !== 'asr') throw new StudioError(`“${providerId}” is not a speech-to-text model.`)
  const task = req.task === 'translate' ? 'translate' : 'transcribe'
  const model =
    task === 'translate'
      ? requireModel('translate', ref.modelId, provider ?? PROVIDER_BY_ID.get('whisper'))
      : requireModel('transcribe', ref.modelId, provider)
  const family = PROVIDER_BY_ID.get(model.provider)!
  const lang = req.language && req.language !== 'auto' ? STT_LANGUAGES.find((l) => l.id === req.language || l.code === req.language) : undefined
  if (req.language && req.language !== 'auto' && !lang) throw new StudioError(`Unknown language “${req.language}”.`)
  if (lang && !family.languages.includes(lang.id)) {
    throw new StudioError(`${family.name} doesn’t support ${lang.label}. Pick Auto-detect or another model.`)
  }

  let file = typeof req.audio === 'string' ? req.audio : ''
  let tmp = ''
  if (typeof req.audio !== 'string') {
    tmp = join(paths.tmp, `asr-${randomUUID()}.wav`)
    writeFileSync(tmp, req.audio)
    file = tmp
  }
  const modelPath = models.installedPath(model.id)!
  try {
    const res = await engine.request<{
      text: string
      segments: { start: number; end: number; text: string }[]
      language?: string | null
      duration: number
      processing_time: number
    }>('asr.transcribe', {
      model_path: modelPath,
      audio_path: file,
      language: lang ? (family.id === 'whisper' ? lang.code : lang.label) : undefined,
      task
    })
    engine.markLoaded(modelPath)
    const source = req.source ?? 'app'
    const t: Transcript = {
      id: `stt_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`,
      name: req.name?.trim() || (typeof req.audio === 'string' ? req.audio.split(/[\\/]/).pop()! : 'Audio'),
      text: res.text,
      segments: res.segments ?? [],
      language: languageLabel(res.language) ?? lang?.label,
      task,
      provider: family.id,
      modelId: model.id,
      durationSec: res.duration,
      processingSec: res.processing_time,
      createdAt: Date.now(),
      source,
      ...(keepOnlySaved(source) ? { saved: false } : {})
    }
    transcripts.add(t)
    return t
  } finally {
    if (tmp) rmSync(tmp, { force: true })
  }
}

/** Plain transcription for voice cloning (not recorded in the transcript list). */
export async function transcribe(audio: Uint8Array | string, language?: string): Promise<string> {
  const model = requireModel('transcribe')
  let file = typeof audio === 'string' ? audio : ''
  let tmp = ''
  if (typeof audio !== 'string') {
    tmp = join(paths.tmp, `asr-${randomUUID()}.wav`)
    writeFileSync(tmp, audio)
    file = tmp
  }
  const lang = language && language !== 'auto' ? STT_LANGUAGES.find((l) => l.id === language) : undefined
  try {
    const res = await engine.request<{ text: string }>('asr.transcribe', {
      model_path: models.installedPath(model.id),
      audio_path: file,
      language: lang ? (model.provider === 'whisper' ? lang.code : lang.label) : undefined
    })
    engine.markLoaded(models.installedPath(model.id)!)
    return res.text
  } finally {
    if (tmp) rmSync(tmp, { force: true })
  }
}

export async function cloneVoice(input: { name: string; description?: string; audio: Uint8Array | string; refText?: string }) {
  let refText = input.refText?.trim()
  if (!refText && models.installedWith('transcribe').length) {
    refText = await transcribe(input.audio).catch(() => undefined)
  }
  return voices.createCloned({ name: input.name, description: input.description, wav: input.audio, refText })
}

export function saveDesignedVoice(input: { name: string; description?: string; designPrompt: string; historyId: string }) {
  const item = history.get(input.historyId)
  if (!item) throw new StudioError('That preview no longer exists. Generate it again.')
  return voices.createDesigned({
    name: input.name,
    description: input.description,
    designPrompt: input.designPrompt,
    audioPath: item.audioPath,
    refText: item.text
  })
}

const PREVIEW_LINES: Record<string, string> = {
  english: "Hi, I'm {name}. This is how I sound when I read your text out loud.",
  chinese: '你好，我是{name}。这就是我朗读文字时的声音。',
  japanese: 'こんにちは、{name}です。これが私の声です。',
  korean: '안녕하세요, {name}입니다. 제 목소리는 이렇게 들려요.'
}

const previewJobs = new Map<string, Promise<string>>()

export async function previewVoice(id: string): Promise<string> {
  const voice = voices.find(id)
  if (!voice) throw new StudioError('Voice not found.')
  if (voice.previewAudio && existsSync(voice.previewAudio)) return voice.previewAudio
  if (voice.refAudio && existsSync(voice.refAudio)) return voice.refAudio
  const dir = join(paths.voices, 'previews')
  const file = join(dir, `${voice.id.replace(/[^\w-]/g, '_')}.wav`)
  if (existsSync(file)) return file
  const pending = previewJobs.get(file)
  if (pending) return pending
  const job = (async () => {
    const lang = (voice.language ?? 'english').toLowerCase()
    const line = (PREVIEW_LINES[lang] ?? PREVIEW_LINES.english).replace('{name}', voice.name)
    const item = await generate({ text: line, voiceId: voice.id, stream: false }, { ephemeral: true })
    mkdirSync(dir, { recursive: true })
    copyFileSync(item.audioPath, file)
    return file
  })().finally(() => previewJobs.delete(file))
  previewJobs.set(file, job)
  return job
}

export function playInApp(historyId: string) {
  bus.publish('playHistory', { id: historyId })
}

export function status() {
  const installed = models.list().filter((m) => m.install.status === 'installed')
  const has = (provider: string, cap: Capability) => installed.some((m) => m.provider === provider && m.capabilities.includes(cap))
  return {
    engine: engine.status,
    installedModels: installed.map((m) => ({ id: m.id, provider: m.provider, name: m.name, capabilities: m.capabilities, loaded: m.loaded })),
    providers: TTS_PROVIDERS.map((p) => ({
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      languages: p.languages,
      installed: installed.some((m) => m.provider === p.id),
      can: {
        builtInVoices: has(p.id, 'preset-voices'),
        styleInstructions: p.features.styleInstructions && installed.some((m) => m.provider === p.id && m.capabilities.includes('instruct') && m.capabilities.includes('preset-voices')),
        voiceCloning: has(p.id, 'voice-clone'),
        voiceDesign: has(p.id, 'voice-design')
      }
    })),
    transcription: ASR_PROVIDERS.map((p) => ({
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      installed: installed.some((m) => m.provider === p.id),
      can: { transcribe: has(p.id, 'transcribe'), translate: has(p.id, 'translate') }
    }))
  }
}
