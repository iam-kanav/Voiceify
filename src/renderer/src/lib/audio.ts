/**
 * Single Web Audio engine for the whole app.
 *
 * - Stream mode: PCM chunks from the engine are scheduled back-to-back for ~300 ms time-to-first-audio.
 * - File mode: once the WAV is on disk we decode it and hand playback over seamlessly at the
 *   current position, enabling seeking and waveforms.
 *
 * Position is read on demand (rAF) instead of pushed through React state, keeping the UI smooth.
 */

type Listener = () => void

class AudioEngine {
  private _ctx: AudioContext | null = null
  private out: GainNode | null = null

  // file mode
  buffer: AudioBuffer | null = null
  private source: AudioBufferSourceNode | null = null
  private startedAt = 0
  private offset = 0
  playing = false

  // stream mode
  streaming = false
  private streamSources = new Set<AudioBufferSourceNode>()
  private streamNext = 0
  private streamStart = 0
  private streamQueued = 0 // seconds scheduled so far
  private streamDone = false

  private endedListeners = new Set<Listener>()

  get ctx() {
    if (!this._ctx) {
      this._ctx = new AudioContext({ latencyHint: 'interactive' })
      this.out = this._ctx.createGain()
      this.out.connect(this._ctx.destination)
    }
    return this._ctx
  }

  onEnded(fn: Listener) {
    this.endedListeners.add(fn)
    return () => this.endedListeners.delete(fn)
  }

  private fireEnded() {
    for (const l of this.endedListeners) l()
  }

  // ---------- streaming ----------

  startStream() {
    this.stopAll()
    const ctx = this.ctx
    if (ctx.state === 'suspended') ctx.resume()
    this.streaming = true
    this.streamDone = false
    this.streamQueued = 0
    this.streamStart = 0
    this.streamNext = 0
  }

  pushChunk(pcm: Uint8Array, sampleRate: number) {
    if (!this.streaming) return
    const ctx = this.ctx
    const view = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2))
    if (!view.length) return
    const buf = ctx.createBuffer(1, view.length, sampleRate)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < view.length; i++) ch[i] = view[i] / 32768
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.out!)
    const now = ctx.currentTime
    if (!this.streamStart || this.streamNext < now) {
      // First chunk, or we underran: (re)start slightly in the future.
      const at = now + 0.06
      if (!this.streamStart) this.streamStart = at
      else this.streamStart += at - this.streamNext // shift the timeline by the gap
      this.streamNext = at
    }
    src.start(this.streamNext)
    this.streamNext += buf.duration
    this.streamQueued += buf.duration
    this.streamSources.add(src)
    src.onended = () => {
      this.streamSources.delete(src)
      if (this.streaming && this.streamDone && this.streamSources.size === 0) {
        this.streaming = false
        this.fireEnded()
      }
    }
  }

  /** No more chunks will arrive. */
  endStream() {
    this.streamDone = true
    if (this.streaming && this.streamSources.size === 0) {
      this.streaming = false
    }
  }

  streamPosition() {
    if (!this.streamStart) return 0
    return Math.max(0, Math.min(this.streamQueued, this.ctx.currentTime - this.streamStart))
  }

  private stopStream() {
    for (const s of this.streamSources) {
      s.onended = null
      try {
        s.stop()
      } catch {
        /* already stopped */
      }
    }
    this.streamSources.clear()
    this.streaming = false
  }

  // ---------- file playback ----------

  async decode(url: string): Promise<AudioBuffer> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Couldn't load audio (${res.status})`)
    return this.ctx.decodeAudioData(await res.arrayBuffer())
  }

  /** Swap in a decoded buffer, continuing from the stream position if a stream is playing. */
  handoff(buffer: AudioBuffer): { playing: boolean } {
    const wasStreaming = this.streaming && this.streamSources.size > 0
    const pos = wasStreaming ? this.streamPosition() : buffer.duration
    this.stopStream()
    this.buffer = buffer
    if (wasStreaming && pos < buffer.duration - 0.05) {
      this.play(pos)
      return { playing: true }
    }
    this.offset = 0
    this.playing = false
    return { playing: false }
  }

  load(buffer: AudioBuffer) {
    this.stopAll()
    this.buffer = buffer
    this.offset = 0
  }

  play(from?: number) {
    if (!this.buffer) return
    const ctx = this.ctx
    if (ctx.state === 'suspended') ctx.resume()
    this.stopSource()
    let offset = from ?? this.offset
    if (offset >= this.buffer.duration - 0.01) offset = 0
    const src = ctx.createBufferSource()
    src.buffer = this.buffer
    src.connect(this.out!)
    src.start(0, offset)
    this.startedAt = ctx.currentTime - offset
    this.source = src
    this.playing = true
    src.onended = () => {
      if (this.source !== src) return
      this.playing = false
      this.offset = this.buffer?.duration ?? 0
      this.source = null
      this.fireEnded()
    }
  }

  pause() {
    if (!this.playing) return
    this.offset = this.position()
    this.stopSource()
    this.playing = false
  }

  seek(t: number) {
    if (!this.buffer) return
    const clamped = Math.max(0, Math.min(t, this.buffer.duration))
    if (this.playing) this.play(clamped)
    else this.offset = clamped
  }

  position() {
    if (this.streaming) return this.streamPosition()
    if (!this.buffer) return 0
    if (!this.playing) return this.offset
    return Math.min(this.buffer.duration, this.ctx.currentTime - this.startedAt)
  }

  duration() {
    if (this.streaming) return this.streamQueued
    return this.buffer?.duration ?? 0
  }

  private stopSource() {
    if (this.source) {
      this.source.onended = null
      try {
        this.source.stop()
      } catch {
        /* noop */
      }
      this.source = null
    }
  }

  stopAll() {
    this.stopStream()
    this.stopSource()
    this.playing = false
    this.offset = 0
  }
}

export const audio = new AudioEngine()
