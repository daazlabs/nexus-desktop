// Real web search via a local SearXNG instance — ports backend/services/web_search.py
// so the Desktop app stops relying on a model's own (often outdated or invented)
// knowledge for anything time-sensitive. Deliberately NOT gated behind BUILD mode:
// unlike bash/write_file, a read-only web search carries none of the risk PLAN mode
// exists to block, so it runs regardless of which mode the user is in.
import type { ChatMessage, ChatResult } from './providerClients.js'

const SEARXNG_URL = process.env.SEARXNG_URL || 'http://127.0.0.1:8888'

// Histórico: até 14 Ago 2026 a decisão "isto precisa de pesquisa web?" era uma
// lista fixa de ~60 palavras-chave PT/EN, duplicada à mão aqui e em
// backend/services/web_search.py — o comentário antigo dizia "kept in sync
// deliberately", um cheiro de manutenção a sério. Fragilíssimo: uma pergunta
// que precisasse de dados actuais mas não usasse uma das palavras exactas
// nunca disparava pesquisa nenhuma. Substituído por uma chamada LLM (classe
// "trabalhador", grátis) que decide E reescreve a query ao mesmo tempo —
// mesmo padrão que memoryExtraction.ts já usa: pede-se JSON estrito, e
// trata-se qualquer coisa que não faça parse como resultado negativo.
const CLASSIFIER_PROMPT = (context: string) => `Achas que esta mensagem precisa de informação actual da internet para responder bem \
(preços, cotações, notícias, resultados desportivos, tempo, factos que mudam com o tempo, ou qualquer coisa que \
tu não possas saber com certeza)? Ignora pedidos que não têm assunto nenhum (ex: só "sim, faz isso") — nesse \
caso olha para o resto da mensagem para encontrar o assunto real.

Mensagem:
${context}

Responde APENAS com um objecto JSON, sem markdown, sem explicação:
{"search": true ou false, "query": "pesquisa curta e directa no mesmo idioma da mensagem, sem palavras de \
preenchimento — string vazia se search for false"}

JSON:`

const CLASSIFY_TIMEOUT = 12000
const CLASSIFY_MAX_TOKENS = 120

const THINK_BLOCK_RE = /<think>[\s\S]*?(<\/think>|$)/i
const JSON_FENCE_RE = /^```(?:json)?\s*|\s*```$/gi
const JSON_OBJECT_RE = /\{[\s\S]*\}/

// Falha fechada: qualquer coisa que não faça parse como JSON válido é tratada
// como "não pesquisar" — mesmo princípio de memoryExtraction.ts (JSON
// estrito, sem tentar aproveitar lixo linha a linha).
export function parseClassification(raw: string): { shouldSearch: boolean; query: string } {
  const cleaned = raw.replace(THINK_BLOCK_RE, '').trim().replace(JSON_FENCE_RE, '').trim()
  const match = cleaned.match(JSON_OBJECT_RE)
  if (!match) return { shouldSearch: false, query: '' }
  let parsed: any
  try {
    parsed = JSON.parse(match[0])
  } catch {
    return { shouldSearch: false, query: '' }
  }
  if (!parsed || typeof parsed !== 'object') return { shouldSearch: false, query: '' }
  const query = typeof parsed.query === 'string' ? parsed.query.trim().slice(0, 200) : ''
  return { shouldSearch: Boolean(parsed.search) && Boolean(query), query }
}

// Corre sempre na classe "trabalhador" (grátis) — nunca gasta a classe
// "cerebro" (paga) do utilizador para uma decisão automática, e nunca manda
// uma conversa "local" (privada) para um modelo na nuvem: mesmo princípio já
// usado em fallbackChain.ts para delegar sub-tarefas (delegar_tarefa).
async function classifySearch(
  context: string,
  callerModelClass?: string,
): Promise<{ shouldSearch: boolean; query: string }> {
  const { routeWithFallback } = await import('./fallbackChain.js')
  const targetClass = callerModelClass === 'local' ? 'local' : 'trabalhador'
  const messages: ChatMessage[] = [{ role: 'user', content: CLASSIFIER_PROMPT(context) }]

  try {
    const result = await Promise.race([
      routeWithFallback(messages, targetClass, undefined, 'fastest', CLASSIFY_MAX_TOKENS, undefined),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`web search classifier: timeout after ${CLASSIFY_TIMEOUT / 1000}s`)), CLASSIFY_TIMEOUT),
      ),
    ]) as ChatResult
    return parseClassification(result.content || '')
  } catch (e) {
    console.warn('[webSearch] classifier failed:', e)
    return { shouldSearch: false, query: '' }
  }
}

interface SearxngResult {
  title?: string
  content?: string
  url?: string
}

// O SearXNG já ordena por relevância léxica, mas isso não apanha sinónimos
// nem distingue "artigos sobre o mesmo assunto" de "o mesmo artigo espelhado
// em 3 sites" — os dois problemas que o modo speed/balanced do Vane resolve
// com embeddings antes de escrever a resposta. Usamos o nomic-embed-text
// local (Ollama, mesmo modelo já usado noutros projectos DAAZ) em vez de uma
// API paga — a app já corre no computador do próprio utilizador, sem GPU
// partilhada com outros serviços a competir. Falha ABERTA de propósito: ao
// contrário do classificador (onde "não pesquisar" é o resultado seguro),
// aqui o resultado seguro é devolver os resultados como vieram do SearXNG —
// reranking pior nunca deve significar zero resultados.
const OLLAMA_URL = 'http://localhost:11434'
const EMBED_MODEL = 'nomic-embed-text'
// Testado ao vivo 14 Ago 2026 (backend): com o modelo já carregado, uma
// chamada com ~15 textos demora ~2s; a carga a frio pode levar bem mais numa
// GPU apertada. 15s dá margem sem segurar a resposta do chat por demasiado
// tempo se o Ollama estiver mesmo preso.
const EMBED_TIMEOUT = 15000
const RERANK_POOL = 15
const SIMILARITY_THRESHOLD = 0.5
const DEDUP_THRESHOLD = 0.85

async function embed(texts: string[]): Promise<number[][] | null> {
  if (!texts.length) return []
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT),
    })
    if (!resp.ok) return null
    const data = await resp.json()
    const embeddings: number[][] | undefined = data.embeddings
    if (!embeddings || embeddings.length !== texts.length) return null
    return embeddings
  } catch (e) {
    console.warn('[webSearch] embeddings failed:', e)
    return null
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (!normA || !normB) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// Ordena por semelhança semântica real à query e descarta duplicados
// quase-idênticos. O nomic-embed-text precisa dos prefixos
// "search_query:"/"search_document:" para separar bem os scores.
async function rerank(query: string, results: SearxngResult[]): Promise<SearxngResult[]> {
  if (!results.length) return results

  const texts = results.map(r => `${r.title || ''} ${r.content || ''}`.trim())
  const embeddings = await embed([`search_query: ${query}`, ...texts.map(t => `search_document: ${t}`)])
  if (!embeddings) return results

  const [queryVec, ...resultVecs] = embeddings
  const scored = results
    .map((r, i) => ({ r, vec: resultVecs[i], score: cosine(queryVec, resultVecs[i]) }))
    .sort((a, b) => b.score - a.score)

  const kept: { r: SearxngResult; vec: number[] }[] = []
  for (const { r, vec, score } of scored) {
    if (score < SIMILARITY_THRESHOLD) continue
    if (kept.some(k => cosine(vec, k.vec) >= DEDUP_THRESHOLD)) continue
    kept.push({ r, vec })
  }

  // O filtro de relevância chumbou tudo — mais provável ser um score mal
  // calibrado para esta query do que os resultados serem mesmo todos
  // irrelevantes. Preferimos mostrar algo (ordem original) a nada.
  return kept.length ? kept.map(k => k.r) : results
}

export async function webSearch(query: string, maxResults = 5): Promise<string> {
  try {
    const url = new URL('/search', SEARXNG_URL)
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!resp.ok) return ''
    const data = await resp.json()
    let results: SearxngResult[] = data.results || []
    if (!results.length) return ''

    results = await rerank(query, results.slice(0, RERANK_POOL))

    const now = new Date().toLocaleString('pt-PT')
    const lines = [`[Pesquisa web — ${now}]`]
    for (const r of results.slice(0, maxResults)) {
      const title = (r.title || '').trim()
      const content = (r.content || '').trim().slice(0, 350)
      if (title || content) {
        lines.push(`\n${title}`)
        if (content) lines.push(content)
        if (r.url) lines.push(`Fonte: ${r.url}`)
      }
    }
    return lines.join('\n')
  } catch (e) {
    console.warn('[webSearch] failed:', e)
    return ''
  }
}

// Returns the system-message content to inject, or '' if this message doesn't
// look like it needs current info (or the search came back empty).
// `context` should be the last 1-2 user messages (newest last) — a short reply
// like "sim, faz a pesquisa" has no topic of its own, that was in the message
// before it. `callerModelClass` is only used to decide whether the classifier
// call itself is allowed to leave the machine (see classifySearch above).
export async function maybeEnrichWithWeb(context: string, callerModelClass?: string): Promise<string> {
  if (!context) return ''
  const { shouldSearch, query } = await classifySearch(context, callerModelClass)
  if (!shouldSearch) return ''

  const results = await webSearch(query)
  if (!results) return ''
  return (
    'Os seguintes resultados de pesquisa foram obtidos automaticamente. ' +
    'Usa-os directamente para responder com dados actualizados. ' +
    'Não simules ferramentas nem visitas a websites — apenas usa a informação abaixo:\n\n' +
    results
  )
}
