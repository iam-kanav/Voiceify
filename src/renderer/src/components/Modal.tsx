import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { cn } from '@/lib/api'

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 480
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <motion.div
            className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            style={{ width }}
            className="relative max-h-[86vh] overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl"
          >
            <div className="scroll max-h-[86vh]">
              {(title || description) && (
                <div className="px-6 pt-6">
                  {title && <h2 className="pr-8 text-lg font-semibold tracking-tight">{title}</h2>}
                  {description && <p className="mt-1 text-sm text-ink-3">{description}</p>}
                </div>
              )}
              <button
                onClick={onClose}
                className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full text-ink-3 transition hover:bg-muted hover:text-ink"
              >
                <X className="size-4" />
              </button>
              <div className={cn('px-6 py-5')}>{children}</div>
              {footer && <div className="flex justify-end gap-2 border-t border-line bg-subtle/60 px-6 py-4">{footer}</div>}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}
