import { cn } from '@/lib/api'
import { InfoTip } from './InfoTip'

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  left,
  right,
  format,
  hint,
  className
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  left?: string
  right?: string
  format?: (v: number) => string
  hint?: string
  className?: string
}) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
          {label}
          {hint && <InfoTip>{hint}</InfoTip>}
        </span>
        <span className="text-xs tabular-nums text-ink-3">{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--fill' as string]: `${fill}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {(left || right) && (
        <div className="flex justify-between text-[11px] text-ink-3">
          <span>{left}</span>
          <span>{right}</span>
        </div>
      )}
    </div>
  )
}
