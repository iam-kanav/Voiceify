import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './paths'

/**
 * Tiny JSON document store with debounced atomic writes. Good enough for settings, voices and
 * history (thousands of rows); swap for SQLite if a feature ever needs queries.
 *
 * The file is resolved and read lazily on first access, so stores can be declared at module
 * scope before the app has finalised its userData path.
 */
export class JsonStore<T> {
  private static all = new Set<JsonStore<unknown>>()

  /** Write every pending store to disk (called on quit). */
  static flushAll() {
    for (const s of JsonStore.all) s.flush()
  }

  private value!: T
  private loaded = false
  private timer: NodeJS.Timeout | null = null
  private _file = ''

  constructor(
    private readonly name: string,
    private readonly defaults: T
  ) {
    JsonStore.all.add(this as JsonStore<unknown>)
  }

  private get file() {
    if (!this._file) this._file = join(paths.data, `${this.name}.json`)
    return this._file
  }

  private load() {
    if (this.loaded) return
    this.loaded = true
    this.value = this.defaults
    if (!existsSync(this.file)) return
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      const d = this.defaults
      this.value = d && typeof d === 'object' && !Array.isArray(d) ? { ...d, ...parsed } : parsed
    } catch (e) {
      console.error(`[store] failed to read ${this.file}`, e)
    }
  }

  get(): T {
    this.load()
    return this.value
  }

  set(next: T) {
    this.loaded = true
    this.value = next
    this.schedule()
  }

  update(fn: (v: T) => T) {
    this.set(fn(this.get()))
  }

  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.loaded) return
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.value, null, 2))
    renameSync(tmp, this.file)
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 150)
  }
}
