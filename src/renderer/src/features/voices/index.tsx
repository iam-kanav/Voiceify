import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Fingerprint, MoreHorizontal, Pencil, Plus, Search, Trash2, Wand2 } from 'lucide-react'
import type { Voice } from '@shared/types'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Button, Input, Textarea, UnderlineTabs } from '@/components/ui'
import { VoiceAvatar } from '@/components/VoiceAvatar'
import { KIND_LABEL, PreviewButton } from '@/components/VoicePicker'
import { Modal } from '@/components/Modal'
import { Popover } from '@/components/Popover'
import { errorMessage, toast } from '@/components/Toast'
import { useApp } from '@/stores/app'
import { useTts } from '@/stores/tts'
import { cn, studio } from '@/lib/api'
import { usePlayerPadding } from '@/lib/useGenerate'

type Tab = 'all' | 'mine' | 'default'

export default function Voices() {
  const voices = useApp((s) => s.voices)
  const navigate = useApp((s) => s.navigate)
  const [tab, setTab] = useState<Tab>('all')
  const [q, setQ] = useState('')
  const pad = usePlayerPadding()

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return voices
      .filter((v) => (tab === 'all' ? true : tab === 'mine' ? v.kind !== 'preset' : v.kind === 'preset'))
      .filter((v) => !s || [v.name, v.description, v.language, ...(v.tags ?? [])].join(' ').toLowerCase().includes(s))
  }, [voices, tab, q])

  const mineCount = voices.filter((v) => v.kind !== 'preset').length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Voices"
        subtitle="Built-in model voices plus every voice you design or clone."
        right={
          <>
            <Button variant="outline" icon={<Fingerprint className="size-4" />} onClick={() => navigate('create-voice', { mode: 'clone' })}>
              Clone a voice
            </Button>
            <Button icon={<Wand2 className="size-4" />} onClick={() => navigate('create-voice', { mode: 'design' })}>
              Design a voice
            </Button>
          </>
        }
      />
      <div className={cn('scroll flex-1 px-8', pad)}>
        <div className="flex items-end justify-between gap-4">
          <UnderlineTabs
            id="voices"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'all', label: 'All voices' },
              { id: 'mine', label: `My voices${mineCount ? ` · ${mineCount}` : ''}` },
              { id: 'default', label: 'Built-in' }
            ]}
          />
          <div className="relative mb-2 w-64">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search voices" className="h-9 pl-9" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 py-6 lg:grid-cols-2 2xl:grid-cols-3">
          {tab !== 'default' && !q && (
            <motion.button
              layout
              onClick={() => navigate('create-voice')}
              className="flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong text-ink-2 transition-colors hover:bg-subtle hover:text-ink"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-muted">
                <Plus className="size-4" />
              </span>
              <span className="text-sm font-medium">Design or clone a new voice</span>
            </motion.button>
          )}
          <AnimatePresence initial={false}>
            {list.map((v, i) => (
              <VoiceCard key={v.id} voice={v} index={i} onUse={() => (useTts.getState().setVoice(v.id), navigate('tts'))} />
            ))}
          </AnimatePresence>
        </div>
        {!list.length && <div className="pb-16 text-center text-sm text-ink-3">No voices found.</div>}
      </div>

    </div>
  )
}

function VoiceCard({ voice, index, onUse }: { voice: Voice; index: number; onUse: () => void }) {
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const more = useRef<HTMLButtonElement>(null)
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { delay: Math.min(index, 12) * 0.025 } }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="group flex min-h-[132px] flex-col rounded-2xl border border-line bg-surface p-4 transition-shadow hover:shadow-[0_6px_24px_-12px_rgb(0_0_0/0.2)]"
    >
      <div className="flex items-start gap-3">
        <VoiceAvatar colors={voice.colors} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{voice.name}</span>
            <Badge tone={voice.kind === 'cloned' ? 'blue' : voice.kind === 'designed' ? 'violet' : 'neutral'}>{KIND_LABEL[voice.kind]}</Badge>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-3">{voice.description}</p>
        </div>
        <PreviewButton voice={voice} />
      </div>
      <div className="mt-auto flex items-center gap-1.5 pt-3">
        {voice.language && <Badge>{voice.language}</Badge>}
        {voice.tags?.slice(0, 2).map((t) => <Badge key={t}>{t}</Badge>)}
        <div className="flex-1" />
        {voice.kind !== 'preset' && (
          <>
            <button ref={more} onClick={() => setMenu(true)} className="flex size-8 items-center justify-center rounded-full text-ink-3 hover:bg-muted hover:text-ink">
              <MoreHorizontal className="size-4" />
            </button>
            <Popover open={menu} onClose={() => setMenu(false)} anchor={more} width={180} align="end">
              <MenuItem icon={<Pencil className="size-4" />} onClick={() => (setMenu(false), setEditing(true))}>
                Edit
              </MenuItem>
              <MenuItem
                danger
                icon={<Trash2 className="size-4" />}
                onClick={() => {
                  setMenu(false)
                  setConfirmDelete(true)
                }}
              >
                Delete
              </MenuItem>
            </Popover>
          </>
        )}
        <Button size="sm" variant="outline" onClick={onUse}>
          Use
        </Button>
      </div>
      <EditVoice voice={voice} open={editing} onClose={() => setEditing(false)} />
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete “${voice.name}”?`}
        description="Its reference audio is removed from this computer. This can’t be undone. Past generations in History are kept."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                setConfirmDelete(false)
                await studio.deleteVoice(voice.id)
                toast.success(`Deleted ${voice.name}`)
              }}
            >
              Delete voice
            </Button>
          </>
        }
      >
        <div />
      </Modal>
    </motion.div>
  )
}

function MenuItem({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors hover:bg-muted', danger && 'text-danger')}
    >
      {icon}
      {children}
    </button>
  )
}

function EditVoice({ voice, open, onClose }: { voice: Voice; open: boolean; onClose: () => void }) {
  const [name, setName] = useState(voice.name)
  const [description, setDescription] = useState(voice.description)
  const [refText, setRefText] = useState(voice.refText ?? '')
  useEffect(() => {
    if (!open) return
    setName(voice.name)
    setDescription(voice.description)
    setRefText(voice.refText ?? '')
  }, [open, voice])
  const save = async () => {
    if (!name.trim()) return
    try {
      await studio.updateVoice(voice.id, { name: name.trim(), description: description.trim(), refText: refText.trim() || undefined })
      onClose()
    } catch (e) {
      toast.error('Could not save', errorMessage(e))
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit ${voice.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <div className="text-[13px] font-medium">Name</div>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <div className="text-[13px] font-medium">Description</div>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {voice.refAudio && (
          <div className="space-y-1.5">
            <div className="text-[13px] font-medium">Reference transcript</div>
            <Textarea rows={3} value={refText} onChange={(e) => setRefText(e.target.value)} placeholder="Exact words spoken in the reference clip" />
            <p className="text-xs text-ink-3">The exact words spoken in the reference clip. An accurate transcript makes the voice sound more like the original.</p>
          </div>
        )}
      </div>
    </Modal>
  )
}
