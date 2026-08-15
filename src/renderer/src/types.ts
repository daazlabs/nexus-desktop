export interface Project {
  id: number
  name: string
  system_prompt: string
  working_dir?: string
  created_at: number
}

export interface Agent {
  agent_id: string
  display_name: string
  requires_api_key: boolean
  is_enabled: boolean
  available_models: string[]
  model_classes: Record<string, ModelClass> | null
}

export interface ModelClass {
  label: string
  models: string[]
  default: string
  description: string
}

export interface Message {
  id: number
  role: "user" | "assistant" | "system"
  content: string
  agent_id?: string
  model?: string
  tokens_used?: number
  duration?: number
  multiGroupId?: string
  isLoading?: boolean
  attachments?: { url: string; name: string; type: string }[]
  // Set on the synthetic user turn auto-sent by "Avaliar com…" (cross-model
  // evaluation) — lets MessageBubble render it as a system-triggered request
  // instead of something the user typed themselves.
  isEvalPrompt?: boolean
}

export interface ChatResponse {
  user_message: Message
  agent_message: Message
}

export type ModelClassKey = "auto" | "cerebro" | "trabalhador" | "local"

export const MODEL_CLASS_INFO: Record<ModelClassKey, { label: string; color: string; icon: string; description: string }> = {
  auto: { label: "Auto", color: "#f472b6", icon: "🤖", description: "Smart routing — free → paid → local" },
  cerebro: { label: "Brain", color: "#a78bfa", icon: "🧠", description: "Paid models for critical tasks" },
  trabalhador: { label: "Worker", color: "#34d399", icon: "⚡", description: "Free models for volume" },
  local: { label: "Local", color: "#fbbf24", icon: "🔒", description: "Local models — private data" },
}

export interface UsageEntry {
  model: string
  tokens: number
  requests: number
  errors: number
}

export interface TimelineEntry {
  day: string
  tokens: number
  requests: number
}

export interface ErrorEntry {
  provider: string
  error: string
  count: number
}

export interface CategorizedModel {
  id: string
  context: number
  vision: boolean
  tools: boolean
  free: boolean
  paid: boolean
}

export interface CategorizedProvider {
  id: string
  name: string
  base_url: string
  api_type: string
  requires_key: boolean
  register_url: string
  models: CategorizedModel[]
}

export interface MultiAgentResult {
  agent_id: string
  message: Message | null
  error: string | null
}

export interface MultiChatResponse {
  user_message: Message
  results: MultiAgentResult[]
}

export interface ToolInfo {
  name: string
  description: string
  parameters: Record<string, unknown>
  dangerous: boolean
}

export interface PermissionRequest {
  id: string
  action: string
  detail: string
  dangerous?: boolean
  convId?: number
  convTitle?: string
}

export type ToolEventStatus = "pending" | "running" | "completed" | "failed"

export interface ToolEvent {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: ToolEventStatus
  result?: string
  error?: string
  started_at: number
  completed_at?: number
}

export const AGENT_COLORS: Record<string, string> = {
  nexus: "#f472b6",
  llamacpp: "#34d399",
  sovereign: "#a78bfa",
  claude: "#d97706",
  gemini: "#4285f4",
  deepseek_api: "#06b6d4",
  chatgpt_api: "#10b981",
  openrouter: "#8b5cf6",
  groq: "#f97316",
}
