import { useState, useCallback, useRef, useLayoutEffect, memo } from "react"
import type { Message, ToolEvent } from "../../types"
import type { Lang } from "../../i18n"
import { t } from "../../i18n"
import Markdown from "../ui/markdown"
import { Pencil } from "lucide-react"

interface Props {
  lang: Lang
  msg: Message
  streamingContent: string
  loading: boolean
  toolEvents: ToolEvent[]
  isStreaming: boolean
  showToolEvents: boolean
  onEdit?: (msgId: number, newContent: string) => void
  onRegenerate?: (msgId: number) => void
}

// Friendly copy for mcp__browser__* tool events — everything else keeps the
// raw tool name, this is just polish for a capability the user actually
// watches happen live (a real Chromium window), not a general-purpose
// pretty-printer for every tool.
// Field names below were checked against the actual @playwright/mcp tool
// schemas (packages/playwright-core/src/tools/backend/*.ts in the installed
// version), not guessed — e.g. browser_tabs is one unified tool with an
// `action` enum (list/new/close/select), not separate per-action tools.
const BROWSER_LABELS: Record<string, (args: Record<string, unknown>, lang: Lang) => string> = {
  browser_navigate: (a, lang) => (lang === "en" ? `navigating to ${a.url ?? "…"}` : `a navegar para ${a.url ?? "…"}`),
  browser_click: (a, lang) => (lang === "en" ? `clicking "${a.element ?? "…"}"` : `a clicar em "${a.element ?? "…"}"`),
  browser_type: (a, lang) => (lang === "en" ? `typing "${a.text ?? "…"}"` : `a escrever "${a.text ?? "…"}"`),
  browser_snapshot: (_a, lang) => (lang === "en" ? "reading the page" : "a ler a página"),
  browser_take_screenshot: (_a, lang) => (lang === "en" ? "taking a screenshot" : "a tirar uma captura de ecrã"),
  browser_select_option: (a, lang) => {
    const values = Array.isArray(a.values) ? a.values.join(", ") : "…"
    return lang === "en" ? `selecting "${values}"` : `a selecionar "${values}"`
  },
  browser_press_key: (a, lang) => (lang === "en" ? `pressing "${a.key ?? "…"}"` : `a premir "${a.key ?? "…"}"`),
  browser_wait_for: (_a, lang) => (lang === "en" ? "waiting" : "a aguardar"),
  browser_tabs: (a, lang) => {
    const action = String(a.action ?? "")
    const labels: Record<string, [string, string]> = {
      new: ["opening a new tab", "a abrir um novo separador"],
      close: ["closing tab", "a fechar separador"],
      select: ["switching tab", "a mudar de separador"],
      list: ["listing tabs", "a listar separadores"],
    }
    const [en, pt] = labels[action] ?? ["managing tabs", "a gerir separadores"]
    return lang === "en" ? en : pt
  },
  browser_file_upload: (_a, lang) => (lang === "en" ? "uploading file" : "a carregar ficheiro"),
  browser_hover: (a, lang) => (lang === "en" ? `hovering "${a.element ?? "…"}"` : `a passar o rato em "${a.element ?? "…"}"`),
  browser_close: (_a, lang) => (lang === "en" ? "closing browser" : "a fechar o browser"),
}

// Persistent "is it still alive?" line — separate from the tool-call list
// below and from the message content itself, a status channel that never
// gets baked into the answer text. Main process sends this through the
// same __TOOL_EVENT__ channel as real tool calls, with the reserved id
// "status" and name "__status__" — see ipc/tools.ts and
// services/fallbackChain.ts.
function describeStatusEvent(ev: ToolEvent, lang: Lang): string | null {
  const kind = (ev.arguments as Record<string, unknown> | undefined)?.kind
  if (kind === "retrying") {
    const model = String((ev.arguments as any)?.model ?? "")
    const reason = String((ev.arguments as any)?.reason ?? "")
    return lang === "en"
      ? `${model} failed (${reason}) — switching to another model…`
      : `${model} falhou (${reason}) — a mudar de modelo…`
  }
  if (kind === "busy") {
    return lang === "en" ? "working…" : "a trabalhar…"
  }
  return null // "idle" (or unknown) — nothing to show
}

function describeToolEvent(tc: ToolEvent, lang: Lang): string {
  if (tc.name.startsWith("mcp__browser__")) {
    const base = tc.name.slice("mcp__browser__".length)
    const fn = BROWSER_LABELS[base]
    if (fn) return fn(tc.arguments ?? {}, lang)
  }
  if (tc.name === "delegar_tarefa") {
    const tarefa = String(tc.arguments?.tarefa ?? "")
    const truncated = tarefa.length > 60 ? tarefa.slice(0, 60) + "…" : tarefa
    return lang === "en"
      ? `delegating "${truncated}" to a cheaper model`
      : `a delegar "${truncated}" a um modelo mais barato`
  }
  return tc.name
}

function extractStream(content: string): { thinking: string; thinkingDone: boolean; visible: string } {
  const thinkParts: string[] = []
  let rest = content.replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner) => {
    thinkParts.push(inner.trim())
    return ""
  })
  const openIdx = rest.indexOf("<think>")
  let currentThink = ""
  let thinkingDone = true
  if (openIdx !== -1) {
    currentThink = rest.slice(openIdx + 7)
    rest = rest.slice(0, openIdx)
    thinkingDone = false
  }
  const thinking = [...thinkParts, currentThink].filter(Boolean).join("\n\n")
  return { thinking, thinkingDone, visible: rest.trim() }
}

function ThinkBlock({ content, done, lang }: { content: string; done: boolean; lang: Lang }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-2 text-xs rounded-xl border border-border/40 bg-muted/20 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className={done ? "" : "animate-pulse"}>💭</span>
        <span>{done ? t(lang, "reasoning") : t(lang, "thinking")}</span>
        <span className="ml-auto opacity-50">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-3 pb-2 pt-1 border-t border-border/30 text-muted-foreground/70 whitespace-pre-wrap leading-relaxed font-mono text-[11px] max-h-52 overflow-y-auto">
          {content}
        </div>
      )}
    </div>
  )
}

function MessageBubble({ lang, msg, streamingContent, toolEvents, isStreaming, showToolEvents, onEdit, onRegenerate }: Props) {
  const isUser = msg.role === "user"
  const isSystem = msg.role === "system"
  const isAssistant = msg.role === "assistant"
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(msg.content)
  const editTextareaRef = useRef<HTMLTextAreaElement>(null)

  // rows={editValue.split("\n").length} used to size this by explicit
  // newlines only — a long message with no manual line breaks (the normal
  // case) still wraps to several visual lines in the bubble, but counted as
  // "1 line" here, so the edit box opened tiny instead of matching the
  // bubble it replaced. Auto-grow to the textarea's own scrollHeight instead
  // — that reflects wrapped lines too, not just \n. useLayoutEffect (not
  // useEffect) so it's sized before paint: no visible tiny-then-big flash.
  const resizeEditTextarea = useCallback(() => {
    const el = editTextareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useLayoutEffect(() => {
    if (editing) resizeEditTextarea()
  }, [editing, resizeEditTextarea])

  const copy = useCallback(() => {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [msg.content])

  const submitEdit = () => {
    const trimmed = editValue.trim()
    setEditing(false)
    // Deliberately no "only if the text changed" check: pressing Enviar
    // without touching anything is a resend, and silently doing nothing was
    // indistinguishable from the button being broken.
    if (trimmed && onEdit) onEdit(msg.id, trimmed)
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} group/bubble`}>
      <div className={`${editing ? "w-full" : "max-w-[85%]"} ${
        isUser ? "bg-primary text-primary-foreground rounded-3xl px-4 py-3" :
        isSystem ? "bg-destructive/10 text-destructive border border-destructive/30 rounded-3xl px-4 py-3" :
        "bg-card text-card-foreground rounded-3xl px-4 py-3 border border-border/50"
      }`}>
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {msg.attachments.filter(a => a.type === "image").map((a, i) => (
              <img key={i} src={a.url} alt={a.name}
                className="max-h-40 max-w-[200px] rounded-xl object-cover border border-white/20" />
            ))}
          </div>
        )}

        {isStreaming ? (
          <>
            {(() => {
              // "status" is a reserved pseudo tool-event (id "status", name
              // "__status__") — never part of the real tool-call list below,
              // shown on its own line regardless of showToolEvents: whether
              // the request is still alive isn't a "tool detail" preference,
              // it's the thing this whole indicator exists for.
              const statusEv = toolEvents.find(tc => tc.name === "__status__")
              const label = statusEv ? describeStatusEvent(statusEv, lang) : null
              if (!label) return null
              return (
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                  <span className="animate-pulse">●</span>
                  <span>{label}</span>
                </div>
              )
            })()}
            {(() => {
              const realToolEvents = toolEvents.filter(tc => tc.name !== "__status__")
              if (!showToolEvents || realToolEvents.length === 0) return null
              return (
                <div className="space-y-1 mb-2 pb-2 border-b border-border/50">
                  {realToolEvents.map((tc) => (
                    <div key={tc.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className={tc.status === "running" ? "animate-pulse" : ""}>
                        {tc.status === "running" ? "●" : tc.status === "completed" ? "✓" : "✗"}
                      </span>
                      <code>{describeToolEvent(tc, lang)}</code>
                    </div>
                  ))}
                </div>
              )
            })()}
            {(() => {
              const { thinking, thinkingDone, visible } = extractStream(streamingContent)
              return (
                <>
                  {thinking && <ThinkBlock content={thinking} done={thinkingDone} lang={lang} />}
                  {!visible && !thinking && (
                    <p><span className="thinking-text">{t(lang, "thinkingLabel")}</span><span className="animate-pulse">▊</span></p>
                  )}
                  {visible && (
                    <>
                      <Markdown content={visible} />
                      <span className="animate-pulse text-muted-foreground">▊</span>
                    </>
                  )}
                </>
              )
            })()}
          </>
        ) : editing ? (
          <div className="flex flex-col gap-2">
            <textarea
              ref={editTextareaRef}
              value={editValue}
              onChange={e => {
                setEditValue(e.target.value)
                resizeEditTextarea()
              }}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit() }
                if (e.key === "Escape") setEditing(false)
              }}
              className="bg-primary/20 text-primary-foreground rounded-xl px-3 py-2 text-sm resize-none outline-none border border-white/20 min-h-[60px] w-full overflow-hidden"
              rows={1}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditing(false)}
                className="text-xs text-white/60 hover:text-white transition-colors px-2 py-1">
                {lang === "pt" ? "Cancelar" : "Cancel"}
              </button>
              <button onClick={submitEdit}
                className="text-xs bg-white/20 hover:bg-white/30 text-white rounded-full px-3 py-1 transition-colors">
                {lang === "pt" ? "Enviar" : "Send"}
              </button>
            </div>
          </div>
        ) : (
          // Links render with text-primary (purple) — invisible on a user
          // bubble, whose own background IS bg-primary (purple on purple).
          // Force them to the bubble's own foreground color there instead;
          // assistant/system bubbles have a light/tinted background where
          // text-primary already reads fine, so leave those alone.
          <Markdown content={msg.content} className={isUser ? "[&_a]:!text-primary-foreground" : undefined} />
        )}

        {!isStreaming && !editing && (
          <div className="text-xs text-muted-foreground/60 mt-1.5 flex items-center gap-2 flex-wrap">
            {isAssistant && msg.model && <span>{msg.model}</span>}
            {isAssistant && msg.tokens_used != null && <span>{msg.tokens_used} tok</span>}
            {isAssistant && msg.duration != null && <span>{msg.duration}s</span>}
            <div className="ml-auto flex items-center gap-1">
              {/* Always visible, not hidden behind hover like the buttons
                  below — a faint icon that only appeared on hover was the
                  original complaint (looked broken/invisible at rest). */}
              {isUser && onEdit && msg.id > 0 && (
                <button onClick={() => {
                  setEditValue(msg.content)
                  setEditing(true)
                }}
                  className="flex items-center justify-center w-6 h-6 rounded-full bg-accent/70 text-foreground/70 hover:text-foreground hover:bg-accent transition-colors"
                  title={lang === "pt" ? "Editar" : "Edit"}>
                  <Pencil size={13} />
                </button>
              )}
              <div className="flex items-center gap-1 opacity-0 group-hover/bubble:opacity-100 transition-opacity">
                {isAssistant && onRegenerate && msg.id > 0 && (
                  <button onClick={() => onRegenerate(msg.id)}
                    className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground px-1.5 py-0.5 rounded hover:bg-accent transition-colors"
                    title={lang === "pt" ? "Regenerar" : "Regenerate"}>
                    ↻
                  </button>
                )}
                {isAssistant && msg.id > 0 && (
                  <button onClick={copy}
                    className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground px-1.5 py-0.5 rounded hover:bg-accent transition-colors">
                    {copied ? t(lang, "copied") : t(lang, "copy")}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Historical (non-streaming) bubbles don't depend on streamingContent/toolEvents/loading,
// so skip re-rendering them when the parent re-renders for unrelated reasons (e.g. every
// keystroke in the input box, which otherwise forces a full markdown re-parse of the whole
// conversation and shows up as visible jank while typing). The actively streaming bubble
// still re-renders on every update, same as before.
function messageBubblePropsEqual(prev: Readonly<Props>, next: Readonly<Props>): boolean {
  if (next.isStreaming) return false
  return prev.msg === next.msg && prev.lang === next.lang && prev.showToolEvents === next.showToolEvents
    && prev.onEdit === next.onEdit && prev.onRegenerate === next.onRegenerate
}

export default memo(MessageBubble, messageBubblePropsEqual)
