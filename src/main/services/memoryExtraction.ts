// Automatic memory extraction for Nexus Desktop.
//
// Same concept as the web app's user_memories system (backend/routers/memory.py):
// after each exchange, ask a cheap model to pull out durable facts about the
// user (projects, tools, preferences, goals) and keep them around to feed
// future conversations. Rebuilt more defensively here rather than ported
// as-is — production data from the web app (Aug 2026) showed its line-based
// parsing let a confused model's own reasoning/prompt-echo leak through and
// get saved as if it were a real fact about the user (one surviving example:
// `'"). They show frustration with generic answers.'`, a stray fragment).
// Asking for strict JSON and discarding anything that fails to parse closes
// off that whole failure mode instead of chasing each new shape of garbage.
//
// Desktop-specific addition: BUILD mode gives this app real tool access
// (bash, filesystem) that the web app never has. A user who just ran
// `git log` in ~/projects/daazrecover or wrote a .tsx file reveals far more
// about what they actually work on than anything they're likely to type in
// chat — so the exchange handed to the extractor includes a short digest of
// which tools ran and on what, not just the visible conversation text.
import { routeWithFallback } from './fallbackChain.js'
import type { ChatMessage } from './providerClients.js'

const MAX_EXCHANGE_CHARS = 1500
const MAX_FACT_LEN = 200
const MIN_FACT_LEN = 8

const EXTRACTION_PROMPT: Record<string, string> = {
  pt: `Analisa esta troca de mensagens e extrai factos concretos e duradouros sobre o utilizador: projectos em que trabalha, tecnologias/ferramentas que usa, preferências, contexto profissional, objectivos, gostos.

Ignora perguntas pontuais, pedidos efémeros, e o conteúdo técnico da própria resposta (código, resultados de comandos) — só o que revela algo estável sobre quem é o utilizador.

Responde APENAS com um array JSON de strings, sem markdown, sem explicação, sem comentário. Cada string é um facto curto e específico. Se não houver nenhum facto novo relevante, responde exactamente: []

Troca:
{exchange}

Array JSON:`,
  en: `Analyze this exchange and extract concrete, durable facts about the user: projects they work on, technologies/tools they use, preferences, professional context, goals, likes.

Ignore one-off questions, ephemeral requests, and the technical content of the reply itself (code, command output) — only what reveals something stable about who the user is.

Reply with ONLY a JSON array of strings, no markdown, no explanation, no commentary. Each string is a short, specific fact. If there is no relevant new fact, reply with exactly: []

Exchange:
{exchange}

JSON array:`,
}

interface ToolEventLike {
  name: string
  args?: Record<string, unknown>
  status: 'running' | 'completed' | 'failed'
}

// A short, human-readable line per completed tool call — enough for the
// extractor to notice "trabalha no projecto X" / "usa bash e git" without
// forwarding full file contents or command output (privacy + prompt-size).
const ARG_KEYS_TO_SHOW = ['command', 'path', 'file_path', 'dir_path', 'query', 'skill_name']

export function summarizeToolEvent(ev: ToolEventLike): string | null {
  if (ev.status !== 'completed') return null
  const args = ev.args || {}
  const key = ARG_KEYS_TO_SHOW.find((k) => typeof args[k] === 'string')
  const detail = key ? String(args[key]).slice(0, 80) : ''
  return detail ? `- ${ev.name}: ${detail}` : `- ${ev.name}`
}

function looksLikePromptEcho(fact: string, lang: string): boolean {
  const normalized = fact.trim().toLowerCase()
  return normalized.length > 3 && EXTRACTION_PROMPT[lang].toLowerCase().includes(normalized)
}

// Heuristic net for anything that survives JSON parsing but still isn't a
// real sentence about the user — e.g. a stray closing quote/paren left over
// from a model that half-followed the JSON instruction.
function looksLikeFragment(fact: string): boolean {
  const opens = (fact.match(/[([{"]/g) || []).length
  const closes = (fact.match(/[)\]}"]/g) || []).length
  if (Math.abs(opens - closes) > 1) return true
  if (/^["')\]}.,;:]/.test(fact.trim())) return true
  return false
}

function parseFactsArray(raw: string): string[] {
  // Models sometimes wrap JSON in a ```json fence despite instructions —
  // strip that before parsing rather than rejecting the whole response.
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter((f): f is string => typeof f === 'string')
}

export async function extractMemories(params: {
  userMsg: string
  assistantMsg: string
  toolSummary?: string
  existingFacts: string[]
  lang?: string
}): Promise<string[]> {
  const lang = params.lang === 'en' ? 'en' : 'pt'
  const userMsg = params.userMsg.trim()
  const assistantMsg = params.assistantMsg.trim()
  if (!userMsg || !assistantMsg) return []

  let exchange = `${lang === 'pt' ? 'Utilizador' : 'User'}: ${userMsg}\n\n${lang === 'pt' ? 'Assistente' : 'Assistant'}: ${assistantMsg.slice(0, MAX_EXCHANGE_CHARS)}`
  if (params.toolSummary) {
    exchange += `\n\n${lang === 'pt' ? 'Ferramentas usadas nesta troca' : 'Tools used in this exchange'}:\n${params.toolSummary}`
  }

  const messages: ChatMessage[] = [
    { role: 'user', content: EXTRACTION_PROMPT[lang].replace('{exchange}', exchange) },
  ]

  let content: string
  try {
    // Forced to 'trabalhador' (free tier), never the user's own paid Cerebro
    // key — this runs silently after every exchange and must never spend
    // real money the user didn't knowingly ask for.
    const result = await routeWithFallback(messages, 'trabalhador', undefined, 'priority', 300)
    content = result.content
  } catch {
    return []
  }

  const existing = new Set(params.existingFacts.map((f) => f.toLowerCase()))
  const facts = parseFactsArray(content)
    .map((f) => f.trim())
    .filter((f) => f.length >= MIN_FACT_LEN && f.length <= MAX_FACT_LEN)
    .filter((f) => !looksLikePromptEcho(f, lang))
    .filter((f) => !looksLikeFragment(f))
    .filter((f) => !existing.has(f.toLowerCase()))

  // De-dupe within this batch too (model can repeat itself across the array).
  const seen = new Set<string>()
  return facts.filter((f) => {
    const key = f.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
