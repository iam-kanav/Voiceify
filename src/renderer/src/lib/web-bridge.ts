import { INVOKE_METHODS, type StudioApi } from '@shared/ipc'

/**
 * In a phone's browser there's no Electron preload, so `window.studio` talks to the Mac over the
 * phone-access server instead (src/main/remote/server.ts): methods become POST /rpc/<method>,
 * events arrive over Server-Sent Events. Imported first in main.tsx so it exists before anything
 * reads `window.studio`.
 */

function toBase64(bytes: Uint8Array) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(b64: string) {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

const encode = (v: unknown): unknown =>
  v instanceof Uint8Array
    ? { $bytes: toBase64(v) }
    : Array.isArray(v)
      ? v.map(encode)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]))
        : v

const decode = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(decode)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.$bytes === 'string' && Object.keys(o).length === 1) return fromBase64(o.$bytes)
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decode(x)]))
  }
  return v
}

/** Save a file from the Mac: the share sheet where there is one (save to Files, AirDrop…), else a download. */
async function deliver(url: string, fallbackName: string): Promise<string | null> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Couldn’t get the file from your Mac.')
  const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1]
  const file = new File([await res.blob()], name ? decodeURIComponent(name) : fallbackName, { type: res.headers.get('content-type') ?? '' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return null
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
  return 'Saved to your Downloads'
}

if (!window.studio) {
  // Generation audio is sent to the phone that asked for it; this id says which one that is.
  const client = Math.random().toString(36).slice(2) + Date.now().toString(36)
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  const source = new EventSource(`/events?client=${client}`)
  const listen = (event: string) => {
    if (listeners.has(event)) return
    listeners.set(event, new Set())
    source.addEventListener(event, (e) => {
      const payload = decode(JSON.parse((e as MessageEvent).data))
      for (const cb of listeners.get(event) ?? []) cb(payload)
    })
  }

  const call = async (method: string, args: unknown[]) => {
    const res = await fetch(`/rpc/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-voiceify': '1', 'x-voiceify-client': client },
      body: JSON.stringify({ args: encode(args) })
    })
    const body = (await res.json().catch(() => ({ ok: false, error: 'Lost the connection to your Mac.' }))) as { ok: boolean; value?: unknown; error?: string }
    if (!body.ok) throw new Error(body.error)
    return decode(body.value)
  }

  const api: Record<string, unknown> = {
    platform: 'web',
    on(event: string, cb: (payload: unknown) => void) {
      listen(event)
      listeners.get(event)!.add(cb)
      return () => listeners.get(event)?.delete(cb)
    }
  }
  for (const method of INVOKE_METHODS) api[method] = (...args: unknown[]) => call(method, args)
  Object.assign(api, {
    exportAudio: (id: string) => deliver(`/download/audio/${encodeURIComponent(id)}`, 'Voiceify.wav'),
    exportTranscript: (id: string, format: string) => deliver(`/download/transcript/${encodeURIComponent(id)}?format=${format}`, `Transcript.${format}`),
    openExternal: async (url: string) => {
      if (/^https?:\/\//.test(url)) window.open(url, '_blank', 'noopener')
    },
    revealInFinder: async () => undefined,
    openDataFolder: async () => undefined
  })
  window.studio = api as StudioApi
}

export {}
