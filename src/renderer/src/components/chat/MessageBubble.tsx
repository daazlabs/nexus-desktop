import { useState, useCallback, memo } from "react"
import type { Message, ToolEvent } from "../../types"
import type { Lang } from "../../i18n"
import { t } from "../../i18n"
import Markdown from "../ui/markdown"

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
      <div className={`max-w-[85%] ${
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
            {showToolEvents && toolEvents.length > 0 && (
              <div className="space-y-1 mb-2 pb-2 border-b border-border/50">
                {toolEvents.map((tc) => (
                  <div key={tc.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={tc.status === "running" ? "animate-pulse" : ""}>
                      {tc.status === "running" ? "●" : tc.status === "completed" ? "✓" : "✗"}
                    </span>
                    <code>{tc.name}</code>
                  </div>
                ))}
              </div>
            )}
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
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit() }
                if (e.key === "Escape") setEditing(false)
              }}
              className="bg-primary/20 text-primary-foreground rounded-xl px-3 py-2 text-sm resize-none outline-none border border-white/20 min-h-[60px] w-full"
              rows={Math.max(2, editValue.split("\n").length)}
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
          <Markdown content={msg.content} />
        )}

        {!isStreaming && !editing && (
          <div className="text-xs text-muted-foreground/60 mt-1.5 flex items-center gap-2 flex-wrap">
            {isAssistant && msg.model && <span>{msg.model}</span>}
            {isAssistant && msg.tokens_used != null && <span>{msg.tokens_used} tok</span>}
            {isAssistant && msg.duration != null && <span>{msg.duration}s</span>}
            <div className="ml-auto flex items-center gap-1 opacity-0 group-hover/bubble:opacity-100 transition-opacity">
              {isUser && onEdit && msg.id > 0 && (
                <button onClick={() => { setEditValue(msg.content); setEditing(true) }}
                  className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground px-1.5 py-0.5 rounded hover:bg-accent transition-colors"
                  title={lang === "pt" ? "Editar" : "Edit"}>
                  ✏️
                </button>
              )}
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
