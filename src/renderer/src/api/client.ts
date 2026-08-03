import type { CategorizedProvider, Message, Project } from "../types"

declare global {
  interface Window {
    nexus: typeof nexusApi
  }
}

const nexusApi = (window as any).nexus || {}

const CONVS_KEY = "nexus-convs"
const MEMORIES_KEY = "nexus-memories"
const PROJECTS_KEY = "nexus-projects"
const convKey = (id: number) => `nexus-conv-${id}`
const prefKey = (id: string) => `nexus-agent-pref-${id}`

function loadConvData(id: number): { messages: Message[]; system_prompt: string } {
  try { return { messages: [], system_prompt: "", ...JSON.parse(localStorage.getItem(convKey(id)) || "{}") } } catch { return { messages: [], system_prompt: "" } }
}

function saveConvData(id: number, data: Partial<{ messages: Message[]; system_prompt: string }>) {
  const existing = loadConvData(id)
  localStorage.setItem(convKey(id), JSON.stringify({ ...existing, ...data }))
}

export const api = {
  getProvidersCategorized: async (): Promise<Record<string, CategorizedProvider[]>> => {
    const providers = await nexusApi.providers?.list?.() || []
    const free: CategorizedProvider[] = []
    const paid: CategorizedProvider[] = []
    const local: CategorizedProvider[] = []
    for (const p of providers) {
      const mapped: CategorizedProvider = {
        id: p.id, name: p.name, base_url: p.baseUrl, api_type: p.apiType,
        requires_key: p.requiresKey, register_url: p.registerUrl,
        models: p.models.map((m: any) => ({ id: m.id, context: m.context, vision: m.vision, tools: m.tools, free: m.free, paid: m.paid })),
      }
      if (!p.requiresKey || p.id === "ollama" || p.id === "llamacpp") local.push(mapped)
      else if (p.models.some((m: any) => m.free)) free.push(mapped)
      else paid.push(mapped)
    }
    return { free, paid, local }
  },

  // Same as getProvidersCategorized but filtered to only providers with a configured API key.
  // Used by ModelSelector so only usable models appear in the dropdown.
  // Local providers (Ollama, llama.cpp) are only included if their server is reachable.
  getAvailableProviders: async (): Promise<Record<string, CategorizedProvider[]>> => {
    const all = await api.getProvidersCategorized()
    const vaultKeys = await nexusApi.vault?.getKeys?.() || {}

    const remote = api.getRemoteOllama()
    const localReachable = (await Promise.all(
      (all.local || []).map(async (p) => {
        try {
          const ctrl = new AbortController()
          const timer = setTimeout(() => ctrl.abort(), 800)
          const url = remote.url
            ? `${remote.url}/api/local/v1/models`
            : `${p.base_url}/models`
          const headers: Record<string, string> = remote.url && remote.key
            ? { Authorization: `Bearer ${remote.key}` }
            : {}
          await fetch(url, { signal: ctrl.signal, headers })
          clearTimeout(timer)
          return p
        } catch {
          return null
        }
      })
    )).filter(Boolean) as CategorizedProvider[]

    return {
      free: (all.free || []).filter(p => vaultKeys[p.id]),
      paid: (all.paid || []).filter(p => vaultKeys[p.id]),
      local: localReachable,
    }
  },

  // Subscribe to main-process notifications that the effective model catalog
  // changed (remote catalog fetched). Returns an unsubscribe function.
  onCatalogUpdated: (callback: () => void): (() => void) => {
    return nexusApi.providers?.onCatalogUpdated?.(callback) ?? (() => {})
  },

  getRemoteOllama: (): { url: string; key: string } => {
    try { return { url: '', key: '', ...JSON.parse(localStorage.getItem('nexus-remote-ollama') || '{}') } } catch { return { url: '', key: '' } }
  },

  saveRemoteOllama: async (url: string, key: string): Promise<void> => {
    const clean = { url: url.trim().replace(/\/$/, ''), key: key.trim() }
    localStorage.setItem('nexus-remote-ollama', JSON.stringify(clean))
    if (clean.key) await nexusApi.vault?.setKey?.('remote-ollama', clean.key)
    else await nexusApi.vault?.deleteKey?.('remote-ollama')
  },

  getProviderHealth: async (): Promise<Record<string, { healthy: boolean; failures: number; models: string[] }>> => {
    const providers = await nexusApi.providers?.list?.() || []
    const vaultKeys = await nexusApi.vault?.getKeys?.() || {}
    const result: Record<string, any> = {}
    for (const p of providers) {
      result[p.id] = { healthy: !!vaultKeys[p.id] || !p.requiresKey, failures: 0, models: p.models.map((m: any) => m.id) }
    }
    return result
  },

  sendToProvider: async (
    messages: { role: string; content: string }[],
    options: { modelClass?: string; model?: string; strategy?: string; temperature?: number; toolsEnabled?: boolean },
  ): Promise<{ content: string; model?: string; tokensUsed?: number; duration?: number }> => {
    return nexusApi.providers?.send?.(messages, options) || { content: "No provider available" }
  },

  openDirPicker: async (): Promise<string | null> => {
    return (window as any).nexus?.dialog?.openDir?.() ?? null
  },

  getCooldowns: async (): Promise<Record<string, number>> => {
    return (window as any).nexus?.providers?.cooldowns?.() ?? {}
  },

  streamToProvider: (
    messages: { role: string; content: string }[],
    options: { modelClass?: string; model?: string; strategy?: string; temperature?: number; workingDir?: string; toolsEnabled?: boolean; lang?: string; convId?: number },
    onChunk: (chunk: string) => void,
    onDone: (result: { content: string; model: string }) => void,
    onError: (err: string) => void,
    onToolEvent?: (ev: { id: string; name: string; args: Record<string, unknown>; status: 'running' | 'completed' | 'failed'; result?: string; started_at: number; completed_at?: number }) => void,
  ): (() => void) => {
    if (!nexusApi.providers?.stream) {
      api.sendToProvider(messages, options).then(r => onDone({ content: r.content || "", model: r.model || "" })).catch(e => onError(String(e)))
      return () => {}
    }
    const wrappedChunk = (chunk: string) => {
      if (typeof chunk === 'string' && chunk.startsWith('__TOOL_EVENT__:')) {
        if (onToolEvent) {
          try { onToolEvent(JSON.parse(chunk.slice('__TOOL_EVENT__:'.length))) } catch { /* */ }
        }
        return
      }
      onChunk(chunk)
    }
    const remote = api.getRemoteOllama()
    const enrichedOptions = remote.url
      ? { ...options, remoteOllamaUrl: remote.url, remoteOllamaKey: remote.key }
      : options
    return nexusApi.providers.stream(messages, enrichedOptions, wrappedChunk, onDone, onError)
  },

  listConversations: async (): Promise<{ id: number; title: string; project_id?: number }[]> => {
    try { return JSON.parse(localStorage.getItem(CONVS_KEY) || "[]") } catch { return [] }
  },

  createConversation: async (title: string, projectId?: number): Promise<{ id: number; title: string; project_id?: number }> => {
    const convs = await api.listConversations()
    const conv: { id: number; title: string; project_id?: number } = { id: Date.now(), title }
    if (projectId) conv.project_id = projectId
    convs.push(conv)
    localStorage.setItem(CONVS_KEY, JSON.stringify(convs))
    saveConvData(conv.id, { messages: [], system_prompt: "" })
    return conv
  },

  getConversation: async (id: number): Promise<{ id: number; title: string; messages: Message[]; system_prompt: string; project_id?: number }> => {
    const convs = await api.listConversations()
    const conv = convs.find(c => c.id === id)
    const data = loadConvData(id)
    return { id, title: conv?.title || "", messages: data.messages || [], system_prompt: data.system_prompt || "", project_id: conv?.project_id }
  },

  deleteConversation: async (id: number): Promise<void> => {
    const convs = await api.listConversations()
    localStorage.setItem(CONVS_KEY, JSON.stringify(convs.filter(c => c.id !== id)))
    localStorage.removeItem(convKey(id))
  },

  updateConversationTitle: async (id: number, title: string): Promise<{ id: number; title: string }> => {
    const convs = await api.listConversations()
    const idx = convs.findIndex(c => c.id === id)
    if (idx >= 0) { convs[idx].title = title; localStorage.setItem(CONVS_KEY, JSON.stringify(convs)) }
    return { id, title }
  },

  updateConversationProject: async (id: number, projectId: number | null): Promise<void> => {
    const convs = await api.listConversations()
    const updated = convs.map(c => {
      if (c.id !== id) return c
      const { project_id: _drop, ...rest } = c
      return projectId !== null ? { ...rest, project_id: projectId } : rest
    })
    localStorage.setItem(CONVS_KEY, JSON.stringify(updated))
  },

  listProjects: async (): Promise<Project[]> => {
    try { return JSON.parse(localStorage.getItem(PROJECTS_KEY) || "[]") } catch { return [] }
  },

  createProject: async (name: string, systemPrompt = "", workingDir?: string): Promise<Project> => {
    const projects = await api.listProjects()
    const p: Project = { id: Date.now(), name, system_prompt: systemPrompt, created_at: Date.now() }
    if (workingDir) p.working_dir = workingDir
    projects.push(p)
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects))
    return p
  },

  updateProject: async (id: number, updates: Partial<Pick<Project, "name" | "system_prompt" | "working_dir">>): Promise<Project | null> => {
    const projects = await api.listProjects()
    const idx = projects.findIndex(p => p.id === id)
    if (idx < 0) return null
    projects[idx] = { ...projects[idx], ...updates }
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects))
    return projects[idx]
  },

  deleteProject: async (id: number): Promise<void> => {
    const projects = await api.listProjects()
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects.filter(p => p.id !== id)))
    // Unlink conversations from this project
    const convs = await api.listConversations()
    const updated = convs.map(c => c.project_id === id ? { ...c, project_id: undefined } : c)
    localStorage.setItem(CONVS_KEY, JSON.stringify(updated))
  },

  saveMessages: async (id: number, messages: Message[]): Promise<void> => {
    saveConvData(id, { messages })
  },

  truncateMessages: async (convId: number, fromMsgId: number): Promise<void> => {
    const data = loadConvData(convId)
    saveConvData(convId, { messages: (data.messages || []).filter(m => m.id < fromMsgId) })
  },

  setSystemPrompt: async (convId: number, prompt: string): Promise<{ system_prompt: string | null }> => {
    saveConvData(convId, { system_prompt: prompt || "" })
    return { system_prompt: prompt || null }
  },

  listMemories: async (): Promise<{ memories: { id: number; fact: string; created_at: string }[]; total: number }> => {
    try {
      const memories = JSON.parse(localStorage.getItem(MEMORIES_KEY) || "[]")
      return { memories, total: memories.length }
    } catch { return { memories: [], total: 0 } }
  },

  addMemory: async (fact: string): Promise<{ id: number; fact: string; created_at: string }> => {
    const { memories } = await api.listMemories()
    const m = { id: Date.now(), fact: fact.trim(), created_at: new Date().toISOString() }
    memories.unshift(m)
    localStorage.setItem(MEMORIES_KEY, JSON.stringify(memories))
    return m
  },

  deleteMemory: async (id: number): Promise<{ detail: string }> => {
    const { memories } = await api.listMemories()
    localStorage.setItem(MEMORIES_KEY, JSON.stringify(memories.filter(m => m.id !== id)))
    return { detail: "deleted" }
  },

  clearMemories: async (): Promise<{ detail: string }> => {
    localStorage.removeItem(MEMORIES_KEY)
    return { detail: "cleared" }
  },

  listSkills: async (): Promise<{ skills: { id: number; name: string; description: string; instructions: string; created_at: string }[] }> => {
    const skills = await nexusApi.skills?.list?.() || []
    return { skills }
  },

  createSkill: async (name: string, description: string, instructions: string) => {
    const res = await nexusApi.skills?.create?.(name, description, instructions)
    if (!res?.ok) throw new Error(res?.error || "Could not save.")
    return res.skill
  },

  updateSkill: async (id: number, name: string, description: string, instructions: string) => {
    const res = await nexusApi.skills?.update?.(id, name, description, instructions)
    if (!res?.ok) throw new Error(res?.error || "Could not save.")
    return res.skill
  },

  deleteSkill: async (id: number): Promise<{ detail: string }> => {
    return await nexusApi.skills?.delete?.(id) || { detail: "deleted" }
  },

  getAgentConfig: async (agentId: string): Promise<any> => {
    const hasKey = !!(await nexusApi.vault?.resolveKey?.(agentId))
    try {
      const pref = JSON.parse(localStorage.getItem(prefKey(agentId)) || "{}")
      return { params: { model: pref.model || "", temperature: pref.temperature ?? 0.7, max_tokens: 8192, system_prompt: "" }, has_api_key: hasKey }
    } catch {
      return { params: { model: "", temperature: 0.7, max_tokens: 8192, system_prompt: "" }, has_api_key: hasKey }
    }
  },

  saveAgentConfig: async (agentId: string, config: any): Promise<any> => {
    if (config.api_key) await nexusApi.vault?.setKey?.(agentId, config.api_key)
    const pref: Record<string, unknown> = {}
    if (config.model !== undefined) pref.model = config.model
    if (config.temperature !== undefined) pref.temperature = config.temperature
    if (Object.keys(pref).length) localStorage.setItem(prefKey(agentId), JSON.stringify(pref))
    return { status: "ok" }
  },

  getUserAnalytics: async (days = 30): Promise<Record<string, { model: string; tokens: number; requests: number; errors: number }[]>> => {
    try {
      const convs: { id: number }[] = JSON.parse(localStorage.getItem(CONVS_KEY) || "[]")
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
      const byModel: Record<string, { model: string; tokens: number; requests: number; errors: number }> = {}
      for (const conv of convs) {
        for (const msg of loadConvData(conv.id).messages) {
          if (msg.role !== "assistant" || !msg.model || msg.id < cutoff) continue
          if (!byModel[msg.model]) byModel[msg.model] = { model: msg.model, tokens: 0, requests: 0, errors: 0 }
          byModel[msg.model].requests++
          if (msg.content.startsWith("❌")) byModel[msg.model].errors++
        }
      }
      return { desktop: Object.values(byModel) }
    } catch { return {} }
  },

  getTimeline: async (days = 7): Promise<{ day: string; tokens: number; requests: number }[]> => {
    try {
      const convs: { id: number }[] = JSON.parse(localStorage.getItem(CONVS_KEY) || "[]")
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
      const dayMap: Record<string, number> = {}
      for (const conv of convs) {
        for (const msg of loadConvData(conv.id).messages) {
          if (msg.role !== "assistant" || msg.id < cutoff) continue
          const day = new Date(msg.id).toISOString().slice(0, 10)
          dayMap[day] = (dayMap[day] || 0) + 1
        }
      }
      return Object.entries(dayMap).sort(([a], [b]) => a.localeCompare(b)).map(([day, requests]) => ({ day, tokens: 0, requests }))
    } catch { return [] }
  },

  getErrors: async (_days = 7): Promise<{ provider: string; error: string; count: number }[]> => {
    return []
  },

  uploadFile: async (_file: File): Promise<any> => {
    return { file_id: "", filename: "", mime_type: "", size: 0, type: "", url: "", preview: "" }
  },

  listConnectors: async (): Promise<{ id: string; name: string; authMethodSupported: string; status: string; available: boolean }[]> => {
    return await nexusApi.connectors?.list?.() || []
  },

  setConnectorToken: async (connectorId: string, token: string) => {
    return await nexusApi.connectors?.setToken?.(connectorId, token)
  },

  connectConnectorOAuth: async (connectorId: string) => {
    return await nexusApi.connectors?.connectOAuth?.(connectorId)
  },

  setWordPressCredentials: async (siteUrl: string, username: string, appPassword: string) => {
    return await nexusApi.connectors?.setWordPressCredentials?.(siteUrl, username, appPassword)
  },

  setN8nCredentials: async (baseUrl: string, apiKey: string) => {
    return await nexusApi.connectors?.setN8nCredentials?.(baseUrl, apiKey)
  },

  disconnectConnector: async (connectorId: string) => {
    return await nexusApi.connectors?.disconnect?.(connectorId)
  },

  getAutocadStatus: async (): Promise<{
    supported: boolean
    provisioned: boolean
    connected: boolean
    installDir: string
  }> => {
    return (
      (await nexusApi.connectors?.autocadStatus?.()) || {
        supported: false,
        provisioned: false,
        connected: false,
        installDir: "",
      }
    )
  },

  installAutocad: (
    onProgress: (data: { step: string; pct: number }) => void,
    onDone: (data: { ok: boolean; status?: unknown; error?: string }) => void,
  ): (() => void) => {
    return nexusApi.connectors?.autocadInstall?.(onProgress, onDone) ?? (() => {})
  },

  getPhotoshopStatus: async (): Promise<{
    supported: boolean
    provisioned: boolean
    proxyRunning: boolean
    mcpConnected: boolean
    pluginConnected: boolean
    connected: boolean
    installDir: string
    pluginInstallerError?: string
  }> => {
    return (
      (await nexusApi.connectors?.photoshopStatus?.()) || {
        supported: false,
        provisioned: false,
        proxyRunning: false,
        mcpConnected: false,
        pluginConnected: false,
        connected: false,
        installDir: "",
      }
    )
  },

  installPhotoshop: (
    onProgress: (data: { step: string; pct: number }) => void,
    onDone: (data: { ok: boolean; status?: unknown; error?: string }) => void,
  ): (() => void) => {
    return nexusApi.connectors?.photoshopInstall?.(onProgress, onDone) ?? (() => {})
  },

  disconnectPhotoshop: async () => {
    return await nexusApi.connectors?.photoshopDisconnect?.()
  },

  showPhotoshopInstaller: async () => {
    return await nexusApi.connectors?.photoshopShowInstaller?.()
  },

  getPremiereStatus: async (): Promise<{
    supported: boolean
    provisioned: boolean
    proxyRunning: boolean
    mcpConnected: boolean
    pluginConnected: boolean
    connected: boolean
    installDir: string
    pluginInstallerError?: string
  }> => {
    return (
      (await nexusApi.connectors?.premiereStatus?.()) || {
        supported: false,
        provisioned: false,
        proxyRunning: false,
        mcpConnected: false,
        pluginConnected: false,
        connected: false,
        installDir: "",
      }
    )
  },

  installPremiere: (
    onProgress: (data: { step: string; pct: number }) => void,
    onDone: (data: { ok: boolean; status?: unknown; error?: string }) => void,
  ): (() => void) => {
    return nexusApi.connectors?.premiereInstall?.(onProgress, onDone) ?? (() => {})
  },

  disconnectPremiere: async () => {
    return await nexusApi.connectors?.premiereDisconnect?.()
  },

  showPremiereInstaller: async () => {
    return await nexusApi.connectors?.premiereShowInstaller?.()
  },

  listMcpServers: async (): Promise<{
    id: string; command: string; args: string[]; env: Record<string, string>
    enabled: boolean; transport: "stdio" | "http"; url?: string; cwd?: string
    status: "connected" | "disconnected" | "error"; error?: string; toolCount?: number
  }[]> => {
    return await nexusApi.mcp?.list?.() || []
  },

  upsertMcpServer: async (id: string, def: {
    command: string; args: string[]; env?: Record<string, string>
    enabled?: boolean; transport?: "stdio" | "http"; url?: string; cwd?: string
  }) => {
    return await nexusApi.mcp?.upsert?.(id, def)
  },

  removeMcpServer: async (id: string) => {
    return await nexusApi.mcp?.remove?.(id)
  },

  testMcpServer: async (id: string): Promise<{ ok: boolean; error?: string; tools?: { name: string; description?: string }[] }> => {
    return await nexusApi.mcp?.test?.(id) || { ok: false, error: "IPC unavailable" }
  },

  pickFile: async (): Promise<string | null> => {
    return await nexusApi.dialog?.openFile?.() ?? null
  },
}
