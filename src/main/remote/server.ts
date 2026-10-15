import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { hostname, networkInterfaces } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { powerSaveBlocker } from 'electron'
import QRCode from 'qrcode'
import type { StudioEvents } from '@shared/ipc'
import type { RemoteInfo } from '@shared/types'
import { formatTranscript, type TranscriptFormat } from '@shared/subtitles'
import { bus } from '../events'
import { history } from '../library/history'
import { transcripts } from '../library/transcripts'
import { paths } from '../paths'
import { getSettings, updateSettings } from '../settings'
import { callHandler, type CallContext } from '../ipc'

/**
 * Phone access: serves the full app to browsers on the same Wi-Fi, so a phone can use Voiceify
 * while this Mac does the work. Off by default. A phone pairs once by scanning a QR code that
 * carries a secret; after that every request must present it (as a cookie).
 *
 *   GET  /pair?code=…          pairs this browser, then opens the app
 *   GET  /                     the app (the same build the Mac window loads)
 *   POST /rpc/<method>         one bridge method (see src/shared/ipc.ts), args/result as JSON
 *   GET  /events?client=…      live events (Server-Sent Events), incl. this phone's generation audio
 *   GET  /media?p=<path>       audio from the data folder (supports Range, which Safari needs)
 *   GET  /download/audio/<id>  a generation as a WAV download
 *   GET  /download/transcript/<id>?format=txt|srt|vtt
 */

const DEFAULT_PORT = 47822
const COOKIE = 'voiceify_pair'
/** Live events every phone receives; a phone's own generation audio is sent to it alone. */
const BROADCAST: (keyof StudioEvents)[] = [
  'engineStatus',
  'modelProgress',
  'modelsChanged',
  'voicesChanged',
  'historyChanged',
  'transcriptsChanged',
  'apiServer',
  'remoteServer'
]
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.wav': 'audio/wav',
  '.webmanifest': 'application/manifest+json'
}

let server: Server | null = null
let blocker: number | null = null
let info: RemoteInfo = { enabled: false, running: false, port: DEFAULT_PORT, urls: [], pairUrl: '', qr: '' }
const clients = new Map<string, ServerResponse>()
const unsubscribers: (() => void)[] = []

export function getRemoteInfo(): RemoteInfo {
  return info
}

/** The pairing secret, made the first time phone access is used. */
function token(): string {
  const s = getSettings()
  if (s.remoteToken) return s.remoteToken
  const t = randomBytes(24).toString('base64url')
  updateSettings({ remoteToken: t })
  return t
}

export async function resetRemotePairing(): Promise<RemoteInfo> {
  updateSettings({ remoteToken: randomBytes(24).toString('base64url') })
  // Close open connections so already-paired phones stop working right away.
  for (const res of clients.values()) res.end()
  clients.clear()
  await startRemoteServer()
  return info
}

/** This Mac's addresses on the local network: Wi-Fi/Ethernet IPs first, then its Bonjour name. */
function addresses(): string[] {
  const ips: string[] = []
  const all = networkInterfaces()
  const names = Object.keys(all).sort((a, b) => Number(b === 'en0') - Number(a === 'en0'))
  for (const name of names) {
    for (const a of all[name] ?? []) {
      // Skip loopback, link-local and virtual adapters (VPNs, Docker…), which a phone can't reach.
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.') && /^(en|eth|wl)/.test(name)) ips.push(a.address)
    }
  }
  const host = hostname().replace(/\.local$/, '')
  return [...new Set(ips), `${host}.local`]
}

async function describe(running: boolean, error?: string): Promise<RemoteInfo> {
  const s = getSettings()
  const port = s.remotePort ?? DEFAULT_PORT
  const urls = addresses().map((a) => `http://${a}:${port}`)
  const pairUrl = `${urls[0]}/pair?code=${encodeURIComponent(token())}`
  const qr = running ? await QRCode.toDataURL(pairUrl, { margin: 1, width: 320, errorCorrectionLevel: 'M' }) : ''
  return { enabled: !!s.remoteEnabled, running, port, urls, pairUrl: running ? pairUrl : '', qr, error }
}

export async function startRemoteServer() {
  await stopRemoteServer()
  const s = getSettings()
  if (!s.remoteEnabled) {
    info = await describe(false)
    bus.publish('remoteServer', info)
    return
  }
  const port = s.remotePort ?? DEFAULT_PORT
  await new Promise<void>((done) => {
    const srv = createServer((req, res) => {
      handle(req, res).catch((e) => {
        console.error('[remote]', e)
        if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Something went wrong.')
        else res.end()
      })
    })
    srv.requestTimeout = 0
    srv.on('error', async (e: NodeJS.ErrnoException) => {
      info = await describe(false, e.code === 'EADDRINUSE' ? `Port ${port} is already in use by another app.` : e.message)
      bus.publish('remoteServer', info)
      done()
    })
    srv.listen(port, '0.0.0.0', async () => {
      server = srv
      for (const event of BROADCAST) {
        const fn = (payload: unknown) => broadcast(event, payload)
        bus.on(event, fn)
        unsubscribers.push(() => bus.off(event, fn))
      }
      if (s.remoteKeepAwake !== false) blocker = powerSaveBlocker.start('prevent-app-suspension')
      info = await describe(true)
      bus.publish('remoteServer', info)
      done()
    })
  })
}

export async function stopRemoteServer() {
  for (const off of unsubscribers.splice(0)) off()
  if (blocker !== null) {
    powerSaveBlocker.stop(blocker)
    blocker = null
  }
  for (const res of clients.values()) res.end()
  clients.clear()
  if (!server) return
  const srv = server
  server = null
  const closed = new Promise<void>((r) => srv.close(() => r()))
  srv.closeAllConnections?.()
  await closed
}

// ---------------------------------------------------------------------------------------------

function send(res: ServerResponse, status: number, type: string, body: string | Buffer, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers })
  res.end(body)
}

function paired(req: IncomingMessage): boolean {
  const cookie = (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))
  if (!cookie) return false
  const a = Buffer.from(decodeURIComponent(cookie.slice(COOKIE.length + 1)))
  const b = Buffer.from(token())
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Uint8Arrays (audio) don't survive JSON, so they travel as base64. */
function encode(v: unknown): unknown {
  if (v instanceof Uint8Array) return { $bytes: Buffer.from(v).toString('base64') }
  if (Array.isArray(v)) return v.map(encode)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]))
  return v
}

function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.$bytes === 'string' && Object.keys(o).length === 1) return new Uint8Array(Buffer.from(o.$bytes, 'base64'))
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decode(x)]))
  }
  return v
}

function emit(res: ServerResponse, event: string, payload: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(encode(payload))}\n\n`)
}

function broadcast(event: string, payload: unknown) {
  for (const res of clients.values()) emit(res, event, payload)
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    // Recordings for speech enhancement can be long; base64 adds a third.
    if (size > 400 * 1024 * 1024) throw new Error('That file is too large to send from the phone.')
    chunks.push(c as Buffer)
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

/** Only files inside Voiceify's data folder can be fetched. */
function dataFile(p: string | null): string | null {
  if (!p) return null
  const file = resolve(p)
  return file.startsWith(resolve(paths.root) + sep) && existsSync(file) ? file : null
}

function serveFile(req: IncomingMessage, res: ServerResponse, file: string, extra: Record<string, string> = {}) {
  const size = statSync(file).size
  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start >= size || start > end) {
      res.writeHead(416, { 'content-range': `bytes */${size}` })
      return res.end()
    }
    res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', ...extra })
    return createReadStream(file, { start, end }).pipe(res)
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', ...extra })
  createReadStream(file).pipe(res)
}

const attachment = (name: string) => ({ 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` })
const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().slice(0, 60)

const RENDERER = join(import.meta.dirname, '../renderer')
const PUBLIC = ['/manifest.webmanifest', '/apple-touch-icon.png', '/icon-512.png']

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://phone')

  if (url.pathname === '/pair') {
    const code = url.searchParams.get('code') ?? ''
    const ok = Buffer.from(code).length === Buffer.from(token()).length && timingSafeEqual(Buffer.from(code), Buffer.from(token()))
    if (!ok) return send(res, 403, 'text/html; charset=utf-8', page('That pairing code has expired', 'Open Voiceify on your Mac, go to Settings → Use on your phone, and scan the new code.'))
    res.writeHead(302, {
      'set-cookie': `${COOKIE}=${encodeURIComponent(code)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
      location: '/'
    })
    return res.end()
  }

  // The Home Screen icon and manifest are fetched without cookies; they reveal nothing.
  if (PUBLIC.includes(url.pathname)) return serveFile(req, res, join(RENDERER, url.pathname.slice(1)))

  if (!paired(req)) {
    if (url.pathname.startsWith('/rpc/') || url.pathname === '/events') return send(res, 401, 'application/json', JSON.stringify({ ok: false, error: 'This phone is no longer paired. Scan the code on your Mac again.' }))
    return send(res, 401, 'text/html; charset=utf-8', page('Pair this phone first', 'Open Voiceify on your Mac, go to Settings → Use on your phone, and scan the code with your phone’s camera.'))
  }

  if (req.method === 'POST' && url.pathname.startsWith('/rpc/')) {
    // A custom header can't be sent cross-site without a preflight we never answer, so other sites can't call this.
    if (req.headers['x-voiceify'] !== '1') return send(res, 403, 'application/json', '{"ok":false,"error":"Forbidden"}')
    const method = url.pathname.slice(5)
    const clientId = String(req.headers['x-voiceify-client'] ?? '')
    const ctx: CallContext = {
      remote: true,
      send: (event, payload) => {
        const c = clients.get(clientId)
        if (c) emit(c, event, payload)
      }
    }
    try {
      const body = (await readJson(req)) as { args?: unknown[] }
      const value = await callHandler(method, ctx, (decode(body.args ?? []) as unknown[]) ?? [])
      return send(res, 200, 'application/json', JSON.stringify({ ok: true, value: encode(value) }))
    } catch (err) {
      return send(res, 200, 'application/json', JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
    }
  }

  if (url.pathname === '/events') {
    const id = url.searchParams.get('client') ?? randomBytes(8).toString('hex')
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' })
    res.write(': connected\n\n')
    clients.get(id)?.end()
    clients.set(id, res)
    const ping = setInterval(() => res.write(': ping\n\n'), 20000)
    req.on('close', () => {
      clearInterval(ping)
      if (clients.get(id) === res) clients.delete(id)
    })
    return
  }

  if (url.pathname === '/media') {
    const file = dataFile(url.searchParams.get('p'))
    if (!file) return send(res, 404, 'text/plain', 'Not found')
    return serveFile(req, res, file)
  }

  const audio = url.pathname.match(/^\/download\/audio\/([\w-]+)$/)
  if (audio) {
    const item = history.get(audio[1])
    const file = item && dataFile(item.audioPath)
    if (!item || !file) return send(res, 404, 'text/plain', 'Not found')
    return serveFile(req, res, file, attachment(`${safeName(item.voiceName)} - ${safeName(item.text) || item.id}.wav`))
  }

  const tr = url.pathname.match(/^\/download\/transcript\/([\w-]+)$/)
  if (tr) {
    const t = transcripts.get(tr[1])
    const format = (['txt', 'srt', 'vtt'].includes(url.searchParams.get('format') ?? '') ? url.searchParams.get('format') : 'txt') as TranscriptFormat
    if (!t) return send(res, 404, 'text/plain', 'Not found')
    const name = `${safeName(t.name.replace(/\.[^.]+$/, '')) || 'Transcript'}.${format}`
    return send(res, 200, 'text/plain; charset=utf-8', formatTranscript(t.text, t.segments, format), attachment(name))
  }

  // The app itself. Unknown paths get index.html, so reloading any page works.
  if (req.method === 'GET') {
    const asset = resolve(RENDERER, '.' + decodeURIComponent(url.pathname))
    if (asset.startsWith(resolve(RENDERER) + sep) && existsSync(asset) && statSync(asset).isFile()) {
      return serveFile(req, res, asset, { 'cache-control': asset.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-store' })
    }
    const index = join(RENDERER, 'index.html')
    if (!existsSync(index)) return send(res, 503, 'text/plain; charset=utf-8', 'The app hasn’t been built yet (run npm run build).')
    return send(res, 200, 'text/html; charset=utf-8', readFileSync(index))
  }
  send(res, 404, 'text/plain', 'Not found')
}

/** A plain page for pairing problems, styled to match the app. */
function page(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Voiceify</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fff;color:#18181b;padding:24px;box-sizing:border-box}
@media (prefers-color-scheme:dark){body{background:#0b0b0c;color:#f4f4f5}p{color:#a1a1aa!important}}
div{max-width:340px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#71717a;font-size:15px;line-height:1.5;margin:0}</style></head>
<body><div><h1>${title}</h1><p>${body}</p></div></body></html>`
}
