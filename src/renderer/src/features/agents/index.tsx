import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, Plug, Terminal } from 'lucide-react'
import type { ApiServerInfo } from '@shared/types'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Button, Card, Input, SectionTitle, Toggle } from '@/components/ui'
import { InfoTip } from '@/components/InfoTip'
import { useApp } from '@/stores/app'
import { cn } from '@/lib/api'
import { usePlayerPadding } from '@/lib/useGenerate'

const NAME = 'voiceify'

interface Client {
  id: string
  name: string
  file?: string
  note?: string
  snippet: (i: ApiServerInfo) => string
  lang: 'bash' | 'json' | 'toml'
}

const stdio = (i: ApiServerInfo) => ({
  command: i.electronBinary,
  args: [i.bridgePath],
  env: { ELECTRON_RUN_AS_NODE: '1' }
})

const CLIENTS: Client[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    lang: 'bash',
    note: 'Add --scope user to make it available in every project.',
    snippet: (i) => `claude mcp add --transport http ${NAME} ${i.mcpUrl}`
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    file: '~/.codex/config.toml',
    lang: 'toml',
    snippet: (i) => `[mcp_servers.${NAME}]\nurl = "${i.mcpUrl}"\n\n# Older Codex versions (stdio only):\n# [mcp_servers.${NAME}]\n# command = "${i.electronBinary}"\n# args = ["${i.bridgePath}"]\n# env = { ELECTRON_RUN_AS_NODE = "1" }`
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    file: 'opencode.json',
    lang: 'json',
    snippet: (i) =>
      JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: { [NAME]: { type: 'remote', url: i.mcpUrl, enabled: true } } }, null, 2)
  },
  {
    id: 'cursor',
    name: 'Cursor',
    file: '~/.cursor/mcp.json',
    lang: 'json',
    snippet: (i) => JSON.stringify({ mcpServers: { [NAME]: { url: i.mcpUrl } } }, null, 2)
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    file: '~/Library/Application Support/Claude/claude_desktop_config.json',
    lang: 'json',
    note: 'Uses the bundled stdio bridge — no Node.js install required.',
    snippet: (i) => JSON.stringify({ mcpServers: { [NAME]: stdio(i) } }, null, 2)
  },
  {
    id: 'vscode',
    name: 'VS Code',
    file: '.vscode/mcp.json',
    lang: 'json',
    snippet: (i) => JSON.stringify({ servers: { [NAME]: { type: 'http', url: i.mcpUrl } } }, null, 2)
  },
  {
    id: 'zed',
    name: 'Zed',
    file: '~/.config/zed/settings.json',
    lang: 'json',
    snippet: (i) => JSON.stringify({ context_servers: { [NAME]: { ...stdio(i), source: 'custom' } } }, null, 2)
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    file: '~/.gemini/settings.json',
    lang: 'json',
    snippet: (i) => JSON.stringify({ mcpServers: { [NAME]: { httpUrl: i.mcpUrl } } }, null, 2)
  },
  {
    id: 'stdio',
    name: 'Any stdio client',
    lang: 'json',
    note: 'For clients that only support stdio. The bridge auto-launches the app if it isn’t running.',
    snippet: (i) => JSON.stringify({ [NAME]: stdio(i) }, null, 2)
  }
]

const TOOLS = [
  ['text_to_speech', 'Speak text with any voice; optional style instructions, language, play out loud'],
  ['list_voices', 'Built-in, cloned and designed voices'],
  ['design_voice', 'Invent a voice from a description, optionally save it'],
  ['clone_voice', 'Clone a voice from an audio file (auto-transcribed)'],
  ['transcribe_audio', 'Speech to text for a local audio file'],
  ['play_audio', 'Play a past generation in the app'],
  ['list_history', 'Recent generations with file paths'],
  ['list_models / install_model', 'Inspect and download models'],
  ['get_status', 'Engine state and available capabilities']
]

export default function Agents() {
  const api = useApp((s) => s.api)
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const [client, setClient] = useState('claude-code')
  const pad = usePlayerPadding()
  const c = CLIENTS.find((x) => x.id === client)!
  const snippet = useMemo(() => (api ? c.snippet(api) : ''), [api, c])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Agents & MCP"
        subtitle="Let AI assistants like Claude Code, Codex or Cursor speak, design and clone voices with Voiceify, using the standard Model Context Protocol (MCP)."
      />
      <div className={cn('scroll flex-1 space-y-8 px-8 pb-10', pad)}>
        <Card className="flex items-center gap-4 p-5">
          <span className="relative flex size-10 items-center justify-center rounded-xl bg-muted">
            <Plug className="size-5" />
            {api?.running && <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-surface bg-success" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold">
              Allow AI apps on this computer to use Voiceify
              {api?.running ? <Badge tone="green">On</Badge> : <Badge tone={api?.error ? 'red' : 'neutral'}>{api?.error ? 'Problem' : 'Off'}</Badge>}
            </div>
            <div className="mt-0.5 text-[13px] text-ink-3">
              {api?.error ? api.error : api?.running ? <span className="font-mono">{api.mcpUrl}</span> : 'Turn this on to connect coding agents and other apps.'}
            </div>
          </div>
          <PortSetting />
          <Toggle checked={!!settings?.apiEnabled} onChange={(v) => updateSettings({ apiEnabled: v })} />
        </Card>

        <section>
          <SectionTitle>Connect a client</SectionTitle>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {CLIENTS.map((x) => (
              <button
                key={x.id}
                onClick={() => setClient(x.id)}
                className={cn(
                  'relative h-8 rounded-full border px-3 text-[13px] transition-colors',
                  client === x.id ? 'border-ink text-canvas' : 'border-line text-ink-2 hover:bg-muted'
                )}
              >
                {client === x.id && (
                  <motion.span layoutId="client-pill" className="absolute inset-0 rounded-full bg-ink" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
                )}
                <span className="relative">{x.name}</span>
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={client} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <CodeBlock title={c.file ?? (c.lang === 'bash' ? 'Terminal' : 'Config')} code={snippet} />
              {c.note && <p className="mt-2 text-xs text-ink-3">{c.note}</p>}
            </motion.div>
          </AnimatePresence>
          <p className="mt-3 text-xs text-ink-3">
            Only apps on this computer can connect, and websites are blocked. Keep Voiceify running (closing the window keeps it running in the background) so
            agents can reach it.
          </p>
        </section>

        <section>
          <SectionTitle>Tools exposed to agents</SectionTitle>
          <div className="overflow-hidden rounded-2xl border border-line">
            {TOOLS.map(([name, desc]) => (
              <div key={name} className="flex items-center gap-4 border-b border-line px-4 py-2.5 last:border-b-0">
                <code className="w-56 shrink-0 font-mono text-[13px]">{name}</code>
                <span className="text-[13px] text-ink-3">{desc}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle>REST API</SectionTitle>
          <CodeBlock
            title="curl"
            code={`# Generate speech and save the WAV\ncurl -s ${api?.url}/api/tts?format=wav \\\n  -H 'content-type: application/json' \\\n  -d '{"text":"Hello from my agent!","voice":"Ryan","instructions":"Cheerful"}' -o hello.wav\n\n# List voices / models / history\ncurl -s ${api?.url}/api/voices\ncurl -s ${api?.url}/api/models\ncurl -s ${api?.url}/api/history?limit=10`}
          />
        </section>
      </div>
    </div>
  )
}

function PortSetting() {
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const [port, setPort] = useState(String(settings?.apiPort ?? ''))
  const valid = Number(port) >= 1024 && Number(port) <= 65535
  return (
    <div className="flex items-center gap-1.5">
      <span className="flex items-center gap-1 text-xs text-ink-3">
        Port
        <InfoTip>Only change this if another app already uses port {settings?.apiPort}. Agents you already connected will need the new address.</InfoTip>
      </span>
      <div className="w-20">
        <Input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} className="h-8 text-xs" />
      </div>
      {port !== String(settings?.apiPort) && (
        <Button size="sm" variant="outline" disabled={!valid} onClick={() => updateSettings({ apiPort: Number(port) })}>
          Apply
        </Button>
      )}
    </div>
  )
}

function CodeBlock({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-subtle">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="flex items-center gap-2 text-xs text-ink-3">
          <Terminal className="size-3.5" />
          {title}
        </span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-ink-2 transition-colors hover:bg-muted"
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="scroll select-text overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-ink">{code}</pre>
    </div>
  )
}
