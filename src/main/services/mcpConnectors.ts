import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { saveSystemKey, getSystemKey, deleteSystemKey, hasVaultKey } from './keyVault.js'
import * as mcpClient from './mcpClient.js'
import * as oauthFlow from './oauthFlow.js'
import type { McpConnection } from './mcpClient.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// dist-electron/main/services/mcpConnectors.js -> .../daaznexus (repo root,
// sibling of nexus-desktop/ — see mcp-servers/ layout in the plan).
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

function nodeServer(name: string): string[] {
  return ['node', path.join(REPO_ROOT, 'mcp-servers', name, 'dist', 'index.js')]
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

// Google issues a "Desktop app" OAuth client separate from the backend's
// "Web application" one (different redirect mechanism — loopback here vs a
// fixed HTTPS URL there). Not a real secret for an installed app per
// Google's own classification (PKCE is what actually protects the flow) —
// but GitHub's push protection still flags it, and it's simplest to just
// never commit it: read from an env var first, then from a local file in
// the same user-data directory as the encryption vault key, never from
// source. Whoever builds/packages the app places that file once, the same
// way ENCRYPTION_KEY/.vault-key already works in keyVault.ts.
function loadGoogleDesktopClient(): { clientId: string; clientSecret: string } {
  if (process.env.GOOGLE_DESKTOP_CLIENT_ID) {
    return { clientId: process.env.GOOGLE_DESKTOP_CLIENT_ID, clientSecret: process.env.GOOGLE_DESKTOP_CLIENT_SECRET || '' }
  }
  try {
    const configPath = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.daaznexus', 'google-desktop-client.json')
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    return { clientId: raw.client_id || '', clientSecret: raw.client_secret || '' }
  } catch {
    return { clientId: '', clientSecret: '' }
  }
}

const { clientId: GOOGLE_DESKTOP_CLIENT_ID, clientSecret: GOOGLE_DESKTOP_CLIENT_SECRET } = loadGoogleDesktopClient()

const OAUTH_PROVIDERS: Record<string, { authorizeUrl: string; tokenUrl: string; clientId: string; clientSecret?: string; extraAuthorizeParams?: Record<string, string> }> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: GOOGLE_DESKTOP_CLIENT_ID,
    clientSecret: GOOGLE_DESKTOP_CLIENT_SECRET,
    extraAuthorizeParams: { access_type: 'offline', prompt: 'consent' },
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
  if (!provider?.clientId) throw new Error(`Connector '${connectorId}' is not configured (missing Google Desktop Client ID)`)

  const token = await oauthFlow.runPkceFlow({
    authorizeUrl: provider.authorizeUrl,
    tokenUrl: provider.tokenUrl,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    scopes: CONNECTOR_SCOPES[connectorId] || [],
    extraAuthorizeParams: provider.extraAuthorizeParams,
  })
  saveSystemKey(vaultKey(connectorId), JSON.stringify(token))
  return listConnectors()
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
    const refreshed = await oauthFlow.refreshAccessToken(provider.tokenUrl, provider.clientId, provider.clientSecret, blob.refresh_token)
    blob.access_token = refreshed.access_token
    blob.expires_at = refreshed.expires_at
    saveSystemKey(vaultKey(connectorId), JSON.stringify(blob))
    return blob.access_token
  } catch (e) {
    console.warn(`[mcp] failed to refresh '${connectorId}' token:`, e)
    return null
  }
}

async function getConnection(connectorId: string): Promise<McpConnection | null> {
  const existing = connections.get(connectorId)
  if (existing) return existing

  const def = CONNECTOR_DEFS[connectorId]
  if (!def) return null
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
      console.warn(`[mcp] listTools failed for '${def.id}':`, e)
    }
  }
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
    return `Error executing MCP tool '${name}': ${e.message}`
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
}
