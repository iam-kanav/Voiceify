import type { ReactNode } from 'react'

export function PageHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <header className="drag relative z-30 flex shrink-0 items-end justify-between gap-4 px-8 pb-5 pt-[60px]">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {right && <div className="no-drag flex items-center gap-2">{right}</div>}
    </header>
  )
}
