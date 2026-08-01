import fixPath from 'fix-path'
import { app, BrowserWindow, Menu, MenuItem } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerIpcHandlers } from './ipc/tools.js'
import { initAutoUpdater } from './updater.js'
import { initRemoteCatalog } from './services/remoteCatalog.js'
import { startHealthChecker } from './services/healthChecker.js'
import { closeAllConnections } from './services/mcpConnectors.js'

// A macOS app launched from the Finder/Dock doesn't inherit the shell's PATH
// (~/.zshrc etc.) — without this, MCP servers configured with a bare
// command like "python" or "npx" fail with ENOENT even though the same
// command works fine in a terminal. Must run before anything spawns a
// process (MCP connectors connect lazily on first use, but this is cheap
// and only needs to happen once, so do it as early as possible).
fixPath()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')

const DEV_URL = 'http://localhost:5173'
const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev')

// Safety net: an unhandled error in the main process otherwise shows
// Electron's native "A JavaScript error occurred in the main process" dialog
// — a scary, technical, English-only crash screen for a non-technical user,
// and the process may not recover from it. Log it and keep the app alive
// instead of letting it reach the user raw.
process.on('uncaughtException', (err) => {
  console.error('[electron] uncaught exception in main process:', err)
})

// Without this, launching the app a second time (double-clicking the Dock
// icon while it's already running, opening it again from Spotlight, etc.)
// spawns a fully separate process instead of focusing the existing window.
// Both processes then read/write the SAME on-disk localStorage concurrently
// — Chromium's storage backend isn't safe for that, so conversations bleed
// into each other, permission prompts land in the wrong window, and streams
// die mid-response. Reported on macOS as: a second "new chat" window shows
// content from an unrelated, days-old conversation while it's still
// generating, and that conversation's stream stops responding.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null

if (gotLock) {

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'DaazNexus',
    webPreferences: {
      preload: path.join(ROOT, 'dist-electron', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const indexPath = path.join(ROOT, 'src', 'renderer', 'dist', 'index.html')
  if (isDev) {
    mainWindow.loadURL(DEV_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(indexPath)
  }

  // Electron windows have no native right-click menu by default (unlike a
  // regular browser) — build a minimal Copy/Cut/Paste/Select All one.
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu()
    if (params.isEditable) {
      menu.append(new MenuItem({ label: 'Cortar', role: 'cut', enabled: params.editFlags.canCut }))
      menu.append(new MenuItem({ label: 'Copiar', role: 'copy', enabled: params.editFlags.canCopy }))
      menu.append(new MenuItem({ label: 'Colar', role: 'paste', enabled: params.editFlags.canPaste }))
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(new MenuItem({ label: 'Selecionar tudo', role: 'selectAll' }))
    } else if (params.selectionText) {
      menu.append(new MenuItem({ label: 'Copiar', role: 'copy' }))
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(new MenuItem({ label: 'Selecionar tudo', role: 'selectAll' }))
    } else {
      menu.append(new MenuItem({ label: 'Selecionar tudo', role: 'selectAll' }))
    }
    menu.popup()
  })

  // DevTools only auto-opens in dev builds — production installs have no
  // menu bar entry for it either, so without this there is no way for a
  // non-technical user to get us a console log. Cmd+Option+I (mac) /
  // Ctrl+Shift+I (win/linux) / F12 works in every build.
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    const isDevToolsShortcut =
      (input.meta && input.alt && key === 'i') ||
      (input.control && input.shift && key === 'i') ||
      key === 'f12'
    if (isDevToolsShortcut) mainWindow?.webContents.toggleDevTools()
  })

  // A blank/white window on load failure is undiagnosable from the user's
  // side — they can't send us DevTools output over WhatsApp. Replace it with
  // a visible error page carrying the exact code/path, so a broken install
  // is at least self-reporting instead of silently white.
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error(`[electron] Failed to load: ${errorDescription} (${errorCode}) url=${validatedURL}`)
    if (!isMainFrame) return
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>DaazNexus</title></head>
      <body style="font-family:-apple-system,sans-serif;background:#1a1625;color:#e5e0f5;padding:40px;line-height:1.5">
        <h2>Não consegui carregar a aplicação</h2>
        <p>Erro: <code>${errorDescription} (${errorCode})</code></p>
        <p>URL: <code>${validatedURL}</code></p>
        <p>Ficheiro esperado: <code>${indexPath}</code></p>
        <p>Tenta reinstalar a partir do .dmg mais recente em
          <a href="https://github.com/daazlabs/nexus-desktop/releases/latest" style="color:#a78bfa">github.com/daazlabs/nexus-desktop/releases/latest</a>.
        </p>
      </body></html>`
    mainWindow?.loadURL(`data:text/html,${encodeURIComponent(html)}`)
  })

  mainWindow.webContents.on('console-message', (_event, _level, message) => {
    if (message.includes('[electron]')) {
      console.log(message)
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(() => {
  registerIpcHandlers()
  initRemoteCatalog() // non-blocking: bundled catalog serves until remote/cache applies
  startHealthChecker() // periodic provider reachability check, feeds isProviderDisabled() in fallbackChain
  createWindow()
  initAutoUpdater(isDev)

  // Registered here, not at module scope: on macOS, 'activate' can fire
  // before 'ready' on some launch paths (fresh installs especially), and
  // `new BrowserWindow()` throws "Cannot create BrowserWindow before app is
  // ready" if that happens — an uncaught exception that crashes the whole
  // main process. A listener that doesn't exist yet can't fire early.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  closeAllConnections().catch((err) => console.error('[mcp] error closing connections on quit:', err))
})

} // gotLock
