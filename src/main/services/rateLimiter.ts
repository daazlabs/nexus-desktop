const WINDOW_SECONDS = 60

const PROVIDER_LIMITS: Record<string, [number, number]> = {
  groq: [30, 15000],
  openrouter: [20, 100000],
  gemini: [60, 1000000],
  github: [30, 50000],
  deepseek: [500, 1000000],
  mistral: [5, 50000],
  anthropic: [5, 40000],
  openai: [500, 200000],
  ollama: [100, 500000],
  llamacpp: [100, 500000],
  // Free tier, measured from the x-ratelimit-* response headers: only 5
  // requests/minute and 30k tokens/minute. Far tighter than the [30, 50000]
  // default that used to apply here, which is what let a tool loop fire ten
  // back-to-back calls and collect an HTTP 429 halfway through.
  cerebras: [5, 30000],
}

interface WindowEntry {
  requests: number
  tokens: number
}

const windows = new Map<number, Map<string, WindowEntry>>()

function getOrCreateWindow(provider: string, now: number): WindowEntry {
  const windowStart = now - (now % WINDOW_SECONDS)
  let timeWindow = windows.get(windowStart)
  if (!timeWindow) {
    windows.clear()
    timeWindow = new Map()
    windows.set(windowStart, timeWindow)
  }
  let entry = timeWindow.get(provider)
  if (!entry) {
    entry = { requests: 0, tokens: 0 }
    timeWindow.set(provider, entry)
  }
  return entry
}

export function checkAndRecord(provider: string, tokens = 0): boolean {
  const [maxRpm, maxTpm] = PROVIDER_LIMITS[provider] || [30, 50000]
  const now = Math.floor(Date.now() / 1000)

  const entry = getOrCreateWindow(provider, now)
  if (entry.requests >= maxRpm) return false
  if (entry.tokens >= maxTpm) return false

  entry.requests += 1
  entry.tokens += tokens
  return true
}

// Would one more request of roughly `estTokens` still fit in this minute?
// Pure check — records nothing.
export function hasBudget(provider: string, estTokens = 0): boolean {
  const [maxRpm, maxTpm] = PROVIDER_LIMITS[provider] || [30, 50000]
  const entry = getOrCreateWindow(provider, Math.floor(Date.now() / 1000))
  if (entry.requests + 1 > maxRpm) return false
  if (entry.tokens + estTokens > maxTpm) return false
  return true
}

export function recordUsage(provider: string, tokens = 0): void {
  const entry = getOrCreateWindow(provider, Math.floor(Date.now() / 1000))
  entry.requests += 1
  entry.tokens += tokens
}

function msUntilWindowReset(): number {
  const windowMs = WINDOW_SECONDS * 1000
  return windowMs - (Date.now() % windowMs) + 250
}

// Sleep until the provider has room again instead of firing a request that is
// certain to come back 429. Used between iterations of the tool loop, where a
// single user prompt legitimately needs many calls in a row and switching
// model mid-conversation is not an option.
export async function waitForBudget(
  provider: string,
  estTokens = 0,
  maxWaitMs = WINDOW_SECONDS * 1000 + 5000,
  isCancelled?: () => boolean,
): Promise<void> {
  const deadline = Date.now() + maxWaitMs
  while (!hasBudget(provider, estTokens)) {
    if (isCancelled?.()) return
    const remaining = deadline - Date.now()
    if (remaining <= 0) return
    await new Promise(r => setTimeout(r, Math.min(msUntilWindowReset(), remaining)))
  }
}
