#!/usr/bin/env node
// Voiceify — MCP stdio bridge.
//
// Lets stdio-only MCP clients talk to the studio's built-in Streamable HTTP MCP server.
// Dependency-free: run it with any Node ≥ 18, or with the app's own binary:
//   ELECTRON_RUN_AS_NODE=1 "/Applications/Voiceify.app/Contents/MacOS/Voiceify" stdio-bridge.mjs
//
// Options: --port <n> (default 47821) or VOICEIFY_URL=http://127.0.0.1:47821/mcp

import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'

const argPort = (() => {
  const i = process.argv.indexOf('--port')
  return i > -1 ? process.argv[i + 1] : undefined
})()
const URL_ = process.env.VOICEIFY_URL || `http://127.0.0.1:${argPort || process.env.VOICEIFY_PORT || 47821}/mcp`
const BUNDLE_ID = 'com.kanavsethi.voiceify'

let launched = false
let inflight = 0
let closed = false
const out = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')
const err = (...a) => process.stderr.write(`[voiceify] ${a.join(' ')}\n`)

async function post(body) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body)
  })
  if (res.status === 202 || res.status === 204) return []
  const type = res.headers.get('content-type') || ''
  const text = await res.text()
  if (!res.ok && !type.includes('json')) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  if (type.includes('text/event-stream')) {
    return text
      .split(/\n\n/)
      .map((block) =>
        block
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('')
      )
      .filter(Boolean)
      .map((d) => JSON.parse(d))
  }
  if (!text) return []
  const parsed = JSON.parse(text)
  return Array.isArray(parsed) ? parsed : [parsed]
}

function launchApp() {
  if (launched || process.platform !== 'darwin') return
  launched = true
  err('Studio not reachable — launching the app…')
  spawn('/usr/bin/open', ['-g', '-b', BUNDLE_ID], { stdio: 'ignore', detached: true }).unref()
}

async function forward(msg) {
  const deadline = Date.now() + 45_000
  for (;;) {
    try {
      for (const m of await post(msg)) out(m)
      return
    } catch (e) {
      const refused = e?.cause?.code === 'ECONNREFUSED' || /fetch failed/.test(String(e?.message))
      if (refused && Date.now() < deadline) {
        launchApp()
        await new Promise((r) => setTimeout(r, 1000))
        continue
      }
      err(String(e?.message || e))
      if (msg && msg.id !== undefined) {
        out({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32000, message: `Voiceify is not reachable at ${URL_}. Is the app running with the API enabled?` }
        })
      }
      return
    }
  }
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (!line.trim()) return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return err('Ignoring non-JSON input')
  }
  inflight++
  forward(msg).finally(() => {
    inflight--
    if (closed && inflight === 0) process.exit(0)
  })
})
rl.on('close', () => {
  closed = true
  if (inflight === 0) process.exit(0)
})
