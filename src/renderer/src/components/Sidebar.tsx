import { motion } from 'motion/react'
import { DEFAULT_ROUTE, FEATURES, SECTION_LABELS, type Section } from '@/app/registry'
import { LogoMark } from './Logo'
import { useApp } from '@/stores/app'
import { cn } from '@/lib/api'

const ORDER: Section[] = ['playground', 'library', 'soon']

export function Sidebar() {
  const route = useApp((s) => s.route)
  const navigate = useApp((s) => s.navigate)

  const item = (id: string) => {
    const f = FEATURES.find((x) => x.id === id)!
    const active = route.id === f.id
    const Icon = f.icon
    return (
      <button
        key={f.id}
        onClick={() => navigate(f.id)}
        className={cn(
          'group relative flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] transition-colors duration-150',
          active ? 'font-medium text-ink' : 'text-ink-2 hover:bg-muted/70 hover:text-ink',
          f.status === 'soon' && !active && 'text-ink-3'
        )}
      >
        {active && (
          <motion.span
            layoutId="sidebar-active"
            className="absolute inset-0 rounded-lg bg-muted"
            transition={{ type: 'spring', stiffness: 550, damping: 40 }}
          />
        )}
        <Icon className="relative size-4 shrink-0" strokeWidth={active ? 2.2 : 1.8} />
        <span className="relative flex-1 truncate">{f.label}</span>
        {f.status === 'soon' && (
          <span className="relative rounded-full border border-line px-1.5 text-[10px] font-medium text-ink-3">Soon</span>
        )}
      </button>
    )
  }

  return (
    <aside className="flex h-full w-[244px] shrink-0 flex-col border-r border-line bg-canvas">
      <div className="drag h-[52px] shrink-0" />
      <div className="px-4 pb-4">
        <button onClick={() => navigate(DEFAULT_ROUTE)} className="flex items-center gap-2.5">
          <LogoMark size={28} />
          <span className="text-[15px] font-semibold tracking-tight">Voiceify</span>
        </button>
      </div>
      <nav className="scroll flex-1 space-y-5 px-2.5 pb-4">
        {ORDER.map((section) => {
          const items = FEATURES.filter((f) => f.section === section && !f.hidden)
          if (!items.length) return null
          return (
            <div key={section} className="space-y-0.5">
              {SECTION_LABELS[section] && (
                <div className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-ink-3">{SECTION_LABELS[section]}</div>
              )}
              {items.map((f) => item(f.id))}
            </div>
          )
        })}
      </nav>
      <div className="space-y-0.5 border-t border-line px-2.5 py-2.5">
        {FEATURES.filter((f) => f.section === 'bottom').map((f) => item(f.id))}
      </div>
    </aside>
  )
}
