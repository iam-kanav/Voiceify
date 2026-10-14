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
import { selectVoice } from '@/stores/tts'
import { cn, studio } from '@/lib/api'
import { PROVIDER_BY_ID, providersForVoice, TTS_PROVIDERS } from '@shared/providers'
import { isInstalled } from '@/lib/models'
import { InfoTip } from '@/components/InfoTip'
import { usePlayerPadding } from '@/lib/useGenerate'

type Tab = string // 'all' | 'mine' | a provider id

export default function Voices() {
  const voices = useApp((s) => s.voices)
  const navigate = useApp((s) => s.navigate)
  const [tab, setTab] = useState<Tab>('all')
  const [q, setQ] = useState('')
  const pad = usePlayerPadding()

  const matching = useMemo(() => {
    const s = q.trim().toLowerCase()
    return voices.filter((v) => !s || [v.name, v.description, v.language, ...(v.tags ?? [])].join(' ').toLowerCase().includes(s))
  }, [voices, q])
  // Sections: your voices, then each model family's built-in voices.
  const sections = [
    { id: 'mine', title: 'Your voices', subtitle: 'Voices you designed or cloned. They work with every model that supports your own voices.', voices: matching.filter((v) => v.kind !== 'preset') },
    ...TTS_PROVIDERS.filter((p) => p.voices.length).map((p) => ({
      id: p.id,
      title: `${p.name} voices`,
      subtitle: `Built into ${p.name} by ${p.vendor}. ${p.tagline}`,
      voices: matching.filter((v) => v.kind === 'preset' && v.provider === p.id)
    }))
  ].filter((sec) => tab === 'all' || sec.id === tab)

  const mineCount = voices.filter((v) => v.kind !== 'preset').length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Voices"
        subtitle="Every model’s built-in voices, plus the voices you design or clone."
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
              { id: 'mine', label: `Your voices${mineCount ? ` · ${mineCount}` : ''}` },
              ...TTS_PROVIDERS.filter((p) => p.voices.length).map((p) => ({ id: p.id, label: p.name }))
            ]}
          />
          <div className="relative mb-2 w-64">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search voices" className="h-9 pl-9" />
          </div>
        </div>

        <div className="space-y-10 py-6">
          {sections.map((sec) => (
            <section key={sec.id}>
              <div className="mb-3">
                <h2 className="text-[15px] font-semibold tracking-tight">{sec.title}</h2>
                <p className="mt-0.5 text-[13px] text-ink-3">{sec.subtitle}</p>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                {sec.id === 'mine' && !q && (
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
                  {sec.voices.map((v, i) => (
                    <VoiceCard key={v.id} voice={v} index={i} onUse={() => (selectVoice(v), navigate('tts'))} />
                  ))}
                </AnimatePresence>
              </div>
              {q && !sec.voices.length && <div className="py-4 text-sm text-ink-3">No matches.</div>}
            </section>
          ))}
        </div>
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
            <Badge tone={voice.kind === 'cloned' ? 'blue' : voice.kind === 'designed' ? 'violet' : 'neutral'}>
              {voice.kind === 'preset' ? (PROVIDER_BY_ID.get(voice.provider ?? '')?.name ?? KIND_LABEL.preset) : KIND_LABEL[voice.kind]}
            </Badge>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-3">{voice.description}</p>
          {voice.kind !== 'preset' && <WorksWith voice={voice} />}
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

/** Which model families can speak one of your voices, with installed ones highlighted. */
function WorksWith({ voice }: { voice: Voice }) {
  const models = useApp((s) => s.models)
  const families = providersForVoice(voice)
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-ink-3">
      Works with
      {families.map((p) => {
        const ready = models.some((m) => m.provider === p.id && isInstalled(m) && m.capabilities.includes('voice-clone'))
        return (
          <span
            key={p.id}
            title={ready ? `${p.name} is installed` : `Install ${p.name} to use this voice with it`}
            className={cn('rounded-full px-1.5 py-px', ready ? 'bg-muted text-ink-2' : 'border border-dashed border-line-strong')}
          >
            {p.name}
          </span>
        )
      })}
      <InfoTip>
        Your voices are stored as a short reference recording, so any model that supports your own voices can speak them — including ones that can’t
        design voices themselves.
      </InfoTip>
    </div>
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
