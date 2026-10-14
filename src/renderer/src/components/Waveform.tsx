import { useRef } from 'react'
import { audio } from '@/lib/audio'
import { useRaf } from '@/lib/useRaf'
import { cn } from '@/lib/api'

/** Bar waveform with a progress overlay driven by rAF (no React re-renders while playing). */
export function Waveform({
  peaks,
  active,
  onSeek,
  className,
  height = 32
}: {
  peaks: number[]
  active: boolean
  onSeek?: (fraction: number) => void
  className?: string
  height?: number
}) {
  const overlay = useRef<HTMLDivElement>(null)
  useRaf(() => {
    const d = audio.duration()
    const f = d ? audio.position() / d : 0
    if (overlay.current) overlay.current.style.clipPath = `inset(0 ${100 - f * 100}% 0 0)`
  }, active)

  const bars = peaks.length ? peaks : Array.from({ length: 120 }, () => 0.08)
  const renderBars = (cls: string) => (
    <div className="absolute inset-0 flex items-center gap-[2px]">
      {bars.map((p, i) => (
        <span key={i} className={cn('flex-1 rounded-full', cls)} style={{ height: `${Math.max(8, p * 100)}%` }} />
      ))}
    </div>
  )
  return (
    <div
      className={cn('relative w-full cursor-pointer', className)}
      style={{ height }}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        onSeek?.((e.clientX - r.left) / r.width)
      }}
    >
      {renderBars('bg-line-strong')}
      <div ref={overlay} className="absolute inset-0" style={{ clipPath: 'inset(0 100% 0 0)' }}>
        {renderBars('bg-ink')}
      </div>
    </div>
  )
}

export function EqBars({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex h-3.5 items-end gap-[2px]', className)}>
      {[0, 0.2, 0.4, 0.1].map((d, i) => (
        <span
          key={i}
          className="w-[3px] origin-bottom rounded-full bg-current"
          style={{ height: '100%', animation: `eq 0.9s ${d}s ease-in-out infinite` }}
        />
      ))}
    </span>
  )
}
