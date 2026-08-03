import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { saveSystemKey, getSystemKey, deleteSystemKey, hasVaultKey } from './keyVault.js'
import * as mcpClient from './mcpClient.js'
import * as oauthFlow from './oauthFlow.js'
import * as customMcpServers from './customMcpServers.js'
import * as autocadRuntime from './autocadRuntime.js'
import * as adobeRuntime from './adobeRuntime.js'
import { PHOTOSHOP, PREMIERE, type AdobeAppConfig } from './adobeRuntime.js'
import type { McpConnection } from './mcpClient.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// dist-electron/main/services/mcpConnectors.js -> .../daaznexus (repo root,
// sibling of nexus-desktop/ — see mcp-servers/ layout in the plan).
// Only valid for a dev/unpacked run: nexus-desktop/ then sits inside the
// daaznexus checkout. A packaged app has no such sibling repo on the user's
// disk, so mcp-servers/ is copied into the app's own resources at build time
// (see electron-builder.yml extraResources) and read from there instead.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

function nodeServer(name: string): string[] {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'mcp-servers', name)
    : path.join(REPO_ROOT, 'mcp-servers', name)
  return ['node', path.join(base, 'dist', 'index.js')]
}

interface ConnectorDef {
  id: string
  name: string
  transport: 'streamable_http' | 'stdio'
  authMethod: 'pat' | 'oauth'
  url?: string
  command?: string[]
  buildHeaders?: (token: string) => Record<string, string>
  buildEnv?: (token: string) => Record<string, string>
}

// Each OAuth provider (Google, Canva, ...) issues a "Desktop app"-style
// client separate from any web-backend client (different redirect mechanism
// — loopback here vs a fixed HTTPS URL there). Not a real secret for an
// installed app — PKCE is what actually protects the flow — but GitHub's
// push protection still flags it, and it's simplest to just never commit it:
// read from an env var first (`<PREFIX>_CLIENT_ID`/`_SECRET`), then from a
// local file in the same user-data directory as the encryption vault key,
// never from source. Whoever builds/packages the app places that file once,
// the same way ENCRYPTION_KEY/.vault-key already works in keyVault.ts.
// One file per provider, never a shared blob: a broken or missing Google
// registration must not be able to take Canva down with it.
function readClientFile(filePath: string): { clientId: string; clientSecret: string } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    if (!raw.client_id) return null
    return { clientId: raw.client_id, clientSecret: raw.client_secret || '' }
  } catch {
    return null
  }
}

// Three sources, most specific first:
//   1. env vars           — dev override, nothing on disk
//   2. ~/.daaznexus/…     — per-machine override (e.g. someone using their
//                           own Google Cloud project instead of ours)
//   3. app resources      — the defaults every install ships with, written
//                           by CI from repo secrets (see release.yml).
// Source 3 is what makes the connectors work out of the box: an OAuth client
// for an "installed app" is designed to travel inside the app — Google's own
// docs say the secret of a Desktop client "is obviously not treated as a
// secret". Each user still does their own login; this only identifies the app.
function loadDesktopOAuthClient(providerId: string, envPrefix: string): { clientId: string; clientSecret: string } {
  const idVar = `${envPrefix}_CLIENT_ID`
  const secretVar = `${envPrefix}_CLIENT_SECRET`
  if (process.env[idVar]) {
    return { clientId: process.env[idVar]!, clientSecret: process.env[secretVar] || '' }
  }
  const fileName = `${providerId}-desktop-client.json`
  const home = process.env.HOME || process.env.USERPROFILE || '.'
  const userFile = readClientFile(path.join(home, '.daaznexus', fileName))
  if (userFile) return userFile
  const bundledDir = app.isPackaged
    ? path.join(process.resourcesPath, 'oauth-clients')
    : path.join(REPO_ROOT, 'nexus-desktop', 'build-oauth')
  return readClientFile(path.join(bundledDir, fileName)) || { clientId: '', clientSecret: '' }
}

const { clientId: GOOGLE_DESKTOP_CLIENT_ID, clientSecret: GOOGLE_DESKTOP_CLIENT_SECRET } = loadDesktopOAuthClient('google', 'GOOGLE_DESKTOP')
const { clientId: CANVA_CLIENT_ID, clientSecret: CANVA_CLIENT_SECRET } = loadDesktopOAuthClient('canva', 'CANVA')

// Canva's OAuth server (unlike Google's "Desktop app" client type) validates
// redirect_uri by exact match against what was registered via Dynamic Client
// Registration (https://mcp.canva.com/register) — it doesn't exempt loopback
// ports the way Google does. So this fixed port must match the redirect_uris
// used at registration time (see mcp-servers docs / setup notes).
const CANVA_REDIRECT_PORT = 53791

const OAUTH_PROVIDERS: Record<string, { authorizeUrl: string; tokenUrl: string; clientId: string; clientSecret?: string; extraAuthorizeParams?: Record<string, string>; fixedPort?: number; clientAuthMethod?: 'body' | 'basic' }> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: GOOGLE_DESKTOP_CLIENT_ID,
    clientSecret: GOOGLE_DESKTOP_CLIENT_SECRET,
    extraAuthorizeParams: { access_type: 'offline', prompt: 'consent' },
  },
  // Canva requires each user to authenticate individually — no org-level
  // service account (see docs.canva.dev/docs/mcp/troubleshooting — "Canva
  // doesn't support organization level authentication").
  canva: {
    authorizeUrl: 'https://mcp.canva.com/authorize',
    tokenUrl: 'https://mcp.canva.com/token',
    clientId: CANVA_CLIENT_ID,
    clientSecret: CANVA_CLIENT_SECRET,
    fixedPort: CANVA_REDIRECT_PORT,
    // The DCR registration (mcp.canva.com/register) returns
    // token_endpoint_auth_method: "client_secret_basic" — credentials go in
    // an HTTP Basic header at the token endpoint, not as body fields.
    clientAuthMethod: 'basic',
  },
}

// Must match backend/services/oauth_broker.py's CONNECTOR_SCOPES exactly —
// same Google connectors, same minimal (readonly-first) scope choice.
const CONNECTOR_SCOPES: Record<string, string[]> = {
  gdrive: ['https://www.googleapis.com/auth/drive.readonly'],
  gmail: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
  ],
}

const CONNECTOR_PROVIDER: Record<string, string> = {
  gdrive: 'google',
  gmail: 'google',
  canva: 'canva',
}

// Phase 1 wired up GitHub (remote MCP server, PAT auth, zero subprocesses).
// Phase 2 adds Google Drive: a first-party Node MCP server under
// mcp-servers/ (see backend/services/mcp_registry.py for why — community
// packages assume a single local user with their own browser login, which
// doesn't fit either side of this app well once OAuth is involved).
const CONNECTOR_DEFS: Record<string, ConnectorDef> = {
  github: {
    id: 'github',
    name: 'GitHub',
    transport: 'streamable_http',
    authMethod: 'pat',
    url: 'https://api.githubcopilot.com/mcp/',
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  // Canva's official remote MCP server (docs.canva.dev/docs/mcp) — same
  // transport shape as GitHub, but OAuth instead of a plain PAT. Client
  // registered via Dynamic Client Registration (mcp.canva.com/register),
  // not the waitlist-gated CIMD path — see OAUTH_PROVIDERS.canva above.
  canva: {
    id: 'canva',
    name: 'Canva',
    transport: 'streamable_http',
    authMethod: 'oauth',
    url: 'https://mcp.canva.com/mcp',
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  gdrive: {
    id: 'gdrive',
    name: 'Google Drive',
    transport: 'stdio',
    authMethod: 'oauth',
    command: nodeServer('gdrive-server'),
    buildEnv: (token) => ({ GOOGLE_ACCESS_TOKEN: token }),
  },
  gmail: {
    id: 'gmail',
    name: 'Gmail',
    transport: 'stdio',
    authMethod: 'oauth',
    command: nodeServer('gmail-server'),
    buildEnv: (token) => ({ GOOGLE_ACCESS_TOKEN: token }),
  },
  // WordPress uses an Application Password (native to WP since 5.6) — a
  // per-user credential, no OAuth. The "token" stored in the vault is a
  // JSON blob {site_url, username, app_password} rather than a single
  // string, since a self-hosted site needs its own URL too, unlike
  // GitHub/Google's fixed endpoints.
  wordpress: {
    id: 'wordpress',
    name: 'WordPress',
    transport: 'stdio',
    authMethod: 'pat',
    command: nodeServer('wordpress-server'),
    buildEnv: (token) => {
      const blob = JSON.parse(token)
      return { WP_SITE_URL: blob.site_url, WP_USERNAME: blob.username, WP_APP_PASSWORD: blob.app_password }
    },
  },
  // n8n uses an API key (Settings → n8n API on self-hosted instances) — no
  // OAuth, just like WordPress. Unlike the web chat, Desktop has no
  // container networking gotcha: "http://localhost:5678" here means this
  // same machine, so a locally-run n8n just works.
  n8n: {
    id: 'n8n',
    name: 'n8n',
    transport: 'stdio',
    authMethod: 'pat',
    command: nodeServer('n8n-server'),
    buildEnv: (token) => {
      const blob = JSON.parse(token)
      return { N8N_BASE_URL: blob.base_url, N8N_API_KEY: blob.api_key }
    },
  },
  // Magnific/Freepik: a single API key (freepik.com/api), fixed endpoint —
  // simplest auth shape of any connector here, same as GitHub's plain PAT.
  // No vendored code: the only community MCP for this API ships with no
  // LICENSE file, so mcp-servers/magnific-server is written fresh against
  // Magnific's public OpenAPI spec instead of being adapted from it.
  magnific: {
    id: 'magnific',
    name: 'Magnific',
    transport: 'stdio',
    authMethod: 'pat',
    command: nodeServer('magnific-server'),
    buildEnv: (token) => ({ MAGNIFIC_API_KEY: token }),
  },
}

function vaultKey(connectorId: string): string {
  return `mcp_${connectorId}`
}

function isOAuthConfigured(connectorId: string): boolean {
  const providerId = CONNECTOR_PROVIDER[connectorId]
  const provider = providerId ? OAUTH_PROVIDERS[providerId] : undefined
  return !!provider?.clientId
}

const connections = new Map<string, McpConnection>()

export interface ConnectorState {
  id: string
  name: string
  authMethodSupported: string
  status: 'connected' | 'disconnected'
  available: boolean
}

export function listConnectors(): ConnectorState[] {
  return Object.values(CONNECTOR_DEFS).map((def) => ({
    id: def.id,
    name: def.name,
    authMethodSupported: def.authMethod,
    status: hasVaultKey(vaultKey(def.id)) ? 'connected' : 'disconnected',
    available: def.authMethod === 'pat' ? true : isOAuthConfigured(def.id),
  }))
}

export function setConnectorToken(connectorId: string, token: string): void {
  if (!CONNECTOR_DEFS[connectorId]) throw new Error(`Unknown connector: ${connectorId}`)
  saveSystemKey(vaultKey(connectorId), token)
}

export function setWordPressCredentials(siteUrl: string, username: string, appPassword: string): void {
  const blob = JSON.stringify({
    site_url: siteUrl.trim().replace(/\/+$/, ''),
    username: username.trim(),
    app_password: appPassword.trim(),
  })
  saveSystemKey(vaultKey('wordpress'), blob)
}

export function setN8nCredentials(baseUrl: string, apiKey: string): void {
  const blob = JSON.stringify({
    base_url: baseUrl.trim().replace(/\/+$/, ''),
    api_key: apiKey.trim(),
  })
  saveSystemKey(vaultKey('n8n'), blob)
}

export async function connectOAuth(connectorId: string): Promise<ConnectorState[]> {
  const def = CONNECTOR_DEFS[connectorId]
  if (!def || def.authMethod !== 'oauth') throw new Error(`Connector '${connectorId}' does not use OAuth`)
  const providerId = CONNECTOR_PROVIDER[connectorId]
  const provider = OAUTH_PROVIDERS[providerId]
  if (!provider?.clientId) throw new Error(`Connector '${connectorId}' is not configured (missing ${providerId} Desktop Client ID)`)

  const token = await oauthFlow.runPkceFlow({
    authorizeUrl: provider.authorizeUrl,
    tokenUrl: provider.tokenUrl,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    scopes: CONNECTOR_SCOPES[connectorId] || [],
    extraAuthorizeParams: provider.extraAuthorizeParams,
    fixedPort: provider.fixedPort,
  })
  saveSystemKey(vaultKey(connectorId), JSON.stringify(token))
  return listConnectors()
}

export interface AutocadStatus {
  supported: boolean
  provisioned: boolean
  connected: boolean
  // Where the one-click install puts its files — shown in Settings so the
  // user knows what's being downloaded and where, before starting.
  installDir: string
}

export function getAutocadStatus(): AutocadStatus {
  return {
    supported: autocadRuntime.isSupportedPlatform(),
    provisioned: autocadRuntime.isProvisioned(),
    connected: connections.has('autocad'),
    installDir: autocadRuntime.installDir(),
  }
}

// Drives the one-click "Ligar AutoCAD" button: provisions the private
// Python runtime if needed (no-op if already done — see
// autocadRuntime.ensureAutocadRuntime), then immediately attempts a real
// connection so failures (AutoCAD not installed/open, COM error) surface
// right away instead of silently waiting for the first chat tool call.
export async function installAutocad(onProgress?: (step: string, pct: number) => void): Promise<AutocadStatus> {
  await autocadRuntime.ensureAutocadRuntime(onProgress)
  connections.delete('autocad')
  const conn = await getAutocadConnection()
  if (!conn) throw new Error('Não foi possível ligar ao AutoCAD. Confirma que o AutoCAD está aberto e tenta novamente.')
  return getAutocadStatus()
}

export interface AdobeConnectorStatus {
  supported: boolean
  provisioned: boolean
  proxyRunning: boolean
  mcpConnected: boolean
  pluginConnected: boolean
  // Alias of pluginConnected — keeps the same shape as AutocadStatus.connected
  // so the generic "Desligar" button/UI condition can be reused as-is.
  connected: boolean
  // Same purpose as AutocadStatus.installDir. Shared by every Adobe app.
  installDir: string
  // Non-empty when the plugin installer failed to open — the UI turns this
  // into a "install Creative Cloud, or open the file by hand" warning.
  pluginInstallerError?: string
}
// Kept for backwards-compat call sites; identical shape.
export type PhotoshopStatus = AdobeConnectorStatus

// One adb-proxy-socket process/port (3001) serves every Adobe app at once
// (see mcp-servers/adobe-server/NOTICE.md) — so "is the proxy running" is
// genuinely shared state, not per-app, unlike pluginConnected which really
// is per-app (each app's own plugin registers with the proxy separately).
let adobeProxyRunning = false

const ADOBE_APPS: AdobeAppConfig[] = [PHOTOSHOP, PREMIERE]

interface AdobePluginPingState {
  connected: boolean
  timer: ReturnType<typeof setInterval> | null
  inFlight: boolean
  // Set when the .ccx plugin installer couldn't be opened at the end of the
  // install (typically: no Creative Cloud Desktop, which is what handles
  // .ccx files). Without this the wizard just sits on "waiting for the
  // plugin" forever with nothing to act on — see getAdobeStatus.
  installerError?: string
}
const adobePingState = new Map<string, AdobePluginPingState>()
function pingState(appId: string): AdobePluginPingState {
  let s = adobePingState.get(appId)
  if (!s) {
    s = { connected: false, timer: null, inFlight: false }
    adobePingState.set(appId, s)
  }
  return s
}

function getAdobeStatus(appCfg: AdobeAppConfig): AdobeConnectorStatus {
  const state = pingState(appCfg.id)
  const pluginConnected = state.connected
  return {
    supported: adobeRuntime.isSupportedPlatform(),
    provisioned: adobeRuntime.isProvisioned(),
    proxyRunning: adobeProxyRunning,
    mcpConnected: connections.has(appCfg.id),
    pluginConnected,
    connected: pluginConnected,
    installDir: adobeRuntime.installDir(),
    pluginInstallerError: state.installerError,
  }
}

// mcpClient.callTool never throws for an application-level error from the
// MCP server itself (FastMCP wraps Python exceptions into isError:true,
// surfaced as a "Error: ..." string — see mcpClient.ts callTool). It only
// throws if the stdio transport/process itself dies. socket_client.py always
// raises the *same* wording on a proxy round-trip timeout regardless of which
// tool was called (see mcp-servers/adobe-server/mcp/socket_client.py) — any
// other response, success or application error, means the plugin answered,
// i.e. is connected inside the app.
async function pingAdobePlugin(appCfg: AdobeAppConfig, conn: McpConnection): Promise<boolean> {
  const result = await mcpClient.callTool(conn, appCfg.pingTool, {})
  return !/Connection Timed Out|command proxy server/i.test(result)
}

function stopAdobePluginPing(appCfg: AdobeAppConfig): void {
  const s = pingState(appCfg.id)
  if (s.timer) clearInterval(s.timer)
  s.timer = null
}

// Polls every 3s while the wizard is waiting for the user to click "Connect"
// inside the app's plugin panel — a failed ping takes ~20s (the proxy's own
// timeout), so `inFlight` guards against stacking calls. Self-stops the
// moment a connection is detected.
function startAdobePluginPing(appCfg: AdobeAppConfig, conn: McpConnection): void {
  stopAdobePluginPing(appCfg)
  const s = pingState(appCfg.id)
  s.timer = setInterval(async () => {
    if (s.inFlight) return
    s.inFlight = true
    try {
      const ok = await pingAdobePlugin(appCfg, conn)
      if (ok) {
        s.connected = true
        stopAdobePluginPing(appCfg)
      }
    } catch {
      /* transport died — next getConnection() call will notice and reconnect */
    } finally {
      s.inFlight = false
    }
  }, 3000)
}

// Not in CONNECTOR_DEFS for the same reason AutoCAD isn't: no vault
// credential, the "connection" is a self-provisioned local runtime whose
// command/args/cwd are only known once adobeRuntime has provisioned it.
async function getAdobeConnection(appCfg: AdobeAppConfig): Promise<McpConnection | null> {
  const existing = connections.get(appCfg.id)
  if (existing) return existing
  if (!adobeRuntime.isProvisioned()) return null
  try {
    const target = await adobeRuntime.ensureAdobeRuntime(appCfg)
    const conn = await mcpClient.connectStdio(appCfg.id, target.command, target.args, target.env, target.cwd)
    connections.set(appCfg.id, conn)
    return conn
  } catch (e) {
    console.warn(`[mcp] failed to connect '${appCfg.id}':`, e)
    return null
  }
}

// Drives the one-click "Ligar <App>" button: provisions uv + the shared
// proxy binary + the vendored MCP source and starts the proxy (a no-op if
// another Adobe app already started it — see adobeRuntime.ensureProxyRunning),
// connects the MCP server, downloads and opens the .ccx plugin installer
// (best-effort — never throws, see adobeRuntime.openPluginInstaller), then
// starts polling for the user's manual "Connect" click inside the app.
async function installAdobeApp(
  appCfg: AdobeAppConfig,
  onProgress?: (step: string, pct: number) => void,
): Promise<AdobeConnectorStatus> {
  await adobeRuntime.ensureAdobeRuntime(appCfg, onProgress)
  adobeProxyRunning = true
  connections.delete(appCfg.id)
  const conn = await getAdobeConnection(appCfg)
  if (!conn) throw new Error(`Não foi possível preparar o servidor MCP do ${appCfg.displayName}.`)
  // Not fatal — everything else is provisioned and the user can still open
  // the .ccx by hand — but it has to be *said*, otherwise the card sits on
  // "waiting for the plugin" forever with no hint of what went wrong.
  const opened = await adobeRuntime.openPluginInstaller(appCfg)
  pingState(appCfg.id).installerError = opened.ok ? undefined : opened.error || 'unknown'
  onProgress?.('A aguardar ligação do plugin...', 100)
  startAdobePluginPing(appCfg, conn)
  return getAdobeStatus(appCfg)
}

// Only tears down the shared proxy process once no other Adobe app is still
// using it — Photoshop and Premiere register with the same proxy/port, so
// disconnecting one must not kill the other's connection.
async function disconnectAdobeApp(appCfg: AdobeAppConfig): Promise<void> {
  stopAdobePluginPing(appCfg)
  await disconnectConnector(appCfg.id)
  pingState(appCfg.id).connected = false
  const stillInUse = ADOBE_APPS.some((a) => a.id !== appCfg.id && connections.has(a.id))
  if (!stillInUse) {
    adobeRuntime.stopProxy()
    adobeProxyRunning = false
  }
}

export function getPhotoshopStatus(): AdobeConnectorStatus {
  return getAdobeStatus(PHOTOSHOP)
}
export function installPhotoshop(onProgress?: (step: string, pct: number) => void): Promise<AdobeConnectorStatus> {
  return installAdobeApp(PHOTOSHOP, onProgress)
}
export function disconnectPhotoshop(): Promise<void> {
  return disconnectAdobeApp(PHOTOSHOP)
}
export function showPhotoshopInstallerInFolder(): void {
  adobeRuntime.showPluginInstallerInFolder(PHOTOSHOP)
}

export function getPremiereStatus(): AdobeConnectorStatus {
  return getAdobeStatus(PREMIERE)
}
export function installPremiere(onProgress?: (step: string, pct: number) => void): Promise<AdobeConnectorStatus> {
  return installAdobeApp(PREMIERE, onProgress)
}
export function disconnectPremiere(): Promise<void> {
  return disconnectAdobeApp(PREMIERE)
}
export function showPremiereInstallerInFolder(): void {
  adobeRuntime.showPluginInstallerInFolder(PREMIERE)
}

export async function disconnectConnector(connectorId: string): Promise<void> {
  const conn = connections.get(connectorId)
  if (conn) {
    connections.delete(connectorId)
    try {
      await mcpClient.closeConnection(conn)
    } catch {
      /* already gone */
    }
  }
  deleteSystemKey(vaultKey(connectorId))
}

// PAT connectors (GitHub) store the token as-is. OAuth connectors (Drive)
// store a JSON blob {access_token, refresh_token, expires_at, scopes} —
// refreshed here on demand. Google never resends a refresh_token on refresh,
// so the original one is always preserved across updates.
async function resolveAccessToken(connectorId: string, def: ConnectorDef): Promise<string | null> {
  const raw = getSystemKey(vaultKey(connectorId))
  if (!raw) return null
  if (def.authMethod === 'pat') return raw

  let blob: oauthFlow.OAuthTokenBlob
  try {
    blob = JSON.parse(raw)
  } catch {
    console.error(`[mcp] corrupt oauth token blob for '${connectorId}'`)
    return null
  }

  if (blob.expires_at > Date.now() / 1000 + 60) return blob.access_token

  if (!blob.refresh_token) {
    console.warn(`[mcp] '${connectorId}' token expired and no refresh_token available`)
    return null
  }

  const providerId = CONNECTOR_PROVIDER[connectorId]
  const provider = OAUTH_PROVIDERS[providerId]
  try {
    const refreshed = await oauthFlow.refreshAccessToken(provider.tokenUrl, provider.clientId, provider.clientSecret, blob.refresh_token, provider.clientAuthMethod)
    blob.access_token = refreshed.access_token
    blob.expires_at = refreshed.expires_at
    saveSystemKey(vaultKey(connectorId), JSON.stringify(blob))
    return blob.access_token
  } catch (e) {
    console.warn(`[mcp] failed to refresh '${connectorId}' token:`, e)
    return null
  }
}

// AutoCAD isn't in CONNECTOR_DEFS: unlike the token/OAuth-based connectors,
// there's no credential to store — the "connection" is a self-provisioned
// local Python runtime (see autocadRuntime.ts) whose command/args/cwd are
// only known once that provisioning has actually happened. Provisioning
// itself is driven by installAutocad() (with progress callbacks for the
// Settings UI); this just (re)connects to an already-provisioned runtime.
async function getAutocadConnection(): Promise<McpConnection | null> {
  const existing = connections.get('autocad')
  if (existing) return existing
  if (!autocadRuntime.isProvisioned()) return null
  try {
    const target = await autocadRuntime.ensureAutocadRuntime()
    const conn = await mcpClient.connectStdio('autocad', target.command, target.args, undefined, target.cwd)
    connections.set('autocad', conn)
    return conn
  } catch (e) {
    console.warn(`[mcp] failed to connect 'autocad':`, e)
    return null
  }
}

async function getConnection(connectorId: string): Promise<McpConnection | null> {
  const existing = connections.get(connectorId)
  if (existing) return existing

  if (connectorId === 'autocad') return getAutocadConnection()
  const adobeApp = ADOBE_APPS.find((a) => a.id === connectorId)
  if (adobeApp) return getAdobeConnection(adobeApp)

  const def = CONNECTOR_DEFS[connectorId]
  // Not one of the hardcoded first-party connectors (GitHub/Drive/Gmail/
  // WordPress/n8n/AutoCAD/Adobe apps) — fall through to the user-defined
  // servers registry (custom MCP servers the user configured by hand), which
  // owns its own connection cache and reconnection logic.
  if (!def) return customMcpServers.getConnection(connectorId)
  const token = await resolveAccessToken(connectorId, def)
  if (!token) return null

  try {
    let conn: McpConnection
    if (def.transport === 'streamable_http') {
      conn = await mcpClient.connectHttp(connectorId, def.url!, def.buildHeaders?.(token))
    } else {
      const [command, ...args] = def.command!
      conn = await mcpClient.connectStdio(connectorId, command, args, def.buildEnv?.(token))
    }
    connections.set(connectorId, conn)
    return conn
  } catch (e) {
    console.warn(`[mcp] failed to connect '${connectorId}':`, e)
    return null
  }
}

export async function listOpenAiToolsForConnectors(): Promise<any[]> {
  const tools: any[] = []
  for (const def of Object.values(CONNECTOR_DEFS)) {
    if (!hasVaultKey(vaultKey(def.id))) continue
    const conn = await getConnection(def.id)
    if (!conn) continue
    try {
      const mcpTools = await mcpClient.listTools(conn)
      for (const t of mcpTools) tools.push(mcpClient.mcpToolToOpenai(def.id, t))
    } catch (e) {
      // A ligação em cache pode ter morrido entretanto (o subprocesso do
      // servidor MCP crashou, a instância remota reiniciou, etc.) —
      // `connections` guardava a referência morta para sempre, por isso um
      // conector que falhasse uma vez ficava sem ferramentas até a app
      // inteira ser reiniciada. Tenta uma vez mais com ligação nova.
      console.warn(`[mcp] listTools failed for '${def.id}', reconnecting:`, e)
      connections.delete(def.id)
      const fresh = await getConnection(def.id)
      if (fresh) {
        try {
          const mcpTools = await mcpClient.listTools(fresh)
          for (const t of mcpTools) tools.push(mcpClient.mcpToolToOpenai(def.id, t))
        } catch (e2) {
          console.warn(`[mcp] listTools retry failed for '${def.id}':`, e2)
        }
      }
    }
  }
  if (autocadRuntime.isProvisioned()) {
    const conn = await getAutocadConnection()
    if (conn) {
      try {
        const mcpTools = await mcpClient.listTools(conn)
        for (const t of mcpTools) tools.push(mcpClient.mcpToolToOpenai('autocad', t))
      } catch (e) {
        console.warn(`[mcp] listTools failed for 'autocad', reconnecting:`, e)
        connections.delete('autocad')
        const fresh = await getAutocadConnection()
        if (fresh) {
          try {
            const mcpTools = await mcpClient.listTools(fresh)
            for (const t of mcpTools) tools.push(mcpClient.mcpToolToOpenai('autocad', t))
          } catch (e2) {
            console.warn(`[mcp] listTools retry failed for 'autocad':`, e2)
          }
        }
      }
    }
  }
  // Gated on pingState(id).connected rather than adobeRuntime.isProvisioned()
  // (unlike AutoCAD) — exposing an app's tools before its plugin is actually
  // connected would mean any LLM call blocks for the full ~20s proxy timeout
  // before failing. Bad UX in the middle of a chat.
  for (const appCfg of ADOBE_APPS) {
    if (!pingState(appCfg.id).connected) continue
    const conn = await getAdobeConnection(appCfg)
    if (!conn) continue
    try {
      const mcpTools = await mcpClient.listTools(conn)
      for (const t of mcpTools) tools.push(mcpClient.mcpToolToOpenai(appCfg.id, t))
    } catch (e) {
      console.warn(`[mcp] listTools failed for '${appCfg.id}', reconnecting:`, e)
      connections.delete(appCfg.id)
      const fresh = await getAdobeConnection(appCfg)
      if (fresh) {
        try {
          const mcpTools = await mcpClient.listTools(fresh)
          for (const t of mcpTools) tools.push(mcpClient.mcpToolToOpenai(appCfg.id, t))
        } catch (e2) {
          console.warn(`[mcp] listTools retry failed for '${appCfg.id}':`, e2)
        }
      }
    }
  }
  tools.push(...(await customMcpServers.listOpenAiTools()))
  return tools
}

// Every MCP tool call is gated the same way bash/write_file already are (see
// GATED_TOOLS in fallbackChain.ts) — treated as dangerous by default, since we
// have no per-tool sense of blast radius for an arbitrary third-party server.
export async function dispatchMcpCall(
  name: string,
  args: Record<string, unknown>,
  requestPermission?: (action: string, detail: string) => Promise<boolean>,
): Promise<string> {
  const resolved = mcpClient.resolveToolName(name)
  if (!resolved) return `Error: unknown MCP tool '${name}'`
  const [connectorId, toolName] = resolved

  if (requestPermission) {
    const detail = `${connectorId}.${toolName}(${JSON.stringify(args).slice(0, 150)})`
    const ok = await requestPermission(name, detail)
    if (!ok) return 'Permission denied.'
  }

  const conn = await getConnection(connectorId)
  if (!conn) return `Error: connector '${connectorId}' is not connected.`
  try {
    return await mcpClient.callTool(conn, toolName, args)
  } catch (e: any) {
    // Mesma lógica de auto-recuperação do listOpenAiToolsForConnectors — a
    // ligação em cache pode ter morrido entretanto.
    console.warn(`[mcp] callTool failed for '${name}', reconnecting:`, e)
    connections.delete(connectorId)
    const fresh = await getConnection(connectorId)
    if (!fresh) return `Error: connector '${connectorId}' is not connected.`
    try {
      return await mcpClient.callTool(fresh, toolName, args)
    } catch (e2: any) {
      return `Error executing MCP tool '${name}': ${e2.message}`
    }
  }
}

export async function closeAllConnections(): Promise<void> {
  for (const conn of connections.values()) {
    try {
      await mcpClient.closeConnection(conn)
    } catch {
      /* already gone */
    }
  }
  connections.clear()
  for (const appCfg of ADOBE_APPS) stopAdobePluginPing(appCfg)
  adobeRuntime.stopProxy()
  await customMcpServers.closeAll()
}
