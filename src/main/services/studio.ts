import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Capability, GenerateRequest, GenerationMode, GenerationSettings, HistoryItem, ModelVariant, Voice } from '@shared/types'
import { DEFAULT_GENERATION } from '@shared/voices'
import { engine } from '../engine/client'
import { bus } from '../events'
import { history } from '../library/history'
import { voices } from '../library/voices'
import { models } from '../models/manager'
import { paths } from '../paths'
import { getSettings } from '../settings'

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
  transcribe: { task: 'transcribe audio', model: 'Transcription' }
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
  voice?: Voice
  voiceName: string
  params: Record<string, unknown>
}

function requireModel(cap: Capability, preferredId?: string): ModelVariant {
  if (preferredId) {
    const m = models.get(preferredId)
    if (m && models.installedPath(m.id) && !m.capabilities.includes(cap)) {
      throw new StudioError(`${m.name} can't ${CAP_NEEDS[cap].task}. Pick a ${CAP_NEEDS[cap].model} model instead.`)
    }
  }
  const model = models.resolve(cap, preferredId)
  if (!model) {
    throw new StudioError(`To ${CAP_NEEDS[cap].task}, download a ${CAP_NEEDS[cap].model} model on the Models page.`, 'no-model')
  }
  return model
}

function defaultVoice(): Voice {
  // Prefer a preset when a CustomVoice model exists, otherwise the newest personal voice.
  if (models.installedWith('preset-voices').length) return voices.find('preset:ryan')!
  const own = voices.list().find((v) => v.kind !== 'preset')
  return own ?? voices.find('preset:ryan')!
}

function plan(req: GenerateRequest, settings: GenerationSettings): Plan {
  const base = {
    temperature: settings.temperature,
    top_p: settings.topP,
    top_k: settings.topK,
    repetition_penalty: settings.repetitionPenalty,
    language: settings.language
  }

  if (req.designPrompt && !req.voiceId) {
    const model = requireModel('voice-design', req.modelId)
    return { mode: 'design', model, voiceName: 'Voice Design', params: { ...base, instruct: req.designPrompt } }
  }

  const voice = req.voiceId ? voices.find(req.voiceId) : defaultVoice()
  if (!voice) throw new StudioError(`The voice "${req.voiceId}" no longer exists. Pick another voice.`)

  if (voice.kind === 'preset') {
    const model = requireModel('preset-voices', req.modelId)
    const instruct = model.capabilities.includes('instruct') ? settings.instruct?.trim() : undefined
    return {
      mode: 'preset',
      model,
      voice,
      voiceName: voice.name,
      params: { ...base, voice: voice.speaker, instruct: instruct || undefined }
    }
  }

  // Designed voices replay through the Base model (consistent timbre) when available,
  // otherwise fall back to re-describing them to VoiceDesign.
  const wantsDesign =
    voice.kind === 'designed' &&
    voice.designPrompt &&
    (models.get(req.modelId ?? '')?.capabilities.includes('voice-design') || !models.installedWith('voice-clone').length)
  if (wantsDesign) {
    const model = requireModel('voice-design', req.modelId)
    return { mode: 'design', model, voice, voiceName: voice.name, params: { ...base, instruct: voice.designPrompt } }
  }

  const model = requireModel('voice-clone', req.modelId)
  if (!voice.refAudio) throw new StudioError(`“${voice.name}” is missing its reference audio. Clone it again from Create Voice.`)
  return {
    mode: 'clone',
    model,
    voice,
    voiceName: voice.name,
    params: { ...base, ref_audio: voice.refAudio, ref_text: voice.refText || undefined }
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

  const settings: GenerationSettings = { ...DEFAULT_GENERATION, ...getSettings().defaultGeneration, ...req.settings }
  const p = plan(req, settings)
  const modelPath = models.installedPath(p.model.id)!
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
    { ...p.params, model_path: modelPath, text, out_path: outPath, stream: req.stream !== false },
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
    modelId: p.model.id,
    mode: p.mode,
    settings: { ...settings, instruct: (p.params.instruct as string) ?? '' },
    audioPath: outPath,
    durationSec: result.duration,
    sampleRate: result.sample_rate,
    processingSec: result.processing_time,
    rtf: result.rtf,
    createdAt: Date.now(),
    source: req.source ?? 'app',
    ephemeral: opts.ephemeral ?? (p.mode === 'design' && !req.voiceId)
  }
  history.add(item)
  return item
}

export function cancel(jobId: string) {
  engine.cancel(jobId)
}

export async function transcribe(audio: Uint8Array | string, language?: string): Promise<string> {
  const model = requireModel('transcribe')
  let file = typeof audio === 'string' ? audio : ''
  let tmp = ''
  if (typeof audio !== 'string') {
    tmp = join(paths.tmp, `asr-${randomUUID()}.wav`)
    writeFileSync(tmp, audio)
    file = tmp
  }
  try {
    const res = await engine.request<{ text: string }>('asr.transcribe', {
      model_path: models.installedPath(model.id),
      audio_path: file,
      language
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
  return {
    engine: engine.status,
    installedModels: installed.map((m) => ({ id: m.id, name: m.name, capabilities: m.capabilities, loaded: m.loaded })),
    capabilities: {
      presetVoices: installed.some((m) => m.capabilities.includes('preset-voices')),
      styleInstructions: installed.some((m) => m.capabilities.includes('instruct') && m.capabilities.includes('preset-voices')),
      voiceDesign: installed.some((m) => m.capabilities.includes('voice-design')),
      voiceClone: installed.some((m) => m.capabilities.includes('voice-clone')),
      transcription: installed.some((m) => m.capabilities.includes('transcribe'))
    }
  }
}
