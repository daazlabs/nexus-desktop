import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import * as mcpClient from './mcpClient.js'
import type { McpConnection } from './mcpClient.js'
import { resolveCommand, buildEnv } from '../mcp/resolveCommand.js'

// User-defined MCP servers (e.g. a locally installed AutoCAD MCP server),
// as opposed to the hardcoded first-party connectors in mcpConnectors.ts
// (GitHub, Google Drive, Gmail, WordPress, n8n). Same on-disk shape as
// Claude Desktop's claude_desktop_config.json / Cursor's mcp.json
// (`{ "mcpServers": { "<id>": { command, args, env, ... } } }`), so a user
// can hand-edit this file or paste in a config they already have working
// elsewhere without translation.
export interface CustomMcpServerConfig {
  command: string
  args: string[]
  env?: Record<string, string>
  enabled?: boolean
  transport?: 'stdio' | 'http'
  url?: string
  // Working directory for the spawned process. Several real-world stdio
  // servers (e.g. CAD-MCP for AutoCAD) resolve relative paths — their own
  // config file, an "./output" directory — against the process cwd rather
  // than the script's own location, and expect to be launched from their
  // project root (`python src/server.py` run from that root). Without this,
  // the server inherits this Electron app's cwd instead, and writes files
  // to the wrong place.
  cwd?: string
}

interface ServersFile {
  mcpServers: Record<string, CustomMcpServerConfig>
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'mcp-servers.json')
}

function readConfig(): ServersFile {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && parsed.mcpServers) return parsed
  } catch {
    // First run (file doesn't exist yet) or a hand-edited file that's
    // temporarily invalid JSON — either way, start from an empty registry
    // rather than crashing the app's startup.
  }
  return { mcpServers: {} }
}

function writeConfig(cfg: ServersFile): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf-8')
}

const connections = new Map<string, McpConnection>()
const lastError = new Map<string, string>()

export interface CustomServerState {
  id: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
  transport: 'stdio' | 'http'
  url?: string
  cwd?: string
  status: 'connected' | 'disconnected' | 'error'
  error?: string
  toolCount?: number
}

export async function listServers(): Promise<CustomServerState[]> {
  const cfg = readConfig()
  const out: CustomServerState[] = []
  for (const [id, def] of Object.entries(cfg.mcpServers)) {
    const conn = connections.get(id)
    let toolCount: number | undefined
    if (conn) {
      try {
        toolCount = (await mcpClient.listTools(conn)).length
      } catch {
        // Connection object exists but the underlying process/socket died —
        // listServers() is a read-only status view, so just omit the count
        // rather than reconnecting here (getConnection() already handles
        // reconnection for actual tool use).
      }
    }
    out.push({
      id,
      command: def.command,
      args: def.args || [],
      env: def.env || {},
      enabled: def.enabled !== false,
      transport: def.transport || 'stdio',
      url: def.url,
      cwd: def.cwd,
      status: conn ? 'connected' : lastError.has(id) ? 'error' : 'disconnected',
      error: lastError.get(id),
      toolCount,
    })
  }
  return out
}

async function disconnectId(id: string): Promise<void> {
  const existing = connections.get(id)
  if (!existing) return
  connections.delete(id)
  try {
    await mcpClient.closeConnection(existing)
  } catch {
    // subprocess/socket may already be gone
  }
}

export async function upsertServer(id: string, def: CustomMcpServerConfig): Promise<void> {
  const trimmedId = id.trim()
  if (!trimmedId) throw new Error('O nome do servidor é obrigatório.')
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmedId)) {
    throw new Error('O nome do servidor só pode ter letras, números, "-" e "_" (sem espaços).')
  }
  if ((def.transport || 'stdio') === 'http') {
    if (!def.url?.trim()) throw new Error('Falta o URL para um servidor com transporte "http".')
  } else if (!def.command?.trim()) {
    throw new Error('Falta o comando (ex: "python", "node", "npx").')
  }

  const cfg = readConfig()
  cfg.mcpServers[trimmedId] = {
    command: def.command,
    args: def.args || [],
    env: def.env || {},
    enabled: def.enabled !== false,
    transport: def.transport || 'stdio',
    url: def.url,
    cwd: def.cwd,
  }
  writeConfig(cfg)
  // The definition changed — drop any live connection so the next call
  // reconnects using the new command/args/env instead of a stale process.
  await disconnectId(trimmedId)
  lastError.delete(trimmedId)
}

export async function removeServer(id: string): Promise<void> {
  const cfg = readConfig()
  delete cfg.mcpServers[id]
  writeConfig(cfg)
  await disconnectId(id)
  lastError.delete(id)
}

async function connect(id: string, def: CustomMcpServerConfig): Promise<McpConnection> {
  if ((def.transport || 'stdio') === 'http') {
    if (!def.url) throw new Error(`Servidor '${id}': transporte "http" sem url definido.`)
    return mcpClient.connectHttp(id, def.url)
  }
  const command = await resolveCommand(def.command)
  return mcpClient.connectStdio(id, command, def.args || [], buildEnv(def.env), def.cwd)
}

export async function getConnection(id: string): Promise<McpConnection | null> {
  const existing = connections.get(id)
  if (existing) return existing

  const cfg = readConfig()
  const def = cfg.mcpServers[id]
  if (!def || def.enabled === false) return null

  try {
    const conn = await connect(id, def)
    connections.set(id, conn)
    lastError.delete(id)
    return conn
  } catch (e: any) {
    lastError.set(id, e?.message || String(e))
    console.warn(`[mcp] failed to connect custom server '${id}':`, e)
    return null
  }
}

export interface TestResult {
  ok: boolean
  error?: string
  tools?: { name: string; description?: string }[]
}

// Used by the "Test connection" button in Settings: always reconnects from
// scratch so the result reflects what's currently saved on disk, not a
// stale cached connection from before the user's last edit.
export async function testServer(id: string): Promise<TestResult> {
  await disconnectId(id)
  const conn = await getConnection(id)
  if (!conn) return { ok: false, error: lastError.get(id) || 'Falha ao ligar.' }
  try {
    const tools = await mcpClient.listTools(conn)
    return { ok: true, tools: tools.map((t) => ({ name: t.name, description: t.description })) }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

export async function listOpenAiTools(): Promise<any[]> {
  const cfg = readConfig()
  const tools: any[] = []
  for (const [id, def] of Object.entries(cfg.mcpServers)) {
    if (def.enabled === false) continue
    const conn = await getConnection(id)
    if (!conn) continue
    try {
      const mcpTools = await mcpClient.listTools(conn)
      for (const t of mcpTools) tools.push(mcpClient.mcpToolToOpenai(id, t))
    } catch (e) {
      // Mirrors mcpConnectors.ts's self-healing: a cached connection may
      // have died since (server subprocess crashed, etc.) — retry once
      // with a fresh connection instead of leaving this server toolless
      // until the whole app restarts.
      console.warn(`[mcp] listTools failed for custom server '${id}', reconnecting:`, e)
      await disconnectId(id)
      const fresh = await getConnection(id)
      if (fresh) {
        try {
          const mcpTools = await mcpClient.listTools(fresh)
          for (const t of mcpTools) tools.push(mcpClient.mcpToolToOpenai(id, t))
        } catch (e2) {
          console.warn(`[mcp] listTools retry failed for custom server '${id}':`, e2)
        }
      }
    }
  }
  return tools
}

export function hasServer(id: string): boolean {
  return !!readConfig().mcpServers[id]
}

export async function closeAll(): Promise<void> {
  for (const conn of connections.values()) {
    try {
      await mcpClient.closeConnection(conn)
    } catch {
      // already gone
    }
  }
  connections.clear()
}
