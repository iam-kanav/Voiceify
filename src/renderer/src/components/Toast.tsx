import { create } from 'zustand'
import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import type { ReactNode } from 'react'

interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  title: string
  body?: ReactNode
}

const useToasts = create<{ toasts: Toast[]; push: (t: Omit<Toast, 'id'>) => void; dismiss: (id: number) => void }>((set) => ({
  toasts: [],
  push: (t) => {
    const id = Date.now() + Math.random()
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
    // Errors and toasts carrying an action (a React element) stay up long enough to read and click.
    const hasAction = t.body !== undefined && typeof t.body !== 'string'
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.kind === 'error' || hasAction ? 8000 : 3800)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }))
}))

export const toast = {
  success: (title: string, body?: ReactNode) => useToasts.getState().push({ kind: 'success', title, body }),
  error: (title: string, body?: ReactNode) => useToasts.getState().push({ kind: 'error', title, body }),
  info: (title: string, body?: ReactNode) => useToasts.getState().push({ kind: 'info', title, body })
}

export function errorMessage(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

const ICONS = {
  success: <CheckCircle2 className="size-4 text-success" />,
  error: <AlertCircle className="size-4 text-danger" />,
  info: <Info className="size-4 text-ink-2" />
}

export function Toaster() {
  const { toasts, dismiss } = useToasts()
  return (
    <div className="pointer-events-none fixed right-5 top-5 z-[60] flex w-[360px] flex-col gap-2 max-md:inset-x-3 max-md:top-[calc(env(safe-area-inset-top)+8px)] max-md:w-auto">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
            transition={{ type: 'spring', stiffness: 480, damping: 34 }}
            className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-[0_10px_30px_-10px_rgb(0_0_0/0.25)]"
          >
            <div className="mt-0.5">{ICONS[t.kind]}</div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t.title}</div>
              {t.body && <div className="mt-0.5 text-[13px] text-ink-3">{t.body}</div>}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-ink-3 hover:text-ink">
              <X className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
