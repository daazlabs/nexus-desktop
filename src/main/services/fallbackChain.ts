import { getProvider, getModelsByClass, listAvailable } from './catalog.js'
import { resolveKey } from './keyVault.js'
import { getClient, type ChatMessage, type ChatResult } from './providerClients.js'
import { checkAndRecord, recordUsage, waitForBudget } from './rateLimiter.js'
import { recordAttempt } from './analytics.js'
import { isProviderDisabled } from './healthChecker.js'
import { createExcel, createWord, createPowerpoint, createPdf } from '../tools/office.js'
import { usarSkill } from '../tools/skills.js'

const MAX_TOOL_ITERATIONS = 10
const TIMEOUT = 30000
// The call that produces the model's answer AFTER a tool already ran (e.g.
// after an MCP round-trip to GitHub) carries a bigger context (the tool
// result) and has already paid the tool's own latency — 30s is tuned for a
// fresh, tool-free first response and was observed timing out here on slower
// free models purely because of that extra load, not a real hang.
const TOOL_CONTINUATION_TIMEOUT = 60000
const MAX_RETRIES = 20
const EMPTY_CONTENT_RETRIES = 2

const cooldownCache = new Map<string, number>()

// Paid models ('cerebro' class) are opt-in only: never part of AUTO fallback.
const AUTO_FALLBACK_ORDER = ['trabalhador', 'local']

function isOnCooldown(model: string): boolean {
  const expiry = cooldownCache.get(model)
  if (!expiry) return false
  if (Date.now() / 1000 > expiry) {
    cooldownCache.delete(model)
    return false
  }
  return true
}

function markCooldown(model: string, duration = 30): void {
  cooldownCache.set(model, Date.now() / 1000 + duration)
}

function shortError(err: any): string {
  if (err?.status) return `HTTP ${err.status}`
  if (err?.name === 'AbortError') return 'timeout'
  return err?.message?.slice(0, 60) || String(err)
}

async function filterModelsWithKeys(models: string[]): Promise<string[]> {
  const available: string[] = []
  for (const model of models) {
    const provider = getProvider(model)
    if (!provider) continue
    if (isProviderDisabled(provider.id)) continue
    if (!provider.requiresKey) {
      available.push(model)
    } else {
      const key = resolveKey(provider.id)
      if (key) available.push(model)
    }
  }
  return available
}

function prioritizeVision(models: string[]): string[] {
  const visionIds = new Set(listAvailable().filter(m => m.vision).map(m => m.id))
  const v = models.filter(m => visionIds.has(m))
  const rest = models.filter(m => !visionIds.has(m))
  return [...v, ...rest]
}

// When a request carries tools (BUILD mode), only models the catalog marks as
// tool-capable may receive them. Sending `tools` to a model that doesn't
// really support function-calling doesn't error — the model just narrates a
// fabricated success ("ficheiro gravado!") instead of ever calling write_file,
// because the BUILD-mode system prompt tells it the action "genuinely
// happens". Filtering here (rather than trusting the model's own text) is the
// only reliable way to catch that before it reaches the user.
function filterToolCapable(models: string[]): string[] {
  const capableIds = new Set(listAvailable().filter(m => m.tools).map(m => m.id))
  return models.filter(m => capableIds.has(m))
}

type ToolNotify = (ev: { id: string; name: string; args: Record<string, unknown>; status: 'running' | 'completed' | 'failed'; result?: string; started_at: number; completed_at?: number }) => void

// Recursively sort object keys so that logically identical args always
// produce the same JSON string, regardless of key order.
function canonicalize(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {}
    for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k])
    return out
  }
  return value
}

// Signature = tool name + canonical JSON of its arguments.
function toolCallSignature(tc: any): string {
  let args: any
  try { args = canonicalize(JSON.parse(tc.function.arguments || '{}')) } catch { args = tc.function.arguments || '' }
  return `${tc.function.name}(${JSON.stringify(args)})`
}

// Cheap stand-in for a tokenizer: only needs to be good enough to tell the
// rate limiter "this next call is ~14k tokens, not ~200".
function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0
  for (const m of messages) {
    if (typeof m.content === 'string') chars += m.content.length
    if (m.toolCalls) chars += JSON.stringify(m.toolCalls).length
  }
  return Math.ceil(chars / 4)
}

async function executeToolLoop(
  client: any, apiKey: string, model: string,
  workingMsgs: ChatMessage[], maxTokens: number, tools?: any[],
  requestPermission?: (action: string, detail: string) => Promise<boolean>,
  isCancelled?: () => boolean,
  notifyTool?: ToolNotify,
  workingDir?: string,
  seenCounts?: Map<string, number>,
  firstCallTimeout: number = TIMEOUT,
): Promise<[ChatResult, ChatMessage[]]> {
  const seenCalls = seenCounts ?? new Map<string, number>()
  const providerId = getProvider(model)?.id || ''

  // Every iteration of this loop is a separate API request carrying the whole
  // (growing) conversation, and on a tight free tier — Cerebras allows 5
  // requests and 30k tokens a minute — a ten-step research task blows the
  // quota within seconds. Pacing here, OUTSIDE the timeout race below, is
  // what keeps the wait from being counted as a hang.
  const paced = async (msgs: ChatMessage[], callTools: any[] | undefined, timeout: number, label: string): Promise<ChatResult> => {
    if (providerId) await waitForBudget(providerId, estimateTokens(msgs), undefined, isCancelled)
    const r: ChatResult = await Promise.race([
      client.chat(apiKey, model, msgs, { maxTokens, tools: callTools }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${model}: timeout after ${timeout / 1000}s${label}`)), timeout)),
    ])
    if (providerId) recordUsage(providerId, r?.tokensUsed || 0)
    return r
  }

  let result = await paced(workingMsgs, tools, firstCallTimeout, '')

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    if (isCancelled?.()) break
    if (!needsToolCall(result)) break

    // Anti-loop: if ANY signature in this round was already executed once,
    // do not execute it again — stop the tool loop here so the forced
    // no-tools final completion below produces an answer instead.
    const callSigs = (result.toolCalls || []).map(toolCallSignature)
    if (callSigs.some((sig: string) => (seenCalls.get(sig) || 0) >= 1)) break
    callSigs.forEach((sig: string) => seenCalls.set(sig, (seenCalls.get(sig) || 0) + 1))

    const resultsList: [any, string][] = []
    for (const tc of result.toolCalls || []) {
      if (isCancelled?.()) break
      const started_at = Date.now()
      const tcId = tc.id || `${tc.function.name}-${started_at}`
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(tc.function.arguments || '{}') } catch { /* */ }
      notifyTool?.({ id: tcId, name: tc.function.name, args, status: 'running', started_at })
      try {
        const r = await executeToolCall(tc, requestPermission, workingDir)
        notifyTool?.({ id: tcId, name: tc.function.name, args, status: 'completed', result: r, started_at, completed_at: Date.now() })
        resultsList.push([tc, r])
      } catch (e: any) {
        notifyTool?.({ id: tcId, name: tc.function.name, args, status: 'failed', result: e.message, started_at, completed_at: Date.now() })
        resultsList.push([tc, `Error: ${e.message}`])
      }
    }

    workingMsgs = [
      ...workingMsgs,
      ...toolCallsToMessages(result.toolCalls || []),
      ...toolResultsToMessages(resultsList),
    ]

    result = await paced(workingMsgs, tools, TIMEOUT, ` (mid tool-loop, iteration ${iteration + 1})`)
  }

  if (needsToolCall(result)) {
    if (providerId) await waitForBudget(providerId, estimateTokens(workingMsgs), undefined, isCancelled)
    result = await client.chat(apiKey, model, workingMsgs, { maxTokens, tools: undefined })
    if (providerId) recordUsage(providerId, result?.tokensUsed || 0)
  }

  return [result, workingMsgs]
}

function needsToolCall(result: ChatResult): boolean {
  return !!(result.toolCalls?.length)
}

async function runToolsAndContinue(
  client: any,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  toolCalls: any[],
  maxTokens: number,
  tools: any[],
  requestPermission?: (action: string, detail: string) => Promise<boolean>,
  isCancelled?: () => boolean,
  notifyTool?: ToolNotify,
  workingDir?: string,
): Promise<string> {
  if (isCancelled?.()) return ''
  const resultsList: [any, string][] = []
  for (const tc of toolCalls) {
    if (isCancelled?.()) break
    const started_at = Date.now()
    const tcId = tc.id || `${tc.function.name}-${started_at}`
    let args: Record<string, unknown> = {}
    try { args = JSON.parse(tc.function.arguments || '{}') } catch { /* */ }
    notifyTool?.({ id: tcId, name: tc.function.name, args, status: 'running', started_at })
    try {
      const r = await executeToolCall(tc, requestPermission, workingDir)
      notifyTool?.({ id: tcId, name: tc.function.name, args, status: 'completed', result: r, started_at, completed_at: Date.now() })
      resultsList.push([tc, r])
    } catch (e: any) {
      notifyTool?.({ id: tcId, name: tc.function.name, args, status: 'failed', result: e.message, started_at, completed_at: Date.now() })
      resultsList.push([tc, `Error: ${e.message}`])
    }
  }
  if (isCancelled?.()) return ''
  const workingMsgs: ChatMessage[] = [
    ...messages,
    ...toolCallsToMessages(toolCalls),
    ...toolResultsToMessages(resultsList),
  ]
  if (isCancelled?.()) return ''
  // Seed the anti-loop counter with the calls we just executed so the model
  // cannot immediately repeat them inside the tool loop.
  const seenCounts = new Map<string, number>()
  for (const tc of toolCalls) {
    const sig = toolCallSignature(tc)
    seenCounts.set(sig, (seenCounts.get(sig) || 0) + 1)
  }
  const [result] = await executeToolLoop(client, apiKey, model, workingMsgs, maxTokens, tools.length ? tools : undefined, requestPermission, isCancelled, notifyTool, workingDir, seenCounts, TOOL_CONTINUATION_TIMEOUT)
  return result.content || ''
}

function toolCallsToMessages(toolCalls: any[]): ChatMessage[] {
  return [{
    role: 'assistant' as const,
    content: null,
    toolCalls: toolCalls.map(tc => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.function.name, arguments: tc.function.arguments },
    })),
  }]
}

function toolResultsToMessages(results: [any, string][]): ChatMessage[] {
  return results.map(([tc, content]) => ({
    role: 'tool' as const,
    toolCallId: tc.id,
    content,
  }))
}

// Tools that touch the filesystem or shell. These must NEVER run without an
// explicit permission decision: if no permission callback is available on a
// given code path, gated tools are denied outright instead of silently
// executing.
const GATED_TOOLS = new Set([
  'bash', 'write_file', 'delete_file', 'create_dir', 'read_file', 'list_dir', 'file_info',
  'create_excel', 'create_word', 'create_powerpoint', 'create_pdf',
])

async function executeToolCall(
  tc: any,
  requestPermission?: (action: string, detail: string) => Promise<boolean>,
  workingDir?: string,
): Promise<string> {
  const nodePath = await import('node:path')
  const name = tc.function.name
  const args = JSON.parse(tc.function.arguments || '{}')

  // Unconditional permission gate: no callback -> no execution. MCP tools
  // (GitHub/Drive/Gmail) are treated as dangerous by default alongside the
  // native gated tools — an arbitrary third-party MCP server has no known
  // blast radius, so it never gets a pass.
  if ((GATED_TOOLS.has(name) || name.startsWith('mcp__')) && !requestPermission) {
    return 'Permission denied.'
  }

  if (name.startsWith('mcp__')) {
    const { dispatchMcpCall } = await import('./mcpConnectors.js')
    return await dispatchMcpCall(name, args, requestPermission)
  }

  // Resolve a file path: absolute paths are kept as-is; relative paths are
  // resolved against workingDir when set, otherwise left for the OS to handle.
  const resolve = (p: string): string => {
    if (!p) return p
    if (nodePath.isAbsolute(p)) return p
    if (workingDir) return nodePath.resolve(workingDir, p)
    return p
  }

  switch (name) {
    case 'usar_skill':
      return usarSkill(args.nome)
    case 'read_file': {
      const resolved = resolve(args.path)
      if (requestPermission) {
        const ok = await requestPermission('read_file', `Read: ${resolved}`)
        if (!ok) return 'Permission denied.'
      }
      const fs = await import('node:fs/promises')
      return await fs.readFile(resolved, 'utf-8')
    }
    case 'write_file': {
      const resolved = resolve(args.path)
      if (requestPermission) {
        const ok = await requestPermission('write_file', `Write to: ${resolved}`)
        if (!ok) return 'Permission denied.'
      }
      const fs = await import('node:fs/promises')
      await fs.mkdir(nodePath.dirname(resolved), { recursive: true })
      await fs.writeFile(resolved, args.content, 'utf-8')
      return `File written: ${resolved}`
    }
    case 'list_dir': {
      const resolved = resolve(args.path)
      if (requestPermission) {
        const ok = await requestPermission('list_dir', `List directory: ${resolved}`)
        if (!ok) return 'Permission denied.'
      }
      const fs = await import('node:fs/promises')
      const entries = await fs.readdir(resolved)
      return entries.join('\n')
    }
    case 'create_dir': {
      const resolved = resolve(args.path)
      if (requestPermission) {
        const ok = await requestPermission('create_dir', `Create directory: ${resolved}`)
        if (!ok) return 'Permission denied.'
      }
      const fs = await import('node:fs/promises')
      await fs.mkdir(resolved, { recursive: true })
      return `Directory created: ${resolved}`
    }
    case 'delete_file': {
      const resolved = resolve(args.path)
      if (requestPermission) {
        const ok = await requestPermission('delete_file', `Delete: ${resolved}`)
        if (!ok) return 'Permission denied.'
      }
      const fs = await import('node:fs/promises')
      await fs.unlink(resolved)
      return `File deleted: ${resolved}`
    }
    case 'file_info': {
      const resolved = resolve(args.path)
      if (requestPermission) {
        const ok = await requestPermission('file_info', `Inspect: ${resolved}`)
        if (!ok) return 'Permission denied.'
      }
      const fs = await import('node:fs/promises')
      const stat = await fs.stat(resolved)
      return JSON.stringify({ size: stat.size, isDirectory: stat.isDirectory(), mtime: stat.mtime })
    }
    case 'bash': {
      if (requestPermission) {
        const ok = await requestPermission('bash', `Run: ${args.command}`)
        if (!ok) return 'Permission denied.'
      }
      const { execa } = await import('execa')
      // cwd makes relative paths work correctly in shell commands
      const execOpts: any = { shell: true, timeout: 30000 }
      if (workingDir) execOpts.cwd = workingDir
      const result = await execa(args.command, execOpts)
      return result.stdout
    }
    case 'create_excel': {
      const resolved = resolve(args.path)
      if (requestPermission) {
        const ok = await requestPermission('create_excel', `Create Excel workbook: ${resolved}`)
        if (!ok) return 'Permission denied.'
      }
      return await createExcel({ path: resolved, sheets: args.sheets })
    }
    case 'create_word': {
      const resolved = resolve(args.path)
      if (requestPermission) {
        const ok = await requestPermission('create_word', `Create Word document: ${resolved}`)
        if (!ok) return 'Permission denied.'
      }
      return await createWord({ path: resolved, title: args.title, blocks: args.blocks })
    }
    case 'create_powerpoint': {
      const resolved = resolve(args.path)
      if (requestPermission) {
        const ok = await requestPermission('create_powerpoint', `Create PowerPoint presentation: ${resolved}`)
        if (!ok) return 'Permission denied.'
      }
      return await createPowerpoint({ path: resolved, title: args.title, slides: args.slides })
    }
    case 'create_pdf': {
      const resolved = resolve(args.path)
      if (requestPermission) {
        const ok = await requestPermission('create_pdf', `Create PDF: ${resolved}`)
        if (!ok) return 'Permission denied.'
      }
      return await createPdf({ path: resolved, html: args.html, landscape: args.landscape })
    }
    default:
      return `Unknown tool: ${name}`
  }
}

async function tryModels(
  models: string[], messages: ChatMessage[],
  maxTokens: number, tools?: any[],
  requestPermission?: (action: string, detail: string) => Promise<boolean>,
): Promise<ChatResult> {
  const errors: string[] = []
  let emptyCount = 0

  for (const model of models) {
    if (isOnCooldown(model)) continue

    const provider = getProvider(model)
    if (!provider) continue

    const apiKey = resolveKey(provider.id)
    if (!apiKey && provider.requiresKey) continue

    const client = getClient(provider.id)

    try {
      const startTime = Date.now()
      let workingMsgs = [...messages]
      const [result] = await executeToolLoop(client, apiKey!, model, workingMsgs, maxTokens, tools, requestPermission)

      result.duration = (Date.now() - startTime) / 1000

      if (!result.content && !result.toolCalls) {
        emptyCount++
        errors.push(`${model}: empty completion`)
        recordAttempt(provider.id, model, false, 0, 'empty completion')
        if (emptyCount >= EMPTY_CONTENT_RETRIES) emptyCount = 0
        markCooldown(model, 15)
        continue
      }

      checkAndRecord(provider.id, result.tokensUsed || 0)
      recordAttempt(provider.id, model, true, result.tokensUsed || 0)
      cooldownCache.delete(model)
      return result
    } catch (err: any) {
      errors.push(`${model}: ${shortError(err)}`)
      recordAttempt(provider.id, model, false, 0, err.message?.slice(0, 100))
      markCooldown(model, err.name === 'AbortError' ? 10 : 15)
    }
  }

  throw new Error(`No model responded. Errors: ${errors.join('; ')}`)
}

function sortByStrategy(models: string[], strategy: string): string[] {
  if (strategy === 'smartest') {
    const allM = new Map(listAvailable().map(m => [m.id, m.intelligenceScore]))
    return [...models].sort((a, b) => (allM.get(b) || 5) - (allM.get(a) || 5))
  }
  if (strategy === 'fastest') {
    const allM = new Map(listAvailable().map(m => [m.id, m.speedScore]))
    return [...models].sort((a, b) => (allM.get(b) || 5) - (allM.get(a) || 5))
  }
  return models
}

export function getCooldownState(): Record<string, number> {
  const now = Date.now() / 1000
  const result: Record<string, number> = {}
  for (const [model, expiry] of cooldownCache) {
    const remaining = Math.ceil(expiry - now)
    if (remaining > 0) result[model] = remaining
  }
  return result
}

export async function routeWithFallback(
  messages: ChatMessage[],
  modelClass = 'trabalhador',
  model?: string,
  strategy = 'priority',
  maxTokens = 4096,
  tools?: any[],
  fallbackOrder?: string[],
  requestPermission?: (action: string, detail: string) => Promise<boolean>,
): Promise<ChatResult> {
  const hasImages = messages.some(m => m.images?.length)

  if (model) {
    let filtered = await filterModelsWithKeys([model])
    if (tools?.length) filtered = filterToolCapable(filtered)
    if (filtered.length) {
      try {
        return await tryModels(filtered, messages, maxTokens, tools, requestPermission)
      } catch {
        console.warn(`[fallback] model override "${model}" failed, falling back`)
      }
    }
  }

  let fbOrder: string[]
  if (modelClass === 'auto') {
    fbOrder = [...(fallbackOrder || AUTO_FALLBACK_ORDER)]
  } else if (modelClass === 'local') {
    fbOrder = ['local']
  } else {
    const chosen = await filterModelsWithKeys(getModelsByClass(modelClass))
    fbOrder = chosen.length ? [modelClass] : [modelClass, 'local']
  }

  const lastErrors = new Map<string, string>()

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    for (const attemptClass of fbOrder) {
      let models = getModelsByClass(attemptClass)
      models = await filterModelsWithKeys(models)
      if (tools?.length) models = filterToolCapable(models)
      if (!models.length) {
        if (!lastErrors.has(attemptClass)) {
          lastErrors.set(attemptClass, 'no usable models (missing API keys, all on cooldown, or none support tools)')
        }
        continue
      }
      if (hasImages) models = prioritizeVision(models)
      // Tool use already pays for a permission wait + the tool's own round-trip
      // (e.g. a GitHub API call) before the model even starts its final
      // answer — pairing that with a big/slow model (e.g. a 675B one with
      // speedScore 3) is what pushed the timeout observed in testing.
      // Latency budget matters far more than raw intelligence here.
      models = sortByStrategy(models, tools?.length ? 'fastest' : strategy)

      for (const m of models) {
        if (isOnCooldown(m)) continue
        const provider = getProvider(m)
        if (!provider) continue
        const apiKey = resolveKey(provider.id)
        if (!apiKey && provider.requiresKey) continue
        const client = getClient(provider.id)

        try {
          const startTime = Date.now()
          let workingMsgs = [...messages]
          const [result] = await executeToolLoop(client, apiKey!, m, workingMsgs, maxTokens, tools, requestPermission)

          if (result.content) {
            result.duration = (Date.now() - startTime) / 1000
            checkAndRecord(provider.id, result.tokensUsed || 0)
            recordAttempt(provider.id, m, true, result.tokensUsed || 0)
            cooldownCache.delete(m)
            return result
          } else {
            recordAttempt(provider.id, m, false, 0, 'empty completion')
            markCooldown(m, 10)
            lastErrors.set(attemptClass, `${m}: empty completion`)
          }
        } catch (err: any) {
          recordAttempt(provider.id, m, false, 0, err.message?.slice(0, 100))
          markCooldown(m, 10)
          lastErrors.set(attemptClass, `${m}: ${shortError(err)}`)
        }
      }
    }
  }

  const details = Array.from(lastErrors.entries()).map(([c, e]) => `[${c}] ${e}`).join('; ')
  throw new Error(
    `All providers failed for class "${modelClass}" after ${MAX_RETRIES} attempts. Errors: ${details}`,
  )
}

export async function* routeWithFallbackStream(
  messages: ChatMessage[],
  modelClass = 'trabalhador',
  model?: string,
  strategy = 'priority',
  maxTokens = 4096,
  tools?: any[],
  requestPermission?: (action: string, detail: string) => Promise<boolean>,
  isCancelled?: () => boolean,
  temperature?: number,
  notifyTool?: ToolNotify,
  workingDir?: string,
  remoteOllamaUrl?: string,
  remoteOllamaKey?: string,
): AsyncGenerator<string> {
  const hasImages = messages.some(m => m.images?.length)

  const localIds = new Set(['ollama', 'llamacpp'])
  function resolveLocalOverride(providerId: string): { apiKey: string; baseUrlOverride?: string } {
    if (localIds.has(providerId) && remoteOllamaUrl) {
      return { apiKey: remoteOllamaKey || '', baseUrlOverride: `${remoteOllamaUrl}/api/local/v1` }
    }
    return { apiKey: resolveKey(providerId) || '' }
  }

  if (model) {
    let filtered = await filterModelsWithKeys([model])
    if (tools?.length) filtered = filterToolCapable(filtered)
    if (filtered.length) {
      const m = filtered[0]
      const provider = getProvider(m)
      const { apiKey, baseUrlOverride } = resolveLocalOverride(provider?.id || '')
      const effectiveKey = apiKey || resolveKey(provider?.id || '')
      if (provider && (effectiveKey || !provider.requiresKey)) {
        const client = getClient(provider.id)
        if ('chatStream' in client) {
          let sent = false
          try {
            let pendingCalls: any[] | null = null
            for await (const chunk of (client as any).chatStream(effectiveKey, m, messages, { maxTokens, tools, temperature, baseUrlOverride })) {
              if (typeof chunk === 'string' && chunk.startsWith('__TOKENS_USED__')) continue
              if (typeof chunk === 'string' && chunk.startsWith('__TOOL_CALLS__:')) {
                pendingCalls = JSON.parse(chunk.slice('__TOOL_CALLS__:'.length))
                sent = true
                continue
              }
              if (chunk) {
                sent = true
                yield chunk
              }
            }
            if (pendingCalls) {
              const finalContent = await runToolsAndContinue(client, apiKey!, m, messages, pendingCalls, maxTokens, tools || [], requestPermission, isCancelled, notifyTool, workingDir)
              if (finalContent) yield finalContent
            }
            if (sent) {
              checkAndRecord(provider.id, 0)
              recordAttempt(provider.id, m, true)
              yield `__MODEL__:${m}`
              return
            }
          } catch (err) {
            console.warn(`[stream] override "${model}" failed:`, err)
            if (sent) {
              // Partial output already reached the renderer — stop here.
              // Falling through to the retry loop would re-run the prompt
              // and append a second answer after the partial one.
              yield `__MODEL__:${m}`
              return
            }
          }
        }
      }
    }
  }

  let fbOrder: string[]
  if (modelClass === 'auto') {
    fbOrder = [...AUTO_FALLBACK_ORDER]
  } else if (modelClass === 'local') {
    fbOrder = ['local']
  } else {
    const chosen = await filterModelsWithKeys(getModelsByClass(modelClass))
    fbOrder = chosen.length ? [modelClass] : [modelClass, 'local']
  }

  const lastErrors = new Map<string, string>()

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    for (const attemptClass of fbOrder) {
      let models = getModelsByClass(attemptClass)
      models = await filterModelsWithKeys(models)
      if (tools?.length) models = filterToolCapable(models)
      if (!models.length) continue
      if (hasImages) models = prioritizeVision(models)
      // Tool use already pays for a permission wait + the tool's own round-trip
      // (e.g. a GitHub API call) before the model even starts its final
      // answer — pairing that with a big/slow model (e.g. a 675B one with
      // speedScore 3) is what pushed the timeout observed in testing.
      // Latency budget matters far more than raw intelligence here.
      models = sortByStrategy(models, tools?.length ? 'fastest' : strategy)

      for (const m of models) {
        if (isOnCooldown(m)) continue
        const provider = getProvider(m)
        if (!provider) continue
        const { apiKey: localKey, baseUrlOverride } = resolveLocalOverride(provider.id)
        const apiKey = localKey || resolveKey(provider.id)
        if (!apiKey && provider.requiresKey) continue
        const client = getClient(provider.id)
        if (!('chatStream' in client)) continue

        let holdFirst = true
        let totalTokens = 0
        let pendingCalls: any[] | null = null
        try {
          for await (const chunk of (client as any).chatStream(apiKey, m, messages, { maxTokens, tools, temperature, baseUrlOverride })) {
            if (typeof chunk === 'string' && chunk.startsWith('__TOKENS_USED__')) {
              totalTokens = parseInt(chunk.split('__')[2], 10) || 0
              continue
            }
            if (typeof chunk === 'string' && chunk.startsWith('__TOOL_CALLS__:')) {
              pendingCalls = JSON.parse(chunk.slice('__TOOL_CALLS__:'.length))
              continue
            }
            if (chunk) {
              holdFirst = false
              yield chunk
            }
          }

          if (pendingCalls) {
            const finalContent = await runToolsAndContinue(client, apiKey!, m, messages, pendingCalls, maxTokens, tools || [], requestPermission, isCancelled, notifyTool)
            if (finalContent) {
              holdFirst = false
              yield finalContent
            }
          }

          if (holdFirst) {
            recordAttempt(provider.id, m, false, 0, 'empty stream')
            markCooldown(m, 10)
            lastErrors.set(m, 'empty stream')
            continue
          }

          checkAndRecord(provider.id, totalTokens)
          recordAttempt(provider.id, m, true, totalTokens)
          cooldownCache.delete(m)
          yield `__MODEL__:${m}`
          return
        } catch (err: any) {
          if (holdFirst) {
            recordAttempt(provider.id, m, false, 0, err.message?.slice(0, 100))
            markCooldown(m, 15)
            lastErrors.set(m, err?.message?.slice(0, 100) || String(err))
            continue
          } else {
            // Content already reached the renderer. Throwing here makes
            // finalize() replace the whole answer with "❌ <message>", so a
            // long tool-driven run that dies on its last step loses every
            // step before it. Append the failure to the partial answer and
            // finish normally instead. Always tagged with the model — bare
            // "timeout" or "HTTP 503" is undiagnosable.
            const msg: string = err?.message || String(err)
            recordAttempt(provider.id, m, false, totalTokens, msg.slice(0, 100))
            yield `\n\n---\n⚠️ ${msg.startsWith(m) ? msg : `${m}: ${msg}`}\n(resposta interrompida — o texto acima é o que chegou a ser gerado)`
            yield `__MODEL__:${m}`
            return
          }
        }
      }
    }
  }

  const details = Array.from(lastErrors.entries()).map(([mdl, e]) => `${mdl}: ${e}`).join('; ')
  throw new Error(`All providers failed for class "${modelClass}" after ${MAX_RETRIES} attempts.${details ? ` Errors: ${details}` : ''}`)
}
