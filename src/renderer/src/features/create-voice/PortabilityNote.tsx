import { Check } from 'lucide-react'
import { PROVIDER_BY_ID, TTS_PROVIDERS } from '@shared/providers'
import { VoiceAvatar } from '@/components/VoiceAvatar'
import { useApp } from '@/stores/app'
import { canSpeakOwnVoices } from '@/lib/models'
import { cn } from '@/lib/api'

/**
 * Explains which model powers this tab and which models can speak the voices it creates. Voices
 * are saved as a reference recording, so any model that can clone can use them — that's how a
 * voice designed with Qwen3-TTS can be spoken by Pocket TTS or VoxCPM2.
 */
export function PortabilityNote({ mode, designer: designerId = 'qwen3-tts' }: { mode: 'design' | 'clone'; designer?: string }) {
  const models = useApp((s) => s.models)
  const designer = PROVIDER_BY_ID.get(designerId)!
  const cloners = TTS_PROVIDERS.filter((p) => p.features.voiceCloning)
  const transcriptUsers = cloners.filter((p) => p.usesTranscript).map((p) => p.name)
  const ready = (id: string) => canSpeakOwnVoices(models, id)
  return (
    <div className="rounded-2xl border border-line p-4">
      {mode === 'design' ? (
        <div className="flex items-start gap-3">
          <VoiceAvatar colors={designer.colors} size={28} />
          <p className="text-[13px] text-ink-2">
            <b className="font-medium text-ink">Designed by {designer.name}.</b> Saved voices are stored as a short recording, so{' '}
            <b className="font-medium text-ink">any model that supports your own voices can speak them</b>, even ones that can’t design voices.
          </p>
        </div>
      ) : (
        <p className="text-[13px] text-ink-2">
          <b className="font-medium text-ink">Your clone works with every model that supports your own voices.</b> {new Intl.ListFormat('en', { type: 'conjunction' }).format(transcriptUsers).replace(', and', ' and')}{' '}
          {transcriptUsers.length === 1 ? 'uses' : 'use'} the transcript for a closer match; models that only need the audio ignore it.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-3">
        Saved voices can be spoken by
        {cloners.map((p) => (
          <span
            key={p.id}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
              ready(p.id) ? 'bg-muted text-ink-2' : 'border border-dashed border-line-strong'
            )}
            title={ready(p.id) ? `${p.name} is installed` : `Install ${p.name} on the Models page to use your voices with it`}
          >
            {ready(p.id) && <Check className="size-3" />}
            {p.name}
          </span>
        ))}
      </div>
    </div>
  )
}
