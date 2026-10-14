import { useEffect, useState } from 'react'
import { mediaUrl } from './api'
import { peaks } from './wav'

const peakCache = new Map<string, number[]>()

/** Waveform bars for a clip on disk (decoded once, then cached). */
export function useFilePeaks(path: string, bars = 96) {
  const [p, setP] = useState<number[]>(() => peakCache.get(path) ?? [])
  useEffect(() => {
    if (peakCache.has(path)) return setP(peakCache.get(path)!)
    let alive = true
    const ctx = new AudioContext()
    fetch(mediaUrl(path))
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => {
        const v = peaks(buf.getChannelData(0), bars)
        peakCache.set(path, v)
        if (alive) setP(v)
      })
      .catch(() => undefined)
      .finally(() => ctx.close())
    return () => {
      alive = false
    }
  }, [path, bars])
  return p
}
