import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { execa } from 'execa'
import { buildEnv } from '../mcp/resolveCommand.js'

// Same depth/convention as nodeServer() in mcpConnectors.ts: this file also
// lives at dist-electron/main/services/, so REPO_ROOT resolves the same way.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

// A recent CPython with prebuilt pywin32 wheels on PyPI. Windows-only
// (amd64) — used for the *live* COM connector, which has no macOS
// equivalent (see below for the macOS branch, which is file-based).
const PYTHON_VERSION = '3.11.9'
const PYTHON_EMBED_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py'

// macOS branch: same uv version pin as adobeRuntime.ts (kept independent —
// each connector's runtime is self-contained, same convention as the rest
// of this file already follows for autocad-runtime/ vs adobe-runtime/).
const UV_VERSION = '0.12.1'
const PYTHON_PIN = '3.11'
// mcp[cli] pinned: 2.0.0 removed `mcp.server.fastmcp` (see
// mcp-servers/autocad-mac-server/NOTICE.md) — unpinned would silently break
// on the next `uv run` dependency resolution.
const MAC_WITH_DEPS = ['ezdxf', 'mcp[cli]==1.29.0']

export type ProgressFn = (step: string, pct: number) => void

function runtimeDir(): string {
  return path.join(app.getPath('userData'), 'autocad-runtime')
}
function pythonDir(): string {
  return path.join(runtimeDir(), 'python')
}
function pythonExe(): string {
  return path.join(pythonDir(), 'python.exe')
}
function cadMcpDir(): string {
  return path.join(runtimeDir(), 'cad-mcp')
}
function scriptPath(): string {
  return path.join(cadMcpDir(), 'src', 'server.py')
}

// Vendored, unmodified CAD-MCP source (github.com/daobataotie/CAD-MCP, MIT)
// — see mcp-servers/autocad-server/NOTICE.md. Bundled the same way the
// Node-based connectors (gdrive-server etc.) are, via electron-builder's
// extraResources (Windows-only entry).
function vendoredSourceDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'mcp-servers', 'autocad-server')
    : path.join(REPO_ROOT, 'mcp-servers', 'autocad-server')
}

// --- macOS branch: file-based server (ezdxf), no live AutoCAD control ---
// See mcp-servers/autocad-mac-server/NOTICE.md and
// PESQUISA/r-autocad-mac.md for why this is a different architecture from
// the Windows COM connector rather than a port of it.
function uvDir(): string {
  return path.join(runtimeDir(), 'uv')
}
function uvExe(): string {
  return path.join(uvDir(), process.platform === 'win32' ? 'uv.exe' : 'uv')
}
function macServerDir(): string {
  return path.join(runtimeDir(), 'mac-server')
}
function vendoredMacSourceDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'mcp-servers', 'autocad-mac-server')
    : path.join(REPO_ROOT, 'mcp-servers', 'autocad-mac-server')
}

export function isSupportedPlatform(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin'
}

// Shown in Settings before the user starts the install, so they know where
// the ~40 MB ends up and can delete it by hand later if they want the space
// back (deleting it just means the next connect re-downloads).
export function installDir(): string {
  return runtimeDir()
}

// Without this, a download that stalls mid-transfer (flaky wifi, captive
// portal, python.org unreachable) leaves the install spinning forever with no
// way out — there's no cancel button. The socket timeout turns a hang into a
// normal error the user can read and retry from; re-clicking resumes, since
// every step here is idempotent.
const DOWNLOAD_STALL_TIMEOUT_MS = 60_000

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    let settled = false
    const fail = (err: Error) => {
      if (settled) return
      settled = true
      file.destroy()
      // A half-written file would make the next attempt extract garbage.
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
      const req = https.get(u, (res) => {
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

// Embeddable Python ships with site-packages import disabled by default
// (a `python3XX._pth` file with `#import site` commented out) — without
// enabling it, `pip install`ed packages are invisible to the interpreter.
// This is the standard, documented trick for using pip with the embeddable
// distribution.
function enableSitePackages(): void {
  const dir = pythonDir()
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('._pth')) continue
    const p = path.join(dir, f)
    const content = fs.readFileSync(p, 'utf-8')
    if (content.includes('#import site')) {
      fs.writeFileSync(p, content.replace('#import site', 'import site'), 'utf-8')
    }
  }
}

async function ensurePython(onProgress: ProgressFn): Promise<void> {
  if (fs.existsSync(pythonExe())) return
  onProgress('A descarregar Python portátil...', 10)
  fs.mkdirSync(pythonDir(), { recursive: true })
  const zipPath = path.join(runtimeDir(), 'python-embed.zip')
  await downloadFile(PYTHON_EMBED_URL, zipPath)
  onProgress('A extrair Python...', 30)
  // PowerShell's Expand-Archive is built into Windows 10+ — avoids adding a
  // zip-extraction npm dependency for a Windows-only feature.
  await execa('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Expand-Archive -Path "${zipPath}" -DestinationPath "${pythonDir()}" -Force`,
  ])
  fs.rmSync(zipPath, { force: true })
  enableSitePackages()
}

async function ensurePip(onProgress: ProgressFn): Promise<void> {
  if (fs.existsSync(path.join(pythonDir(), 'Scripts', 'pip.exe'))) return
  onProgress('A instalar o gestor de pacotes Python...', 45)
  const getPipPath = path.join(runtimeDir(), 'get-pip.py')
  await downloadFile(GET_PIP_URL, getPipPath)
  await execa(pythonExe(), [getPipPath, '--no-warn-script-location'], { cwd: pythonDir() })
  fs.rmSync(getPipPath, { force: true })
}

async function ensureDeps(onProgress: ProgressFn): Promise<void> {
  if (fs.existsSync(path.join(pythonDir(), 'Lib', 'site-packages', 'win32com'))) return
  onProgress('A instalar dependências (pywin32, mcp, pydantic)...', 65)
  await execa(pythonExe(), ['-m', 'pip', 'install', '--no-warn-script-location', 'pywin32', 'mcp', 'pydantic'], {
    cwd: pythonDir(),
  })
  // Best-effort only: modern pywin32 wheels place their DLLs via a .pth
  // sys.path hook and don't strictly need this, but older versions might.
  // CAD-MCP only uses late-bound win32com.client.Dispatch/GetActiveObject,
  // which doesn't need makepy/gencache registration either way.
  const postinstall = path.join(pythonDir(), 'Scripts', 'pywin32_postinstall.py')
  if (fs.existsSync(postinstall)) {
    try {
      await execa(pythonExe(), [postinstall, '-install'], { cwd: pythonDir() })
    } catch (e) {
      console.warn('[autocad] pywin32 postinstall failed (continuing — may be harmless):', e)
    }
  }
}

// Checked up front, before any download: these files ship with the app, so
// if they're missing nothing later can fix it — no point making the user
// wait through a ~40 MB Python install first.
function assertVendoredSourcePresent(): void {
  const src = vendoredSourceDir()
  if (!fs.existsSync(src)) {
    throw new Error(`Ficheiros do servidor AutoCAD não encontrados em "${src}" — build incompleto.`)
  }
}

// Re-copied on every call (cheap — a few plain-text .py files) so an app
// update always ships the latest vendored server instead of a stale copy
// left over from a previous install.
function ensureVendoredSource(): void {
  const src = vendoredSourceDir()
  fs.rmSync(cadMcpDir(), { recursive: true, force: true })
  fs.cpSync(src, cadMcpDir(), { recursive: true })
}

// --- macOS branch helpers ---

function assertVendoredMacSourcePresent(): void {
  const src = vendoredMacSourceDir()
  if (!fs.existsSync(src)) {
    throw new Error(`Ficheiros do servidor AutoCAD (Mac) não encontrados em "${src}" — build incompleto.`)
  }
}

function ensureVendoredMacSource(): void {
  const src = vendoredMacSourceDir()
  fs.rmSync(macServerDir(), { recursive: true, force: true })
  fs.cpSync(src, macServerDir(), { recursive: true })
}

// Same uv release asset naming as adobeRuntime.ts's uvAssetUrl (darwin arm64
// vs x64 tar.gz, extracting into a uv-<triple>/ subfolder).
function uvAssetUrl(): string {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  return `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${arch}-apple-darwin.tar.gz`
}

async function ensureUv(onProgress: ProgressFn): Promise<void> {
  if (fs.existsSync(uvExe())) return
  onProgress('A descarregar o gestor Python (uv)...', 20)
  fs.mkdirSync(uvDir(), { recursive: true })
  const tarPath = path.join(runtimeDir(), 'uv.tar.gz')
  await downloadFile(uvAssetUrl(), tarPath)
  onProgress('A extrair uv...', 35)
  const tmpDir = path.join(runtimeDir(), 'uv-extract-tmp')
  fs.mkdirSync(tmpDir, { recursive: true })
  await execa('tar', ['-xzf', tarPath, '-C', tmpDir])
  const entries = fs.readdirSync(tmpDir)
  const subdir = entries.find((e) => fs.statSync(path.join(tmpDir, e)).isDirectory())
  const srcDir = subdir ? path.join(tmpDir, subdir) : tmpDir
  for (const f of fs.readdirSync(srcDir)) {
    fs.cpSync(path.join(srcDir, f), path.join(uvDir(), f))
  }
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.rmSync(tarPath, { force: true })
  fs.chmodSync(uvExe(), 0o755)
}

// Best-effort detection of the (free) ODA File Converter install — needed
// by the Mac server only for .dwg (not .dxf) read/write, via ezdxf's odafc
// add-on. NÃO VERIFICADO: the exact app-bundle path Autodesk/ODA ships on
// macOS wasn't confirmed by our research (PESQUISA/r-autocad-mac.md §5c) —
// this scans /Applications instead of hardcoding one path, and simply
// omits ODAFC_PATH (falling back to a PATH lookup inside the server) if it
// finds nothing. Never throws: .dwg just won't be available, .dxf still is.
export function findOdafcPath(): string | null {
  if (process.platform !== 'darwin') return null
  const appsDir = '/Applications'
  try {
    const candidates = fs.readdirSync(appsDir).filter((e) => /odafileconverter/i.test(e))
    for (const candidate of candidates) {
      const macosDir = path.join(appsDir, candidate, 'Contents', 'MacOS')
      if (!fs.existsSync(macosDir)) continue
      const exe = fs.readdirSync(macosDir).find((f) => /odafileconverter/i.test(f))
      if (exe) return path.join(macosDir, exe)
    }
  } catch (e) {
    console.warn('[autocad] falha ao procurar o ODA File Converter:', e)
  }
  return null
}

export interface AutocadTarget {
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string>
}

export function isProvisioned(): boolean {
  if (process.platform === 'darwin') return fs.existsSync(uvExe())
  return fs.existsSync(pythonExe()) && fs.existsSync(path.join(pythonDir(), 'Lib', 'site-packages', 'win32com'))
}

async function ensureAutocadRuntimeMac(onProgress: ProgressFn): Promise<AutocadTarget> {
  assertVendoredMacSourcePresent()
  fs.mkdirSync(runtimeDir(), { recursive: true })
  onProgress('A preparar...', 5)
  await ensureUv(onProgress)
  onProgress('A preparar o servidor AutoCAD...', 90)
  ensureVendoredMacSource()
  const odafcPath = findOdafcPath()
  onProgress('Pronto', 100)
  const withArgs = MAC_WITH_DEPS.flatMap((d) => ['--with', d])
  return {
    command: uvExe(),
    args: ['run', '--no-project', '--python', PYTHON_PIN, ...withArgs, path.join('src', 'server.py')],
    cwd: macServerDir(),
    env: buildEnv({
      UV_CACHE_DIR: path.join(runtimeDir(), 'uv-cache'),
      UV_PYTHON_INSTALL_DIR: path.join(runtimeDir(), 'uv-python'),
      ...(odafcPath ? { ODAFC_PATH: odafcPath } : {}),
    }),
  }
}

// Idempotent: safe to call every time the user clicks "Ligar AutoCAD" —
// each step is skipped if already done, so a re-click after a partial
// failure resumes rather than re-downloading everything.
export async function ensureAutocadRuntime(onProgress: ProgressFn = () => {}): Promise<AutocadTarget> {
  if (!isSupportedPlatform()) {
    throw new Error('O AutoCAD só está disponível no Windows e no macOS.')
  }
  if (process.platform === 'darwin') return ensureAutocadRuntimeMac(onProgress)

  assertVendoredSourcePresent()
  fs.mkdirSync(runtimeDir(), { recursive: true })
  onProgress('A preparar...', 5)
  await ensurePython(onProgress)
  await ensurePip(onProgress)
  await ensureDeps(onProgress)
  onProgress('A preparar o servidor AutoCAD...', 90)
  ensureVendoredSource()
  onProgress('Pronto', 100)
  return { command: pythonExe(), args: [scriptPath()], cwd: cadMcpDir() }
}
