import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Bot, FolderOpen, History as HistoryIcon, Pause, Play, Repeat2, Search, Share, Trash2 } from 'lucide-react'
import type { HistoryItem } from '@shared/types'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Button, EmptyState, IconButton, Input } from '@/components/ui'
import { VoiceAvatar } from '@/components/VoiceAvatar'
import { Modal } from '@/components/Modal'
import { toast } from '@/components/Toast'
import { SaveButton, useManualSave } from '@/components/SaveMode'
import { useApp } from '@/stores/app'
import { useTts } from '@/stores/tts'
import { PROVIDER_BY_ID } from '@shared/providers'
import { useSfx } from '@/stores/sfx'
import { playHistoryItem, usePlayer } from '@/stores/player'
import { cn, dayLabel, formatTime, studio } from '@/lib/api'
import { usePlayerPadding } from '@/lib/useGenerate'

export default function History() {
  const history = useApp((s) => s.history)
  const voices = useApp((s) => s.voices)
  const models = useApp((s) => s.models)
  const navigate = useApp((s) => s.navigate)
  const [q, setQ] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const pad = usePlayerPadding()
  const manual = useManualSave()
  const unsaved = history.filter((h) => h.saved === false).length

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase()
    const g = new Map<string, HistoryItem[]>()
    for (const h of history) {
      if (s && !`${h.text} ${h.voiceName}`.toLowerCase().includes(s)) continue
      const k = dayLabel(h.createdAt)
      g.set(k, [...(g.get(k) ?? []), h])
    }
    return [...g]
  }, [history, q])

  const reuse = (h: HistoryItem) => {
    if (h.mode === 'sfx') {
      useSfx.setState({
        prompt: h.text,
        ...(h.sfx ? { seconds: h.sfx.seconds, steps: h.sfx.steps, cfg: h.sfx.cfg, negativePrompt: h.sfx.negativePrompt ?? '' } : {})
      })
      navigate('sound-effects')
      return
    }
    if (h.mode === 'script') {
      useTts.setState({ text: h.text, scriptMode: true, scriptPause: h.script?.pauseSec ?? 0.35 })
      navigate('tts')
      return
    }
    const t = useTts.getState()
    const provider = h.provider ?? 'qwen3-tts'
    const voice = voices.find((v) => v.id === h.voiceId)
    useTts.setState({
      text: h.text,
      provider,
      language: h.settings.language ?? 'auto',
      instruct: h.settings.instruct ?? '',
      paramsByProvider: { ...t.paramsByProvider, [provider]: { ...t.paramsByProvider[provider], ...(h.settings.params ?? {}) } },
      ...(voice ? { voiceByProvider: { ...t.voiceByProvider, [provider]: voice.id } } : {})
    })
    if (!voice) toast.info(`“${h.voiceName}” no longer exists`, 'Another voice is selected instead.')
    navigate('tts')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="History"
        subtitle={
          manual
            ? `${history.length - unsaved} saved${unsaved ? ` · ${unsaved} not saved yet (removed when you quit)` : ''}`
            : `${history.length} generation${history.length === 1 ? '' : 's'} · stored on this computer`
        }
        right={
          history.length > 0 && (
            <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" />} onClick={() => setConfirmClear(true)}>
              Clear all
            </Button>
          )
        }
      />
      <div className={cn('scroll flex-1 px-8', pad)}>
        {history.length === 0 ? (
          <EmptyState
            icon={<HistoryIcon className="size-5" />}
            title="Nothing here yet"
            body="Generated speech and sound effects from the app, agents and the API show up here."
            action={<Button onClick={() => navigate('tts')}>Open Text to Speech</Button>}
          />
        ) : (
          <>
            <div className="relative mb-4 w-72">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search text or voice" className="h-9 pl-9" />
            </div>
            {groups.map(([day, items]) => (
              <div key={day} className="mb-6">
                <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-3">{day}</div>
                <div className="overflow-hidden rounded-2xl border border-line">
                  <AnimatePresence initial={false}>
                    {items.map((h) => (
                      <Row
                        key={h.id}
                        item={h}
                        colors={voices.find((v) => v.id === h.voiceId)?.colors ?? (h.mode === 'sfx' ? PROVIDER_BY_ID.get(h.provider ?? '')?.colors : undefined)}
                        modelName={models.find((m) => m.id === h.modelId)?.name ?? h.modelId}
                        onReuse={() => reuse(h)}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear all history?"
        description="This permanently deletes every generated audio file. Saved voices are not affected."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await studio.clearHistory()
                setConfirmClear(false)
              }}
            >
              Delete everything
            </Button>
          </>
        }
      >
        <div />
      </Modal>
    </div>
  )
}

function Row({ item, colors, modelName, onReuse }: { item: HistoryItem; colors?: [string, string]; modelName: string; onReuse: () => void }) {
  const clip = usePlayer((s) => s.clip)
  const status = usePlayer((s) => s.status)
  const current = clip?.id === item.id
  const playing = current && status === 'playing'
  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0 }}
      className={cn('group flex items-center gap-4 border-b border-line px-4 py-3 last:border-b-0 transition-colors hover:bg-subtle', current && 'bg-subtle')}
    >
      <button
        onClick={() => (current && status !== 'loading' ? usePlayer.getState().toggle() : playHistoryItem(item, colors))}
        className="relative shrink-0"
      >
        <VoiceAvatar colors={colors ?? ['#a1a1aa', '#52525b']} size={36} active={playing} />
        <span className="absolute inset-0 flex items-center justify-center text-white">
          {playing ? <Pause className="size-3.5" fill="white" /> : <Play className="ml-0.5 size-3.5 opacity-0 group-hover:opacity-100" fill="white" />}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{item.text}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
          <span className="font-medium text-ink-2">{item.voiceName}</span>·<span>{modelName}</span>·
          <span>{formatTime(item.durationSec)}</span>·
          <span>{new Date(item.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
          {item.saved === false && <Badge tone="amber">Not saved</Badge>}
          {item.source !== 'app' && (
            <Badge tone="violet">
              <Bot className="size-3" />
              {item.source === 'mcp' ? 'Agent' : 'API'}
            </Badge>
          )}
        </div>
      </div>
      {item.saved === false && <SaveButton saved={false} onSave={() => studio.saveHistory(item.id)} />}
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <IconButton label={item.mode === 'sfx' ? 'Open in Sound Effects' : 'Open in Text to Speech'} onClick={onReuse}>
          <Repeat2 className="size-4" />
        </IconButton>
        <IconButton label="Show in Finder" onClick={() => studio.revealInFinder(item.audioPath)}>
          <FolderOpen className="size-4" />
        </IconButton>
        <IconButton
          label="Export as WAV…"
          onClick={async () => {
            const p = await studio.exportAudio(item.id)
            if (p) toast.success('Exported', p)
          }}
        >
          <Share className="size-4" />
        </IconButton>
        <IconButton label="Delete" onClick={() => studio.deleteHistory(item.id)}>
          <Trash2 className="size-4" />
        </IconButton>
      </div>
    </motion.div>
  )
}
