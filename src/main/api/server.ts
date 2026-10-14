import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { app } from 'electron'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { ApiServerInfo } from '@shared/types'
import { bus } from '../events'
import { history } from '../library/history'
import { voices } from '../library/voices'
import { models } from '../models/manager'
import { paths } from '../paths'
import { getSettings } from '../settings'
import * as studio from '../services/studio'
import { createMcpServer } from './mcp'

/**
 * Local HTTP server (127.0.0.1 only):
 *   POST /mcp            Model Context Protocol (Streamable HTTP, stateless)
 *   GET  /api/status     engine + capabilities
 *   GET  /api/voices     voices
 *   GET  /api/models     models
 *   GET  /api/history    recent generations
 *   POST /api/tts        {text, voice?, provider?, instructions?, language?, model?, temperature?} → JSON (or WAV with ?format=wav)
 *   GET  /api/audio/:id  WAV file
 */

let server: Server | null = null
let info: ApiServerInfo = {
  running: false,
  port: 0,
  url: '',
  mcpUrl: '',
  bridgePath: '',
  nodeCommand: '',
  electronBinary: ''
}

export function getApiInfo(): ApiServerInfo {
  return info
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > 50 * 1024 * 1024) throw new Error('Body too large')
    chunks.push(c as Buffer)
  }
  if (!chunks.length) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Block browsers on other origins and DNS-rebinding attacks from driving the local API. */
function allowed(req: IncomingMessage, port: number) {
  const host = (req.headers.host ?? '').toLowerCase()
  const okHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]
  if (!okHosts.includes(host)) return false
  const origin = req.headers.origin
  if (!origin || origin === 'null') return true
  try {
    const u = new URL(origin)
    return ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
  } catch {
    return false
  }
}

function sendAudio(res: ServerResponse, file: string) {
  if (!existsSync(file)) return json(res, 404, { error: 'Audio not found' })
  res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': statSync(file).size })
  createReadStream(file).pipe(res)
}

async function handle(req: IncomingMessage, res: ServerResponse, port: number) {
  if (!allowed(req, port)) return json(res, 403, { error: 'Forbidden' })
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
  const baseUrl = `http://127.0.0.1:${port}`

  if (url.pathname === '/mcp') {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end()
      return
    }
    const body = await readBody(req)
    const mcp = createMcpServer(baseUrl)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      transport.close().catch(() => undefined)
      mcp.close().catch(() => undefined)
    })
    await mcp.connect(transport)
    await transport.handleRequest(req, res, body)
    return
  }

  if (url.pathname === '/' || url.pathname === '/api/health') {
    return json(res, 200, { name: 'Voiceify', version: app.getVersion(), mcp: `${baseUrl}/mcp` })
  }
  if (url.pathname === '/api/status' && req.method === 'GET') return json(res, 200, studio.status())
  if (url.pathname === '/api/voices' && req.method === 'GET') return json(res, 200, voices.list())
  if (url.pathname === '/api/models' && req.method === 'GET') return json(res, 200, models.list())
  if (url.pathname === '/api/history' && req.method === 'GET') {
    const limit = Number(url.searchParams.get('limit') ?? 50)
    return json(res, 200, history.list().slice(0, limit))
  }
  const audio = url.pathname.match(/^\/api\/audio\/([\w-]+)$/)
  if (audio && req.method === 'GET') {
    const item = history.get(audio[1])
    return item ? sendAudio(res, item.audioPath) : json(res, 404, { error: 'Unknown id' })
  }
  if (url.pathname === '/api/tts' && req.method === 'POST') {
    const b = ((await readBody(req)) ?? {}) as Record<string, unknown>
    try {
      const voice = typeof b.voice === 'string' ? voices.find(b.voice) : undefined
      if (b.voice && !voice) return json(res, 400, { error: `Unknown voice "${b.voice}"` })
      const item = await studio.generate({
        text: String(b.text ?? ''),
        voiceId: voice?.id,
        provider: typeof b.provider === 'string' ? b.provider : undefined,
        modelId: typeof b.model === 'string' ? b.model : undefined,
        stream: false,
        source: 'api',
        settings: {
          ...(typeof b.instructions === 'string' && { instruct: b.instructions }),
          ...(typeof b.language === 'string' && { language: b.language }),
          ...(typeof b.temperature === 'number' && { temperature: b.temperature })
        }
      })
      if (b.play === true) studio.playInApp(item.id)
      if (url.searchParams.get('format') === 'wav') return sendAudio(res, item.audioPath)
      return json(res, 200, { ...item, audio_url: `${baseUrl}/api/audio/${item.id}` })
    } catch (e) {
      const code = e instanceof studio.StudioError && e.code === 'no-model' ? 409 : 400
      return json(res, code, { error: e instanceof Error ? e.message : String(e) })
    }
  }
  json(res, 404, { error: 'Not found' })
}

export async function startApiServer() {
  await stopApiServer()
  const { apiPort, apiEnabled } = getSettings()
  const exe = process.execPath
  const base = {
    port: apiPort,
    url: `http://127.0.0.1:${apiPort}`,
    mcpUrl: `http://127.0.0.1:${apiPort}/mcp`,
    bridgePath: paths.mcpBridge,
    nodeCommand: 'node',
    electronBinary: exe
  }
  if (!apiEnabled) {
    info = { ...base, running: false }
    bus.publish('apiServer', info)
    return
  }
  await new Promise<void>((resolve) => {
    const s = createServer((req, res) => {
      handle(req, res, apiPort).catch((e) => {
        console.error('[api]', e)
        if (!res.headersSent) json(res, 500, { error: e instanceof Error ? e.message : String(e) })
        else res.end()
      })
    })
    s.requestTimeout = 0
    s.on('error', (e: NodeJS.ErrnoException) => {
      info = {
        ...base,
        running: false,
        error: e.code === 'EADDRINUSE' ? `Port ${apiPort} is already in use. Pick another port in Settings.` : e.message
      }
      bus.publish('apiServer', info)
      resolve()
    })
    s.listen(apiPort, '127.0.0.1', () => {
      server = s
      info = { ...base, running: true }
      bus.publish('apiServer', info)
      resolve()
    })
  })
}

export async function stopApiServer() {
  if (!server) return
  const s = server
  server = null
  const closed = new Promise<void>((r) => s.close(() => r()))
  s.closeAllConnections?.()
  await closed
}
