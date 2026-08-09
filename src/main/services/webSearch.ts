// Real web search via a local SearXNG instance — ports backend/services/web_search.py
// so the Desktop app stops relying on a model's own (often outdated or invented)
// knowledge for anything time-sensitive. Deliberately NOT gated behind BUILD mode:
// unlike bash/write_file, a read-only web search carries none of the risk PLAN mode
// exists to block, so it runs regardless of which mode the user is in.
const SEARXNG_URL = process.env.SEARXNG_URL || 'http://127.0.0.1:8888'

// Same keyword heuristic as the backend (services/web_search.py) — kept in sync
// deliberately, both sides should trigger enrichment on the same kinds of questions.

// Pedido explícito de pesquisa — independente do tópico. Sem isto, uma mensagem
// como "faz a tua pesquisa" ou "podes investigar isso?" não disparava pesquisa
// nenhuma, e o modelo prometia "vou pesquisar" sem nunca ter tido como. Fica à
// parte das palavras de tópico porque, sozinha, uma frase deste tipo ("sim, faz
// a pesquisa") não tem assunto nenhum — só serve para detectar a necessidade,
// não para construir a query (ver extractQuery).
const GENERIC_REQUEST_KEYWORDS = [
  'pesquisa', 'pesquisar', 'pesquisares', 'investiga', 'investigar',
  'procura', 'procurar', 'procurares', 'estudo', 'estudar',
  'search', 'google', 'consulta a web', 'vai à net', 'vai à internet',
]

// Palavras-chave de tópico que indicam necessidade de informação actual.
const TOPIC_KEYWORDS = [
  'preço', 'preco', 'price', 'valor', 'cotação', 'cotacao', 'quanto custa',
  'how much', 'custo', 'custa', 'mercado', 'market',
  'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'cripto',
  'acção', 'acao', 'stock', 'bolsa', 'nasdaq', 's&p',
  'euro', 'dólar', 'dollar', 'usd', 'eur',
  'notícia', 'noticia', 'news', 'última hora', 'hoje', 'today', 'agora', 'now',
  'actual', 'atual', 'current', 'recente', 'recent', 'último', 'ultimo',
  'latest', 'live', 'em directo', 'em direto',
  'tempo', 'weather', 'clima', 'temperatura', 'chuva', 'rain',
  'resultado', 'result', 'jogo', 'game', 'placar', 'score',
  'liga', 'league', 'championship', 'campeonato', 'equipa', 'equipe',
  'clube', 'classificação', 'classificacao', 'classificado',
  'esta semana', 'this week', 'este mês', 'this month',
  'ontem', 'yesterday', 'amanhã', 'tomorrow',
]

const REALTIME_KEYWORDS = [...GENERIC_REQUEST_KEYWORDS, ...TOPIC_KEYWORDS]

// Palavras de enchimento sem valor nenhum para um motor de pesquisa — uma frase
// conversacional inteira ("é isso que quero, que faças um estudo...") manda o
// SearXNG atrás da palavra errada. Sem stopwords a mesma frase reduzida a
// "classificado equipas Benfica Porto Sporting vencer campeonato 2026/2027" já
// traz resultados certos.
const STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das',
  'e', 'ou', 'que', 'quero', 'queria', 'isso', 'aquilo', 'com', 'sem', 'para', 'por',
  'se', 'é', 'és', 'foi', 'ser', 'estar', 'está', 'estás', 'estão', 'tens', 'tem',
  'podes', 'pode', 'posso', 'consegues', 'consigo', 'faz', 'faça', 'faças', 'fazer',
  'como', 'cada', 'qual', 'quais', 'porque', 'porquê', 'não', 'sim', 'só', 'mais',
  'muito', 'bem', 'obrigado', 'obrigada', 'foca-te', 'foca', 'nos', 'no', 'na',
  'grandes', 'base', 'teus', 'tua', 'teu', 'tuas', 'pontos', 'ponto', 'sua',
  'this', 'that', 'the', 'an', 'and', 'or', 'for', 'with', 'to', 'of', 'in',
  'on', 'is', 'are', 'please', 'can', 'you', 'your',
  ...GENERIC_REQUEST_KEYWORDS, // "estudo", "pesquisa", etc. são o pedido, não o assunto
])

export function needsWebSearch(text: string): boolean {
  const t = text.toLowerCase()
  return REALTIME_KEYWORDS.some(kw => t.includes(kw))
}

// Remove pontuação e stopwords, mantendo a ordem — dá uma query estilo motor
// de busca em vez de uma frase inteira em português corrente.
function stripFiller(sentence: string): string {
  const words = sentence.match(/[\wÀ-ÿ][\wÀ-ÿ/.'-]*/g) || []
  const kept = words.filter(w => !STOPWORDS.has(w.toLowerCase()))
  return kept.length ? kept.join(' ') : sentence
}

// Usar a mensagem inteira como query dilui o resultado quando o utilizador
// escreve de forma conversacional. A pergunta real costuma ser a última frase
// com assunto concreto — é essa que procuramos. Damos prioridade às frases com
// palavra de TÓPICO (preço, bitcoin, jogo, campeonato...) porque essas é que
// dizem do que se trata; uma frase que só tem o pedido genérico ("faz a
// pesquisa") não tem assunto — se for a única coisa encontrada, usa-se o texto
// todo em vez de só essa frase vazia de conteúdo.
function extractQuery(text: string): string {
  const sentences = text.trim().split(/(?<=[.!?\n])\s+/)
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (TOPIC_KEYWORDS.some(kw => sentences[i].toLowerCase().includes(kw))) {
      return stripFiller(sentences[i].trim()).slice(0, 200)
    }
  }
  return stripFiller(text.trim()).slice(0, 200)
}

interface SearxngResult {
  title?: string
  content?: string
  url?: string
}

export async function webSearch(query: string, maxResults = 5): Promise<string> {
  try {
    const url = new URL('/search', SEARXNG_URL)
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!resp.ok) return ''
    const data = await resp.json()
    const results: SearxngResult[] = data.results || []
    if (!results.length) return ''

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
// before it.
export async function maybeEnrichWithWeb(context: string): Promise<string> {
  if (!context || !needsWebSearch(context)) return ''
  const query = extractQuery(context)
  const results = await webSearch(query)
  if (!results) return ''
  return (
    'Os seguintes resultados de pesquisa foram obtidos automaticamente. ' +
    'Usa-os directamente para responder com dados actualizados. ' +
    'Não simules ferramentas nem visitas a websites — apenas usa a informação abaixo:\n\n' +
    results
  )
}
