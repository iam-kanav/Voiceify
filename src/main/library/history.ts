import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { HistoryItem } from '@shared/types'
import { bus } from '../events'
import { paths } from '../paths'
import { JsonStore } from '../store'

const EPHEMERAL_TTL = 24 * 3600 * 1000

class History {
  private store = new JsonStore<HistoryItem[]>('history', [])

  init() {
    // Drop voice-design previews older than a day and rows whose audio vanished.
    const now = Date.now()
    const keep: HistoryItem[] = []
    for (const h of this.store.get()) {
      const stale = h.ephemeral && now - h.createdAt > EPHEMERAL_TTL
      if (stale || !existsSync(h.audioPath)) {
        if (stale) rmSync(h.audioPath, { force: true })
        continue
      }
      keep.push(h)
    }
    this.store.set(keep)
  }

  audioPathFor(id: string) {
    return join(paths.history, `${id}.wav`)
  }

  list(includeEphemeral = false): HistoryItem[] {
    return this.store.get().filter((h) => includeEphemeral || !h.ephemeral)
  }

  get(id: string) {
    return this.store.get().find((h) => h.id === id)
  }

  add(item: HistoryItem) {
    this.store.update((list) => [item, ...list].slice(0, 5000))
    if (!item.ephemeral) bus.publish('historyChanged', null)
  }

  remove(id: string) {
    const item = this.get(id)
    if (item) rmSync(item.audioPath, { force: true })
    this.store.update((list) => list.filter((h) => h.id !== id))
    bus.publish('historyChanged', null)
  }

  clear() {
    for (const h of this.store.get()) if (!h.ephemeral) rmSync(h.audioPath, { force: true })
    this.store.update((list) => list.filter((h) => h.ephemeral))
    bus.publish('historyChanged', null)
  }
}

export const history = new History()
