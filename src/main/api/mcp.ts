import { readFileSync, existsSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { LANGUAGES } from '@shared/catalog'
import type { HistoryItem } from '@shared/types'
import { history } from '../library/history'
import { voices } from '../library/voices'
import { models } from '../models/manager'
import * as studio from '../services/studio'
import { providersForVoice, STT_LANGUAGES } from '@shared/providers'
import { formatTranscript } from '@shared/subtitles'

/**
 * The built-in MCP server. Any MCP client (Claude Code, Codex, OpenCode, Cursor, Zed, Claude
 * Desktop…) can drive the studio: list voices, synthesize speech, design and clone voices.
 * Served over Streamable HTTP at http://127.0.0.1:<port>/mcp and via the stdio bridge.
 */

const LANG_IDS = LANGUAGES.map((l) => l.id) as [string, ...string[]]

type Content = { type: 'text'; text: string } | { type: 'audio'; data: string; mimeType: string }

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] }
}

function fail(e: unknown) {
  return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true }
}

function describeItem(item: HistoryItem, baseUrl: string) {
  return [
    `Generated ${item.durationSec.toFixed(1)}s of audio in ${item.processingSec.toFixed(1)}s.`,
    `voice: ${item.voiceName}`,
    `model: ${item.modelId}`,
    `history_id: ${item.id}`,
    `file: ${item.audioPath}`,
    `url: ${baseUrl}/api/audio/${item.id}`
  ].join('\n')
}

function audioResult(item: HistoryItem, baseUrl: string, includeAudio: boolean) {
  const content: Content[] = [{ type: 'text', text: describeItem(item, baseUrl) }]
  if (includeAudio && existsSync(item.audioPath)) {
    content.push({ type: 'audio', data: readFileSync(item.audioPath).toString('base64'), mimeType: 'audio/wav' })
  }
  return { content }
}

export function createMcpServer(baseUrl: string) {
  const server = new McpServer(
    { name: 'voiceify', title: 'Voiceify', version: '0.2.0' },
    {
      instructions:
        'Voiceify: a local, multi-model voice studio running on this computer. Call list_voices to pick a voice, then text_to_speech. ' +
        'Audio is saved as WAV on disk; pass play=true to play it out loud in the app. Built-in voices accept natural-language ' +
        '`instructions` (emotion, pace, tone) when an instruction-capable model is installed. Use design_voice to invent a voice ' +
        'from a description and clone_voice to clone one from an audio file. get_status lists what the installed models can do.'
    }
  )

  server.registerTool(
    'get_status',
    {
      title: 'Studio status',
      description: 'Engine state, installed models and which capabilities are currently available.',
      inputSchema: {}
    },
    async () => text(JSON.stringify(studio.status(), null, 2))
  )

  server.registerTool(
    'list_voices',
    {
      title: 'List voices',
      description: 'List available voices: built-in model voices plus the user’s cloned and designed voices.',
      inputSchema: { kind: z.enum(['all', 'preset', 'cloned', 'designed']).optional().describe('Filter by voice type') }
    },
    async ({ kind }) => {
      const list = voices
        .list()
        .filter((v) => !kind || kind === 'all' || v.kind === kind)
        .map((v) => ({
          id: v.id,
          name: v.name,
          kind: v.kind,
          description: v.description,
          language: v.language,
          gender: v.gender,
          works_with: providersForVoice(v).map((p) => p.id),
          ...(v.kind !== 'preset' && { follows_instructions: !!v.fingerprint })
        }))
      return text(JSON.stringify(list, null, 2))
    }
  )

  server.registerTool(
    'list_models',
    {
      title: 'List models',
      description: 'List available models and variants, with provider, capabilities, size and install state.',
      inputSchema: { installed_only: z.boolean().optional() }
    },
    async ({ installed_only }) => {
      const list = models
        .list()
        .filter((m) => !installed_only || m.install.status === 'installed')
        .map((m) => ({
          id: m.id,
          name: m.name,
          provider: m.provider,
          official_name: m.officialName,
          capabilities: m.capabilities,
          size_gb: +(m.sizeBytes / 1e9).toFixed(2),
          status: m.install.status,
          recommended: m.recommended
        }))
      return text(JSON.stringify(list, null, 2))
    }
  )

  server.registerTool(
    'text_to_speech',
    {
      title: 'Text to speech',
      description:
        'Synthesize speech from text with a voice. Returns the saved WAV path and a local URL. Any length works; long text is split automatically.',
      inputSchema: {
        text: z.string().min(1).describe('The text to speak (any length; long text is split into segments automatically)'),
        voice: z.string().optional().describe('Voice id or name from list_voices (default: Ryan, or your newest voice)'),
        instructions: z
          .string()
          .optional()
          .describe('Style/emotion/pace instructions, e.g. "Very happy, speak quickly" (Qwen3-TTS: built-in voices, and your own voices via their fingerprint; needs Built-in Voices Large)'),
        language: z.enum(LANG_IDS).optional().describe('Language (default auto-detect; single-language models ignore it)'),
        provider: z
          .string()
          .optional()
          .describe('Model family to speak with, e.g. "qwen3-tts" (expressive, 10 languages) or "pocket-tts" (tiny, fast, English). Built-in voices belong to one family; your own voices work with any family that can clone.'),
        model: z.string().optional().describe('Specific model variant id from list_models'),
        temperature: z.number().min(0.1).max(1.5).optional().describe('Expressiveness / sampling temperature (default 0.9)'),
        play: z.boolean().optional().describe('Play the result out loud in the app'),
        include_audio: z.boolean().optional().describe('Also return the audio inline as base64 WAV')
      }
    },
    async (args) => {
      try {
        const voice = args.voice ? voices.find(args.voice) : undefined
        if (args.voice && !voice) return fail(`Unknown voice "${args.voice}". Call list_voices.`)
        const item = await studio.generate({
          text: args.text,
          voiceId: voice?.id,
          provider: args.provider,
          modelId: args.model,
          stream: false,
          source: 'mcp',
          settings: {
            ...(args.instructions !== undefined && { instruct: args.instructions }),
            ...(args.language && { language: args.language }),
            ...(args.temperature !== undefined && { temperature: args.temperature })
          }
        })
        if (args.play) studio.playInApp(item.id)
        return audioResult(item, baseUrl, !!args.include_audio)
      } catch (e) {
        return fail(e)
      }
    }
  )

  server.registerTool(
    'design_voice',
    {
      title: 'Design a voice',
      description:
        'Create a new voice from a natural-language description (requires a VoiceDesign model). Optionally save it to the voice library.',
      inputSchema: {
        description: z.string().min(5).describe('Voice description: age, gender, accent, timbre, emotion, pace…'),
        preview_text: z.string().min(1).describe('What the preview should say'),
        language: z.enum(LANG_IDS).optional(),
        save_as: z.string().optional().describe('If set, save the voice under this name'),
        play: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const item = await studio.generate(
          {
            text: args.preview_text,
            designPrompt: args.description,
            stream: false,
            source: 'mcp',
            settings: args.language ? { language: args.language } : undefined
          },
          { ephemeral: !args.save_as }
        )
        if (args.play) studio.playInApp(item.id)
        const res = audioResult(item, baseUrl, false)
        if (args.save_as) {
          const v = studio.saveDesignedVoice({ name: args.save_as, designPrompt: args.description, historyId: item.id })
          res.content.push({ type: 'text', text: `Saved as voice "${v.name}" (id: ${v.id}).` })
        }
        return res
      } catch (e) {
        return fail(e)
      }
    }
  )

  server.registerTool(
    'clone_voice',
    {
      title: 'Clone a voice',
      description:
        'Clone a voice from a local audio file (3–20 s of clean speech works best). If no transcript is given and a transcription model is installed, it is transcribed automatically.',
      inputSchema: {
        name: z.string().min(1),
        audio_path: z.string().describe('Absolute path to a WAV/MP3/FLAC file'),
        transcript: z.string().optional().describe('Exact words spoken in the clip (improves quality)'),
        description: z.string().optional()
      }
    },
    async (args) => {
      try {
        if (!existsSync(args.audio_path)) return fail(`File not found: ${args.audio_path}`)
        const v = await studio.cloneVoice({
          name: args.name,
          description: args.description,
          audio: args.audio_path,
          refText: args.transcript
        })
        return text(`Created voice "${v.name}" (id: ${v.id}).${v.refText ? `\nTranscript: ${v.refText}` : ''}`)
      } catch (e) {
        return fail(e)
      }
    }
  )

  server.registerTool(
    'transcribe_audio',
    {
      title: 'Transcribe audio',
      description:
        'Speech to text for a local audio file, run on this computer. Uses Qwen3-ASR or Whisper (whichever is installed, or the one you name). ' +
        'Whisper Large v3 can also translate speech in any language into English (task="translate"). ' +
        'format="srt"/"vtt" returns subtitles with timestamps; "json" returns text, segments and the detected language.',
      inputSchema: {
        audio_path: z.string().describe('Absolute path to an audio file (WAV, MP3, FLAC, M4A…)'),
        model: z.string().optional().describe('"qwen3-asr", "whisper", or a model id from list_models'),
        language: z
          .enum(['auto', ...STT_LANGUAGES.map((l) => l.id)] as [string, ...string[]])
          .optional()
          .describe('Spoken language; omit to auto-detect'),
        task: z.enum(['transcribe', 'translate']).optional(),
        format: z.enum(['text', 'srt', 'vtt', 'json']).optional()
      }
    },
    async ({ audio_path, model, language, task, format }) => {
      try {
        if (!existsSync(audio_path)) return fail(`File not found: ${audio_path}`)
        const t = await studio.transcribeAudio({ audio: audio_path, modelId: model, language, task, source: 'mcp' })
        if (format === 'json') {
          return text(JSON.stringify({ text: t.text, language: t.language, duration_sec: +t.durationSec.toFixed(2), model: t.modelId, segments: t.segments }, null, 2))
        }
        if (format === 'srt' || format === 'vtt') return text(formatTranscript(t.text, t.segments, format))
        return text(t.text)
      } catch (e) {
        return fail(e)
      }
    }
  )

  server.registerTool(
    'generate_sound_effect',
    {
      title: 'Generate a sound effect',
      description:
        'Text to sound effect, run on this computer with Stable Audio 3 Small SFX (powered by Stability AI). ' +
        'Describe the source, action and space (e.g. "a heavy wooden door slams in a stone hallway"). ' +
        'Returns 44.1 kHz stereo WAV file paths, one per take. Needs the Sound Effects model (see list_models).',
      inputSchema: {
        prompt: z.string().min(1).describe('What the sound is, in English'),
        seconds: z.number().min(0.5).max(120).optional().describe('Length of each take (default 5)'),
        takes: z.number().int().min(1).max(4).optional().describe('Variations to make in one pass (default 1)'),
        seed: z.number().int().min(0).optional().describe('Same seed + settings = same result'),
        prompt_strength: z.number().min(1).max(10).optional().describe('1 (default) = most natural; higher follows the prompt more literally'),
        avoid: z.string().optional().describe('Sounds to steer away from (used when prompt_strength > 1)'),
        play: z.boolean().optional().describe('Also play the first take in the Voiceify app')
      }
    },
    async ({ prompt, seconds, takes, seed, prompt_strength, avoid, play }) => {
      try {
        const items = await studio.generateSoundEffect({
          prompt,
          count: takes,
          seed,
          settings: { seconds, cfg: prompt_strength, negativePrompt: avoid },
          source: 'mcp'
        })
        if (play && items[0]) studio.playInApp(items[0].id)
        const s = items[0]?.sfx
        return text(
          `Made ${items.length} take${items.length === 1 ? '' : 's'} of "${prompt}" (${items[0].durationSec.toFixed(1)} s each, seed ${s?.seed}):\n` +
            items.map((h) => h.audioPath).join('\n')
        )
      } catch (e) {
        return fail(e)
      }
    }
  )

  server.registerTool(
    'list_history',
    {
      title: 'Generation history',
      description: 'Recent generations with their file paths.',
      inputSchema: { limit: z.number().int().min(1).max(200).optional() }
    },
    async ({ limit }) =>
      text(
        JSON.stringify(
          history
            .list()
            .slice(0, limit ?? 20)
            .map((h) => ({
              id: h.id,
              text: h.text.slice(0, 200),
              voice: h.voiceName,
              duration_sec: +h.durationSec.toFixed(2),
              file: h.audioPath,
              created_at: new Date(h.createdAt).toISOString()
            })),
          null,
          2
        )
      )
  )

  server.registerTool(
    'play_audio',
    {
      title: 'Play audio in app',
      description: 'Play a previous generation out loud in the studio app.',
      inputSchema: { history_id: z.string() }
    },
    async ({ history_id }) => {
      if (!history.get(history_id)) return fail('Unknown history_id')
      studio.playInApp(history_id)
      return text('Playing.')
    }
  )

  server.registerTool(
    'install_model',
    {
      title: 'Install a model',
      description: 'Start downloading a model by id (see list_models). Returns immediately; poll list_models for progress.',
      inputSchema: { model_id: z.string() }
    },
    async ({ model_id }) => {
      const m = models.get(model_id)
      if (!m) return fail(`Unknown model id "${model_id}".`)
      models.install(model_id).catch(() => undefined)
      return text(`Downloading ${m.name} (${(m.sizeBytes / 1e9).toFixed(1)} GB) in the background.`)
    }
  )

  return server
}
