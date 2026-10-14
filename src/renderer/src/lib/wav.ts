/** Browser-side audio helpers: decode any format → 24 kHz mono → trimmed → 16-bit WAV. */

export const TARGET_SR = 24000

export async function decodeToMono(data: ArrayBuffer, sampleRate = TARGET_SR): Promise<Float32Array> {
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(data.slice(0))
    const length = Math.ceil(decoded.duration * sampleRate)
    const off = new OfflineAudioContext(1, Math.max(1, length), sampleRate)
    const src = off.createBufferSource()
    src.buffer = decoded
    src.connect(off.destination)
    src.start()
    const rendered = await off.startRendering()
    return rendered.getChannelData(0).slice()
  } finally {
    ctx.close()
  }
}

/** Trim leading/trailing silence and cap length. */
export function trimSilence(samples: Float32Array, sampleRate = TARGET_SR, maxSec = 30, threshold = 0.012) {
  const win = Math.floor(sampleRate * 0.02)
  let start = 0
  let end = samples.length
  const rms = (i: number) => {
    let s = 0
    for (let j = i; j < Math.min(i + win, samples.length); j++) s += samples[j] * samples[j]
    return Math.sqrt(s / win)
  }
  while (start < samples.length - win && rms(start) < threshold) start += win
  while (end > start + win && rms(end - win) < threshold) end -= win
  start = Math.max(0, start - Math.floor(sampleRate * 0.1))
  end = Math.min(samples.length, end + Math.floor(sampleRate * 0.15))
  end = Math.min(end, start + Math.floor(maxSec * sampleRate))
  return samples.slice(start, end)
}

export function normalize(samples: Float32Array, peak = 0.9) {
  let max = 0
  for (const s of samples) max = Math.max(max, Math.abs(s))
  if (max < 1e-4) return samples
  const g = Math.min(4, peak / max)
  return samples.map((s) => s * g)
}

export function encodeWav(samples: Float32Array, sampleRate = TARGET_SR): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  w(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  w(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Uint8Array(buf)
}

export function peaks(samples: Float32Array, bars: number): number[] {
  const out: number[] = []
  const step = Math.max(1, Math.floor(samples.length / bars))
  for (let i = 0; i < bars; i++) {
    let max = 0
    const from = i * step
    for (let j = from; j < Math.min(from + step, samples.length); j++) max = Math.max(max, Math.abs(samples[j]))
    out.push(max)
  }
  const top = Math.max(0.05, ...out)
  return out.map((p) => Math.pow(p / top, 0.8))
}
