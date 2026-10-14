import { app, BrowserWindow, Menu, nativeTheme, net, protocol, shell } from 'electron'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MEDIA_SCHEME } from '@shared/ipc'
import { ensureDirs, paths } from './paths'
import { registerIpc } from './ipc'
import { engine } from './engine/client'
import { models } from './models/manager'
import { history } from './library/history'
import { transcripts } from './library/transcripts'
import { startApiServer, stopApiServer } from './api/server'
import { getSettings } from './settings'
import { JsonStore } from './store'

app.setName('Voiceify')
// Lets a second, throwaway profile run side by side (used for testing first-run setup).
if (process.env.VOICEIFY_USER_DATA) app.setPath('userData', process.env.VOICEIFY_USER_DATA)

function buildMenu() {
  const isMac = process.platform === 'darwin'
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac
        ? [
            {
              label: 'Voiceify',
              submenu: [
                { role: 'about' as const, label: 'About Voiceify' },
                { type: 'separator' as const },
                { role: 'services' as const },
                { type: 'separator' as const },
                { role: 'hide' as const, label: 'Hide Voiceify' },
                { role: 'hideOthers' as const },
                { role: 'unhide' as const },
                { type: 'separator' as const },
                { role: 'quit' as const, label: 'Quit Voiceify' }
              ]
            }
          ]
        : []),
      { role: 'editMenu' as const },
      { role: 'viewMenu' as const },
      { role: 'windowMenu' as const },
      {
        role: 'help' as const,
        submenu: [{ label: 'Open Data Folder', click: () => shell.openPath(paths.root) }]
      }
    ])
  )
  app.setAboutPanelOptions({
    applicationName: 'Voiceify',
    applicationVersion: app.getVersion(),
    copyright: '© 2026 Kanav Sethi',
    credits: 'A local, multi-model voice studio.',
    iconPath: join(paths.resources, 'icon.png')
  })
}

protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: false } }
])

let mainWindow: BrowserWindow | null = null

function createWindow() {
  const theme = getSettings().theme
  nativeTheme.themeSource = theme
  mainWindow = new BrowserWindow({
    title: 'Voiceify',
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0b0c' : '#ffffff',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      // Keep audio UI and agent-triggered playback smooth while the window is in the background.
      backgroundThrottling: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.on('closed', () => (mainWindow = null))

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

/** studio-media://local/<abs path> → file, restricted to the app's data folder. */
function registerMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, async (req) => {
    const url = new URL(req.url)
    const file = resolve(decodeURIComponent(url.pathname))
    const root = resolve(paths.root) + sep
    if (!file.startsWith(root)) return new Response('Forbidden', { status: 403 })
    // The renderer runs on http://localhost in dev and file:// in production, so allow any
    // origin. Only this app's own pages can reach a custom protocol.
    const res = await net.fetch(pathToFileURL(file).toString())
    const headers = new Headers(res.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(res.body, { status: res.status, headers })
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    ensureDirs()
    models.init()
    history.init()
    transcripts.init()
    if (!app.isPackaged) app.dock?.setIcon(join(paths.resources, 'icon.png'))
    buildMenu()
    registerMediaProtocol()
    registerIpc()
    createWindow()
    await startApiServer()
    engine.boot()
    models.resumePending()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('window-all-closed', () => {
    // Keep running on macOS so agents can keep using the MCP server; quit via ⌘Q.
    if (process.platform !== 'darwin') app.quit()
  })

  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting) return
    quitting = true
    e.preventDefault()
    history.dropUnsaved()
    transcripts.dropUnsaved()
    JsonStore.flushAll()
    Promise.allSettled([engine.stop(), stopApiServer()]).finally(() => app.exit(0))
  })
}
