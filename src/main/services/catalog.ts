export interface ModelInfo {
  id: string
  context: number
  vision: boolean
  tools: boolean
  free: boolean
  paid: boolean
  intelligenceScore: number
  speedScore: number
}

export interface ProviderInfo {
  id: string
  name: string
  baseUrl: string
  requiresKey: boolean
  apiType: string
  registerUrl: string
  models: ModelInfo[]
}

function model(
  id: string, ctx: number, opts?: Partial<ModelInfo>,
): ModelInfo {
  return {
    id, context: ctx, vision: false, tools: false,
    free: false, paid: false, intelligenceScore: 5, speedScore: 5,
    ...opts,
  }
}

function provider(
  id: string, name: string, baseUrl: string, apiType: string,
  registerUrl: string, models: ModelInfo[], requiresKey = true,
): ProviderInfo {
  return { id, name, baseUrl, apiType, registerUrl, models, requiresKey }
}

const GROQ = provider('groq', 'Groq', 'https://api.groq.com/openai/v1', 'openai',
  'https://console.groq.com/keys', [
    model('llama-3.3-70b-versatile', 131072, { tools: true, free: true, intelligenceScore: 2, speedScore: 6 }),
    model('meta-llama/llama-4-scout-17b-16e-instruct', 131072, { tools: true, free: true, intelligenceScore: 2, speedScore: 7 }),
    model('llama-3.1-8b-instant', 131072, { tools: true, free: true, intelligenceScore: 1, speedScore: 10 }),
    model('qwen/qwen3-32b', 131072, { tools: true, free: true, intelligenceScore: 8, speedScore: 5 }),
    model('groq/compound', 131072, { tools: true, free: true, intelligenceScore: 9, speedScore: 8 }),
    model('groq/compound-mini', 131072, { tools: true, free: true, intelligenceScore: 7, speedScore: 9 }),
  ],
)

const OPENROUTER = provider('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', 'openai',
  'https://openrouter.ai/keys', [
    model('qwen/qwen3-coder:free', 262144, { tools: true, free: true, intelligenceScore: 8, speedScore: 5 }),
    model('deepseek/deepseek-v3.1:free', 131072, { tools: true, free: true, intelligenceScore: 9, speedScore: 4 }),
    model('moonshotai/kimi-k2:free', 131072, { tools: true, free: true, intelligenceScore: 8, speedScore: 5 }),
    model('meta-llama/llama-3.3-70b-instruct:free', 131072, { tools: true, free: true, intelligenceScore: 7, speedScore: 5 }),
    model('nvidia/nemotron-nano-12b-v2-vl:free', 128000, { tools: true, free: true, intelligenceScore: 6, speedScore: 7 }),
    model('google/gemini-2.0-flash-exp:free', 1048576, { vision: true, tools: true, free: true, intelligenceScore: 8, speedScore: 7 }),
    model('nousresearch/hermes-3-llama-3.1-405b:free', 131072, { tools: true, free: true, intelligenceScore: 8, speedScore: 3 }),
    model('cognitivecomputations/dolphin-mistral-24b-venice-edition:free', 32768, { tools: true, free: true, intelligenceScore: 6, speedScore: 6 }),
    model('poolside/laguna-m.1:free', 262144, { tools: true, free: true, intelligenceScore: 7, speedScore: 5 }),
    model('poolside/laguna-xs.2:free', 262144, { tools: true, free: true, intelligenceScore: 6, speedScore: 7 }),
  ],
)

const GEMINI = provider('gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta', 'google',
  'https://aistudio.google.com/app/apikey', [
    model('gemini-2.5-flash', 1048576, { vision: true, tools: true, free: true, intelligenceScore: 8, speedScore: 7 }),
    model('gemini-2.5-flash-lite', 1048576, { vision: true, tools: true, free: true, intelligenceScore: 6, speedScore: 9 }),
    model('gemini-2.0-flash', 1048576, { vision: true, tools: true, free: true, intelligenceScore: 7, speedScore: 8 }),
    model('gemini-1.5-flash', 1048576, { vision: true, tools: true, free: true, intelligenceScore: 6, speedScore: 9 }),
    model('gemma-4-31b-it', 32768, { tools: true, free: true, intelligenceScore: 7, speedScore: 6 }),
    model('gemma-4-26b-a4b-it', 32768, { tools: true, free: true, intelligenceScore: 6, speedScore: 7 }),
  ],
)

const GITHUB = provider('github', 'GitHub Models', 'https://models.github.ai/inference', 'openai',
  'https://github.com/marketplace/models', [
    model('gpt-4o-mini', 128000, { tools: true, free: true, intelligenceScore: 7, speedScore: 8 }),
    model('gpt-4o', 128000, { vision: true, tools: true, free: true, intelligenceScore: 9, speedScore: 6 }),
  ],
)

const CEREBRAS = provider('cerebras', 'Cerebras', 'https://api.cerebras.ai/v1', 'openai',
  'https://cloud.cerebras.ai/', [
    // tools DELIBERATELY false, not a mistake — observed live 9 Ago 2026
    // fabricating entire tool calls + fake success narratives as plain text
    // (a bash "git push --force-with-lease" and a "GitHub API" table, both
    // invented, no permission popup, nothing actually executed). gpt-oss
    // models use their own "Harmony" tool-call format; if Cerebras isn't
    // translating that into real OpenAI tool_calls deltas for this model,
    // it just writes the call intent as content and then hallucinates a
    // plausible-sounding result for it — this is a false SUCCESS claim, not
    // a refusal, so it's more dangerous than most tool-calling failures.
    // Re-enable only after confirming live that a real tool_calls delta
    // comes back from this provider for this model.
    model('gpt-oss-120b', 131072, { tools: false, free: true, intelligenceScore: 7, speedScore: 8 }),
    model('zai-glm-4.7', 131072, { tools: true, free: true, intelligenceScore: 8, speedScore: 7 }),
  ],
)

const NVIDIA = provider('nvidia', 'NVIDIA NIM', 'https://integrate.api.nvidia.com/v1', 'openai',
  'https://build.nvidia.com/', [
    model('meta/llama-3.3-70b-instruct', 131072, { tools: true, free: true, intelligenceScore: 7, speedScore: 6 }),
    model('deepseek-ai/deepseek-v4-flash', 131072, { tools: true, free: true, intelligenceScore: 9, speedScore: 6 }),
    model('nvidia/nemotron-3-nano-30b-a3b', 131072, { tools: true, free: true, intelligenceScore: 6, speedScore: 7 }),
    model('nvidia/nemotron-3-super-120b-a12b', 131072, { tools: true, free: true, intelligenceScore: 8, speedScore: 5 }),
    model('mistralai/mistral-large-3-675b-instruct-2512', 131072, { tools: true, free: true, intelligenceScore: 9, speedScore: 3 }),
    model('qwen/qwen3-coder-480b-a35b-instruct', 262144, { tools: true, free: true, intelligenceScore: 9, speedScore: 4 }),
  ],
)

const CLOUDFLARE = provider('cloudflare', 'Cloudflare Workers AI',
  'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1', 'openai',
  'https://dash.cloudflare.com/sign-up', [
    model('@cf/meta/llama-3.3-70b-instruct-fp8-fast', 131072, { tools: true, free: true, intelligenceScore: 7, speedScore: 6 }),
    model('@cf/meta/llama-4-scout-17b-16e-instruct', 131072, { tools: true, free: true, intelligenceScore: 7, speedScore: 7 }),
    model('@cf/nvidia/nemotron-3-120b-a12b', 262144, { tools: true, free: true, intelligenceScore: 8, speedScore: 5 }),
    model('@cf/google/gemma-4-26b-a4b-it', 262144, { tools: true, free: true, intelligenceScore: 6, speedScore: 7 }),
    model('@cf/qwen/qwen3-30b-a3b-fp8', 32768, { tools: true, free: true, intelligenceScore: 8, speedScore: 6 }),
    model('@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', 32768, { tools: true, free: true, intelligenceScore: 8, speedScore: 5 }),
  ],
)

const ZHIPU = provider('zhipu', 'Zhipu AI (Z.ai)', 'https://open.bigmodel.cn/api/paas/v4', 'openai',
  'https://open.bigmodel.cn/', [
    model('glm-4.5-flash', 131072, { tools: true, free: true, intelligenceScore: 6, speedScore: 7 }),
    model('glm-4.7-flash', 131072, { tools: true, free: true, intelligenceScore: 6, speedScore: 7 }),
    model('glm-4.6v-flash', 131072, { vision: true, tools: true, free: true, intelligenceScore: 6, speedScore: 7 }),
  ],
)

const MISTRAL = provider('mistral', 'Mistral AI', 'https://api.mistral.ai/v1', 'openai',
  'https://console.mistral.ai/api-keys/', [
    model('mistral-large-latest', 262144, { tools: true, paid: true, intelligenceScore: 8, speedScore: 5 }),
    model('mistral-small-latest', 262144, { tools: true, free: true, intelligenceScore: 6, speedScore: 8 }),
    model('mistral-medium-latest', 131072, { tools: true, free: true, intelligenceScore: 7, speedScore: 6 }),
    model('codestral-latest', 256000, { tools: true, paid: true, intelligenceScore: 8, speedScore: 5 }),
    model('ministral-8b-latest', 262144, { tools: true, paid: true, intelligenceScore: 5, speedScore: 9 }),
  ],
)

const COHERE = provider('cohere', 'Cohere', 'https://api.cohere.ai/compatibility/v1', 'openai',
  'https://dashboard.cohere.com/api-keys', [
    model('command-r-plus-08-2024', 131072, { tools: true, paid: true, intelligenceScore: 7, speedScore: 5 }),
    model('command-a-03-2025', 256000, { tools: true, paid: true, intelligenceScore: 8, speedScore: 5 }),
    model('command-r-08-2024', 131072, { tools: true, paid: true, intelligenceScore: 6, speedScore: 6 }),
  ],
)

const KILO = provider('kilo', 'Kilo Gateway', 'https://api.kilo.ai/api/gateway/v1', 'openai',
  'https://kilo.ai/', [
    model('poolside/laguna-m.1:free', 262144, { tools: true, free: true, intelligenceScore: 7, speedScore: 5 }),
    model('poolside/laguna-xs.2:free', 262144, { tools: true, free: true, intelligenceScore: 6, speedScore: 7 }),
    model('nvidia/nemotron-3-super-120b-a12b:free', 1000000, { tools: true, free: true, intelligenceScore: 8, speedScore: 5 }),
    model('stepfun/step-3.7-flash:free', 262144, { tools: true, free: true, intelligenceScore: 7, speedScore: 8 }),
  ],
)

const POLLINATIONS = provider('pollinations', 'Pollinations AI', 'https://text.pollinations.ai/openai/v1', 'openai',
  'https://enter.pollinations.ai/', [
    model('openai-fast', 32768, { tools: true, free: true, intelligenceScore: 5, speedScore: 9 }),
    model('deepseek-r1', 65536, { free: true, intelligenceScore: 8, speedScore: 3 }),
    model('kimi', 131072, { tools: true, free: true, intelligenceScore: 7, speedScore: 6 }),
    model('qwen-coder-32b', 32768, { tools: true, free: true, intelligenceScore: 7, speedScore: 6 }),
    model('mistral', 32768, { tools: true, free: true, intelligenceScore: 6, speedScore: 7 }),
  ],
)

const OVH = provider('ovh', 'OVHcloud AI Endpoints',
  'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', 'openai',
  'https://endpoints.ai.cloud.ovh.net/', [
    model('Meta-Llama-3_3-70B-Instruct', 131072, { tools: true, paid: true, intelligenceScore: 7, speedScore: 5 }),
    model('Qwen3.5-9B', 262144, { tools: true, paid: true, intelligenceScore: 6, speedScore: 7 }),
    model('Qwen3-Coder-30B-A3B-Instruct', 262144, { tools: true, paid: true, intelligenceScore: 7, speedScore: 6 }),
    model('Mistral-Nemo-Instruct-2407', 65536, { tools: true, paid: true, intelligenceScore: 6, speedScore: 6 }),
    model('Qwen3-32B', 32768, { tools: true, paid: true, intelligenceScore: 8, speedScore: 5 }),
    model('Qwen3Guard-Gen-8B', 32768, { tools: true, free: true, intelligenceScore: 4, speedScore: 8 }),
  ],
)

const OPENCODE_ZEN = provider('opencodezen', 'OpenCode Zen', 'https://opencode.ai/zen/v1', 'openai',
  'https://opencode.ai/auth', [
    model('deepseek-v4-flash-free', 131072, { tools: true, free: true, intelligenceScore: 9, speedScore: 6 }),
    model('mimo-v2.5-free', 131072, { tools: true, free: true, intelligenceScore: 7, speedScore: 7 }),
    model('qwen3.6-plus-free', 131072, { tools: true, free: true, intelligenceScore: 8, speedScore: 6 }),
    model('nemotron-3-ultra-free', 131072, { tools: true, free: true, intelligenceScore: 8, speedScore: 5 }),
    model('minimax-m3-free', 131072, { tools: true, free: true, intelligenceScore: 7, speedScore: 6 }),
    model('north-mini-code-free', 131072, { tools: true, free: true, intelligenceScore: 6, speedScore: 8 }),
    model('deepseek-v4-flash', 131072, { tools: true, paid: true, intelligenceScore: 9, speedScore: 6 }),
    model('deepseek-v4-pro', 131072, { tools: true, paid: true, intelligenceScore: 10, speedScore: 4 }),
    model('claude-sonnet-4-6', 200000, { tools: true, paid: true, intelligenceScore: 10, speedScore: 5 }),
    model('claude-haiku-4-5', 200000, { tools: true, paid: true, intelligenceScore: 8, speedScore: 7 }),
    model('gemini-3.5-flash', 1048576, { tools: true, paid: true, intelligenceScore: 9, speedScore: 7 }),
    model('gpt-5.4-mini', 131072, { tools: true, paid: true, intelligenceScore: 9, speedScore: 8 }),
    model('kimi-k2.5', 131072, { tools: true, paid: true, intelligenceScore: 8, speedScore: 5 }),
  ],
)

const DEEPSEEK = provider('deepseek', 'DeepSeek', 'https://api.deepseek.com', 'openai',
  'https://platform.deepseek.com/api_keys', [
    model('deepseek-chat', 131072, { tools: true, paid: true, intelligenceScore: 9, speedScore: 6 }),
    model('deepseek-reasoner', 131072, { paid: true, intelligenceScore: 10, speedScore: 3 }),
  ],
)

const ANTHROPIC = provider('anthropic', 'Anthropic', 'https://api.anthropic.com/v1', 'openai',
  'https://console.anthropic.com/', [
    model('claude-sonnet-4-20250514', 200000, { tools: true, paid: true, intelligenceScore: 9, speedScore: 5 }),
  ],
)

const OPENAI = provider('openai', 'OpenAI', 'https://api.openai.com/v1', 'openai',
  'https://platform.openai.com/api-keys', [
    model('gpt-4o', 128000, { vision: true, tools: true, paid: true, intelligenceScore: 9, speedScore: 6 }),
    model('gpt-4o-mini', 128000, { tools: true, paid: true, intelligenceScore: 7, speedScore: 8 }),
  ],
)

const XAI = provider('xai', 'xAI (Grok)', 'https://api.x.ai/v1', 'openai',
  'https://console.x.ai/', [
    model('grok-3', 131072, { tools: true, paid: true, intelligenceScore: 8, speedScore: 6 }),
    model('grok-3-mini', 131072, { tools: true, paid: true, intelligenceScore: 7, speedScore: 7 }),
  ],
)

const PERPLEXITY = provider('perplexity', 'Perplexity', 'https://api.perplexity.ai', 'openai',
  'https://www.perplexity.ai/settings/api', [
    model('sonar-pro', 200000, { tools: true, paid: true, intelligenceScore: 8, speedScore: 5 }),
    model('sonar', 127000, { paid: true, intelligenceScore: 7, speedScore: 6 }),
  ],
)

const TOGETHER = provider('together', 'Together AI', 'https://api.together.xyz/v1', 'openai',
  'https://api.together.ai/settings/api-keys', [
    model('meta-llama/Llama-3.3-70B-Instruct-Turbo', 131072, { tools: true, paid: true, intelligenceScore: 7, speedScore: 5 }),
    model('mistralai/Mixtral-8x22B-Instruct-v0.1', 65536, { tools: true, paid: true, intelligenceScore: 7, speedScore: 4 }),
  ],
)

const REPLICATE = provider('replicate', 'Replicate', 'https://api.replicate.com/v1', 'openai',
  'https://replicate.com/account/api-tokens', [
    model('meta/meta-llama-3.3-70b-instruct', 131072, { tools: true, paid: true, intelligenceScore: 7, speedScore: 5 }),
  ],
)

const HUGGINGFACE = provider('huggingface', 'HuggingFace', 'https://router.huggingface.co/v1', 'openai',
  'https://huggingface.co/settings/tokens', [
    model('deepseek-ai/DeepSeek-V4-Flash', 131072, { tools: true, paid: true, intelligenceScore: 9, speedScore: 6 }),
    model('moonshotai/Kimi-K2.6', 262144, { tools: true, paid: true, intelligenceScore: 8, speedScore: 5 }),
    model('Qwen/Qwen3-Coder-Next', 262144, { tools: true, paid: true, intelligenceScore: 9, speedScore: 5 }),
    model('Qwen/Qwen2.5-72B-Instruct', 131072, { tools: true, paid: true, intelligenceScore: 8, speedScore: 4 }),
  ],
)

const LLAMACPP = provider('llamacpp', 'llama.cpp (local)', 'http://localhost:8090/v1', 'openai',
  'https://github.com/ggml-org/llama.cpp', [
    model('Qwen3.6-35B-A3B-UD-Q4_K_M.gguf', 32768, { intelligenceScore: 8, speedScore: 4 }),
  ], false,
)

const OLLAMA = provider('ollama', 'Ollama (local)', 'http://localhost:11434/v1', 'openai',
  'https://ollama.com/download', [
    model('qwen3.5:9b', 131072, { tools: true, intelligenceScore: 6, speedScore: 6 }),
  ], false,
)

// Bundled (compile-time) catalog. Used as the initial effective catalog and
// as the fallback when the remote catalog is unavailable.
export const PROVIDERS: ProviderInfo[] = [
  GROQ, OPENROUTER, GEMINI, GITHUB, CEREBRAS, NVIDIA, CLOUDFLARE, ZHIPU,
  KILO, POLLINATIONS, OVH, OPENCODE_ZEN,
  DEEPSEEK, MISTRAL, ANTHROPIC, OPENAI, XAI, PERPLEXITY, COHERE, TOGETHER, REPLICATE, HUGGINGFACE,
  LLAMACPP, OLLAMA,
]

// Effective catalog: starts as the bundled list, may be replaced at runtime
// by remoteCatalog.ts once the server catalog is fetched (or restored from
// its on-disk cache). All lookups below consult this list, so routing, IPC
// and the renderer all see the same effective catalog.
let effectiveProviders: ProviderInfo[] = PROVIDERS

export function setEffectiveProviders(providers: ProviderInfo[]): void {
  if (Array.isArray(providers) && providers.length > 0) {
    effectiveProviders = providers
  }
}

export function listProviders(): ProviderInfo[] {
  return effectiveProviders
}

export function listAvailable(): ModelInfo[] {
  return effectiveProviders.flatMap(p => p.models)
}

export function getProvider(modelId: string): ProviderInfo | undefined {
  return effectiveProviders.find(p => p.models.some(m => m.id === modelId))
}

export function getProviderById(providerId: string): ProviderInfo | undefined {
  return effectiveProviders.find(p => p.id === providerId)
}

export function getModelsByClass(modelClass: string): string[] {
  if (modelClass === 'cerebro') {
    return effectiveProviders.flatMap(p => p.models).filter(m => m.paid).map(m => m.id)
  }
  if (modelClass === 'trabalhador') {
    return effectiveProviders.flatMap(p => p.models).filter(m => m.free).map(m => m.id)
  }
  if (modelClass === 'local') {
    return effectiveProviders.flatMap(p => p.models).filter(m => !m.free && !m.paid).map(m => m.id)
  }
  return []
}

export function getModelsByProvider(providerId: string): string[] {
  const p = effectiveProviders.find(pr => pr.id === providerId)
  return p ? p.models.map(m => m.id) : []
}
