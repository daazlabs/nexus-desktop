import crypto from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const TOOL_NAME_MAX_LEN = 64 // OpenAI function-calling name limit

// namespaced/short tool name -> [serverId, original tool name from the MCP server]
const nameLookup = new Map<string, [string, string]>()

export interface McpConnection {
  serverId: string
  client: Client
  lastUsed: number
}

export async function connectHttp(
  serverId: string,
  url: string,
  headers?: Record<string, string>,
): Promise<McpConnection> {
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    headers ? { requestInit: { headers } } : undefined,
  )
  const client = new Client({ name: 'daaznexus-desktop', version: '1.0.0' })
  await client.connect(transport)
  return { serverId, client, lastUsed: Date.now() }
}

export async function connectStdio(
  serverId: string,
  command: string,
  args: string[],
  env?: Record<string, string>,
  cwd?: string,
): Promise<McpConnection> {
  const transport = new StdioClientTransport({ command, args, env, cwd })
  const client = new Client({ name: 'daaznexus-desktop', version: '1.0.0' })
  await client.connect(transport)
  return { serverId, client, lastUsed: Date.now() }
}

export async function listTools(conn: McpConnection): Promise<{ name: string; description?: string; inputSchema: any }[]> {
  conn.lastUsed = Date.now()
  const result = await conn.client.listTools()
  return result.tools
}

export async function callTool(conn: McpConnection, toolName: string, args: Record<string, unknown>): Promise<string> {
  conn.lastUsed = Date.now()
  const result = await conn.client.callTool({ name: toolName, arguments: args })
  const parts: string[] = []
  for (const block of (result.content || []) as any[]) {
    if (block.type === 'text') parts.push(block.text)
    else parts.push(JSON.stringify(block))
  }
  const text = parts.join('\n') || '(sem resultado)'
  return result.isError ? `Error: ${text}` : text
}

export async function closeConnection(conn: McpConnection): Promise<void> {
  await conn.client.close()
}

// Namespaces `tool.name` as `mcp__<serverId>__<tool.name>` (same convention
// Claude Code itself uses for MCP tools), hashed down to a short id when that
// would exceed the 64-char function-calling limit. Registers the mapping back
// to (serverId, original name) so dispatch can reverse it.
export function mcpToolToOpenai(serverId: string, tool: { name: string; description?: string; inputSchema: any }): any {
  const rawName = `mcp__${serverId}__${tool.name}`
  let name = rawName
  if (name.length > TOOL_NAME_MAX_LEN) {
    const digest = crypto.createHash('sha1').update(rawName).digest('hex').slice(0, 16)
    name = `mcp__h_${digest}`
  }
  nameLookup.set(name, [serverId, tool.name])
  return {
    type: 'function' as const,
    function: {
      name,
      description: tool.description || `${tool.name} (via ${serverId})`,
      parameters: tool.inputSchema || { type: 'object', properties: {} },
    },
  }
}

export function resolveToolName(name: string): [string, string] | undefined {
  return nameLookup.get(name)
}

export function isMcpToolName(name: string): boolean {
  return name.startsWith('mcp__')
}
