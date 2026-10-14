import type { TranscriptSegment } from './types'

export type TranscriptFormat = 'txt' | 'srt' | 'vtt'

function stamp(sec: number, sep: ',' | '.') {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`
}

/** Render a transcript as plain text or subtitles. */
export function formatTranscript(text: string, segments: TranscriptSegment[], format: TranscriptFormat): string {
  if (format === 'txt' || !segments.length) return text.trim() + '\n'
  if (format === 'srt') {
    return segments.map((s, i) => `${i + 1}\n${stamp(s.start, ',')} --> ${stamp(s.end, ',')}\n${s.text.trim()}\n`).join('\n')
  }
  return 'WEBVTT\n\n' + segments.map((s) => `${stamp(s.start, '.')} --> ${stamp(s.end, '.')}\n${s.text.trim()}\n`).join('\n')
}

/** "1:05" / "1:02:03" for transcript timestamps. */
export function clock(sec: number) {
  const t = Math.max(0, Math.floor(sec))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = String(t % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
