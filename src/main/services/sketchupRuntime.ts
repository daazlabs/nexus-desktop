import fs from 'node:fs'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { execa } from 'execa'
import { buildEnv } from '../mcp/resolveCommand.js'

// Same depth/convention as autocadRuntime.ts/adobeRuntime.ts: this file also
// lives at dist-electron/main/services/.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

// Same uv pin as adobeRuntime.ts/autocadRuntime.ts — independent copy on
// purpose, see those files' comments on why each connector's runtime stays
// self-contained.
const UV_VERSION = '0.12.1'
const PYTHON_PIN = '3.11'
// mcp[cli] pinned: 2.0.0 restructured the low-level Server API this server
// uses (list_tools/call_tool/list_resources/read_resource stopped existing
// as decorators) — confirmed by hand against a test client before picking
// this version. See mcp-servers/sketchup-server/NOTICE.md.
const WITH_DEPS = ['httpx', 'mcp[cli]==1.29.0']

const SKETCHUP_HTTP_PORT = 8080

export type ProgressFn = (step: string, pct: number) => void

function runtimeDir(): string {
  return path.join(app.getPath('userData'), 'sketchup-runtime')
}
function uvDir(): string {
  return path.join(runtimeDir(), 'uv')
}
function uvExe(): string {
  return path.join(uvDir(), process.platform === 'win32' ? 'uv.exe' : 'uv')
}
function serverDir(): string {
  return path.join(runtimeDir(), 'server')
}
function scriptPath(): string {
  return path.join(serverDir(), 'src', 'sketchup_mcp', 'server.py')
}

// Vendored sketchup-mcp (MIT, tarkiin/sketchup-mcp) plus one new resource
// (vray_rendering.md) and two small fixes to server.py — see
// mcp-servers/sketchup-server/NOTICE.md.
function vendoredSourceDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'mcp-servers', 'sketchup-server')
    : path.join(REPO_ROOT, 'mcp-servers', 'sketchup-server')
}

// SketchUp has an official, cross-platform Ruby API — this connector is
// "live" (SketchUp has to be open) rather than file-based like AutoCAD Mac.
export function isSupportedPlatform(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin'
}

export function installDir(): string {
  return runtimeDir()
}

// --- Locating the SketchUp Plugins folder ---
//
// The plugin is a single .rb file the user would otherwise copy in by hand
// (see the upstream README, quoted in NOTICE.md). SketchUp names its
// per-version folder "SketchUp <year>" and only creates it after the app's
// first launch, so detection has to scan rather than assume one path.

function candidatePluginsParents(): string[] {
  if (process.platform === 'darwin') {
    return [path.join(os.homedir(), 'Library', 'Application Support')]
  }
  // Windows: %APPDATA%\SketchUp\SketchUp <version>\SketchUp\Plugins
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  return [path.join(appData, 'SketchUp')]
}

// Returns every installed version's Plugins folder, newest first (by the
// year embedded in "SketchUp <year>" — SketchUp has used that naming since
// at least 2013). Installing into all of them means it doesn't matter which
// one the user actually opens.
export function findSketchupPluginsDirs(): string[] {
  const found: { year: number; dir: string }[] = []
  for (const parent of candidatePluginsParents()) {
    let entries: string[]
    try {
      entries = fs.readdirSync(parent)
    } catch {
      continue
    }
    for (const entry of entries) {
      const m = entry.match(/^SketchUp (\d{4})$/)
      if (!m) continue
      const pluginsDir =
        process.platform === 'darwin'
          ? path.join(parent, entry, 'SketchUp', 'Plugins')
          : path.join(parent, entry, 'SketchUp', 'Plugins')
      found.push({ year: parseInt(m[1], 10), dir: pluginsDir })
    }
  }
  found.sort((a, b) => b.year - a.year)
  return found.map((f) => f.dir)
}

function installedRbPath(pluginsDir: string): string {
  return path.join(pluginsDir, 'sketchup_mcp_server.rb')
}

// Re-copied on every call (cheap — one plain-text .rb file) so an app
// update always ships the latest vendored plugin. Creates the version
// folder's Plugins dir if SketchUp created the version folder but not yet
// Plugins/ (happens on a very fresh install before first launch finishes).
function installPluginFile(pluginsDir: string): void {
  const src = path.join(vendoredSourceDir(), 'sketchup_plugin', 'sketchup_mcp_server.rb')
  fs.mkdirSync(pluginsDir, { recursive: true })
  fs.copyFileSync(src, installedRbPath(pluginsDir))
}

export function isPluginInstalled(): boolean {
  const dirs = findSketchupPluginsDirs()
  return dirs.some((d) => fs.existsSync(installedRbPath(d)))
}

// --- uv download (same recipe as adobeRuntime.ts's ensureUv) ---

const DOWNLOAD_STALL_TIMEOUT_MS = 60_000

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    let settled = false
    const fail = (err: Error) => {
      if (settled) return
      settled = true
      file.destroy()
      fs.rmSync(destPath, { force: true })
      reject(err)
    }
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    file.on('error', fail)
    const request = (u: string, redirectsLeft: number) => {
      const req = https.get(u, { headers: { 'User-Agent': 'daaznexus-desktop' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          if (redirectsLeft <= 0) {
            fail(new Error(`Demasiados redireccionamentos ao descarregar ${url}.`))
            return
          }
          request(res.headers.location, redirectsLeft - 1)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          fail(new Error(`Falha ao descarregar (${res.statusCode}) de ${u}.`))
          return
        }
        res.on('error', fail)
        res.pipe(file)
        file.on('finish', () => file.close(() => done()))
      })
      req.setTimeout(DOWNLOAD_STALL_TIMEOUT_MS, () => {
        req.destroy(
          new Error(
            `Sem resposta há ${DOWNLOAD_STALL_TIMEOUT_MS / 1000} segundos ao descarregar de ${new URL(u).host}. ` +
              'Verifica a ligação à Internet e tenta outra vez — a instalação continua de onde ficou.',
          ),
        )
      })
      req.on('error', fail)
    }
    request(url, 5)
  })
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  if (process.platform === 'win32') {
    await execa('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`,
    ])
  } else {
    await execa('unzip', ['-o', zipPath, '-d', destDir])
  }
}

function uvAssetUrl(): string {
  const base = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}`
  if (process.platform === 'darwin') {
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
    return `${base}/uv-${arch}-apple-darwin.tar.gz`
  }
  return `${base}/uv-x86_64-pc-windows-msvc.zip`
}

async function ensureUv(onProgress: ProgressFn): Promise<void> {
  if (fs.existsSync(uvExe())) return
  onProgress('A descarregar o gestor Python (uv)...', 15)
  fs.mkdirSync(uvDir(), { recursive: true })
  const url = uvAssetUrl()
  const isTarGz = url.endsWith('.tar.gz')
  const archivePath = path.join(runtimeDir(), isTarGz ? 'uv.tar.gz' : 'uv.zip')
  await downloadFile(url, archivePath)
  onProgress('A extrair uv...', 30)
  if (isTarGz) {
    const tmpDir = path.join(runtimeDir(), 'uv-extract-tmp')
    fs.mkdirSync(tmpDir, { recursive: true })
    await execa('tar', ['-xzf', archivePath, '-C', tmpDir])
    const entries = fs.readdirSync(tmpDir)
    const subdir = entries.find((e) => fs.statSync(path.join(tmpDir, e)).isDirectory())
    const srcDir = subdir ? path.join(tmpDir, subdir) : tmpDir
    for (const f of fs.readdirSync(srcDir)) {
      fs.cpSync(path.join(srcDir, f), path.join(uvDir(), f))
    }
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.chmodSync(uvExe(), 0o755)
  } else {
    await extractZip(archivePath, uvDir())
  }
  fs.rmSync(archivePath, { force: true })
}

function assertVendoredSourcePresent(): void {
  const src = vendoredSourceDir()
  if (!fs.existsSync(src)) {
    throw new Error(`Ficheiros do servidor SketchUp não encontrados em "${src}" — build incompleto.`)
  }
}

function ensureVendoredSource(): void {
  const src = vendoredSourceDir()
  fs.rmSync(serverDir(), { recursive: true, force: true })
  fs.mkdirSync(serverDir(), { recursive: true })
  fs.cpSync(path.join(src, 'src'), path.join(serverDir(), 'src'), { recursive: true })
  fs.cpSync(path.join(src, 'resources'), path.join(serverDir(), 'resources'), { recursive: true })
}

function isHttpServerListening(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: SKETCHUP_HTTP_PORT, timeout: 700 })
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

// Whether the *SketchUp side* is ready to talk to — i.e. SketchUp is open
// with the plugin loaded and its embedded HTTP server answering on 8080.
// Distinct from isProvisioned() (our files copied) the same way AutoCAD's
// "AutoCAD open" check is distinct from its Python runtime being installed.
export function isSketchupListening(): Promise<boolean> {
  return isHttpServerListening()
}

export interface SketchupTarget {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
}

export function isProvisioned(): boolean {
  return fs.existsSync(uvExe()) && isPluginInstalled()
}

// Idempotent: safe to call every time the user clicks "Ligar SketchUp" —
// each step is skipped if already done. Installs the plugin into every
// detected SketchUp version's Plugins folder (cheap, avoids guessing which
// one the user actually runs) — but does NOT restart SketchUp itself: a
// freshly-copied .rb file only loads on SketchUp's next startup, same
// manual-restart requirement the upstream README documents, so this throws
// a clear, actionable error rather than silently failing to connect.
export async function ensureSketchupRuntime(onProgress: ProgressFn = () => {}): Promise<SketchupTarget> {
  if (!isSupportedPlatform()) {
    throw new Error('O SketchUp só está disponível no Windows e no macOS.')
  }
  assertVendoredSourcePresent()
  fs.mkdirSync(runtimeDir(), { recursive: true })
  onProgress('A preparar...', 5)
  await ensureUv(onProgress)
  onProgress('A preparar o servidor SketchUp...', 60)
  ensureVendoredSource()

  const pluginsDirs = findSketchupPluginsDirs()
  if (pluginsDirs.length === 0) {
    throw new Error(
      'Não encontrámos nenhuma instalação do SketchUp neste computador. Abre o SketchUp pelo menos uma vez e tenta de novo.',
    )
  }
  onProgress('A instalar o plugin no SketchUp...', 80)
  for (const dir of pluginsDirs) installPluginFile(dir)

  onProgress('Pronto', 100)
  const withArgs = WITH_DEPS.flatMap((d) => ['--with', d])
  return {
    command: uvExe(),
    args: ['run', '--no-project', '--python', PYTHON_PIN, ...withArgs, scriptPath()],
    cwd: serverDir(),
    env: buildEnv({
      UV_CACHE_DIR: path.join(runtimeDir(), 'uv-cache'),
      UV_PYTHON_INSTALL_DIR: path.join(runtimeDir(), 'uv-python'),
    }),
  }
}
