import { readFileSync, writeFileSync } from 'node:fs'

/** Minimal 16-bit PCM WAV I/O, for stitching generated clips together. */

export interface Pcm16 {
  sampleRate: number
  channels: number
  /** Interleaved samples. */
  data: Int16Array
}

export function readWav(path: string): Pcm16 {
  const buf = readFileSync(path)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`Not a WAV file: ${path}`)
  let off = 12
  let fmt: { channels: number; sampleRate: number; bits: number; format: number } | null = null
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    const body = off + 8
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) }
    } else if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16) throw new Error(`Unsupported WAV format in ${path}`)
      const end = Math.min(buf.length, body + size)
      const data = new Int16Array(Math.floor((end - body) / 2))
      for (let i = 0; i < data.length; i++) data[i] = buf.readInt16LE(body + i * 2)
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, data }
    }
    off = body + size + (size % 2)
  }
  throw new Error(`No audio data in ${path}`)
}

export function writeWav(path: string, pcm: Pcm16) {
  const bytes = pcm.data.length * 2
  const buf = Buffer.alloc(44 + bytes)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + bytes, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(pcm.channels, 22)
  buf.writeUInt32LE(pcm.sampleRate, 24)
  buf.writeUInt32LE(pcm.sampleRate * pcm.channels * 2, 28)
  buf.writeUInt16LE(pcm.channels * 2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(bytes, 40)
  for (let i = 0; i < pcm.data.length; i++) buf.writeInt16LE(pcm.data[i], 44 + i * 2)
  writeFileSync(path, buf)
}

/** Mix down to mono. */
export function toMono(pcm: Pcm16): Pcm16 {
  if (pcm.channels === 1) return pcm
  const n = Math.floor(pcm.data.length / pcm.channels)
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let c = 0; c < pcm.channels; c++) s += pcm.data[i * pcm.channels + c]
    out[i] = Math.round(s / pcm.channels)
  }
  return { sampleRate: pcm.sampleRate, channels: 1, data: out }
}

/** Linear-interpolation resample (mono). Only used when two models speak at different rates. */
export function resample(pcm: Pcm16, rate: number): Pcm16 {
  if (pcm.sampleRate === rate) return pcm
  const src = pcm.data
  const n = Math.max(1, Math.round((src.length * rate) / pcm.sampleRate))
  const out = new Int16Array(n)
  const step = pcm.sampleRate / rate
  for (let i = 0; i < n; i++) {
    const x = i * step
    const j = Math.floor(x)
    const f = x - j
    const a = src[Math.min(j, src.length - 1)]
    const b = src[Math.min(j + 1, src.length - 1)]
    out[i] = Math.round(a + (b - a) * f)
  }
  return { sampleRate: rate, channels: 1, data: out }
}
