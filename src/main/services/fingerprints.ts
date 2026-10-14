import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { FINGERPRINT_HELPER_ID } from '@shared/catalog'
import type { ModelVariant, Voice } from '@shared/types'
import { engine } from '../engine/client'
import { bus } from '../events'
import { voices } from '../library/voices'
import { models } from '../models/manager'
import { paths } from '../paths'

/**
 * Voice fingerprints: every voice you design or clone gets a speaker embedding, so Qwen3-TTS
 * Built-in Voices (Large) can speak it like one of its own voices, style instructions included.
 * Runs quietly in the background; the 24 MB helper is fetched once, only when it's useful.
 */

/** Built-in Voices models that can speak fingerprints (the Large one: its speaker slots match the encoder). */
export function fingerprintModels(): ModelVariant[] {
  return models.installedWith('preset-voices', 'qwen3-tts').filter((m) => m.params === '1.7B' && m.capabilities.includes('instruct'))
}

export const hasFingerprint = (v: Voice | undefined) => !!v?.fingerprint && existsSync(v.fingerprint)

let running = false
let again = false
let helperRequested = false
const failed = new Set<string>()

export async function refreshFingerprints() {
  if (running) {
    again = true
    return
  }
  if (engine.status.state !== 'ready' || !fingerprintModels().length) return
  const todo = voices
    .list()
    .filter((v) => v.kind !== 'preset' && v.refAudio && existsSync(v.refAudio) && !hasFingerprint(v) && !failed.has(v.id))
  if (!todo.length) return

  const helper = models.installedPath(FINGERPRINT_HELPER_ID)
  if (!helper) {
    // Ask once per session; when it lands, modelsChanged brings us back here.
    if (!helperRequested) {
      helperRequested = true
      models.install(FINGERPRINT_HELPER_ID).catch((e) => console.error('[fingerprints] helper', e))
    }
    return
  }

  running = true
  try {
    for (const v of todo) {
      const out = join(paths.voices, v.id, 'fingerprint-large.npy')
      try {
        await engine.request('voice.fingerprint', { encoder_path: helper, audio_path: v.refAudio, out_path: out })
        if (voices.get(v.id)) voices.setFingerprint(v.id, out)
      } catch (e) {
        failed.add(v.id)
        console.error(`[fingerprints] ${v.id}`, e)
      }
    }
  } finally {
    running = false
    if (again) {
      again = false
      refreshFingerprints()
    }
  }
}

export function initFingerprints() {
  const run = () => void refreshFingerprints()
  bus.on('engineStatus', (s) => s.state === 'ready' && run())
  bus.on('modelsChanged', run)
  bus.on('voicesChanged', run)
}
