import { useEffect, useRef, useState } from 'react'
import { Loader2, Mic, Square, Upload } from 'lucide-react'
import { errorMessage, toast } from './Toast'
import { cn, formatTime } from '@/lib/api'
import { useRaf } from '@/lib/useRaf'
import { openMic } from '@/stores/mic'

/** Shared audio inputs: drop/pick a file, or record from the microphone. */

export function Dropzone({
  onFile,
  busy,
  title = 'Upload audio',
  hint = 'Drop any audio or video file',
  className
}: {
  onFile: (f: File) => void
  busy: boolean
  title?: string
  hint?: string
  className?: string
}) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  return (
    <div
      onClick={() => input.current?.click()}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files[0]
        if (f) onFile(f)
      }}
      className={cn(
        'flex h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-center transition-all',
        over ? 'scale-[1.01] border-ink bg-muted' : 'border-line-strong hover:bg-subtle',
        className
      )}
    >
      <input
        ref={input}
        type="file"
        accept="audio/*,video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
      {busy ? <Loader2 className="size-5 animate-spin text-ink-3" /> : <Upload className="size-5 text-ink-2" />}
      <div className="text-sm font-medium">{busy ? 'Processing…' : title}</div>
      <div className="text-xs text-ink-3">{hint}</div>
    </div>
  )
}

export function Recorder({
  onDone,
  stopHint = 'Click to stop · aim for 10–20 s',
  className
}: {
  onDone: (b: ArrayBuffer) => void
  stopHint?: string
  className?: string
}) {
  const [state, setState] = useState<'idle' | 'recording'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const rec = useRef<MediaRecorder | null>(null)
  const analyser = useRef<AnalyserNode | null>(null)
  const level = useRef<HTMLDivElement>(null)
  const started = useRef(0)
  const cleanup = useRef<() => void>(() => undefined)

  useRaf(() => {
    if (!analyser.current || !level.current) return
    const data = new Uint8Array(analyser.current.fftSize)
    analyser.current.getByteTimeDomainData(data)
    let peak = 0
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128)
    level.current.style.transform = `scale(${1 + peak * 1.4})`
    setElapsed((Date.now() - started.current) / 1000)
  }, state === 'recording')

  useEffect(() => () => cleanup.current(), [])

  const start = async () => {
    try {
      const { stream, fellBack } = await openMic({ echoCancellation: true, noiseSuppression: true })
      if (fellBack) toast.info('Your chosen microphone isn’t connected', 'Recording with the system default instead. You can change it in Settings.')
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      analyser.current = ctx.createAnalyser()
      analyser.current.fftSize = 1024
      src.connect(analyser.current)
      const chunks: Blob[] = []
      const r = new MediaRecorder(stream)
      r.ondataavailable = (e) => chunks.push(e.data)
      r.onstop = async () => {
        cleanup.current()
        const blob = new Blob(chunks, { type: r.mimeType })
        onDone(await blob.arrayBuffer())
      }
      cleanup.current = () => {
        stream.getTracks().forEach((t) => t.stop())
        ctx.close()
        analyser.current = null
      }
      rec.current = r
      started.current = Date.now()
      r.start()
      setState('recording')
    } catch (e) {
      toast.error('Microphone unavailable', errorMessage(e))
    }
  }

  const stop = () => {
    rec.current?.stop()
    setState('idle')
  }

  return (
    <button
      onClick={state === 'idle' ? start : stop}
      className={cn(
        'flex h-36 flex-col items-center justify-center gap-2 rounded-2xl border text-center transition-colors',
        state === 'recording' ? 'border-danger/40 bg-danger/5' : 'border-dashed border-line-strong hover:bg-subtle',
        className
      )}
    >
      <span className="relative flex size-9 items-center justify-center">
        {state === 'recording' && <span ref={level} className="absolute inset-0 rounded-full bg-danger/25 transition-transform duration-75" />}
        <span className={cn('relative flex size-9 items-center justify-center rounded-full', state === 'recording' ? 'bg-danger text-white' : 'bg-muted text-ink-2')}>
          {state === 'recording' ? <Square className="size-3.5" fill="currentColor" /> : <Mic className="size-4" />}
        </span>
      </span>
      <div className="text-sm font-medium">{state === 'recording' ? `Recording ${formatTime(elapsed)}` : 'Record audio'}</div>
      <div className="text-xs text-ink-3">{state === 'recording' ? stopHint : 'Use your microphone'}</div>
    </button>
  )
}
