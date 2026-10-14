import { Suspense, useEffect } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import { DEFAULT_ROUTE, FEATURE_BY_ID } from '@/app/registry'
import { useApp } from '@/stores/app'
import { playHistoryItem } from '@/stores/player'
import { studio } from '@/lib/api'
import { Sidebar } from '@/components/Sidebar'
import { PlayerBar } from '@/components/PlayerBar'
import { Toaster } from '@/components/Toast'
import { Button, Spinner } from '@/components/ui'
import { Onboarding } from '@/features/onboarding'

export function App() {
  const ready = useApp((s) => s.ready)
  const init = useApp((s) => s.init)
  const route = useApp((s) => s.route)
  const onboarded = useApp((s) => s.settings?.onboardingComplete)
  const initError = useApp((s) => s.initError)

  useEffect(() => {
    init()
    // Agents can ask the app to play something out loud.
    return studio.on('playHistory', async ({ id }) => {
      const list = await studio.listHistory()
      const item = list.find((h) => h.id === id)
      const voice = useApp.getState().voices.find((v) => v.id === item?.voiceId)
      if (item) playHistoryItem(item, voice?.colors)
    })
  }, [init])

  if (initError) {
    return (
      <div className="drag flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <h1 className="text-lg font-semibold">Voiceify couldn’t start</h1>
        <p className="max-w-md text-sm text-ink-3">{initError}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => studio.openDataFolder()}>
            Open data folder
          </Button>
          <Button onClick={() => window.location.reload()}>Try again</Button>
        </div>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="drag flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const feature = FEATURE_BY_ID.get(route.id) ?? FEATURE_BY_ID.get(DEFAULT_ROUTE)!
  const Page = feature.component

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full">
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="drag absolute inset-x-0 top-0 z-20 h-[52px]" />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={route.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <Suspense
                fallback={
                  <div className="flex flex-1 items-center justify-center">
                    <Spinner />
                  </div>
                }
              >
                <Page />
              </Suspense>
            </motion.div>
          </AnimatePresence>
          <PlayerBar />
        </main>
      </div>
      <AnimatePresence>{!onboarded && <Onboarding />}</AnimatePresence>
      <Toaster />
    </MotionConfig>
  )
}
