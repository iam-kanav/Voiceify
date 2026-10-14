import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Capability, GenerateRequest, GenerationMode, GenerationSettings, HistoryItem, ModelVariant, Provider, ScriptPart, ScriptRequest, SoundEffectRequest, SoundEffectSettings, TranscribeRequest, Transcript, Voice } from '@shared/types'
import { parseScript, resolveSpeaker } from '@shared/script'
import { ASR_PROVIDERS, DEFAULT_PROVIDER, paramsFor, PROVIDER_BY_ID, providersForVoice, SFX_PROVIDERS, STT_LANGUAGES, TTS_PROVIDERS } from '@shared/providers'
import { DEFAULT_GENERATION } from '@shared/voices'
import { engine } from '../engine/client'
import { bus } from '../events'
import { history } from '../library/history'
import { transcripts } from '../library/transcripts'
import { voices } from '../library/voices'
import { readWav, resample, toMono, writeWav } from '../library/wav'
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
  translate: { task: 'translate speech into English', model: 'Whisper Large' },
  'sound-effects': { task: 'generate sound effects', model: 'Sound Effects' }
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
  const script = scriptJobs.get(jobId)
  if (script) {
    script.cancelled = true
    if (script.current) engine.cancel(script.current)
    return
  }
  engine.cancel(jobId)
}

const scriptJobs = new Map<string, { cancelled: boolean; current?: string }>()

/**
 * Script mode: each `[@Name]:` section is spoken by that voice (with its own model family), then
 * the pieces are joined with a short pause into one clip and one history item. Streams as it goes.
 */
export async function generateScript(req: ScriptRequest, opts: GenerateOptions = {}): Promise<HistoryItem> {
  const segments = parseScript(req.script ?? '')
  if (!segments.length) throw new StudioError('The script is empty.')
  const pauseSec = Math.min(3, Math.max(0, req.pauseSec ?? 0.35))
  const all = voices.list()
  const defaultV = req.defaultVoiceId ? voices.find(req.defaultVoiceId) : defaultVoice(req.provider)
  if (!defaultV) throw new StudioError(`The voice "${req.defaultVoiceId}" no longer exists. Pick another voice.`)

  // Resolve every line before generating anything, so a typo fails fast.
  const lines = segments.map((s) => {
    const voice = s.speaker ? resolveSpeaker(s.speaker, all, req.provider) : defaultV
    if (!voice) {
      throw new StudioError(`Line ${s.line}: there’s no voice called “${s.speaker}”. Use the name of a built-in voice or one of yours (e.g. [@Ryan]).`)
    }
    const provider = pickProvider(voice, voice.kind === 'preset' ? undefined : req.provider)
    const base = req.settingsByProvider?.[provider.id] ?? {}
    // Panel instructions direct the default voice; a tag's style directs its own line.
    const instruct = s.speaker ? (s.style ?? '') : (s.style ?? base.instruct ?? '')
    return { seg: s, voice, provider, settings: { ...base, instruct }, modelId: req.modelByProvider?.[provider.id] }
  })

  const scriptId = opts.jobId ?? `script_${randomUUID().slice(0, 8)}`
  const state = { cancelled: false, current: undefined as string | undefined }
  scriptJobs.set(scriptId, state)
  const made: HistoryItem[] = []
  try {
    for (const [i, l] of lines.entries()) {
      if (state.cancelled) throw new StudioError('Generation cancelled.')
      state.current = `${scriptId}_${i}`
      const item = await generate(
        { text: l.seg.text, voiceId: l.voice.id, provider: l.provider.id, modelId: l.modelId, settings: l.settings, stream: req.stream, source: req.source },
        { jobId: state.current, onChunk: opts.onChunk, ephemeral: true }
      )
      made.push(item)
      if (opts.onChunk && i < lines.length - 1 && pauseSec > 0) {
        opts.onChunk(Buffer.alloc(Math.round(pauseSec * item.sampleRate) * 2), item.sampleRate)
      }
    }

    // Stitch the lines into one mono clip at the first line's rate.
    const rate = made[0].sampleRate
    const clips = made.map((h) => resample(toMono(readWav(h.audioPath)), rate).data)
    const gap = Math.round(pauseSec * rate)
    const total = clips.reduce((n, c) => n + c.length, 0) + gap * (clips.length - 1)
    const data = new Int16Array(total)
    const parts: ScriptPart[] = []
    let at = 0
    clips.forEach((c, i) => {
      data.set(c, at)
      const h = made[i]
      parts.push({
        voiceId: h.voiceId,
        voiceName: h.voiceName,
        provider: h.provider ?? lines[i].provider.id,
        modelId: h.modelId,
        mode: h.mode,
        text: lines[i].seg.text,
        style: lines[i].seg.style,
        start: at / rate,
        end: (at + c.length) / rate
      })
      at += c.length + gap
    })
    const id = `gen_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`
    const outPath = history.audioPathFor(id)
    writeWav(outPath, { sampleRate: rate, channels: 1, data })

    const names = [...new Set(parts.map((p) => p.voiceName))]
    const processing = made.reduce((n, h) => n + h.processingSec, 0)
    const duration = total / rate
    const first = made[0]
    const source = req.source ?? 'app'
    const item: HistoryItem = {
      id,
      text: req.script.trim(),
      provider: first.provider,
      voiceId: first.voiceId,
      voiceName: names.length <= 2 ? names.join(' & ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`,
      modelId: first.modelId,
      mode: 'script',
      settings: first.settings,
      audioPath: outPath,
      durationSec: duration,
      sampleRate: rate,
      processingSec: processing,
      rtf: processing / Math.max(0.001, duration),
      coldStart: made.some((h) => h.coldStart),
      createdAt: Date.now(),
      source,
      script: { pauseSec, segments: parts }
    }
    if (keepOnlySaved(source)) item.saved = false
    history.add(item)
    return item
  } finally {
    scriptJobs.delete(scriptId)
    for (const h of made) history.remove(h.id)
  }
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

export const SFX_DEFAULTS: SoundEffectSettings = { seconds: 5, steps: 8, cfg: 1 }
export const SFX_LIMITS = { seconds: [0.5, 120], steps: [1, 50], cfg: [1, 10], count: [1, 4] } as const

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v))

export interface SoundEffectOptions {
  jobId?: string
  onProgress?: (step: number, total: number) => void
}

/** Text → sound effects. Makes `count` variations in one pass; each becomes a history item. */
export async function generateSoundEffect(req: SoundEffectRequest, opts: SoundEffectOptions = {}): Promise<HistoryItem[]> {
  const prompt = (req.prompt ?? '').trim()
  if (!prompt) throw new StudioError('Describe the sound you want.')
  const ref = parseModelRef(req.modelId)
  const family = ref.provider ? PROVIDER_BY_ID.get(ref.provider) : undefined
  if (family && family.task !== 'sfx') throw new StudioError(`“${family.name}” doesn’t make sound effects.`)
  const model = requireModel('sound-effects', ref.modelId, family)
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && isFinite(v) ? v : fallback)
  const settings: SoundEffectSettings = {
    seconds: clamp(num(req.settings?.seconds, SFX_DEFAULTS.seconds), SFX_LIMITS.seconds),
    steps: Math.round(clamp(num(req.settings?.steps, SFX_DEFAULTS.steps), SFX_LIMITS.steps)),
    cfg: clamp(num(req.settings?.cfg, SFX_DEFAULTS.cfg), SFX_LIMITS.cfg),
    negativePrompt: req.settings?.negativePrompt?.trim() || undefined
  }
  const count = Math.round(clamp(num(req.count, 1), SFX_LIMITS.count))
  const seed = Number.isInteger(req.seed) ? (req.seed as number) : Math.floor(Math.random() * 2 ** 31)
  const ids = Array.from({ length: count }, (_, i) => `sfx_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}_${i + 1}`)
  const modelPath = models.installedPath(model.id)!
  const coldStart = !engine.isLoaded(modelPath)
  const jobId = opts.jobId ?? ids[0]

  const result = await engine.request<{ cancelled?: boolean; duration: number; sample_rate: number; processing_time: number }>(
    'sfx.generate',
    {
      model_path: modelPath,
      prompt,
      seconds: settings.seconds,
      steps: settings.steps,
      cfg: settings.cfg,
      negative_prompt: settings.cfg > 1 ? settings.negativePrompt : undefined,
      seed,
      out_paths: ids.map((id) => history.audioPathFor(id))
    },
    {
      id: jobId,
      onEvent: (event, data) => {
        if (event === 'progress' && opts.onProgress) {
          const d = data as { step: number; total: number }
          opts.onProgress(d.step, d.total)
        }
      }
    }
  )
  engine.markLoaded(modelPath)
  if (result.cancelled) throw new StudioError('Generation cancelled.')

  const source = req.source ?? 'app'
  const now = Date.now()
  const items: HistoryItem[] = ids.map((id, i) => ({
    id,
    text: prompt,
    provider: model.provider,
    voiceName: count > 1 ? `Sound effect · take ${i + 1}` : 'Sound effect',
    modelId: model.id,
    mode: 'sfx',
    settings: { language: 'english', params: {} },
    audioPath: history.audioPathFor(id),
    durationSec: result.duration,
    sampleRate: result.sample_rate,
    // One pass made every take, so each take's share of the time is what reflects speed.
    processingSec: result.processing_time / count,
    rtf: result.processing_time / count / Math.max(0.001, result.duration),
    coldStart,
    createdAt: now - i,
    source,
    sfx: { ...settings, seed, variation: i + 1, of: count },
    ...(keepOnlySaved(source) ? { saved: false } : {})
  }))
  // History lists newest first; add the last take first so take 1 ends up on top.
  for (const item of [...items].reverse()) history.add(item)
  return items
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
    })),
    soundEffects: SFX_PROVIDERS.map((p) => ({
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      installed: installed.some((m) => m.provider === p.id && m.capabilities.includes('sound-effects'))
    }))
  }
}
