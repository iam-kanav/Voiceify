import type { Voice } from './types'

/**
 * Script mode: one text, several speakers.
 *
 *   Narration before any tag is read by the default voice.
 *   [@Alba]: Everything after a tag is read by that voice…
 *   …until the next tag.
 *   [@Ryan, whispering]: An optional style after a comma (for models that follow style instructions).
 *
 * The parser returns typed segments so other kinds (e.g. `[sfx: door creaks]`) can be added later
 * without changing how speech segments work.
 */

export interface SpeechSegment {
  kind: 'speech'
  /** Name as written after `@`; undefined = the default voice. */
  speaker?: string
  /** Style written after the comma, e.g. "whispering". */
  style?: string
  text: string
  /** 1-based line where the segment starts (for error messages). */
  line: number
}

export type ScriptSegment = SpeechSegment

// [@Name] or [@Name, style], optionally followed by a colon.
const TAG = /\[@([^\],\n]+?)\s*(?:,\s*([^\]\n]*?)\s*)?\]\s*:?/g

export function parseScript(source: string): ScriptSegment[] {
  const out: ScriptSegment[] = []
  const lineAt = (i: number) => source.slice(0, i).split('\n').length
  const push = (text: string, start: number, speaker?: string, style?: string) => {
    const t = text.trim()
    if (!t) return
    const lead = text.length - text.trimStart().length
    out.push({ kind: 'speech', speaker, style: style || undefined, text: t, line: lineAt(start + lead) })
  }
  let last = 0
  let current: { speaker?: string; style?: string } = {}
  for (const m of source.matchAll(TAG)) {
    push(source.slice(last, m.index), last, current.speaker, current.style)
    current = { speaker: m[1].trim(), style: m[2]?.trim() }
    last = m.index! + m[0].length
  }
  push(source.slice(last), last, current.speaker, current.style)
  return out
}

/** True if the text contains at least one speaker tag. */
export function hasSpeakerTags(source: string) {
  return /\[@[^\],\n]+?\s*(?:,[^\]\n]*)?\]/.test(source)
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-.]+/g, '')

/**
 * Find the voice a tag names. Matching ignores case, spaces and underscores ("uncle fu" = "Uncle_Fu").
 * Your own voices win over built-in ones with the same name; among built-ins, `preferProvider`'s win.
 */
export function resolveSpeaker(name: string, voices: Voice[], preferProvider?: string): Voice | undefined {
  const n = norm(name)
  const matches = voices.filter((v) => norm(v.name) === n || (v.speaker && norm(v.speaker) === n))
  return (
    matches.find((v) => v.kind !== 'preset') ??
    matches.find((v) => v.provider === preferProvider) ??
    matches[0]
  )
}

/** Unique speaker names in order of first appearance. */
export function scriptSpeakers(segments: ScriptSegment[]): string[] {
  const seen = new Map<string, string>()
  for (const s of segments) if (s.speaker && !seen.has(norm(s.speaker))) seen.set(norm(s.speaker), s.speaker)
  return [...seen.values()]
}

export const SCRIPT_EXAMPLE = `[@Alba]: Did you hear that? I think it came from the attic.
[@Ryan]: It's an old house, Alba. Old houses make noises.
[@Alba, whispering]: Then why is the light on up there?`
