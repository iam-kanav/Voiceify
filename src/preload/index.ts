import { contextBridge, ipcRenderer } from 'electron'
import { INVOKE_METHODS, type StudioApi } from '@shared/ipc'

const api: Record<string, unknown> = {
  platform: process.platform,
  on(event: string, cb: (payload: unknown) => void) {
    const channel = `studio:event:${event}`
    const listener = (_: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

for (const method of INVOKE_METHODS) {
  api[method] = async (...args: unknown[]) => {
    const res = (await ipcRenderer.invoke(`studio:${method}`, ...args)) as { ok: boolean; value?: unknown; error?: string }
    if (!res.ok) throw new Error(res.error)
    return res.value
  }
}

contextBridge.exposeInMainWorld('studio', api as StudioApi)
