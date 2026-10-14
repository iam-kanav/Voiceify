import type { Transcript } from '@shared/types'
import { bus } from '../events'
import { JsonStore } from '../store'

/** Speech-to-text results. Text only (the source audio is never stored). */
class Transcripts {
  private store = new JsonStore<Transcript[]>('transcripts', [])

  init() {
    this.dropUnsaved()
  }

  list(): Transcript[] {
    return this.store.get()
  }

  get(id: string) {
    return this.store.get().find((t) => t.id === id)
  }

  add(t: Transcript) {
    this.store.update((list) => [t, ...list].slice(0, 2000))
    bus.publish('transcriptsChanged', null)
  }

  update(id: string, patch: Partial<Pick<Transcript, 'name' | 'text' | 'segments' | 'saved'>>) {
    let found: Transcript | undefined
    this.store.update((list) => list.map((t) => (t.id === id ? (found = { ...t, ...patch }) : t)))
    if (!found) throw new Error('That transcript no longer exists.')
    bus.publish('transcriptsChanged', null)
    return found
  }

  remove(id: string) {
    this.store.update((list) => list.filter((t) => t.id !== id))
    bus.publish('transcriptsChanged', null)
  }

  dropUnsaved() {
    if (this.store.get().some((t) => t.saved === false)) this.store.update((list) => list.filter((t) => t.saved !== false))
  }

  saveAll() {
    if (!this.store.get().some((t) => t.saved === false)) return
    this.store.update((list) => list.map((t) => (t.saved === false ? { ...t, saved: true } : t)))
    bus.publish('transcriptsChanged', null)
  }
}

export const transcripts = new Transcripts()
