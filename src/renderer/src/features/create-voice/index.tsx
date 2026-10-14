import { AnimatePresence, motion } from 'motion/react'
import { Fingerprint, Wand2 } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Tabs } from '@/components/ui'
import { useApp } from '@/stores/app'
import { DesignPanel } from './design'
import { ClonePanel } from './clone'

type Mode = 'design' | 'clone'

/** One place to make new voices: describe one from scratch, or clone one from audio. */
export default function CreateVoice() {
  const route = useApp((s) => s.route)
  const navigate = useApp((s) => s.navigate)
  const mode: Mode = route.params?.mode === 'clone' ? 'clone' : 'design'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Create Voice"
        subtitle={mode === 'design' ? 'Describe a voice in plain words and hear it come to life.' : 'Clone a voice from a few seconds of any audio or video.'}
        right={
          <Tabs
            id="create-mode"
            value={mode}
            onChange={(m) => navigate('create-voice', { mode: m })}
            className="rounded-full border border-line p-0.5"
            tabs={[
              { id: 'design', label: <span className="flex items-center gap-1.5"><Wand2 className="size-3.5" />Design</span> },
              { id: 'clone', label: <span className="flex items-center gap-1.5"><Fingerprint className="size-3.5" />Clone</span> }
            ]}
          />
        }
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={mode}
          initial={{ opacity: 0, x: mode === 'clone' ? 12 : -12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: mode === 'clone' ? -12 : 12 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {mode === 'design' ? <DesignPanel /> : <ClonePanel />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
