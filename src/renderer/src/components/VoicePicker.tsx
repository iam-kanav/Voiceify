import { useMemo, useRef, useState } from 'react'
import { ChevronDown, Loader2, Pause, Play, Search } from 'lucide-react'
import type { Voice } from '@shared/types'
import { useApp } from '@/stores/app'
import { PROVIDER_BY_ID, providersForVoice } from '@shared/providers'
import { usePlayer } from '@/stores/player'
import { cn, studio } from '@/lib/api'
import { Popover } from './Popover'
import { VoiceAvatar } from './VoiceAvatar'
import { Badge } from './ui'
import { errorMessage, toast } from './Toast'

export const KIND_LABEL: Record<Voice['kind'], string> = { preset: 'Built-in', cloned: 'Cloned', designed: 'Designed' }

/** Plays a short sample of a voice (generated once and cached for presets). */
export function useVoicePreview() {
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const clip = usePlayer((s) => s.clip)
  const status = usePlayer((s) => s.status)
  const playingId = clip?.id.startsWith('preview:') && status === 'playing' ? clip.id.slice(8) : null

  const preview = async (v: Voice) => {
    if (playingId === v.id) return usePlayer.getState().toggle()
    setLoadingId(v.id)
    try {
      const { path } = await studio.previewVoice(v.id)
      await usePlayer.getState().play({ id: `preview:${v.id}`, title: v.name, subtitle: 'Voice preview', path, colors: v.colors })
    } catch (e) {
      const msg = errorMessage(e)
      toast.error(
        `Couldn't preview ${v.name}`,
        /download/i.test(msg) ? (
          <span>
            {msg}{' '}
            <button className="underline" onClick={() => useApp.getState().navigate('models')}>
              Open Models
            </button>
          </span>
        ) : (
          msg
        )
      )
    } finally {
      setLoadingId(null)
    }
  }
  return { preview, loadingId, playingId }
}

export function PreviewButton({ voice, className }: { voice: Voice; className?: string }) {
  const { preview, loadingId, playingId } = useVoicePreview()
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        preview(voice)
      }}
      title="Preview"
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink transition-all hover:bg-muted active:scale-90',
        className
      )}
    >
      {loadingId === voice.id ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : playingId === voice.id ? (
        <Pause className="size-3.5" fill="currentColor" />
      ) : (
        <Play className="ml-0.5 size-3.5" fill="currentColor" />
      )}
    </button>
  )
}

/**
 * Voice picker for one model family: its built-in voices, plus your own voices when the family can
 * clone. Voices other families own are left out, since this model can't speak them.
 */
export function VoicePicker({ value, onChange, provider }: { value: string; onChange: (id: string) => void; provider?: string }) {
  const voices = useApp((s) => s.voices)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const btn = useRef<HTMLButtonElement>(null)
  const family = provider ? PROVIDER_BY_ID.get(provider) : undefined
  const usable = useMemo(
    () => (provider ? voices.filter((v) => providersForVoice(v).some((p) => p.id === provider)) : voices),
    [voices, provider]
  )
  const current = usable.find((v) => v.id === value) ?? usable.find((v) => v.kind === 'preset') ?? usable[0]

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return usable.filter(
      (v) => !s || [v.name, v.description, v.language, ...(v.tags ?? [])].join(' ').toLowerCase().includes(s)
    )
  }, [usable, q])
  const mine = filtered.filter((v) => v.kind !== 'preset')
  const presets = filtered.filter((v) => v.kind === 'preset')
  const hasOwnVoices = voices.some((v) => v.kind !== 'preset')

  const row = (v: Voice) => (
    <div
      key={v.id}
      onClick={() => {
        onChange(v.id)
        setOpen(false)
      }}
      className={cn(
        'group flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted',
        v.id === value && 'bg-muted'
      )}
    >
      <VoiceAvatar colors={v.colors} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{v.name}</span>
          {v.language && <span className="text-[11px] text-ink-3">{v.language}</span>}
        </div>
        <div className="truncate text-xs text-ink-3">{v.description}</div>
      </div>
      <PreviewButton voice={v} className="opacity-0 group-hover:opacity-100" />
    </div>
  )

  return (
    <>
      <button
        ref={btn}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-2xl border border-line-strong bg-surface p-2.5 text-left transition-colors hover:bg-subtle"
      >
        {current && <VoiceAvatar colors={current.colors} size={36} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{current?.name ?? 'Choose a voice'}</span>
            {current && <Badge>{KIND_LABEL[current.kind]}</Badge>}
          </div>
          <div className="truncate text-xs text-ink-3">{current?.description}</div>
        </div>
        <ChevronDown className={cn('size-4 shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={btn} width={380} align="end">
        <div className="sticky top-0 z-10 -mx-1.5 -mt-1.5 mb-1 bg-surface p-1.5">
          <div className="flex h-9 items-center gap-2 rounded-xl bg-muted px-3">
            <Search className="size-4 text-ink-3" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search voices…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
            />
          </div>
        </div>
        {mine.length > 0 && (
          <>
            <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-ink-3">Your voices</div>
            {mine.map(row)}
          </>
        )}
        {presets.length > 0 && (
          <>
            <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-ink-3">{family ? `${family.name} voices` : 'Built-in voices'}</div>
            {presets.map(row)}
          </>
        )}
        {!filtered.length && <div className="px-3 py-6 text-center text-sm text-ink-3">No voices match “{q}”.</div>}
        {family && !family.features.voiceCloning && hasOwnVoices && (
          <div className="mx-1 mt-1 rounded-lg bg-subtle px-2.5 py-2 text-[11.5px] text-ink-3">
            {family.name} can only speak its built-in voices. Switch models to use your own.
          </div>
        )}
        {family?.features.voiceCloning && !hasOwnVoices && (
          <div className="mx-1 mt-1 rounded-lg bg-subtle px-2.5 py-2 text-[11.5px] text-ink-3">
            Voices you clone or design in Create Voice will appear here too.
          </div>
        )}
      </Popover>
    </>
  )
}
