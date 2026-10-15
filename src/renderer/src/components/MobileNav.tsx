import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { MoreHorizontal } from 'lucide-react'
import { FEATURES } from '@/app/registry'
import { useApp } from '@/stores/app'
import { cn, isWeb } from '@/lib/api'

/** The four pages people use most get a tab; everything else sits under More. */
const TABS = ['tts', 'create-voice', 'voices', 'speech-to-text']

/** Phone navigation: a bottom tab bar in place of the sidebar (hidden on wider screens). */
export function MobileNav() {
  const route = useApp((s) => s.route)
  const navigate = useApp((s) => s.navigate)
  const [more, setMore] = useState(false)
  const rest = FEATURES.filter((f) => !TABS.includes(f.id) && !f.hidden && f.status === 'ready' && !(isWeb && f.desktopOnly))
  const inMore = rest.some((f) => f.id === route.id)
  // Any page change (a link, a toast action…) closes the sheet.
  useEffect(() => setMore(false), [route])

  const go = (id: string) => {
    setMore(false)
    navigate(id)
  }

  return (
    <>
      <nav className="z-40 flex h-[var(--nav-h)] shrink-0 items-start border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {TABS.map((id) => {
          const f = FEATURES.find((x) => x.id === id)!
          const active = route.id === id
          return <Tab key={id} icon={f.icon} label={f.short ?? f.label} active={active && !more} onClick={() => go(id)} />
        })}
        <Tab icon={MoreHorizontal} label="More" active={inMore || more} onClick={() => setMore((m) => !m)} />
      </nav>

      <AnimatePresence>
        {more && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMore(false)}
              className="fixed inset-x-0 top-0 bottom-[var(--nav-h)] z-30 bg-black/30 md:hidden"
            />
            <motion.div
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
              className="fixed inset-x-2 bottom-[calc(var(--nav-h)+8px)] z-40 rounded-2xl border border-line bg-surface p-2 shadow-xl md:hidden"
            >
              {rest.map((f) => (
                <button
                  key={f.id}
                  onClick={() => go(f.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] transition-colors active:bg-muted',
                    route.id === f.id ? 'bg-muted font-medium' : 'text-ink-2'
                  )}
                >
                  <f.icon className="size-5" strokeWidth={1.8} />
                  <span className="flex-1">{f.label}</span>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}

function Tab({ icon: Icon, label, active, onClick }: { icon: React.ElementType; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn('flex h-14 flex-1 flex-col items-center justify-center gap-1 text-[10.5px]', active ? 'text-ink' : 'text-ink-3')}>
      <Icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.7} />
      <span className={cn(active && 'font-medium')}>{label}</span>
    </button>
  )
}
