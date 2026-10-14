import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { EngineStatus } from '@shared/types'
import { bus } from '../events'
import { paths } from '../paths'
import { getSettings } from '../settings'
import { installRuntime, isRuntimeInstalled } from './runtime'

type EventHandler = (event: string, data: unknown) => void

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  onEvent?: EventHandler
  method: string
}

/**
 * Supervises the Python/MLX sidecar and exposes a promise-based RPC over stdio.
 * One engine per app; requests are serialized by the engine's worker thread.
 */
class EngineClient {
  private proc: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<string, Pending>()
  private seq = 0
  private _status: EngineStatus = { state: 'missing' }
  private startPromise: Promise<void> | null = null
  private installing = false
  private versions = { mlx: '', mlxAudio: '' }
  private loaded: string[] = []
  private logs: string[] = []
  private intentionalStop = false

  get status() {
    return this._status
  }

  recentLogs() {
    return this.logs.slice(-300)
  }

  private setStatus(s: EngineStatus) {
    this._status = s
    bus.publish('engineStatus', s)
  }

  private log(line: string) {
    this.logs.push(line)
    if (this.logs.length > 1000) this.logs.splice(0, this.logs.length - 1000)
    bus.publish('engineLog', line)
  }

  /** Called on app start: start the engine if the runtime exists. */
  async boot() {
    if (isRuntimeInstalled()) await this.start().catch(() => undefined)
    else this.setStatus({ state: 'missing' })
  }

  async install() {
    if (this.installing) return
    this.installing = true
    try {
      await this.stop()
      this.setStatus({ state: 'installing', step: 'Starting', progress: 0 })
      let lastStep = 'Starting'
      let lastProgress = 0
      await installRuntime((step, progress, line) => {
        if (line) this.log(line)
        if (step) lastStep = step
        if (progress >= 0) lastProgress = progress
        if (step || progress >= 0) this.setStatus({ state: 'installing', step: lastStep, progress: lastProgress })
      })
      await this.start()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.log(`Install failed: ${msg}`)
      this.setStatus({ state: 'error', error: msg })
      throw e
    } finally {
      this.installing = false
    }
  }

  start(): Promise<void> {
    if (this.proc && this._status.state === 'ready') return Promise.resolve()
    if (this.startPromise) return this.startPromise
    this.startPromise = new Promise<void>((resolve, reject) => {
      if (!isRuntimeInstalled()) {
        this.setStatus({ state: 'missing' })
        this.startPromise = null
        return reject(new Error('Engine runtime is not installed'))
      }
      this.setStatus({ state: 'starting' })
      this.intentionalStop = false
      const proc = spawn(paths.python, ['-u', paths.engineScript], {
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONNOUSERSITE: '1',
          HF_HUB_OFFLINE: '1'
        },
        stdio: ['pipe', 'pipe', 'pipe']
      })
      this.proc = proc
      const rl = createInterface({ input: proc.stdout })
      let readyTimer: NodeJS.Timeout | null = setTimeout(() => {
        reject(new Error('Engine did not start in time'))
      }, 60_000)

      rl.on('line', (line) => {
        let msg: { id?: string; event?: string; data?: unknown; result?: unknown; error?: { message: string } }
        try {
          msg = JSON.parse(line)
        } catch {
          this.log(line)
          return
        }
        if (!msg.id) {
          if (msg.event === 'ready') {
            this.request<{ mlx: string; mlx_audio: string }>('engine.warmup', {})
              .then((v) => {
                this.versions = { mlx: v.mlx, mlxAudio: v.mlx_audio }
                this.setReady()
                this.request('config', { max_loaded: getSettings().maxLoadedModels }).catch(() => undefined)
                if (readyTimer) clearTimeout(readyTimer)
                readyTimer = null
                resolve()
              })
              .catch((e) => reject(e))
          } else if (msg.event === 'log') {
            this.log(String(msg.data))
          }
          return
        }
        const p = this.pending.get(msg.id)
        if (!p) return
        if (msg.event) {
          p.onEvent?.(msg.event, msg.data)
          return
        }
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message))
        else p.resolve(msg.result)
      })

      proc.stderr.on('data', (b: Buffer) => {
        for (const l of b.toString().split(/\r?\n/)) if (l.trim()) this.log(l)
      })

      proc.on('exit', (code, signal) => {
        if (readyTimer) clearTimeout(readyTimer)
        this.proc = null
        this.startPromise = null
        this.loaded = []
        for (const [, p] of this.pending) p.reject(new Error('Engine stopped'))
        this.pending.clear()
        if (this.intentionalStop) {
          this.setStatus(isRuntimeInstalled() ? { state: 'starting' } : { state: 'missing' })
          return
        }
        const err = `Engine exited (${signal ?? code}). Check the engine log in Settings.`
        this.log(err)
        this.setStatus({ state: 'error', error: err })
        reject(new Error(err))
      })
    }).finally(() => {
      this.startPromise = null
    })
    return this.startPromise
  }

  private setReady() {
    this.setStatus({ state: 'ready', version: this.versions.mlxAudio, mlx: this.versions.mlx, loaded: this.loaded })
  }

  async stop() {
    if (!this.proc) return
    this.intentionalStop = true
    const proc = this.proc
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        proc.kill('SIGKILL')
        resolve()
      }, 3000)
      proc.once('exit', () => {
        clearTimeout(t)
        resolve()
      })
      try {
        proc.stdin.write(JSON.stringify({ id: 'shutdown', method: 'shutdown' }) + '\n')
      } catch {
        proc.kill()
      }
    })
  }

  async restart() {
    await this.stop()
    await this.start()
  }

  /** Low-level RPC. `id` may be supplied so callers can cancel by job id. */
  async request<T>(method: string, params: Record<string, unknown>, opts: { id?: string; onEvent?: EventHandler } = {}) {
    if (!this.proc && method !== 'engine.warmup') await this.start()
    const proc = this.proc
    if (!proc) throw new Error('Engine is not running')
    const id = opts.id ?? `r${++this.seq}`
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onEvent: opts.onEvent, method })
      proc.stdin.write(JSON.stringify({ id, method, params }) + '\n')
    })
  }

  cancel(jobId: string) {
    if (!this.proc) return
    this.proc.stdin.write(JSON.stringify({ id: `c${++this.seq}`, method: 'cancel', params: { job_id: jobId } }) + '\n')
  }

  markLoaded(modelPath: string) {
    const max = getSettings().maxLoadedModels
    this.loaded = [...this.loaded.filter((p) => p !== modelPath), modelPath].slice(-Math.max(1, max))
    if (this._status.state === 'ready') this.setReady()
  }

  async unloadAll() {
    if (!this.proc) return
    await this.request('models.unload', {})
    this.loaded = []
    this.setReady()
  }

  isLoaded(modelPath: string) {
    return this.loaded.includes(modelPath)
  }

  async configure(maxLoaded: number) {
    if (this.proc) await this.request('config', { max_loaded: maxLoaded })
  }
}

export const engine = new EngineClient()
