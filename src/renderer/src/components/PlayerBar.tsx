import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Loader2, Pause, Play, RotateCcw, Share, Square, X } from 'lucide-react'
import { usePlayer } from '@/stores/player'
import { audio } from '@/lib/audio'
import { formatTime, studio } from '@/lib/api'
import { useRaf } from '@/lib/useRaf'
import { IconButton } from './ui'
import { VoiceAvatar } from './VoiceAvatar'
import { EqBars, Waveform } from './Waveform'
import { toast } from './Toast'
import { SaveButton, useManualSave } from './SaveMode'
import { useApp } from '@/stores/app'


export function PlayerBar() {
  const { clip, status, peaks, toggle, seek, close, stopGeneration } = usePlayer()
  const timeRef = useRef<HTMLSpanElement>(null)
  const durRef = useRef<HTMLSpanElement>(null)
  const visible = !!clip && status !== 'idle'
  const manual = useManualSave()
  // The history list is the source of truth for whether this clip has been saved.
  const entry = useApp((s) => (clip?.item ? s.history.find((h) => h.id === clip.item!.id) : undefined))
  const canSave = manual && !!clip?.item && !clip.item.ephemeral && clip.item.source === 'app'

  useRaf(() => {
    if (timeRef.current) timeRef.current.textContent = formatTime(audio.position())
    if (durRef.current) durRef.current.textContent = formatTime(audio.duration())
  }, visible)

  // Space toggles playback when not typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.code !== 'Space' || t.closest('input, textarea, [contenteditable], button')) return
      e.preventDefault()
      usePlayer.getState().toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <AnimatePresence>
      {visible && clip && (
        <motion.div
          initial={{ y: 90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 90, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          className="absolute inset-x-0 bottom-0 z-30 border-t border-line bg-surface/92 backdrop-blur-xl"
        >
          <div className="flex h-[72px] items-center gap-4 px-5">
            <div className="flex w-[260px] min-w-0 items-center gap-3">
              <VoiceAvatar colors={clip.colors ?? ['#a1a1aa', '#52525b']} size={36} active={status === 'streaming' || status === 'playing'} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{clip.title}</div>
                <div className="truncate text-xs text-ink-3">{clip.subtitle}</div>
              </div>
            </div>

            <button
              onClick={() => {
                if (status === 'streaming') return stopGeneration()
                if (status === 'paused' && audio.position() >= audio.duration() - 0.05) audio.seek(0)
                toggle()
              }}
              disabled={status === 'loading'}
              title={status === 'streaming' ? 'Stop generating' : status === 'playing' ? 'Pause' : 'Play'}
              className="group/play flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-transform active:scale-90 disabled:opacity-90"
            >
              {status === 'loading' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : status === 'streaming' ? (
                <>
                  <EqBars className="group-hover/play:hidden" />
                  <Square className="hidden size-3.5 group-hover/play:block" fill="currentColor" />
                </>
              ) : status === 'playing' ? (
                <Pause className="size-4" fill="currentColor" />
              ) : (
                <Play className="ml-0.5 size-4" fill="currentColor" />
              )}
            </button>

            <span ref={timeRef} className="w-10 text-right text-xs tabular-nums text-ink-3">
              0:00
            </span>
            <div className="min-w-0 flex-1">
              {status === 'streaming' ? (
                <div className="flex h-8 items-center gap-2 text-xs text-ink-3">
                  <motion.div
                    className="h-1 flex-1 rounded-full bg-gradient-to-r from-transparent via-ink/40 to-transparent bg-[length:50%_100%] bg-no-repeat"
                    animate={{ backgroundPositionX: ['-50%', '150%'] }}
                    transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }}
                  />
                  Generating…
                </div>
              ) : (
                <Waveform
                  peaks={peaks}
                  active={status === 'playing' || status === 'paused'}
                  onSeek={(f) => seek(f * audio.duration())}
                />
              )}
            </div>
            <span ref={durRef} className="w-10 text-xs tabular-nums text-ink-3">
              0:00
            </span>

            <div className="flex items-center gap-1">
              {clip.item && (
                <IconButton
                  label="Replay"
                  disabled={status === 'streaming' || status === 'loading'}
                  onClick={() => {
                    audio.play(0)
                    usePlayer.setState({ status: 'playing' })
                  }}
                >
                  <RotateCcw className="size-4" />
                </IconButton>
              )}
              {canSave && (
                <SaveButton
                  saved={(entry ?? clip.item!).saved !== false}
                  onSave={async () => {
                    await studio.saveHistory(clip.item!.id)
                    toast.success('Saved to History')
                  }}
                />
              )}
              {clip.item && (
                <IconButton
                  label="Export as WAV…"
                  onClick={async () => {
                    const p = await studio.exportAudio(clip.item!.id)
                    if (p) toast.success('Exported', p)
                  }}
                >
                  <Share className="size-4" />
                </IconButton>
              )}
              <IconButton label={status === 'streaming' ? 'Stop and close' : 'Close player'} onClick={close}>
                <X className="size-4" />
              </IconButton>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
