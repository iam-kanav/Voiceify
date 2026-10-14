import { useCallback, useRef, useState } from 'react'
import type { GenerateRequest, HistoryItem } from '@shared/types'
import { studio, uid } from './api'
import { usePlayer } from '@/stores/player'
import { errorMessage, toast } from '@/components/Toast'

/** Streamed generation wired to the global player. */
export function useGenerate() {
  const [busy, setBusy] = useState(false)
  const job = useRef<string | null>(null)

  const run = useCallback(
    async (req: GenerateRequest, meta: { title: string; colors?: [string, string] }): Promise<HistoryItem | null> => {
      const jobId = uid()
      job.current = jobId
      setBusy(true)
      const player = usePlayer.getState()
      player.beginStream(jobId, { id: jobId, title: meta.title, subtitle: req.text, colors: meta.colors })
      try {
        const item = await studio.generate({ ...req, jobId, stream: req.stream ?? true })
        await usePlayer.getState().finishStream({
          id: item.id,
          title: meta.title,
          subtitle: item.text,
          colors: meta.colors,
          path: item.audioPath,
          item
        })
        return item
      } catch (e) {
        usePlayer.getState().abortStream()
        const msg = errorMessage(e)
        if (!/cancelled/i.test(msg)) toast.error('Generation failed', msg)
        return null
      } finally {
        if (job.current === jobId) job.current = null
        setBusy(false)
      }
    },
    []
  )

  const cancel = useCallback(() => {
    if (job.current) studio.cancelGeneration(job.current)
  }, [])

  return { run, cancel, busy }
}

export function usePlayerPadding() {
  const visible = usePlayer((s) => s.clip !== null && s.status !== 'idle')
  return visible ? 'pb-[72px]' : ''
}
