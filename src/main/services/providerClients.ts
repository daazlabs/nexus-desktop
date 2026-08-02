import { getProvider, getProviderById } from './catalog.js'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  images?: string[]
  toolCalls?: any[]
  toolCallId?: string
  name?: string
}

export interface ChatResult {
  content: string
  model: string
  tokensUsed: number
  provider: string
  duration: number
  toolCalls?: any[]
}

const RETRY_STATUSES = new Set([429, 503, 502])
// Backstop for a rate limit the local accounting in rateLimiter.ts could not
// see coming (another app sharing the key, a per-hour or per-day cap). Kept
// short on purpose: these retries sleep INSIDE the timeout race in
// executeToolLoop, so the whole budget has to fit well under 30s.
const MAX_RETRIES = 2
const BASE_DELAY = 2
const MAX_RETRY_DELAY = 8

async function retryOnRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      const status = err?.response?.status ?? err?.status
      if (status && RETRY_STATUSES.has(status) && attempt < MAX_RETRIES) {
        const retryAfter = parseInt(err?.response?.headers?.get?.('retry-after') || '0', 10)
        const delay = Math.min(retryAfter || BASE_DELAY * Math.pow(2, attempt), MAX_RETRY_DELAY)
        await new Promise(r => setTimeout(r, delay * 1000))
        continue
      }
      throw err
    }
  }
  throw new Error('Unreachable')
}

export abstract class BaseClient {
  abstract providerId: string

  abstract chat(
    apiKey: string, model: string, messages: ChatMessage[],
    opts?: { maxTokens?: number; temperature?: number; tools?: any[]; frequencyPenalty?: number },
  ): Promise<ChatResult>

  async checkHealth(apiKey: string, model: string): Promise<boolean> {
    try {
      const r = await this.chat(apiKey, model, [{ role: 'user', content: 'ping' }], { maxTokens: 1 })
      return !!r.content
    } catch {
      return false
    }
  }
}

function prepareOpenAIMessages(messages: ChatMessage[]): any[] {
  const formatted: any[] = []
  for (const m of messages) {
    if (m.role === 'tool') {
      formatted.push({ role: 'tool', tool_call_id: m.toolCallId || '', content: m.content || '' })
      continue
    }
    const entry: any = { role: m.role }
    if (m.toolCalls) {
      entry.content = m.content ?? null
      entry.tool_calls = m.toolCalls
      formatted.push(entry)
      continue
    }
    if (!m.images?.length) {
      entry.content = m.content || ''
      formatted.push(entry)
      continue
    }
    const parts: any[] = []
    if (m.content) parts.push({ type: 'text', text: m.content })
    for (const img of m.images) {
      parts.push({ type: 'image_url', image_url: { url: img } })
    }
    entry.content = parts
    formatted.push(entry)
  }
  return formatted
}

export class OpenAIClient extends BaseClient {
  providerId = 'openai-compat'

  async chat(
    apiKey: string, model: string, messages: ChatMessage[],
    opts?: { maxTokens?: number; temperature?: number; tools?: any[]; baseUrlOverride?: string; frequencyPenalty?: number },
  ): Promise<ChatResult> {
    const provider = getProvider(model)
    const baseUrl = opts?.baseUrlOverride || provider?.baseUrl || 'https://api.openai.com/v1'
    const maxTokens = opts?.maxTokens ?? 4096
    const temperature = opts?.temperature ?? 0.7
    const frequencyPenalty = opts?.frequencyPenalty ?? 0.2
    const tools = opts?.tools

    const body: any = {
      model,
      messages: prepareOpenAIMessages(messages),
      max_tokens: maxTokens,
      temperature,
      frequency_penalty: frequencyPenalty,
      stream: false,
    }
    if (tools?.length) {
      body.tools = tools
      body.tool_choice = 'auto'
    }

    const data: any = await retryOnRateLimit(async () => {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = new Error(`${model}: HTTP ${resp.status}`) as any
        err.status = resp.status
        err.response = resp
        throw err
      }
      return resp.json()
    })

    const choice = data.choices?.[0]
    const msg = choice?.message || {}
    const reasoning = msg.reasoning || msg.reasoning_content || ''
    const answer = msg.content || ''
    // Some providers (DeepSeek-R1, Qwen thinking, etc) return the chain-of-thought
    // in a separate field — wrap it in <think> so the UI collapses it like it
    // already does for models that inline reasoning between <think> tags themselves.
    const content = reasoning ? `<think>${reasoning}</think>${answer}` : answer
    const toolCalls = msg.tool_calls
    const usage = data.usage || {}
    return {
      content,
      model: data.model || model,
      tokensUsed: usage.total_tokens || 0,
      provider: provider?.id || '',
      duration: 0,
      toolCalls,
    }
  }

  async *chatStream(
    apiKey: string, model: string, messages: ChatMessage[],
    opts?: { maxTokens?: number; temperature?: number; tools?: any[]; baseUrlOverride?: string; frequencyPenalty?: number },
  ): AsyncGenerator<string> {
    const provider = getProvider(model)
    const baseUrl = opts?.baseUrlOverride || provider?.baseUrl || 'https://api.openai.com/v1'
    const maxTokens = opts?.maxTokens ?? 4096
    const temperature = opts?.temperature ?? 0.7
    const frequencyPenalty = opts?.frequencyPenalty ?? 0.2
    const tools = opts?.tools
    let totalTokens = 0

    const body: any = {
      model,
      messages: prepareOpenAIMessages(messages),
      max_tokens: maxTokens,
      temperature,
      frequency_penalty: frequencyPenalty,
      stream: true,
    }
    if (tools?.length) {
      body.tools = tools
      body.tool_choice = 'auto'
    }

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const err = new Error(`${model}: HTTP ${resp.status}`) as any
      err.status = resp.status
      err.response = resp
      throw err
    }

    const reader = resp.body?.getReader()
    if (!reader) return
    const decoder = new TextDecoder()
    let buffer = ''
    const accToolCalls = new Map<number, any>()
    // Some providers (DeepSeek-R1, Qwen thinking, etc) stream the chain-of-thought
    // in a separate delta field from the final answer — wrap it in <think> tags so
    // the UI collapses it, same as models that emit <think> inline themselves.
    let inThink = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const chunk = line.slice(6).trim()
        if (chunk === '[DONE]') continue
        try {
          const parsed = JSON.parse(chunk)
          const delta = parsed.choices?.[0]?.delta || {}
          const reasoningChunk = delta.reasoning_content || delta.reasoning || ''
          const contentChunk = delta.content || ''
          if (reasoningChunk) {
            if (!inThink) { yield '<think>'; inThink = true }
            yield reasoningChunk
          }
          if (contentChunk) {
            if (inThink) { yield '</think>'; inThink = false }
            yield contentChunk
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0
              if (!accToolCalls.has(idx)) {
                accToolCalls.set(idx, { id: '', type: 'function', function: { name: '', arguments: '' } })
              }
              const entry = accToolCalls.get(idx)!
              if (tc.id) entry.id = tc.id
              if (tc.function?.name) entry.function.name += tc.function.name
              if (tc.function?.arguments) entry.function.arguments += tc.function.arguments
            }
          }
          if (parsed.usage) totalTokens = parsed.usage.total_tokens || 0
        } catch { /* skip malformed */ }
      }
    }
    if (inThink) yield '</think>'
    if (accToolCalls.size > 0) {
      yield `__TOOL_CALLS__:${JSON.stringify(Array.from(accToolCalls.values()))}`
    }
    yield `__TOKENS_USED__${totalTokens}`
  }
}

export class GoogleClient extends BaseClient {
  providerId = 'google'

  private prepareContents(messages: ChatMessage[]): { contents: any[]; systemMsg: string } {
    const contents: any[] = []
    let systemMsg = ''
    for (const m of messages) {
      if (m.role === 'system') {
        systemMsg = m.content || ''
        continue
      }
      const parts: any[] = []
      if (m.content) parts.push({ text: m.content })
      if (m.images) {
        for (const img of m.images) {
          const match = img.match(/^data:(.+?);base64,(.+)$/)
          if (match) {
            parts.push({ inlineData: { mimeType: match[1], data: match[2] } })
          }
        }
      }
      contents.push({ role: m.role === 'user' ? 'user' : 'model', parts })
    }
    return { contents, systemMsg }
  }

  private static openaiToolsToGemini(tools?: any[]): any[] | undefined {
    if (!tools?.length) return undefined
    const declarations = tools.map(t => {
      const fn = t.function || t
      return { name: fn.name, description: fn.description, parameters: fn.parameters }
    })
    return [{ functionDeclarations: declarations }]
  }

  private static parseGeminiResponse(data: any): { text: string; toolCalls?: any[] } {
    const candidate = data.candidates?.[0]
    if (!candidate) return { text: '' }
    const parts = candidate.content?.parts || []
    let text = ''
    const toolCalls: any[] = []
    for (const part of parts) {
      if (part.text) text += part.text
      if (part.functionCall) {
        const fc = part.functionCall
        toolCalls.push({
          id: fc.name || 'unknown',
          type: 'function',
          function: { name: fc.name || '', arguments: JSON.stringify(fc.args || {}) },
        })
      }
    }
    return { text, toolCalls: toolCalls.length ? toolCalls : undefined }
  }

  async chat(
    apiKey: string, model: string, messages: ChatMessage[],
    opts?: { maxTokens?: number; temperature?: number; tools?: any[]; frequencyPenalty?: number },
  ): Promise<ChatResult> {
    const provider = getProvider(model)
    const baseUrl = provider?.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'
    const maxTokens = opts?.maxTokens ?? 4096
    const temperature = opts?.temperature ?? 0.7
    const frequencyPenalty = opts?.frequencyPenalty ?? 0.2
    const tools = opts?.tools

    const { contents, systemMsg } = this.prepareContents(messages)
    const payload: any = {
      contents,
      generationConfig: { maxOutputTokens: maxTokens, temperature, frequencyPenalty },
    }
    if (systemMsg) payload.systemInstruction = { parts: [{ text: systemMsg }] }
    const geminiTools = GoogleClient.openaiToolsToGemini(tools)
    if (geminiTools) payload.tools = geminiTools

    const data: any = await retryOnRateLimit(async () => {
      const url = `${baseUrl}/models/${model}:generateContent?key=${apiKey}`
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!resp.ok) {
        const err = new Error(`${model}: HTTP ${resp.status}`) as any
        err.status = resp.status
        err.response = resp
        throw err
      }
      return resp.json()
    })

    const { text, toolCalls } = GoogleClient.parseGeminiResponse(data)
    const usage = data.usageMetadata || {}
    return {
      content: text,
      model,
      tokensUsed: usage.totalTokenCount || 0,
      provider: provider?.id || '',
      duration: 0,
      toolCalls,
    }
  }

  async *chatStream(
    apiKey: string, model: string, messages: ChatMessage[],
    opts?: { maxTokens?: number; temperature?: number; tools?: any[]; frequencyPenalty?: number },
  ): AsyncGenerator<string> {
    const provider = getProvider(model)
    const baseUrl = provider?.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'
    const maxTokens = opts?.maxTokens ?? 4096
    const temperature = opts?.temperature ?? 0.7
    const frequencyPenalty = opts?.frequencyPenalty ?? 0.2
    const tools = opts?.tools

    const { contents, systemMsg } = this.prepareContents(messages)
    const payload: any = {
      contents,
      generationConfig: { maxOutputTokens: maxTokens, temperature, frequencyPenalty },
    }
    if (systemMsg) payload.systemInstruction = { parts: [{ text: systemMsg }] }
    const geminiTools = GoogleClient.openaiToolsToGemini(tools)
    if (geminiTools) payload.tools = geminiTools

    const url = `${baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!resp.ok) {
      const err = new Error(`${model}: HTTP ${resp.status}`) as any
      err.status = resp.status
      err.response = resp
      throw err
    }

    const reader = resp.body?.getReader()
    if (!reader) return
    const decoder = new TextDecoder()
    let buffer = ''
    const accGoogleToolCalls: any[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const parsed = JSON.parse(line.slice(6))
          const { text, toolCalls } = GoogleClient.parseGeminiResponse(parsed)
          if (text) yield text
          if (toolCalls?.length) accGoogleToolCalls.push(...toolCalls)
        } catch { /* skip */ }
      }
    }
    if (accGoogleToolCalls.length > 0) {
      yield `__TOOL_CALLS__:${JSON.stringify(accGoogleToolCalls)}`
    }
  }
}

const clientCache = new Map<string, BaseClient>()

export function getClient(providerId: string): BaseClient {
  const cached = clientCache.get(providerId)
  if (cached) return cached

  const provider = getProviderById(providerId)
  if (!provider) throw new Error(`Unknown provider: ${providerId}`)

  let client: BaseClient
  if (provider.apiType === 'google') {
    client = new GoogleClient()
  } else {
    client = new OpenAIClient()
  }
  clientCache.set(providerId, client)
  return client
}
