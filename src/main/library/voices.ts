import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Voice } from '@shared/types'
import { PRESET_VOICES, randomColors } from '@shared/voices'
import { bus } from '../events'
import { paths } from '../paths'
import { JsonStore } from '../store'

class VoiceLibrary {
  private store = new JsonStore<Voice[]>('voices', [])

  list(): Voice[] {
    return [...this.store.get().sort((a, b) => b.createdAt - a.createdAt), ...PRESET_VOICES]
  }

  get(id: string): Voice | undefined {
    return this.list().find((v) => v.id === id)
  }

  /** Find by id, or case-insensitively by name (handy for agents: voice: "Ryan"). */
  find(idOrName: string): Voice | undefined {
    const q = idOrName.trim().toLowerCase()
    return this.list().find((v) => v.id.toLowerCase() === q || v.name.toLowerCase() === q || v.speaker?.toLowerCase() === q)
  }

  createCloned(input: { name: string; description?: string; wav: Uint8Array | string; refText?: string }): Voice {
    const id = `voice_${randomUUID().slice(0, 8)}`
    const dir = join(paths.voices, id)
    mkdirSync(dir, { recursive: true })
    const refAudio = join(dir, 'reference.wav')
    if (typeof input.wav === 'string') copyFileSync(input.wav, refAudio)
    else writeFileSync(refAudio, input.wav)
    const voice: Voice = {
      id,
      name: input.name.trim() || 'My voice',
      kind: 'cloned',
      description: input.description?.trim() || 'Cloned from your audio',
      refAudio,
      refText: input.refText?.trim() || undefined,
      colors: randomColors(id),
      createdAt: Date.now(),
      tags: ['Cloned']
    }
    this.store.update((list) => [voice, ...list])
    bus.publish('voicesChanged', null)
    return voice
  }

  createDesigned(input: { name: string; description?: string; designPrompt: string; audioPath: string; refText: string }): Voice {
    const id = `voice_${randomUUID().slice(0, 8)}`
    const dir = join(paths.voices, id)
    mkdirSync(dir, { recursive: true })
    const refAudio = join(dir, 'reference.wav')
    copyFileSync(input.audioPath, refAudio)
    const voice: Voice = {
      id,
      name: input.name.trim() || 'Designed voice',
      kind: 'designed',
      description: input.description?.trim() || input.designPrompt,
      designPrompt: input.designPrompt,
      refAudio,
      refText: input.refText,
      previewAudio: refAudio,
      colors: randomColors(id),
      createdAt: Date.now(),
      tags: ['Designed']
    }
    this.store.update((list) => [voice, ...list])
    bus.publish('voicesChanged', null)
    return voice
  }

  update(id: string, patch: Partial<Pick<Voice, 'name' | 'description' | 'tags' | 'refText'>>): Voice {
    let updated: Voice | undefined
    this.store.update((list) =>
      list.map((v) => {
        if (v.id !== id) return v
        updated = { ...v, ...patch }
        return updated
      })
    )
    if (!updated) throw new Error('Built-in voices can’t be edited.')
    bus.publish('voicesChanged', null)
    return updated
  }

  /** Record a voice's fingerprint (made in the background, see services/fingerprints.ts). */
  setFingerprint(id: string, path: string) {
    this.store.update((list) => list.map((v) => (v.id === id ? { ...v, fingerprint: path } : v)))
    bus.publish('voicesChanged', null)
  }

  remove(id: string) {
    if (id.startsWith('preset:')) throw new Error('Built-in voices can’t be deleted.')
    this.store.update((list) => list.filter((v) => v.id !== id))
    rmSync(join(paths.voices, id), { recursive: true, force: true })
    bus.publish('voicesChanged', null)
  }
}

export const voices = new VoiceLibrary()
