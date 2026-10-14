import { useId } from 'react'

/** Voiceify mark: waveform bars tracing a "V". Same artwork as the app icon (build/icon.svg). */
export function LogoMark({ size = 28 }: { size?: number }) {
  const id = `logo-${useId().replace(/[^a-zA-Z0-9]/g, "")}`
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[28%] bg-[linear-gradient(180deg,#1d1d21,#060607)] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]"
      style={{ width: size, height: size }}
    >
      <svg viewBox="236 300 552 440" width={size * 0.66} height={size * 0.66} aria-hidden>
        <defs>
          <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="250" y1="300" x2="780" y2="730">
            <stop offset="0" stopColor="#a78bfa" />
            <stop offset="0.5" stopColor="#ec4899" />
            <stop offset="1" stopColor="#fb923c" />
          </linearGradient>
        </defs>
        <g fill={`url(#${id})`}>
        <rect x="245" y="309" width="38" height="150" rx="19" />
        <rect x="307" y="338" width="38" height="210" rx="19" />
        <rect x="369" y="377" width="38" height="250" rx="19" />
        <rect x="431" y="446" width="38" height="230" rx="19" />
        <rect x="493" y="525" width="38" height="190" rx="19" />
        <rect x="555" y="446" width="38" height="230" rx="19" />
        <rect x="617" y="377" width="38" height="250" rx="19" />
        <rect x="679" y="338" width="38" height="210" rx="19" />
        <rect x="741" y="309" width="38" height="150" rx="19" />
        </g>
      </svg>
    </span>
  )
}
