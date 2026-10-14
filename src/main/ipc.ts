import { copyFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { StudioInvoke } from '@shared/ipc'
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
import * as studio from './services/studio'

type Handlers = {
  [K in keyof StudioInvoke]: (
    event: Electron.IpcMainInvokeEvent,
    ...args: Parameters<StudioInvoke[K]>
  ) => ReturnType<StudioInvoke[K]> | Promise<ReturnType<StudioInvoke[K]>>
}

const handlers: Handlers = {
  getSystemInfo: () => getSystemInfo(),
  getSettings: () => getSettings(),
  updateSettings: async (_e, patch) => {
    const before = getSettings()
    const next = updateSettings(patch)
    if (patch.apiPort !== undefined || patch.apiEnabled !== undefined) {
      if (before.apiPort !== next.apiPort || before.apiEnabled !== next.apiEnabled) await startApiServer()
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

  generate: (e, req) =>
    studio.generate(req, {
      jobId: req.jobId,
      onChunk: (pcm, sampleRate) => {
        if (!e.sender.isDestroyed()) {
          e.sender.send('studio:event:generationChunk', { jobId: req.jobId, pcm: new Uint8Array(pcm), sampleRate })
        }
      }
    }),
  cancelGeneration: (_e, jobId) => studio.cancel(jobId),

  listHistory: () => history.list(),
  saveHistory: (_e, id) => history.save(id),
  deleteHistory: (_e, id) => history.remove(id),
  clearHistory: () => history.clear(),
  exportAudio: async (e, id) => {
    const item = history.get(id)
    if (!item) return null
    const win = BrowserWindow.fromWebContents(e.sender)
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
  exportTranscript: async (e, id, format) => {
    const t = transcripts.get(id)
    if (!t) return null
    const win = BrowserWindow.fromWebContents(e.sender)
    const base = t.name.replace(/\.[^.]+$/, '').replace(/[^\w\- ]+/g, '').trim() || 'Transcript'
    const names = { txt: 'Text', srt: 'SubRip subtitles', vtt: 'WebVTT subtitles' }
    const opts = { defaultPath: `${base}.${format}`, filters: [{ name: names[format], extensions: [format] }] }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    writeFileSync(res.filePath, formatTranscript(t.text, t.segments, format), 'utf8')
    return res.filePath
  },

  getApiServerInfo: () => getApiInfo(),
  openExternal: (_e, url) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  },
  openDataFolder: () => {
    shell.openPath(paths.root)
  }
}

export function registerIpc() {
  for (const [name, fn] of Object.entries(handlers)) {
    ipcMain.handle(`studio:${name}`, async (event, ...args) => {
      try {
        return { ok: true, value: await (fn as (...a: unknown[]) => unknown)(event, ...args) }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    })
  }
}
