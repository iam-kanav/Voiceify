import { copyFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { StudioEvents, StudioInvoke } from '@shared/ipc'
import { engine } from './engine/client'
import { history } from './library/history'
import { transcripts } from './library/transcripts'
import { formatTranscript } from '@shared/subtitles'
import { voices } from './library/voices'
import { models } from './models/manager'
import { paths } from './paths'
import { getSettings, updateSettings } from './settings'
import { getSystemInfo } from './system'
import { getApiInfo, startApiServer } from './api/server'
import { getRemoteInfo, resetRemotePairing, startRemoteServer } from './remote/server'
import * as studio from './services/studio'

/** Who made a call: the app's own window, or a paired phone (see remote/server.ts). */
export interface CallContext {
  /** Sends an event to the caller only (e.g. the audio of the generation it started). */
  send<E extends keyof StudioEvents>(event: E, payload: StudioEvents[E]): void
  window?: BrowserWindow | null
  remote?: boolean
}

type Handlers = {
  [K in keyof StudioInvoke]: (
    ctx: CallContext,
    ...args: Parameters<StudioInvoke[K]>
  ) => ReturnType<StudioInvoke[K]> | Promise<ReturnType<StudioInvoke[K]>>
}

/** Mac-only actions (file dialogs, Finder) a phone can't use; it downloads files instead. */
const DESKTOP_ONLY = new Set<keyof StudioInvoke>(['exportAudio', 'exportTranscript', 'revealInFinder', 'openExternal', 'openDataFolder'])
/** Settings only the Mac itself may change. */
const MAC_ONLY_SETTINGS = ['apiPort', 'apiEnabled', 'remoteEnabled', 'remotePort', 'remoteToken', 'remoteKeepAwake'] as const

const handlers: Handlers = {
  getSystemInfo: () => getSystemInfo(),
  getSettings: () => getSettings(),
  updateSettings: async (ctx, patch) => {
    if (ctx.remote) patch = Object.fromEntries(Object.entries(patch).filter(([k]) => !(MAC_ONLY_SETTINGS as readonly string[]).includes(k)))
    const before = getSettings()
    const next = updateSettings(patch)
    if (patch.apiPort !== undefined || patch.apiEnabled !== undefined) {
      if (before.apiPort !== next.apiPort || before.apiEnabled !== next.apiEnabled) await startApiServer()
    }
    if (patch.remoteEnabled !== undefined || patch.remotePort !== undefined || patch.remoteKeepAwake !== undefined) {
      if (before.remoteEnabled !== next.remoteEnabled || before.remotePort !== next.remotePort || before.remoteKeepAwake !== next.remoteKeepAwake) {
        await startRemoteServer()
      }
    }
    if (patch.maxLoadedModels !== undefined) await engine.configure(next.maxLoadedModels).catch(() => undefined)
    if (patch.saveMode === 'all') {
      history.saveAll()
      transcripts.saveAll()
    }
    return next
  },

  getEngineStatus: () => engine.status,
  installEngine: () => {
    engine.install().catch(() => undefined)
  },
  restartEngine: () => {
    engine.restart().catch(() => undefined)
  },

  listModels: () => models.list(),
  installModel: (_e, id) => {
    models.install(id).catch((err) => console.error(err))
  },
  cancelInstall: (_e, id) => models.cancel(id),
  deleteModel: async (_e, id) => {
    await models.remove(id)
  },
  addCustomModel: (_e, repo) => models.addCustom(repo),
  unloadModels: async () => {
    await engine.unloadAll()
  },

  listVoices: () => voices.list(),
  createClonedVoice: (_e, input) =>
    studio.cloneVoice({ name: input.name, description: input.description, audio: input.audio, refText: input.refText }),
  saveDesignedVoice: (_e, input) => studio.saveDesignedVoice(input),
  updateVoice: (_e, id, patch) => voices.update(id, patch),
  deleteVoice: (_e, id) => voices.remove(id),
  transcribe: async (_e, audio) => ({ text: await studio.transcribe(audio) }),
  previewVoice: async (_e, id) => ({ path: await studio.previewVoice(id) }),

  generate: (ctx, req) =>
    studio.generate(req, {
      jobId: req.jobId,
      onChunk: (pcm, sampleRate) => ctx.send('generationChunk', { jobId: req.jobId, pcm: new Uint8Array(pcm), sampleRate })
    }),
  generateScript: (ctx, req) =>
    studio.generateScript(
      { ...req, source: 'app' },
      {
        jobId: req.jobId,
        onChunk: (pcm, sampleRate) => ctx.send('generationChunk', { jobId: req.jobId, pcm: new Uint8Array(pcm), sampleRate })
      }
    ),
  enhanceAudio: (ctx, req) =>
    studio.enhanceAudio(
      { ...req, source: 'app' },
      {
        jobId: req.jobId,
        onProgress: (step, total) => {
          ctx.send('generationProgress', { jobId: req.jobId, step, total })
        }
      }
    ),
  generateSoundEffect: (ctx, req) =>
    studio.generateSoundEffect(
      { ...req, source: 'app' },
      {
        jobId: req.jobId,
        onProgress: (step, total) => {
          ctx.send('generationProgress', { jobId: req.jobId, step, total })
        }
      }
    ),
  cancelGeneration: (_e, jobId) => studio.cancel(jobId),

  listHistory: () => history.list(),
  saveHistory: (_e, id) => history.save(id),
  deleteHistory: (_e, id) => history.remove(id),
  clearHistory: () => history.clear(),
  exportAudio: async (ctx, id) => {
    const item = history.get(id)
    if (!item) return null
    const win = ctx.window
    const safe = item.text.slice(0, 40).replace(/[^\w\- ]+/g, '').trim() || basename(item.audioPath, '.wav')
    const opts = { defaultPath: `${item.voiceName} - ${safe}.wav`, filters: [{ name: 'WAV audio', extensions: ['wav'] }] }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    copyFileSync(item.audioPath, res.filePath)
    return res.filePath
  },
  revealInFinder: (_e, p) => shell.showItemInFolder(p),

  transcribeAudio: (_e, req) => studio.transcribeAudio({ ...req, source: 'app' }),
  listTranscripts: () => transcripts.list(),
  updateTranscript: (_e, id, patch) => transcripts.update(id, patch),
  deleteTranscript: (_e, id) => transcripts.remove(id),
  exportTranscript: async (ctx, id, format) => {
    const t = transcripts.get(id)
    if (!t) return null
    const win = ctx.window
    const base = t.name.replace(/\.[^.]+$/, '').replace(/[^\w\- ]+/g, '').trim() || 'Transcript'
    const names = { txt: 'Text', srt: 'SubRip subtitles', vtt: 'WebVTT subtitles' }
    const opts = { defaultPath: `${base}.${format}`, filters: [{ name: names[format], extensions: [format] }] }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    writeFileSync(res.filePath, formatTranscript(t.text, t.segments, format), 'utf8')
    return res.filePath
  },

  getApiServerInfo: () => getApiInfo(),
  getRemoteInfo: () => getRemoteInfo(),
  resetRemotePairing: (ctx) => {
    if (ctx.remote) throw new Error('Pairing can only be reset on the Mac.')
    return resetRemotePairing()
  },
  openExternal: (_e, url) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  },
  openDataFolder: () => {
    shell.openPath(paths.root)
  }
}

/** Run one bridge method for a caller. Phones can't use the Mac-only ones. */
export async function callHandler(method: string, ctx: CallContext, args: unknown[]): Promise<unknown> {
  const fn = (handlers as Record<string, (ctx: CallContext, ...a: unknown[]) => unknown>)[method]
  if (!fn) throw new Error(`Unknown method: ${method}`)
  if (ctx.remote && DESKTOP_ONLY.has(method as keyof StudioInvoke)) throw new Error('That only works on the Mac.')
  return fn(ctx, ...args)
}

export function registerIpc() {
  for (const name of Object.keys(handlers)) {
    ipcMain.handle(`studio:${name}`, async (event, ...args) => {
      const ctx: CallContext = {
        send: (ev, payload) => {
          if (!event.sender.isDestroyed()) event.sender.send(`studio:event:${ev}`, payload)
        },
        window: BrowserWindow.fromWebContents(event.sender)
      }
      try {
        return { ok: true, value: await callHandler(name, ctx, args) }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    })
  }
}
