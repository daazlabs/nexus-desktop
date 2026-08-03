import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { execa } from 'execa'

// Same depth/convention as nodeServer() in mcpConnectors.ts: this file also
// lives at dist-electron/main/services/, so REPO_ROOT resolves the same way.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

// A recent CPython with prebuilt pywin32 wheels on PyPI. Windows-only
// (amd64) — the whole AutoCAD connector is Windows-only anyway (COM
// automation has no macOS/Linux equivalent).
const PYTHON_VERSION = '3.11.9'
const PYTHON_EMBED_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py'

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

export function isSupportedPlatform(): boolean {
  return process.platform === 'win32'
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

export interface AutocadTarget {
  command: string
  args: string[]
  cwd: string
}

export function isProvisioned(): boolean {
  return fs.existsSync(pythonExe()) && fs.existsSync(path.join(pythonDir(), 'Lib', 'site-packages', 'win32com'))
}

// Idempotent: safe to call every time the user clicks "Ligar AutoCAD" —
// each step is skipped if already done, so a re-click after a partial
// failure resumes rather than re-downloading everything.
export async function ensureAutocadRuntime(onProgress: ProgressFn = () => {}): Promise<AutocadTarget> {
  if (!isSupportedPlatform()) {
    throw new Error('O AutoCAD só está disponível no Windows (usa automação COM, que não existe no macOS/Linux).')
  }
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
