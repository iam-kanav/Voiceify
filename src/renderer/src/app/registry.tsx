import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import {
  AudioLines,
  Blocks,
  Bot,
  History,
  Library,
  Settings,
  Sparkles,
  Speech,
  Wand2,
  type LucideIcon
} from 'lucide-react'

/**
 * Feature registry — the single place that defines the app's sections.
 *
 * To add a new feature (e.g. Sound Effects):
 *   1. Create `src/renderer/src/features/sound-effects/index.tsx` exporting a default component.
 *   2. Flip its entry below to `status: 'ready'` and point `component` at it.
 *   3. Add an engine handler (resources/engine/server.py → HANDLERS), a service function in
 *      src/main/services, and optionally an MCP tool in src/main/api/mcp.ts.
 * The sidebar, routing, code-splitting and page transitions pick it up automatically.
 */

export type Section = 'playground' | 'soon' | 'library' | 'bottom'

export interface Feature {
  id: string
  label: string
  icon: LucideIcon
  section: Section
  status: 'ready' | 'soon'
  description: string
  component: LazyExoticComponent<ComponentType>
  /** Hide from the sidebar (still routable). */
  hidden?: boolean
}

const ComingSoon = lazy(() => import('@/features/coming-soon'))

export const FEATURES: Feature[] = [
  {
    id: 'tts',
    label: 'Text to Speech',
    icon: AudioLines,
    section: 'playground',
    status: 'ready',
    description: 'Turn text into lifelike speech',
    component: lazy(() => import('@/features/tts'))
  },
  {
    id: 'create-voice',
    label: 'Create Voice',
    icon: Wand2,
    section: 'playground',
    status: 'ready',
    description: 'Design a voice from a description or clone one from audio',
    component: lazy(() => import('@/features/create-voice'))
  },
  {
    id: 'voices',
    label: 'Voices',
    icon: Library,
    section: 'playground',
    status: 'ready',
    description: 'Your voice library',
    component: lazy(() => import('@/features/voices'))
  },
  {
    id: 'speech-to-text',
    label: 'Speech to Text',
    icon: Speech,
    section: 'playground',
    status: 'ready',
    description: 'Transcribe any audio or video file, locally',
    component: lazy(() => import('@/features/speech-to-text'))
  },
  {
    id: 'sound-effects',
    label: 'Sound Effects',
    icon: Sparkles,
    section: 'soon',
    status: 'soon',
    description: 'Generate sound effects from text prompts',
    component: ComingSoon
  },
  {
    id: 'history',
    label: 'History',
    icon: History,
    section: 'library',
    status: 'ready',
    description: 'Everything you have generated',
    component: lazy(() => import('@/features/history'))
  },
  {
    id: 'models',
    label: 'Models',
    icon: Blocks,
    section: 'library',
    status: 'ready',
    description: 'Download and manage models',
    component: lazy(() => import('@/features/models'))
  },
  {
    id: 'agents',
    label: 'Agents & MCP',
    icon: Bot,
    section: 'bottom',
    status: 'ready',
    description: 'Connect Claude Code, Codex, OpenCode and more',
    component: lazy(() => import('@/features/agents'))
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    section: 'bottom',
    status: 'ready',
    description: 'Preferences',
    component: lazy(() => import('@/features/settings'))
  }
]

export const FEATURE_BY_ID = new Map(FEATURES.map((f) => [f.id, f]))

export const DEFAULT_ROUTE = 'tts'

export const SECTION_LABELS: Partial<Record<Section, string>> = {
  soon: 'Coming soon',
  library: 'Library'
}
