import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/api'

/** Anchored popover rendered in a portal; closes on outside click / Escape. */
export function Popover({
  open,
  onClose,
  anchor,
  children,
  width,
  align = 'start'
}: {
  open: boolean
  onClose: () => void
  anchor: React.RefObject<HTMLElement | null>
  children: ReactNode
  width?: number | 'anchor'
  align?: 'start' | 'end'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number; up: boolean }>()

  useLayoutEffect(() => {
    if (!open || !anchor.current) return
    const r = anchor.current.getBoundingClientRect()
    // Never wider than the screen (phones), keeping 8 px either side.
    const w = Math.min(width === 'anchor' || !width ? r.width : width, window.innerWidth - 16)
    const below = window.innerHeight - r.bottom - 12
    const above = r.top - 12
    const up = below < 260 && above > below
    const left = Math.max(8, align === 'end' ? r.right - w : Math.min(r.left, window.innerWidth - w - 8))
    setPos({ top: up ? r.top - 6 : r.bottom + 6, left, width: w, maxHeight: Math.min(480, up ? above : below), up })
  }, [open, anchor, width, align])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor.current?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, anchor])

  return createPortal(
    <AnimatePresence>
      {open && pos && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, scale: 0.97, y: pos.up ? 4 : -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
          transition={{ type: 'spring', stiffness: 520, damping: 36 }}
          style={{
            position: 'fixed',
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxHeight,
            ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
            transformOrigin: pos.up ? 'bottom' : 'top'
          }}
          className="scroll z-[80] rounded-2xl border border-line bg-surface p-1.5 shadow-[0_12px_40px_-8px_rgb(0_0_0/0.18),0_2px_6px_rgb(0_0_0/0.05)]"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export interface SelectOption<T extends string> {
  value: T
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  className
}: {
  value: T | undefined
  options: SelectOption<T>[]
  onChange: (v: T) => void
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const current = options.find((o) => o.value === value)
  return (
    <>
      <button
        ref={btn}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-line-strong bg-surface px-3 text-left text-sm transition-colors hover:bg-subtle',
          className
        )}
      >
        <span className={cn('truncate', !current && 'text-ink-3')}>{current?.label ?? placeholder}</span>
        <ChevronDown className={cn('size-4 shrink-0 text-ink-3 transition-transform duration-200', open && 'rotate-180')} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={btn} width="anchor">
        {options.map((o) => (
          <button
            key={o.value}
            disabled={o.disabled}
            onClick={() => {
              onChange(o.value)
              setOpen(false)
            }}
            className="flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-40"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate">{o.label}</div>
              {o.description && <div className="mt-0.5 text-xs text-ink-3">{o.description}</div>}
            </div>
            {o.value === value && <Check className="mt-0.5 size-4 shrink-0" />}
          </button>
        ))}
      </Popover>
    </>
  )
}
