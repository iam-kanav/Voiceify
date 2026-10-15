import { MEDIA_SCHEME } from '@shared/ipc'
// In a phone's browser this provides window.studio; importing it here guarantees it runs first.
import './web-bridge'

export const studio = window.studio

/** Running in a phone's browser (phone access) rather than the Mac app. */
export const isWeb = studio.platform === 'web'

export function mediaUrl(absPath: string) {
  if (isWeb) return `/media?p=${encodeURIComponent(absPath)}`
  return `${MEDIA_SCHEME}://local${absPath.split('/').map(encodeURIComponent).join('/')}`
}

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export function formatTime(sec: number) {
  if (!isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function relativeTime(ts: number) {
  const diff = (Date.now() - ts) / 1000
  if (diff < 45) return 'Just now'
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`
  if (diff < 86400) return `${Math.round(diff / 3600)} hr ago`
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)} d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function dayLabel(ts: number) {
  const d = new Date(ts)
  const today = new Date()
  const yest = new Date(Date.now() - 86400000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}
