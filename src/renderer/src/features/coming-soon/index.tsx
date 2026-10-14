import { motion } from 'motion/react'
import { FEATURE_BY_ID } from '@/app/registry'
import { useApp } from '@/stores/app'
import { PageHeader } from '@/components/PageHeader'

export default function ComingSoon() {
  const route = useApp((s) => s.route)
  const f = FEATURE_BY_ID.get(route.id)!
  const Icon = f.icon
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={f.label} subtitle={f.description} />
      <div className="flex flex-1 items-center justify-center pb-24">
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md text-center">
          <motion.div
            animate={{ y: [0, -6, 0] }}
            transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
            className="mx-auto mb-6 flex size-16 items-center justify-center rounded-3xl bg-muted"
          >
            <Icon className="size-7 text-ink-2" />
          </motion.div>
          <h2 className="text-lg font-semibold tracking-tight">{f.label} is coming soon</h2>
          <p className="mt-2 text-sm text-ink-3">
            We’re working on it. Like everything else in Voiceify, it will run privately on your own computer.
          </p>
        </motion.div>
      </div>
    </div>
  )
}
