import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { once } from 'node:events'
import { join, dirname } from 'node:path'
import { CATALOG, CATALOG_BY_ID, PRECISION_INFO, recommendationsFor, ROLES } from '@shared/catalog'
import { history } from '../library/history'
import type { Capability, ExtraFile, InstallState, ModelInfo, ModelVariant } from '@shared/types'
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
      // Scripts mix several models, so they say nothing about any one model's speed.
      if (h.durationSec < 2 || !h.processingSec || h.coldStart || h.mode === 'script') continue
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

  installedWith(cap: Capability, provider?: string): ModelVariant[] {
    return this.variants().filter(
      (m) => m.capabilities.includes(cap) && (!provider || m.provider === provider) && this.installedPath(m.id)
    )
  }

  /** Model families with at least one installed model that can do `cap`. */
  installedProviders(cap: Capability): string[] {
    return [...new Set(this.installedWith(cap).map((m) => m.provider))]
  }

  /**
   * Pick the model to run for a capability: explicit choice → user default → recommended → best quality.
   */
  resolve(cap: Capability, preferredId?: string, provider?: string): ModelVariant | null {
    const candidates = this.installedWith(cap, provider)
    if (!candidates.length) return null
    const byId = (id?: string) => (id ? candidates.find((c) => c.id === id) : undefined)
    const rec = recommendationsFor(getSystemInfo())
    const defaults = getSettings().defaultModels
    return (
      byId(preferredId) ??
      byId(provider ? defaults[`${provider}/${cap}`] : undefined) ??
      byId(defaults[`${candidates[0].provider}/${cap}`]) ??
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
      if (model.source.type === 'hf-tensors') await this.downloadTensors(id, model.source, downloadDir, ctrl.signal)
      else if (model.source.type === 'hf-files') await this.downloadSelected(id, model.source, downloadDir, ctrl.signal)
      else await this.downloadRepo(id, model.source.repo, downloadDir, ctrl.signal, model.source.extras)
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

  /**
   * Fetch only some tensors of a safetensors file (e.g. a 24 MB speaker encoder inside a 3 GB
   * model) with ranged reads, and write them as a small safetensors file plus config.json. Reads
   * from an installed model with the same repo file when there is one, so nothing is downloaded.
   */
  private async downloadTensors(
    id: string,
    src: Extract<ModelVariant['source'], { type: 'hf-tensors' }>,
    dir: string,
    signal: AbortSignal
  ) {
    mkdirSync(dir, { recursive: true })
    const rev = src.revision ?? 'main'
    const url = (path: string) => `${HF}/${src.repo}/resolve/${rev}/${path}`
    const sameSize = (repo: string) => repo.replace(/-(bf16|\d+bit)$/, '') === src.repo.replace(/-(bf16|\d+bit)$/, '')
    const local = this.variants()
      .filter((m) => m.source.type === 'hf-mlx' && sameSize(m.source.repo) && this.installedPath(m.id))
      .map((m) => this.installedPath(m.id)!)
      .find((p) => existsSync(join(p, src.file)))

    const fh = local ? await open(join(local, src.file), 'r') : null
    const read = async (start: number, end: number): Promise<Buffer> => {
      if (fh) {
        const buf = Buffer.alloc(end - start)
        await fh.read(buf, 0, buf.length, start)
        return buf
      }
      const res = await fetch(url(src.file), { headers: { Range: `bytes=${start}-${end - 1}` }, signal })
      if (res.status !== 206 && res.status !== 200) throw new Error(`Hugging Face returned ${res.status} for ${src.repo}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length !== end - start) throw new Error('Download was cut short. Try again.')
      return buf
    }

    try {
      const headerLen = Number((await read(0, 8)).readBigUInt64LE(0))
      const header = JSON.parse((await read(8, 8 + headerLen)).toString('utf8')) as Record<string, { dtype: string; shape: number[]; data_offsets: [number, number] }>
      const base = 8 + headerLen
      const picks = Object.entries(header)
        .filter(([k]) => k.startsWith(src.prefix))
        .sort((a, b) => a[1].data_offsets[0] - b[1].data_offsets[0])
      if (!picks.length) throw new Error(`No ${src.prefix} tensors found in ${src.repo}.`)
      const total = picks.reduce((n, [, t]) => n + t.data_offsets[1] - t.data_offsets[0], 0)

      // Merge neighbouring tensors into a few larger reads.
      const spans: { start: number; end: number; items: typeof picks }[] = []
      for (const p of picks) {
        const [a, b] = p[1].data_offsets
        const last = spans[spans.length - 1]
        if (last && a - last.end < 256 * 1024) {
          last.end = Math.max(last.end, b)
          last.items.push(p)
        } else spans.push({ start: a, end: b, items: [p] })
      }

      const out: Record<string, unknown> = {}
      const chunks: Buffer[] = []
      let offset = 0
      let received = 0
      const t0 = Date.now()
      for (const span of spans) {
        if (signal.aborted) throw new Error('Cancelled')
        const buf = await read(base + span.start, base + span.end)
        for (const [name, t] of span.items) {
          const piece = buf.subarray(t.data_offsets[0] - span.start, t.data_offsets[1] - span.start)
          out[name] = { dtype: t.dtype, shape: t.shape, data_offsets: [offset, offset + piece.length] }
          chunks.push(piece)
          offset += piece.length
          received += piece.length
        }
        const secs = Math.max(0.001, (Date.now() - t0) / 1000)
        this.setTransient(id, { status: 'downloading', received, total, bytesPerSec: received / secs, file: src.saveAs })
      }

      let json = JSON.stringify(out)
      json += ' '.repeat((8 - (Buffer.byteLength(json) % 8)) % 8)
      const len = Buffer.alloc(8)
      len.writeBigUInt64LE(BigInt(Buffer.byteLength(json)))
      writeFileSync(join(dir, src.saveAs), Buffer.concat([len, Buffer.from(json, 'utf8'), ...chunks]))

      let config: Buffer
      if (local) config = readFileSync(join(local, 'config.json'))
      else {
        const res = await fetch(url('config.json'), { signal })
        if (!res.ok) throw new Error(`Hugging Face returned ${res.status} for ${src.repo}`)
        config = Buffer.from(await res.arrayBuffer())
      }
      writeFileSync(join(dir, 'config.json'), config)
    } finally {
      await fh?.close()
    }
  }

  private async downloadRepo(id: string, repo: string, dir: string, signal: AbortSignal, extras: ExtraFile[] = []) {
    const listed = await this.listFiles(repo)
    const files = [
      ...listed.map((f) => ({ ...f, url: fileUrl(repo, f.path) })),
      // Extras (tokenizers, voice embeddings) the model would otherwise fetch at runtime.
      ...extras
        .filter((e) => !listed.some((f) => f.path === (e.saveAs ?? e.path)))
        .map((e) => ({ path: e.saveAs ?? e.path, size: e.size, url: fileUrl(e.repo, e.path, e.revision) }))
    ]
    await this.downloadFiles(id, files, dir, signal)
  }

  /** Only the listed files of a repo (pinned revision), then the config.json that marks the install. */
  private async downloadSelected(id: string, src: Extract<ModelVariant['source'], { type: 'hf-files' }>, dir: string, signal: AbortSignal) {
    const files = [
      ...src.files.map((f) => ({ ...f, url: fileUrl(src.repo, f.path, src.revision) })),
      ...(src.extras ?? []).map((e) => ({ path: e.saveAs ?? e.path, size: e.size, url: fileUrl(e.repo, e.path, e.revision) }))
    ]
    await this.downloadFiles(id, files, dir, signal)
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ ...src.config, source: { repo: src.repo, revision: src.revision } }, null, 2))
  }

  private async downloadFiles(id: string, files: { path: string; size: number; url: string }[], dir: string, signal: AbortSignal) {
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
      const url = f.url
      const cb = (n: number, resumed?: boolean) => onBytes(n, f.path, resumed)
      if (f.size >= CHUNKED_MIN) await downloadChunked(url, dest, f.size, signal, cb)
      else await downloadSingle(url, dest, f.size, signal, cb)
    }
    emit('', true)
  }
}

function fileUrl(repo: string, path: string, rev = 'main') {
  return `${HF}/${repo}/resolve/${rev}/${path.split('/').map(encodeURIComponent).join('/')}`
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
