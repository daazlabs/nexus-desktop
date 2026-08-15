import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, shell } from 'electron'
import { WebSocket, WebSocketServer } from 'ws'
import { saveSystemKey, getSystemKey } from './keyVault.js'

// Same depth/convention as sketchupRuntime.ts/autocadRuntime.ts: this file
// also lives at dist-electron/main/services/.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

// Fixed local port for the WebSocket bridge to the browser extension —
// chosen to sit next to the existing OAuth redirect ports (Canva 53791,
// LinkedIn 53792, see mcpConnectors.ts); confirmed free against every other
// hardcoded 127.0.0.1 port in src/main (3001, 5173, 8080, 8090, 8888, 11434).
const BRIDGE_PORT = 53793

const PAIRING_CODE_VAULT_KEY = 'browser_ext_pairing_code'

const HELLO_TIMEOUT_MS = 5000
const HEARTBEAT_INTERVAL_MS = 15000
const HEARTBEAT_STALE_MS = 40000
const REQUEST_TIMEOUT_MS = 20000

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let httpServer: http.Server | null = null
let wss: WebSocketServer | null = null
let pairedSocket: WebSocket | null = null
let pairedBrowser: string | null = null
let lastPong = 0
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let requestCounter = 0
const pending = new Map<string, PendingRequest>()

function getOrCreatePairingCode(): string {
  const existing = getSystemKey(PAIRING_CODE_VAULT_KEY)
  if (existing) return existing
  const code = crypto.randomBytes(16).toString('base64url')
  saveSystemKey(PAIRING_CODE_VAULT_KEY, code)
  return code
}

export function getPairingCode(): string {
  return getOrCreatePairingCode()
}

// Invalidates whatever the extension has cached: the paired socket (if any)
// is dropped, and the next hello it (or any other) sends with the old code
// gets rejected — see handleConnection's hello_ack:false path, which makes
// the extension forget the stale token instead of retrying it forever.
export function regeneratePairingCode(): string {
  const code = crypto.randomBytes(16).toString('base64url')
  saveSystemKey(PAIRING_CODE_VAULT_KEY, code)
  if (pairedSocket) {
    try {
      pairedSocket.close()
    } catch {
      /* already gone */
    }
  }
  return code
}

export interface BridgeStatus {
  listening: boolean
  port: number
  paired: boolean
  browserLabel?: string
}

export function getStatus(): BridgeStatus {
  return {
    listening: wss !== null,
    port: BRIDGE_PORT,
    paired: isPaired(),
    browserLabel: pairedBrowser || undefined,
  }
}

export function isPaired(): boolean {
  return pairedSocket !== null && pairedSocket.readyState === WebSocket.OPEN
}

function stopHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = null
}

function failAllPending(reason: string): void {
  for (const [id, p] of pending) {
    clearTimeout(p.timer)
    p.reject(new Error(reason))
    pending.delete(id)
  }
}

function detachPaired(reason: string): void {
  stopHeartbeat()
  failAllPending(reason)
  pairedSocket = null
  pairedBrowser = null
}

function startHeartbeat(socket: WebSocket): void {
  stopHeartbeat()
  lastPong = Date.now()
  heartbeatTimer = setInterval(() => {
    if (Date.now() - lastPong > HEARTBEAT_STALE_MS) {
      console.warn('[browser-ext] paired connection went stale, dropping')
      try {
        socket.terminate()
      } catch {
        /* already gone */
      }
      detachPaired('A ligação à extensão perdeu-se.')
      return
    }
    try {
      socket.send(JSON.stringify({ type: 'ping' }))
    } catch {
      /* socket about to close, next tick's staleness check handles it */
    }
  }, HEARTBEAT_INTERVAL_MS)
}

function handleConnection(socket: WebSocket): void {
  let helloReceived = false
  const helloTimer = setTimeout(() => {
    if (!helloReceived) {
      try {
        socket.close()
      } catch {
        /* already gone */
      }
    }
  }, HELLO_TIMEOUT_MS)

  socket.on('message', (raw) => {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    if (!helloReceived) {
      clearTimeout(helloTimer)
      if (msg.type !== 'hello' || typeof msg.token !== 'string') {
        try {
          socket.close()
        } catch {
          /* already gone */
        }
        return
      }
      const expected = getOrCreatePairingCode()
      const tokenBuf = Buffer.from(msg.token)
      const expectedBuf = Buffer.from(expected)
      // Length check first: timingSafeEqual throws on mismatched lengths
      // instead of returning false.
      const ok = tokenBuf.length === expectedBuf.length && crypto.timingSafeEqual(tokenBuf, expectedBuf)
      if (!ok) {
        try {
          socket.send(JSON.stringify({ type: 'hello_ack', ok: false }))
          socket.close()
        } catch {
          /* already gone */
        }
        return
      }
      helloReceived = true
      // Single active connection by design — a new pairing replaces
      // whatever was connected before rather than stacking targets (see
      // BROWSER-EXTENSION.md for why this is enough for personal use).
      if (pairedSocket && pairedSocket !== socket) {
        console.warn('[browser-ext] replacing previously paired connection')
        try {
          pairedSocket.close()
        } catch {
          /* already gone */
        }
      }
      pairedSocket = socket
      pairedBrowser = typeof msg.browser === 'string' ? msg.browser : 'browser'
      console.log(`[browser-ext] paired: ${pairedBrowser}`)
      startHeartbeat(socket)
      try {
        socket.send(JSON.stringify({ type: 'hello_ack', ok: true }))
      } catch {
        /* already gone */
      }
      return
    }

    if (msg.type === 'pong') {
      lastPong = Date.now()
      return
    }
    if (msg.type === 'response' && typeof msg.id === 'string') {
      const p = pending.get(msg.id)
      if (!p) return
      clearTimeout(p.timer)
      pending.delete(msg.id)
      if (msg.ok) p.resolve(msg.result)
      else p.reject(new Error(typeof msg.error === 'string' ? msg.error : 'Erro desconhecido na extensão.'))
      return
    }
  })

  socket.on('close', () => {
    clearTimeout(helloTimer)
    if (pairedSocket === socket) {
      console.log('[browser-ext] extension disconnected')
      detachPaired('A extensão de browser desligou-se.')
    }
  })
  socket.on('error', (err) => {
    console.warn('[browser-ext] socket error:', err)
  })
}

// Idempotent — safe to call on every app start. Unlike SketchUp/AutoCAD
// there is no provisioning step: the bridge just listens and waits, same
// "always available" shape as getBrowserConnection() in mcpConnectors.ts.
export function ensureBridgeServer(): void {
  if (wss) return
  httpServer = http.createServer()
  wss = new WebSocketServer({ server: httpServer })
  wss.on('connection', handleConnection)
  httpServer.on('error', (err) => {
    console.error('[browser-ext] bridge server error:', err)
  })
  httpServer.listen(BRIDGE_PORT, '127.0.0.1', () => {
    console.log(`[browser-ext] bridge listening on ws://127.0.0.1:${BRIDGE_PORT}`)
  })
}

export function stopBridgeServer(): void {
  if (pairedSocket) {
    try {
      pairedSocket.close()
    } catch {
      /* already gone */
    }
  }
  detachPaired('A aplicação está a fechar.')
  wss?.close()
  wss = null
  httpServer?.close()
  httpServer = null
}

function call(method: string, params: Record<string, unknown>): Promise<any> {
  if (!isPaired() || !pairedSocket) {
    return Promise.reject(new Error('Nenhum browser está emparelhado com a extensão DaazNexus.'))
  }
  const id = `${Date.now()}-${++requestCounter}`
  const socket = pairedSocket
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`A extensão não respondeu a tempo a '${method}'.`))
    }, REQUEST_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    try {
      socket.send(JSON.stringify({ type: 'request', id, method, params }))
    } catch (e) {
      clearTimeout(timer)
      pending.delete(id)
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

interface SnapshotElement {
  ref: string
  tag: string
  role?: string
  name?: string
}
interface SnapshotResult {
  url: string
  title: string
  text: string
  elements: SnapshotElement[]
}

function formatSnapshot(r: SnapshotResult): string {
  const lines = [
    `URL: ${r.url}`,
    `Título: ${r.title}`,
    '',
    '--- Texto visível (truncado) ---',
    r.text || '(vazio)',
    '',
    '--- Elementos interativos (usa o ref entre [] com browser_click/browser_type) ---',
  ]
  if (!r.elements.length) lines.push('(nenhum elemento interativo detetado)')
  for (const el of r.elements) {
    lines.push(`[${el.ref}] ${el.tag}${el.role ? ` role=${el.role}` : ''} "${el.name || ''}"`)
  }
  return lines.join('\n')
}

function screenshotDir(): string {
  return path.join(app.getPath('userData'), 'browser-ext-screenshots')
}

async function saveScreenshot(dataUrl: string): Promise<string> {
  const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl)
  if (!match) throw new Error('Formato de screenshot inesperado da extensão.')
  const ext = match[1] === 'jpeg' ? 'jpg' : 'png'
  const buf = Buffer.from(match[2], 'base64')
  const dir = screenshotDir()
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `screenshot-${Date.now()}.${ext}`)
  fs.writeFileSync(filePath, buf)
  return filePath
}

// Dev-only trace of what the model actually received back from each
// browser_* call — nothing else in this file logs the *content* of a
// dispatch (only pairing/permission events do, see permissions.ts), so
// there was previously no way to tell, after the fact, whether a wrong
// answer came from the model inventing details or from the tool genuinely
// returning something odd. Gated on !app.isPackaged (same dev/prod signal
// extensionDistDir() already uses below) so it never runs in a shipped build.
function logDispatch(name: string, args: Record<string, unknown>, outcome: string): void {
  if (app.isPackaged) return
  console.log(`[browser-ext] ${name}(${JSON.stringify(args)}) →\n${outcome}`)
}

// Executes one of the browser_* tools (schemas in BROWSER_EXT_TOOLS,
// ipc/tools.ts) against the paired extension. Called from
// fallbackChain.ts's executeToolCall — same integration point as
// bash/read_file, because this is a first-class app tool, not an MCP
// connector: there's no subprocess speaking MCP, the bridge already runs
// in-process.
export async function dispatchBrowserTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (!isPaired()) {
    return "Error: nenhum browser está emparelhado com a extensão DaazNexus. Pede ao utilizador para ligar a extensão em Definições → Browser."
  }
  try {
    let outcome: string
    switch (name) {
      case 'browser_navigate': {
        const r = await call('navigate', { url: String(args.url || '') })
        outcome = `Navegado para ${r.url} ("${r.title}"). Usa browser_snapshot para ver o conteúdo da página.`
        break
      }
      case 'browser_snapshot': {
        const r = (await call('snapshot', {})) as SnapshotResult
        outcome = formatSnapshot(r)
        break
      }
      case 'browser_click': {
        await call('click', { ref: String(args.ref || '') })
        outcome = `Cliquei em [${args.ref}].`
        break
      }
      case 'browser_type': {
        await call('type', { ref: String(args.ref || ''), text: String(args.text || ''), submit: !!args.submit })
        outcome = `Escrevi texto em [${args.ref}]${args.submit ? ' e premi Enter' : ''}.`
        break
      }
      case 'browser_screenshot': {
        const r = await call('screenshot', {})
        const savedPath = await saveScreenshot(r.dataUrl)
        outcome = `Screenshot guardado em: ${savedPath}`
        break
      }
      default:
        outcome = `Unknown browser tool: ${name}`
    }
    logDispatch(name, args, outcome)
    return outcome
  } catch (e) {
    const errOutcome = `Error: ${e instanceof Error ? e.message : String(e)}`
    logDispatch(name, args, errOutcome)
    return errOutcome
  }
}

// --- "Show extension folder" — mirrors adobeRuntime.showPluginInstallerInFolder ---

function extensionDistDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'browser-extension', 'dist', 'chrome')
    : path.join(REPO_ROOT, 'browser-extension', 'dist', 'chrome')
}

export function showExtensionInFolder(): void {
  shell.showItemInFolder(path.join(extensionDistDir(), 'manifest.json'))
}
