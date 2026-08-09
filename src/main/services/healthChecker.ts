import { listProviders } from './catalog.js'
import { resolveKey } from './keyVault.js'

const CHECK_INTERVAL = 1800_000
const MAX_FAILURES = 3

const failureCount = new Map<string, number>()

let disabledProviders = new Set<string>()

// Providers whose /models probe needs different auth than a bare
// `Authorization: Bearer` — found live 9 Ago 2026 auditing the paid
// ("cerebro") tier: Anthropic's native /v1/models wants `x-api-key` +
// `anthropic-version`, not Bearer (Bearer is only documented for their
// OpenAI-compat /v1/chat/completions, not /models). Without this a
// perfectly valid Anthropic key 401s here every 30 min and gets the
// provider disabled after 3 failures — the user sees "unhealthy" on a key
// that actually works fine for real chat requests.
function healthCheckRequest(baseUrl: string, apiKey: string, apiType: string, providerId: string): { url: string; headers: Record<string, string> } {
  const base = baseUrl.replace(/\/+$/, '')
  if (apiType === 'google') {
    // Gemini authenticates via a `?key=` query param, not a header —
    // sending Authorization here would 401 on a perfectly healthy provider.
    return { url: `${base}/models?key=${apiKey}`, headers: {} }
  }
  if (providerId === 'anthropic') {
    return { url: `${base}/models`, headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } }
  }
  return { url: `${base}/models`, headers: { Authorization: `Bearer ${apiKey}` } }
}

async function checkHealthLightweight(baseUrl: string, apiKey: string, apiType: string, providerId: string): Promise<boolean> {
  const { url, headers } = healthCheckRequest(baseUrl, apiKey, apiType, providerId)
  try {
    const resp = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(5000),
    })
    return resp.status === 200
  } catch {
    return false
  }
}

function disableProvider(providerId: string): void {
  disabledProviders.add(providerId)
}

export async function runHealthCheck(): Promise<void> {
  for (const provider of listProviders()) {
    if (!provider.requiresKey) continue
    const apiKey = resolveKey(provider.id)
    if (!apiKey) continue

    const ok = await checkHealthLightweight(provider.baseUrl, apiKey, provider.apiType, provider.id)
    if (ok) {
      failureCount.set(provider.id, 0)
      disabledProviders.delete(provider.id)
    } else {
      const count = (failureCount.get(provider.id) || 0) + 1
      failureCount.set(provider.id, count)
      if (count >= MAX_FAILURES) {
        disableProvider(provider.id)
      }
    }
  }
}

export function startHealthChecker(): void {
  setInterval(runHealthCheck, CHECK_INTERVAL)
  runHealthCheck()
}

export function getHealthStatus(): Record<string, { healthy: boolean; failures: number; models: string[] }> {
  const result: Record<string, any> = {}
  for (const provider of listProviders()) {
    result[provider.id] = {
      healthy: !disabledProviders.has(provider.id),
      failures: failureCount.get(provider.id) || 0,
      models: provider.models.map(m => m.id),
    }
  }
  return result
}

export function isProviderDisabled(providerId: string): boolean {
  return disabledProviders.has(providerId)
}
