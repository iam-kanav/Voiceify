import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

/** All on-disk locations. Everything lives under ~/Library/Application Support/<app>. */
export const paths = {
  get root() {
    return app.getPath('userData')
  },
  get engine() {
    return join(this.root, 'engine')
  },
  get venv() {
    return join(this.engine, 'venv')
  },
  get python() {
    return process.platform === 'win32' ? join(this.venv, 'Scripts', 'python.exe') : join(this.venv, 'bin', 'python')
  },
  get bin() {
    return join(this.root, 'bin')
  },
  get models() {
    return join(this.root, 'models')
  },
  get voices() {
    return join(this.root, 'voices')
  },
  get history() {
    return join(this.root, 'history')
  },
  get tmp() {
    return join(this.root, 'tmp')
  },
  get data() {
    return join(this.root, 'data')
  },
  /** Bundled resources (engine script, MCP bridge). */
  get resources() {
    return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  },
  get engineScript() {
    return join(this.resources, 'engine', 'server.py')
  },
  get engineRequirements() {
    return join(this.resources, 'engine', 'requirements.txt')
  },
  get mcpBridge() {
    return join(this.resources, 'mcp', 'stdio-bridge.mjs')
  }
}

export function ensureDirs() {
  for (const d of [paths.engine, paths.bin, paths.models, paths.voices, paths.history, paths.tmp, paths.data]) {
    mkdirSync(d, { recursive: true })
  }
}
