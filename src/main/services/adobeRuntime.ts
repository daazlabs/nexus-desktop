import fs from 'node:fs'
import https from 'node:https'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, shell } from 'electron'
import { execa, type ResultPromise } from 'execa'
import { buildEnv } from '../mcp/resolveCommand.js'

// Same depth/convention as nodeServer() in mcpConnectors.ts and REPO_ROOT in
// autocadRuntime.ts: this file also lives at dist-electron/main/services/.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

// Pinned so a future upstream release can't silently change behaviour under
// us — see mcp-servers/adobe-server/NOTICE.md for the update procedure.
const UV_VERSION = '0.12.1'
const ADB_MCP_TAG = 'v0.85.4'
const PYTHON_PIN = '3.11'

// Common deps every Adobe app's MCP server needs (mirrors mcp/pyproject.toml
// upstream — not vendored as-is, see NOTICE.md for why). App-specific extras
// (e.g. numpy/pillow for Photoshop) come from AdobeAppConfig.extraWithDeps.
//
// mcp[cli] pinned below 2.0.0: that release removed `mcp.server.fastmcp`
// (renamed to `mcp.server.mcpserver`, a different API), which ps-mcp.py/
// pr-mcp.py import directly — an unpinned `uv --with mcp[cli]` would
// silently resolve to 2.0.0 on the next run and this connector would stop
// starting. Same fix applied to autocad-mac-server, which hit this first —
// see its NOTICE.md and PESQUISA/r-autocad-mac.md.
const COMMON_WITH_DEPS = ['fonttools', 'python-socketio', 'mcp[cli]==1.29.0', 'requests', 'websocket-client']

const PROXY_READY_LINE = 'running on ws://localhost:3001'

export type ProgressFn = (step: string, pct: number) => void

export interface AdobeAppConfig {
  id: 'photoshop' | 'premiere' | 'indesign'
  displayName: string
  entryScript: string
  // Exactly one of these two is set. Photoshop/Premiere have a pre-built
  // .ccx published on an adb-mcp release — downloaded as-is. InDesign
  // doesn't (see mcp-servers/adobe-server/NOTICE.md): no upstream release
  // has ever shipped one, so we build it ourselves from the vendored UXP
  // source (uxp/<buildCcxFromUxpFolder>/) — a .ccx is just that folder
  // zipped with manifest.json at the root, no signing required for UXP.
  ccxAssetName?: string
  buildCcxFromUxpFolder?: string
  extraWithDeps: string[]
  pingTool: string
}

export const PHOTOSHOP: AdobeAppConfig = {
  id: 'photoshop',
  displayName: 'Photoshop',
  entryScript: 'ps-mcp.py',
  ccxAssetName: 'Photoshop.MCP.Agent_PS.ccx',
  // pillow isn't in the README's Photoshop --with list, but ps-mcp.py uses
  // mcp.server.fastmcp.Image and pyproject.toml declares it as a hard dep —
  // see mcp-servers/adobe-server/NOTICE.md.
  extraWithDeps: ['numpy', 'pillow'],
  pingTool: 'get_documents',
}

export const PREMIERE: AdobeAppConfig = {
  id: 'premiere',
  displayName: 'Premiere Pro',
  entryScript: 'pr-mcp.py',
  ccxAssetName: 'Premiere.MCP.Agent_premierepro.ccx',
  extraWithDeps: ['pillow'],
  pingTool: 'get_project_info',
}

// id-mcp.py only imports core/socket_client — no numpy/pillow needed.
// pingTool is get_app_info, not get_documents-style: neither
// create_document (side effect) nor get_active_document_info (throws with
// no document open) are safe to poll — see mcp-servers/adobe-server/NOTICE.md.
export const INDESIGN: AdobeAppConfig = {
  id: 'indesign',
  displayName: 'InDesign',
  entryScript: 'id-mcp.py',
  buildCcxFromUxpFolder: 'id',
  extraWithDeps: [],
  pingTool: 'get_app_info',
}

function runtimeDir(): string {
  return path.join(app.getPath('userData'), 'adobe-runtime')
}
function uvDir(): string {
  return path.join(runtimeDir(), 'uv')
}
function uvExe(): string {
  return path.join(uvDir(), process.platform === 'win32' ? 'uv.exe' : 'uv')
}
function proxyDir(): string {
  return path.join(runtimeDir(), 'proxy')
}
function proxyExe(): string {
  return path.join(proxyDir(), process.platform === 'win32' ? 'adb-proxy-socket.exe' : 'adb-proxy-socket')
}
function mcpDir(): string {
  return path.join(runtimeDir(), 'mcp')
}
function ccxPath(appCfg: AdobeAppConfig): string {
  return path.join(runtimeDir(), `${appCfg.id}.ccx`)
}

// Vendored, unmodified adb-mcp Python source (github.com/mikechambers/adb-mcp,
// MIT) — see mcp-servers/adobe-server/NOTICE.md. Bundled via electron-builder's
// extraResources (same convention as autocad-server/, but not platform-gated:
// Photoshop runs on both Mac and Windows).
function vendoredSourceDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'mcp-servers', 'adobe-server')
    : path.join(REPO_ROOT, 'mcp-servers', 'adobe-server')
}

// win32 arm64 is excluded: the adb-mcp proxy only ships a win-x64 binary, and
// there's no confirmation the uv win-arm64 build + that x64 proxy interop
// works under emulation. darwin covers both arm64 and x64 (uv ships both).
export function isSupportedPlatform(): boolean {
  if (process.platform === 'darwin') return true
  if (process.platform === 'win32') return process.arch === 'x64'
  return false
}

// Shown in Settings before the user starts the install, so they know where
// everything lands and can delete it by hand later. Shared by every Adobe
// app (Photoshop/Premiere reuse the same uv, proxy and Python cache).
export function installDir(): string {
  return runtimeDir()
}

// Same stall guard as autocadRuntime.downloadFile — a hung download would
// otherwise leave "A ligar…" spinning forever with no cancel button.
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
    // Built into Windows 10+ — avoids a zip-extraction npm dependency.
    await execa('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`,
    ])
  } else {
    // macOS ships `unzip` natively.
    await execa('unzip', ['-o', zipPath, '-d', destDir])
  }
}

async function extractTarGz(tarPath: string, destDir: string): Promise<void> {
  await execa('tar', ['-xzf', tarPath, '-C', destDir])
}

// uv release asset naming confirmed against astral-sh/uv's actual releases:
// darwin -> uv-<arch>-apple-darwin.tar.gz (extracts into a uv-<triple>/
// subfolder containing `uv`+`uvx`), win32 -> uv-x86_64-pc-windows-msvc.zip
// (extracts uv.exe/uvw.exe/uvx.exe directly at the zip root, no subfolder).
function uvAssetUrl(): string {
  const base = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}`
  if (process.platform === 'darwin') {
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
    return `${base}/uv-${arch}-apple-darwin.tar.gz`
  }
  return `${base}/uv-x86_64-pc-windows-msvc.zip`
}

// adb-mcp release asset naming confirmed against the real v0.85.4 release:
// each zip contains a single executable at its root (no subfolder), named
// after the asset itself (extension-less on mac, `.exe` on Windows).
function proxyAssetUrl(): { url: string; innerName: string } {
  const base = `https://github.com/mikechambers/adb-mcp/releases/download/${ADB_MCP_TAG}`
  if (process.platform === 'darwin') {
    const name = process.arch === 'arm64' ? 'adb-proxy-socket-macos-arm64' : 'adb-proxy-socket-macos-x64'
    return { url: `${base}/${name}.zip`, innerName: name }
  }
  return { url: `${base}/adb-proxy-socket-win-x64.exe.zip`, innerName: 'adb-proxy-socket-win-x64.exe' }
}

async function ensureUv(onProgress: ProgressFn): Promise<void> {
  if (fs.existsSync(uvExe())) return
  onProgress('A descarregar o gestor Python (uv)...', 15)
  fs.mkdirSync(uvDir(), { recursive: true })
  const url = uvAssetUrl()
  const isTarGz = url.endsWith('.tar.gz')
  const archivePath = path.join(runtimeDir(), isTarGz ? 'uv.tar.gz' : 'uv.zip')
  await downloadFile(url, archivePath)
  onProgress('A extrair uv...', 25)
  if (isTarGz) {
    // Extracts into a uv-<triple>/ subfolder — move its contents up into
    // uvDir() so uvExe() finds a stable, platform-independent path.
    const tmpDir = path.join(runtimeDir(), 'uv-extract-tmp')
    fs.mkdirSync(tmpDir, { recursive: true })
    await extractTarGz(archivePath, tmpDir)
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

async function ensureProxyBinary(onProgress: ProgressFn): Promise<void> {
  if (fs.existsSync(proxyExe())) return
  onProgress('A descarregar o servidor de ligação (proxy)...', 35)
  fs.mkdirSync(proxyDir(), { recursive: true })
  const { url, innerName } = proxyAssetUrl()
  const zipPath = path.join(runtimeDir(), 'proxy.zip')
  await downloadFile(url, zipPath)
  onProgress('A extrair o proxy...', 45)
  await extractZip(zipPath, proxyDir())
  fs.rmSync(zipPath, { force: true })
  const extracted = path.join(proxyDir(), innerName)
  if (extracted !== proxyExe() && fs.existsSync(extracted)) {
    fs.renameSync(extracted, proxyExe())
  }
  // The zip's executable bit isn't reliably preserved on extraction.
  if (process.platform !== 'win32') fs.chmodSync(proxyExe(), 0o755)
}

// Checked up front, before any download: these files ship with the app, so
// if they're missing nothing later can fix it. Same rationale as
// autocadRuntime's assertVendoredSourcePresent.
function assertVendoredMcpSourcePresent(): void {
  const src = path.join(vendoredSourceDir(), 'mcp')
  if (!fs.existsSync(src)) {
    throw new Error(`Ficheiros do servidor Adobe não encontrados em "${src}" — build incompleto.`)
  }
}

// Re-copied on every call (cheap — plain-text .py files) so an app update
// always ships the latest vendored server instead of a stale copy left over
// from a previous install. Same pattern as autocadRuntime's ensureVendoredSource.
function ensureVendoredMcpSource(): void {
  const src = path.join(vendoredSourceDir(), 'mcp')
  fs.rmSync(mcpDir(), { recursive: true, force: true })
  fs.cpSync(src, mcpDir(), { recursive: true })
}

function isProxyListening(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: 3001, timeout: 700 })
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

let proxyProc: ResultPromise | null = null

// Idempotent: if a proxy is already listening on 3001 (ours from a previous
// session that didn't get cleaned up, or one the user started by hand
// following the upstream README) it's reused rather than spawning a second
// process to fight over the port.
async function ensureProxyRunning(onProgress: ProgressFn): Promise<void> {
  if (await isProxyListening()) return
  onProgress('A iniciar o servidor de ligação...', 55)
  const subprocess = execa(proxyExe(), [], { cwd: proxyDir(), reject: false })
  proxyProc = subprocess

  await new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    subprocess.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes(PROXY_READY_LINE)) finish()
    })
    // If the ready-line text ever changes upstream, fall back to a plain
    // poll instead of hanging forever — a false "ready" here just means the
    // very first plugin ping retries once more, which is harmless.
    setTimeout(async () => {
      if (settled) return
      if (await isProxyListening()) finish()
      else finish()
    }, 5000)
  })
}

export function stopProxy(): void {
  proxyProc?.kill()
  proxyProc = null
}

async function ensureCcxDownloaded(appCfg: AdobeAppConfig, onProgress: ProgressFn): Promise<string> {
  const dest = ccxPath(appCfg)
  if (fs.existsSync(dest)) return dest
  onProgress('A descarregar o instalador do plugin...', 90)
  const url = `https://github.com/mikechambers/adb-mcp/releases/download/${ADB_MCP_TAG}/${appCfg.ccxAssetName}`
  await downloadFile(url, dest)
  return dest
}

// InDesign has no release asset to download (see AdobeAppConfig's comment
// and mcp-servers/adobe-server/NOTICE.md) — a .ccx is just its plugin
// folder zipped with manifest.json at the root, so we build one from the
// vendored uxp/<folder>/ source instead. Re-built on every call the same
// way ensureVendoredMcpSource() re-copies the .py source: cheap, and keeps
// an app update from shipping a stale zip.
async function buildCcxFromSource(appCfg: AdobeAppConfig, onProgress: ProgressFn): Promise<string> {
  const dest = ccxPath(appCfg)
  fs.rmSync(dest, { force: true })
  onProgress('A preparar o instalador do plugin...', 90)
  const srcDir = path.join(vendoredSourceDir(), 'uxp', appCfg.buildCcxFromUxpFolder!)
  if (!fs.existsSync(srcDir)) {
    throw new Error(`Ficheiros do plugin ${appCfg.displayName} não encontrados em "${srcDir}" — build incompleto.`)
  }
  if (process.platform === 'win32') {
    // Compress-Archive insists on a .zip extension, so target a temp .zip
    // and rename — a .ccx is a plain zip regardless of the extension on disk.
    const tmpZip = `${dest}.zip`
    fs.rmSync(tmpZip, { force: true })
    await execa('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path "${srcDir}\\*" -DestinationPath "${tmpZip}" -Force`,
    ])
    fs.renameSync(tmpZip, dest)
  } else {
    // macOS ships `zip` natively. Run with cwd=srcDir and `.` as the input
    // so manifest.json lands at the zip's root — zipping the folder itself
    // would nest everything one level too deep and Creative Cloud wouldn't
    // find the manifest.
    await execa('zip', ['-r', '-X', dest, '.'], { cwd: srcDir })
  }
  return dest
}

async function ensureCcxReady(appCfg: AdobeAppConfig, onProgress: ProgressFn): Promise<string> {
  return appCfg.buildCcxFromUxpFolder
    ? buildCcxFromSource(appCfg, onProgress)
    : ensureCcxDownloaded(appCfg, onProgress)
}

// shell.openPath never rejects — it resolves with an error string on
// failure (e.g. no app associated with .ccx, Creative Cloud Desktop not
// installed). Surfaced as-is so the caller/UI can decide what to show; a
// manual "mostra o ficheiro" fallback (shell.showItemInFolder) always stays
// available regardless of this result.
export async function openPluginInstaller(appCfg: AdobeAppConfig): Promise<{ ok: boolean; error?: string; path: string }> {
  const ccx = ccxPath(appCfg)
  const err = await shell.openPath(ccx)
  return { ok: !err, error: err || undefined, path: ccx }
}

export function showPluginInstallerInFolder(appCfg: AdobeAppConfig): void {
  shell.showItemInFolder(ccxPath(appCfg))
}

export function isProvisioned(): boolean {
  return fs.existsSync(uvExe()) && fs.existsSync(proxyExe())
}

export interface AdobeTarget {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
}

// Idempotent: safe to call every time the user clicks "Ligar Photoshop" —
// each step is skipped if already done, so a re-click after a partial
// failure resumes rather than re-downloading everything.
export async function ensureAdobeRuntime(appCfg: AdobeAppConfig, onProgress: ProgressFn = () => {}): Promise<AdobeTarget> {
  if (!isSupportedPlatform()) {
    throw new Error(`${appCfg.displayName} só está disponível no macOS e Windows (64-bit).`)
  }
  assertVendoredMcpSourcePresent()
  fs.mkdirSync(runtimeDir(), { recursive: true })
  onProgress('A preparar...', 5)
  await ensureUv(onProgress)
  await ensureProxyBinary(onProgress)
  onProgress('A preparar o servidor MCP...', 50)
  ensureVendoredMcpSource()
  await ensureProxyRunning(onProgress)
  await ensureCcxReady(appCfg, onProgress)
  onProgress('Pronto', 95)

  // BUG FIX (12 Ago 2026, found while wiring InDesign): none of ps-mcp.py/
  // pr-mcp.py/id-mcp.py call `mcp.run()` themselves — running them directly
  // as `uv run ps-mcp.py` executes the module (registers tools, prints the
  // startup banner) and then just falls off the end of the file and exits,
  // even with stdin still open. Confirmed by hand: a live subprocess pipe to
  // `ps-mcp.py`/`id-mcp.py` this way exits within ~100ms every time — no
  // stdio server loop ever starts, so connectStdio's initialize handshake
  // always got "Connection closed". This means Photoshop/Premiere have
  // never actually completed a working MCP handshake in production, despite
  // the Settings UI showing provisioning succeed (that part never exercises
  // a real tool call). `mcp run <file>:<object>` (the `mcp[cli]` CLI's
  // "import approach" — see `mcp run --help`) imports the module and calls
  // `.run()` on the named FastMCP object itself; confirmed alive with a
  // live stdin pipe for 3s+ (vs ~100ms before) with both `mcp run` directly
  // and through `uv run ... mcp run`.
  const withArgs = [...COMMON_WITH_DEPS, ...appCfg.extraWithDeps].flatMap((d) => ['--with', d])
  return {
    command: uvExe(),
    args: ['run', '--no-project', '--python', PYTHON_PIN, ...withArgs, 'mcp', 'run', `${appCfg.entryScript}:mcp`],
    cwd: mcpDir(),
    env: buildEnv({
      UV_CACHE_DIR: path.join(runtimeDir(), 'uv-cache'),
      UV_PYTHON_INSTALL_DIR: path.join(runtimeDir(), 'uv-python'),
    }),
  }
}
