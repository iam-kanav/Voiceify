import { useState } from 'react'
import { create } from 'zustand'
import { motion } from 'motion/react'
import { Archive, Bookmark, BookmarkCheck, Check } from 'lucide-react'
import type { AppSettings } from '@shared/types'
import { useApp } from '@/stores/app'
import { cn, studio } from '@/lib/api'
import { Modal } from './Modal'
import { Button, IconButton } from './ui'
import { errorMessage, toast } from './Toast'

type SaveMode = NonNullable<AppSettings['saveMode']>

export const SAVE_MODES: { id: SaveMode; title: string; body: string; icon: typeof Archive }[] = [
  {
    id: 'all',
    title: 'Keep everything',
    body: 'Everything you generate is saved to History automatically. Delete what you don’t want.',
    icon: Archive
  },
  {
    id: 'manual',
    title: 'Only what I save',
    body: 'Results stay until you quit Voiceify. Press Save on the ones you want to keep.',
    icon: Bookmark
  }
]

const usePrompt = create<{ resolve: ((ok: boolean) => void) | null }>(() => ({ resolve: null }))

/**
 * Asked once, right before the first generation: should results be kept automatically, or only
 * when saved? Resolves false if the person closes the question without answering.
 */
export function ensureSaveMode(): Promise<boolean> {
  if (useApp.getState().settings?.saveMode) return Promise.resolve(true)
  return new Promise((resolve) => {
    usePrompt.getState().resolve?.(false)
    usePrompt.setState({ resolve })
  })
}

/** True when results must be saved explicitly. */
export const useManualSave = () => useApp((s) => s.settings?.saveMode === 'manual')

export function SaveModePrompt() {
  const resolve = usePrompt((s) => s.resolve)
  const update = useApp((s) => s.updateSettings)
  const [pick, setPick] = useState<SaveMode>('all')
  const close = (ok: boolean) => {
    resolve?.(ok)
    usePrompt.setState({ resolve: null })
  }
  return (
    <Modal
      open={!!resolve}
      onClose={() => close(false)}
      width={520}
      title="What should Voiceify keep?"
      description="Everything stays on this computer either way. You can change this any time in Settings."
      footer={
        <Button
          onClick={async () => {
            await update({ saveMode: pick })
            close(true)
          }}
        >
          Continue
        </Button>
      }
    >
      <SaveModeChoice value={pick} onChange={setPick} />
    </Modal>
  )
}

export function SaveModeChoice({ value, onChange }: { value: SaveMode | undefined; onChange: (m: SaveMode) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {SAVE_MODES.map((m) => {
        const on = value === m.id
        return (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            className={cn(
              'relative rounded-2xl border p-4 text-left transition-all',
              on ? 'border-ink bg-subtle' : 'border-line-strong hover:bg-subtle'
            )}
          >
            <m.icon className="size-5 text-ink-2" />
            <div className="mt-3 text-sm font-semibold">{m.title}</div>
            <div className="mt-1 text-xs leading-relaxed text-ink-3">{m.body}</div>
            {on && (
              <motion.span
                layoutId="save-mode-check"
                className="absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-accent text-accent-ink"
              >
                <Check className="size-3" />
              </motion.span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Save button for a result that isn't kept yet. Shows "Saved" once kept. */
export function SaveButton({ saved, onSave, compact }: { saved: boolean; onSave: () => Promise<unknown>; compact?: boolean }) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      await onSave()
    } catch (e) {
      toast.error('Couldn’t save', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  if (compact) {
    return (
      <IconButton label={saved ? 'Saved' : 'Save'} onClick={run} disabled={saved || busy}>
        {saved ? <BookmarkCheck className="size-4 text-success" /> : <Bookmark className="size-4" />}
      </IconButton>
    )
  }
  return (
    <Button
      size="sm"
      variant={saved ? 'ghost' : 'outline'}
      disabled={saved}
      loading={busy}
      onClick={run}
      icon={saved ? <BookmarkCheck className="size-3.5 text-success" /> : <Bookmark className="size-3.5" />}
    >
      {saved ? 'Saved' : 'Save'}
    </Button>
  )
}

export const saveHistory = (id: string) => studio.saveHistory(id)
