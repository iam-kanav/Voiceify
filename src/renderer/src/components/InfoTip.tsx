import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/api'

/** Small (i) button that explains something on hover or keyboard focus. */
export function InfoTip({ children, className, width = 280 }: { children: ReactNode; className?: string; width?: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean }>()
  const timer = useRef<number | undefined>(undefined)

  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const up = r.bottom + 160 > window.innerHeight
    const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8))
    setPos({ left, top: up ? r.top - 8 : r.bottom + 8, up })
  }, [open, width])

  const show = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(true), 120)
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setOpen(false)
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label="More info"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className={cn('inline-flex size-4 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:text-ink', className)}
      >
        <Info className="size-3.5" />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              role="tooltip"
              initial={{ opacity: 0, y: pos.up ? 4 : -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
              transition={{ type: 'spring', stiffness: 600, damping: 38 }}
              style={{
                position: 'fixed',
                left: pos.left,
                width,
                ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top })
              }}
              className="pointer-events-none z-[90] rounded-xl bg-ink px-3 py-2.5 text-[12.5px] leading-relaxed font-normal text-canvas shadow-xl"
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
