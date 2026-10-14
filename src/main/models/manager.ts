import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { once } from 'node:events'
import { join, dirname } from 'node:path'
import { CATALOG, CATALOG_BY_ID, PRECISION_INFO, recommendationsFor, ROLES } from '@shared/catalog'
import { history } from '../library/history'
import type { Capability, InstallState, ModelInfo, ModelVariant } from '@shared/types'
import { bus } from '../events'
import { paths } from '../paths'
import { JsonStore } from '../store'
import { getSettings } from '../settings'
import { freeDiskGB, getSystemInfo } from '../system'
import { engine } from '../engine/client'

interface InstalledRecord {
  path: string
  installedAt: number
  sizeBytes: number
}

interface HfFile {
  path: string
  size: number
}

const HF = 'https://huggingface.co'
const SKIP = [/^samples\//, /\.(wav|mp3|flac|png|jpg|gif)$/i, /^\.gitattributes$/]

class ModelManager {
  private installed = new JsonStore<Record<string, InstalledRecord>>('models', {})
  private custom = new JsonStore<ModelVariant[]>('custom-models', [])
  private transient = new Map<string, InstallState>()
  /** Installs in flight, persisted so they resume after a restart. */
  private pending = new JsonStore<string[]>('pending-installs', [])
  private controllers = new Map<string, AbortController>()

  /** Reconcile the registry with what is actually on disk. */
  init() {
    const rec = { ...this.installed.get() }
    let changed = false
    for (const [id, r] of Object.entries(rec)) {
      if (!existsSync(join(r.path, 'config.json'))) {
        delete rec[id]
        changed = true
      }
    }
    if (changed) this.installed.set(rec)
  }

  /** Resume downloads that were interrupted by quitting the app. */
  resumePending() {
    for (const id of this.pending.get()) {
      if (!this.installedPath(id)) this.install(id).catch((e) => console.error(`[models] resume ${id}`, e))
    }
    this.pending.set(this.pending.get().filter((id) => !this.installedPath(id)))
  }

  variants(): ModelVariant[] {
    const custom = this.custom.get().map((m) => ({
      ...m,
      role: m.role ?? ROLES.custom.label,
      roleId: m.roleId ?? 'custom',
      sizeLabel: m.sizeLabel ?? 'Large',
      precisionLabel: m.precisionLabel ?? m.quant,
      summary: m.summary ?? '',
      officialName: m.officialName ?? m.source.repo
    }))
    return [...CATALOG, ...custom]
  }

  get(id: string): ModelVariant | undefined {
    return CATALOG_BY_ID.get(id) ?? this.custom.get().find((m) => m.id === id)
  }

  installState(id: string): InstallState {
    const t = this.transient.get(id)
    if (t) return t
    const r = this.installed.get()[id]
    if (r) return { status: 'installed', path: r.path, installedAt: r.installedAt, sizeBytes: r.sizeBytes }
    return { status: 'not-installed' }
  }

  installedPath(id: string): string | null {
    return this.installed.get()[id]?.path ?? null
  }

  /** Median speed seen on this computer per model, from real generations (≥2 s of audio). */
  private localSpeeds() {
    const by = new Map<string, number[]>()
    for (const h of history.list(true).slice(0, 400)) {
      if (h.durationSec < 2 || !h.processingSec) continue
      by.set(h.modelId, [...(by.get(h.modelId) ?? []), h.durationSec / h.processingSec])
    }
    const out = new Map<string, { speedup: number; samples: number }>()
    for (const [id, xs] of by) {
      const sorted = xs.sort((a, b) => a - b)
      out.set(id, { speedup: sorted[Math.floor(sorted.length / 2)], samples: xs.length })
    }
    return out
  }

  list(): ModelInfo[] {
    const rec = recommendationsFor(getSystemInfo())
    const speeds = this.localSpeeds()
    return this.variants().map((m) => {
      const path = this.installedPath(m.id)
      return {
        ...m,
        localSpeed: speeds.get(m.id),
        install: this.installState(m.id),
        recommended: rec.has(m.id),
        recommendedReason: rec.get(m.id),
        loaded: !!path && engine.isLoaded(path)
      }
    })
  }

  installedWith(cap: Capability): ModelVariant[] {
    return this.variants().filter((m) => m.capabilities.includes(cap) && this.installedPath(m.id))
  }

  /**
   * Pick the model to run for a capability: explicit choice → user default → recommended → best quality.
   */
  resolve(cap: Capability, preferredId?: string): ModelVariant | null {
    const candidates = this.installedWith(cap)
    if (!candidates.length) return null
    const byId = (id?: string) => (id ? candidates.find((c) => c.id === id) : undefined)
    const rec = recommendationsFor(getSystemInfo())
    return (
      byId(preferredId) ??
      byId(getSettings().defaultModels[cap]) ??
      candidates.find((c) => rec.has(c.id)) ??
      [...candidates].sort((a, b) => b.quality - a.quality || b.speed - a.speed)[0]
    )
  }

  private publish(id: string) {
    bus.publish('modelProgress', { modelId: id, install: this.installState(id) })
  }

  private setTransient(id: string, s: InstallState | null) {
    if (s) this.transient.set(id, s)
    else this.transient.delete(id)
    this.publish(id)
  }

  async install(id: string) {
    const model = this.get(id)
    if (!model) throw new Error(`Unknown model: ${id}`)
    if (this.installedPath(id) || this.controllers.has(id)) return
    const needGB = (model.sizeBytes / 1e9) * (model.source.type === 'hf-convert' ? 1.6 : 1.05)
    if (freeDiskGB() && freeDiskGB() < needGB + 1) {
      throw new Error(`Not enough disk space: ${model.name} needs about ${needGB.toFixed(1)} GB free.`)
    }
    const ctrl = new AbortController()
    this.controllers.set(id, ctrl)
    if (!this.pending.get().includes(id)) this.pending.update((p) => [...p, id])
    this.setTransient(id, { status: 'queued' })

    const finalDir = join(paths.models, id)
    const downloadDir = model.source.type === 'hf-convert' ? join(paths.tmp, `convert-${id}`) : `${finalDir}.partial`

    try {
      await this.downloadRepo(id, model.source.repo, downloadDir, ctrl.signal)
      if (model.source.type === 'hf-convert') {
        this.setTransient(id, { status: 'converting', message: 'Converting to MLX (this can take a few minutes)…' })
        rmSync(finalDir, { recursive: true, force: true })
        await engine.request('models.convert', {
          src_path: downloadDir,
          out_path: finalDir,
          q_bits: model.source.qBits ?? null
        })
        rmSync(downloadDir, { recursive: true, force: true })
      } else {
        rmSync(finalDir, { recursive: true, force: true })
        renameSync(downloadDir, finalDir)
      }
      this.installed.update((r) => ({
        ...r,
        [id]: { path: finalDir, installedAt: Date.now(), sizeBytes: dirSize(finalDir) }
      }))
      this.installed.flush()
      this.pending.update((p) => p.filter((x) => x !== id))
      this.setTransient(id, null)
    } catch (e) {
      if (ctrl.signal.aborted) {
        this.pending.update((p) => p.filter((x) => x !== id))
        this.setTransient(id, null)
      } else {
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`[models] install ${id} failed`, e)
        this.setTransient(id, { status: 'error', error: msg })
      }
    } finally {
      this.controllers.delete(id)
      bus.publish('modelsChanged', null)
    }
  }

  cancel(id: string) {
    this.controllers.get(id)?.abort()
    this.pending.update((p) => p.filter((x) => x !== id))
    if (this.transient.get(id)?.status === 'error') this.setTransient(id, null)
  }

  async remove(id: string) {
    this.cancel(id)
    const path = this.installedPath(id)
    if (path) {
      if (engine.isLoaded(path)) await engine.request('models.unload', { model_path: path }).catch(() => undefined)
      rmSync(path, { recursive: true, force: true })
    }
    rmSync(join(paths.models, `${id}.partial`), { recursive: true, force: true })
    this.installed.update((r) => {
      const next = { ...r }
      delete next[id]
      return next
    })
    if (this.custom.get().some((m) => m.id === id)) {
      this.custom.update((list) => list.filter((m) => m.id !== id))
    }
    this.setTransient(id, null)
    bus.publish('modelsChanged', null)
  }

  /** Register any MLX-format Qwen3-TTS repo from Hugging Face (e.g. a community fine-tune). */
  async addCustom(repo: string): Promise<ModelInfo> {
    repo = repo.trim().replace(/^https?:\/\/huggingface\.co\//, '').replace(/\/$/, '')
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Enter a Hugging Face repo id like "owner/model-name".')
    const existing = this.variants().find((m) => m.source.repo === repo)
    if (existing) return this.list().find((m) => m.id === existing.id)!

    const cfgRes = await fetch(`${HF}/${repo}/resolve/main/config.json`)
    if (!cfgRes.ok) throw new Error(`Couldn't read config.json from ${repo} (${cfgRes.status}).`)
    const cfg = (await cfgRes.json()) as Record<string, unknown>
    const type = String(cfg.tts_model_type ?? '')
    if (!type) throw new Error('This repo does not look like a Qwen3-TTS model (no tts_model_type in config.json).')
    const files = await this.listFiles(repo)
    const size = files.reduce((n, f) => n + f.size, 0)
    const isMlx = !!cfg.quantization || files.some((f) => f.path === 'model.safetensors.index.json') || repo.startsWith('mlx-community/')
    const capabilities: Capability[] =
      type === 'custom_voice' ? ['preset-voices', 'instruct'] : type === 'voice_design' ? ['voice-design', 'instruct'] : ['voice-clone']
    const quant = (cfg.quantization as { bits?: number } | undefined)?.bits
    const roleId = type === 'custom_voice' ? 'built-in-voices' : type === 'voice_design' ? 'voice-design' : 'voice-cloning'
    const quantKey = quant ? (`${quant}bit` as ModelVariant['quant']) : 'bf16'
    const variant: ModelVariant = {
      id: `custom-${repo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      provider: 'qwen3-tts',
      name: repo.split('/')[1],
      family: 'Custom models',
      familyId: 'custom',
      role: ROLES.custom.label,
      roleId: 'custom',
      sizeLabel: String(cfg.tts_model_size ?? '') === '0b6' ? 'Small' : 'Large',
      precisionLabel: PRECISION_INFO[quantKey]?.label ?? quantKey,
      summary: `Works like ${ROLES[roleId].label}`,
      officialName: repo,
      task: 'tts',
      capabilities,
      params: String(cfg.tts_model_size ?? '').replace('b', '.').replace(/^0\./, '0.').toUpperCase() || '?',
      quant: quantKey,
      source: isMlx ? { type: 'hf-mlx', repo } : { type: 'hf-convert', repo, qBits: 8 },
      sizeBytes: size,
      quality: 4,
      speed: 4,
      minRamGB: Math.ceil((size / 1e9) * 1.6 + 2),
      description: `Custom model from huggingface.co/${repo}${isMlx ? '' : ' — will be converted to MLX 8-bit after download'}.`,
      tags: ['Custom'],
      community: true
    }
    this.custom.update((list) => [...list, variant])
    bus.publish('modelsChanged', null)
    return this.list().find((m) => m.id === variant.id)!
  }

  private async listFiles(repo: string): Promise<HfFile[]> {
    const res = await fetch(`${HF}/api/models/${repo}/tree/main?recursive=true`)
    if (!res.ok) throw new Error(`Hugging Face returned ${res.status} for ${repo}`)
    const entries = (await res.json()) as { type: string; path: string; size?: number }[]
    return entries
      .filter((e) => e.type === 'file' && !SKIP.some((r) => r.test(e.path)))
      .map((e) => ({ path: e.path, size: e.size ?? 0 }))
  }

  private async downloadRepo(id: string, repo: string, dir: string, signal: AbortSignal) {
    const files = await this.listFiles(repo)
    const total = files.reduce((n, f) => n + f.size, 0)
    let received = 0
    let lastEmit = 0
    let windowStart = Date.now()
    let windowBytes = 0
    let rate = 0

    const emit = (file: string, force = false) => {
      const now = Date.now()
      if (!force && now - lastEmit < 120) return
      if (now - windowStart >= 1000) {
        rate = rate ? rate * 0.6 + (windowBytes / ((now - windowStart) / 1000)) * 0.4 : windowBytes / ((now - windowStart) / 1000)
        windowStart = now
        windowBytes = 0
      }
      lastEmit = now
      this.setTransient(id, { status: 'downloading', received, total, bytesPerSec: rate, file })
    }

    mkdirSync(dir, { recursive: true })
    // `resumed` bytes were already on disk: count them toward progress but not toward speed.
    const onBytes = (n: number, file: string, resumed = false) => {
      received += n
      if (!resumed) windowBytes += n
      emit(file)
    }
    // Small files first so config/tokenizer land fast and failures surface early.
    for (const f of [...files].sort((a, b) => a.size - b.size)) {
      if (signal.aborted) throw new Error('aborted')
      const dest = join(dir, f.path)
      mkdirSync(dirname(dest), { recursive: true })
      const url = `${HF}/${repo}/resolve/main/${f.path.split('/').map(encodeURIComponent).join('/')}`
      const cb = (n: number, resumed?: boolean) => onBytes(n, f.path, resumed)
      if (f.size >= CHUNKED_MIN) await downloadChunked(url, dest, f.size, signal, cb)
      else await downloadSingle(url, dest, f.size, signal, cb)
    }
    emit('', true)
  }
}

const CHUNK = 16 * 1024 * 1024
const CHUNKED_MIN = 48 * 1024 * 1024
const CONNECTIONS = 8

async function downloadSingle(url: string, dest: string, size: number, signal: AbortSignal, onBytes: (n: number, resumed?: boolean) => void) {
  const have = existsSync(dest) ? statSync(dest).size : 0
  if (size && have === size) return onBytes(have, true)
  const headers: Record<string, string> = {}
  if (have > 0 && have < size) headers.Range = `bytes=${have}-`
  const res = await fetch(url, { headers, signal })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`)
  const append = res.status === 206
  if (append) onBytes(have, true)
  const ws = createWriteStream(dest, { flags: append ? 'a' : 'w' })
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      if (!ws.write(chunk)) await once(ws, 'drain')
      onBytes(chunk.byteLength)
    }
  } finally {
    ws.end()
    await once(ws, 'close').catch(() => undefined)
  }
}

/**
 * Large files are fetched as 16 MB ranges over several parallel connections — the Hugging Face
 * CDN throttles single streams heavily. Finished chunks are recorded in `<file>.parts` so an
 * interrupted download resumes where it left off.
 */
async function downloadChunked(url: string, dest: string, size: number, signal: AbortSignal, onBytes: (n: number, resumed?: boolean) => void) {
  const partsFile = `${dest}.parts`
  const doneMarker = existsSync(dest) && !existsSync(partsFile) && statSync(dest).size === size
  if (doneMarker) return onBytes(size, true)

  // Resolve the CDN redirect once; signed URLs stay valid for the whole download.
  const head = await fetch(url, { method: 'HEAD', redirect: 'follow', signal })
  const target = head.ok && head.url ? head.url : url

  const count = Math.ceil(size / CHUNK)
  const done = new Set<number>()
  if (existsSync(partsFile) && existsSync(dest)) {
    try {
      for (const i of JSON.parse(readFileSync(partsFile, 'utf8')) as number[]) done.add(i)
    } catch {
      /* start over */
    }
  } else {
    rmSync(dest, { force: true })
  }
  const fh = await open(dest, existsSync(dest) ? 'r+' : 'w+')
  try {
    writeFileSync(partsFile, JSON.stringify([...done]))
    await fh.truncate(size)
    for (const i of done) onBytes(Math.min(CHUNK, size - i * CHUNK), true)
    const queue = [...Array(count).keys()].filter((i) => !done.has(i))
    let saveTimer: NodeJS.Timeout | null = null
    const saveParts = () => {
      if (saveTimer) return
      saveTimer = setTimeout(() => {
        saveTimer = null
        writeFileSync(partsFile, JSON.stringify([...done]))
      }, 500)
    }

    const worker = async () => {
      for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
        const start = i * CHUNK
        const end = Math.min(size, start + CHUNK) - 1
        for (let attempt = 0; ; attempt++) {
          let written = 0
          try {
            const res = await fetch(target, { headers: { Range: `bytes=${start}-${end}` }, signal })
            if (res.status !== 206 || !res.body) throw new Error(`Range request failed (${res.status})`)
            for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
              await fh.write(chunk, 0, chunk.byteLength, start + written)
              written += chunk.byteLength
              onBytes(chunk.byteLength)
            }
            if (written !== end - start + 1) throw new Error('Short read')
            break
          } catch (e) {
            onBytes(-written)
            if (signal.aborted || attempt >= 4) throw e
            await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
          }
        }
        done.add(i)
        saveParts()
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONNECTIONS, queue.length) }, worker))
    if (saveTimer) clearTimeout(saveTimer)
  } catch (e) {
    writeFileSync(partsFile, JSON.stringify([...done]))
    throw e
  } finally {
    await fh.close()
  }
  rmSync(partsFile, { force: true })
}

function dirSize(dir: string): number {
  let total = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.name.endsWith('.parts')) continue
    total += e.isDirectory() ? dirSize(p) : statSync(p).size
  }
  return total
}

export const models = new ModelManager()
