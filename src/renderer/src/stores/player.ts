import { create } from 'zustand'
import type { HistoryItem } from '@shared/types'
import { audio } from '@/lib/audio'
import { mediaUrl, studio } from '@/lib/api'
import { peaks } from '@/lib/wav'

export interface Clip {
  id: string
  title: string
  subtitle?: string
  path?: string
  /** Direct URL (e.g. blob:) for audio that isn't on disk yet. */
  url?: string
  colors?: [string, string]
  item?: HistoryItem
}

type Status = 'idle' | 'loading' | 'streaming' | 'playing' | 'paused'

interface PlayerState {
  clip: Clip | null
  status: Status
  peaks: number[]
  /** Job id of the in-flight streamed generation. */
  jobId: string | null
  play: (clip: Clip) => Promise<void>
  toggle: () => void
  seek: (t: number) => void
  close: () => void
  stopGeneration: () => void
  beginStream: (jobId: string, clip: Clip) => void
  finishStream: (clip: Clip) => Promise<void>
  abortStream: () => void
}

export const usePlayer = create<PlayerState>((set, get) => ({
  clip: null,
  status: 'idle',
  peaks: [],
  jobId: null,

  play: async (clip) => {
    const cur = get()
    if (cur.clip?.id === clip.id && audio.buffer && cur.status !== 'loading') {
      audio.play(cur.status === 'paused' ? undefined : 0)
      set({ status: 'playing' })
      return
    }
    const src = clip.url ?? (clip.path ? mediaUrl(clip.path) : null)
    if (!src) return
    set({ clip, status: 'loading', peaks: [] })
    try {
      const buf = await audio.decode(src)
      if (get().clip?.id !== clip.id) return
      audio.load(buf)
      audio.play(0)
      set({ status: 'playing', peaks: peaks(buf.getChannelData(0), 120) })
    } catch (e) {
      console.error(e)
      set({ status: 'idle' })
    }
  },

  toggle: () => {
    const { status } = get()
    if (status === 'playing') {
      audio.pause()
      set({ status: 'paused' })
    } else if (status === 'paused') {
      audio.play()
      set({ status: 'playing' })
    }
  },

  seek: (t) => audio.seek(t),

  close: () => {
    // Closing during generation also stops the generation itself.
    const { jobId } = get()
    if (jobId) studio.cancelGeneration(jobId)
    audio.stopAll()
    set({ clip: null, status: 'idle', peaks: [], jobId: null })
  },

  stopGeneration: () => {
    const { jobId } = get()
    if (jobId) studio.cancelGeneration(jobId)
  },

  beginStream: (jobId, clip) => {
    audio.startStream()
    set({ jobId, clip, status: 'streaming', peaks: [] })
  },

  finishStream: async (clip) => {
    audio.endStream()
    set({ jobId: null })
    if (!clip.path) return
    try {
      const buf = await audio.decode(mediaUrl(clip.path))
      const { playing } = audio.handoff(buf)
      set({ clip, status: playing ? 'playing' : 'paused', peaks: peaks(buf.getChannelData(0), 120) })
    } catch (e) {
      console.error(e)
      set({ status: 'idle' })
    }
  },

  abortStream: () => {
    audio.stopAll()
    set({ jobId: null, status: 'idle', clip: null })
  }
}))

// Route streamed chunks to the audio engine, and reflect natural end of playback.
studio.on('generationChunk', (c) => {
  if (c.jobId === usePlayer.getState().jobId) audio.pushChunk(c.pcm, c.sampleRate)
})
audio.onEnded(() => {
  const s = usePlayer.getState()
  if (s.status === 'playing') usePlayer.setState({ status: 'paused' })
})

/** Play a history item by id (used by agents via play=true). */
export async function playHistoryItem(item: HistoryItem, colors?: [string, string]) {
  await usePlayer.getState().play({
    id: item.id,
    title: item.voiceName,
    subtitle: item.text,
    path: item.audioPath,
    colors,
    item
  })
}
