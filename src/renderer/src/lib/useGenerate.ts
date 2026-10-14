import { useCallback, useRef, useState } from 'react'
import type { GenerateRequest, HistoryItem, ScriptRequest } from '@shared/types'
import { studio, uid } from './api'
import { usePlayer } from '@/stores/player'
import { errorMessage, toast } from '@/components/Toast'
import { ensureSaveMode } from '@/components/SaveMode'

/** Streamed generation wired to the global player. */
export function useGenerate() {
  const [busy, setBusy] = useState(false)
  const job = useRef<string | null>(null)

  /** Stream one job into the player and hand off to the saved file when it finishes. */
  const stream = useCallback(
    async (
      call: (jobId: string) => Promise<HistoryItem>,
      meta: { title: string; subtitle: string; colors?: [string, string] },
      askSaveMode: boolean
    ): Promise<HistoryItem | null> => {
      if (askSaveMode && !(await ensureSaveMode())) return null
      const jobId = uid()
      job.current = jobId
      setBusy(true)
      const player = usePlayer.getState()
      player.beginStream(jobId, { id: jobId, title: meta.title, subtitle: meta.subtitle, colors: meta.colors })
      try {
        const item = await call(jobId)
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

  const run = useCallback(
    (req: GenerateRequest, meta: { title: string; colors?: [string, string] }) =>
      // Voice-design takes are temporary anyway; everything else asks once how to keep results.
      stream((jobId) => studio.generate({ ...req, jobId, stream: req.stream ?? true }), { ...meta, subtitle: req.text }, !(req.designPrompt && !req.voiceId)),
    [stream]
  )

  /** Script mode: several voices, streamed line by line into one clip. */
  const runScript = useCallback(
    (req: ScriptRequest, meta: { title: string; colors?: [string, string] }) =>
      stream((jobId) => studio.generateScript({ ...req, jobId, stream: req.stream ?? true }), { ...meta, subtitle: req.script }, true),
    [stream]
  )

  const cancel = useCallback(() => {
    if (job.current) studio.cancelGeneration(job.current)
  }, [])

  return { run, runScript, cancel, busy }
}

export function usePlayerPadding() {
  const visible = usePlayer((s) => s.clip !== null && s.status !== 'idle')
  return visible ? 'pb-[72px]' : ''
}
