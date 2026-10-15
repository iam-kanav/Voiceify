import { forwardRef, type ButtonHTMLAttributes, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { motion } from 'motion/react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/api'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:opacity-90 shadow-sm',
  secondary: 'bg-muted text-ink hover:bg-line',
  outline: 'border border-line-strong bg-surface text-ink hover:bg-subtle',
  ghost: 'text-ink-2 hover:bg-muted hover:text-ink',
  danger: 'bg-danger/10 text-danger hover:bg-danger/15'
}
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-[15px] gap-2'
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'relative inline-flex select-none items-center justify-center overflow-hidden rounded-full font-medium whitespace-nowrap',
        'transition-[background-color,opacity,transform,box-shadow] duration-200 ease-out active:scale-[0.97]',
        'disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink/40',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
      {loading && variant === 'primary' && <span className="shimmer pointer-events-none absolute inset-0" />}
    </button>
  )
})

export function IconButton({
  className,
  children,
  label,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full text-ink-2 transition-all duration-150',
        'hover:bg-muted hover:text-ink active:scale-90 disabled:opacity-40 disabled:pointer-events-none',
        active && 'bg-muted text-ink',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'blue' | 'violet' | 'red'; className?: string }) {
  const tones = {
    neutral: 'bg-muted text-ink-2',
    green: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
    amber: 'bg-amber-500/14 text-amber-700 dark:text-amber-400',
    blue: 'bg-sky-500/12 text-sky-700 dark:text-sky-400',
    violet: 'bg-violet-500/12 text-violet-700 dark:text-violet-400',
    red: 'bg-red-500/12 text-red-700 dark:text-red-400'
  }
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  )
}

export function Card({ className, children, onClick }: { className?: string; children: ReactNode; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={cn('rounded-2xl border border-line bg-surface', className)}>
      {children}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-ink-3', className)} />
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40',
        checked ? 'bg-accent' : 'bg-line-strong'
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 600, damping: 35 }}
        className={cn('absolute top-0.5 size-4 rounded-full shadow-sm', checked ? 'right-0.5 bg-accent-ink' : 'left-0.5 bg-white')}
      />
    </button>
  )
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  id,
  className
}: {
  tabs: { id: T; label: ReactNode }[]
  value: T
  onChange: (v: T) => void
  id: string
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'relative h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-[13px] font-medium transition-colors',
            value === t.id ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
          )}
        >
          {value === t.id && (
            <motion.span
              layoutId={`tab-${id}`}
              className="absolute inset-0 rounded-full bg-muted"
              transition={{ type: 'spring', stiffness: 500, damping: 38 }}
            />
          )}
          <span className="relative">{t.label}</span>
        </button>
      ))}
    </div>
  )
}

export function UnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  id
}: {
  tabs: { id: T; label: ReactNode }[]
  value: T
  onChange: (v: T) => void
  id: string
}) {
  return (
    <div className="flex items-center gap-5 border-b border-line max-md:w-max">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'relative shrink-0 whitespace-nowrap pb-2.5 pt-1 text-sm font-medium transition-colors',
            value === t.id ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
          )}
        >
          {t.label}
          {value === t.id && (
            <motion.span
              layoutId={`utab-${id}`}
              className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-ink"
              transition={{ type: 'spring', stiffness: 500, damping: 38 }}
            />
          )}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, hint, children, right }: { label: ReactNode; hint?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[13px] font-medium text-ink">{label}</label>
        {right}
      </div>
      {children}
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink outline-none transition-shadow',
        'placeholder:text-ink-3 focus:border-ink/30 focus:ring-4 focus:ring-ink/5',
        className
      )}
      {...rest}
    />
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full resize-none rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-sm leading-relaxed text-ink outline-none transition-shadow',
        'placeholder:text-ink-3 focus:border-ink/30 focus:ring-4 focus:ring-ink/5',
        className
      )}
      {...rest}
    />
  )
})

export function ProgressBar({ value, className, indeterminate }: { value: number; className?: string; indeterminate?: boolean }) {
  return (
    <div className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      {indeterminate ? (
        <motion.div
          className="absolute inset-y-0 w-1/3 rounded-full bg-ink"
          animate={{ x: ['-100%', '300%'] }}
          transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
        />
      ) : (
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-ink"
          animate={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 24 }}
        />
      )}
    </div>
  )
}

export function Meter({ value, max = 5, className }: { value: number; max?: number; className?: string }) {
  return (
    <div className={cn('flex gap-0.5', className)}>
      {Array.from({ length: max }).map((_, i) => {
        const fill = Math.max(0, Math.min(1, value - i))
        return (
          <span key={i} className="relative h-1.5 w-3.5 overflow-hidden rounded-full bg-muted">
            <span className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${fill * 100}%` }} />
          </span>
        )
      })}
    </div>
  )
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center px-6 py-16 text-center"
    >
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-muted text-ink-2">{icon}</div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-ink-3">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[15px] font-semibold tracking-tight">{children}</h2>
      {right}
    </div>
  )
}
