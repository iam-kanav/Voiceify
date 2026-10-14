import { cn } from '@/lib/api'

/** ElevenLabs-style gradient orb. Spins gently while `active`. */
export function VoiceAvatar({
  colors,
  size = 36,
  active,
  className
}: {
  colors: [string, string]
  size?: number
  active?: boolean
  className?: string
}) {
  return (
    <span className={cn('relative inline-block shrink-0 rounded-full', className)} style={{ width: size, height: size }}>
      {active && (
        <span
          className="absolute inset-0 rounded-full"
          style={{ background: colors[0], animation: 'pulse-ring 1.4s ease-out infinite' }}
        />
      )}
      <span
        className="absolute inset-0 overflow-hidden rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)]"
        style={{
          background: `conic-gradient(from 210deg at 35% 35%, ${colors[0]}, ${colors[1]}, ${colors[0]})`,
          animation: active ? 'orb-spin 2.4s linear infinite' : undefined
        }}
      >
        <span
          className="absolute inset-0 rounded-full"
          style={{ background: 'radial-gradient(circle at 30% 25%, rgb(255 255 255 / 0.65), transparent 55%)' }}
        />
      </span>
    </span>
  )
}
