import { useState, useEffect, useRef, useCallback, useMemo, useReducer, type ChangeEvent, type DragEvent } from "react"
import { api } from "../api/client"
import type { Message, ModelClassKey, CategorizedProvider, ToolEvent, PermissionRequest, Project } from "../types"
import type { Page } from "../constants"
import { BarChart3, Settings, HelpCircle, Sun, Moon, X, AlignLeft, MoreVertical, Plus, Brain, Wrench, Download, ArrowDown } from "lucide-react"
import type { Lang } from "../i18n"
import { t } from "../i18n"
import ConversationSidebar from "../components/chat/ConversationSidebar"
import ModelSelector from "../components/chat/ModelSelector"
import MessageBubble from "../components/chat/MessageBubble"
import InputArea from "../components/chat/InputArea"
import ArtifactPanel from "../components/chat/ArtifactPanel"
import PromptLibrary from "../components/chat/PromptLibrary"
import { ArtifactContext } from "../components/ui/artifact-context"
import type { Artifact } from "../components/ui/artifact-context"
import PermissionModal from "../components/PermissionModal"

interface AttachedFile {
  id: string
  name: string
  ext: string
  type: "text" | "image" | "binary"
  content?: string
}

const TEXT_EXTS = new Set(["txt","md","json","py","js","ts","tsx","jsx","html","css","sql","csv","yml","yaml","sh","xml","toml","ini","env","log","rb","go","rs","java","c","cpp","h","php","kt","swift"])
const IMG_EXTS = new Set(["jpg","jpeg","png","gif","webp","svg","bmp"])

function readSingleFile(file: File): Promise<AttachedFile> {
  return new Promise((resolve) => {
    const ext = file.name.split(".").pop()?.toLowerCase() || ""
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    if (IMG_EXTS.has(ext)) {
      const r = new FileReader()
      r.onload = (e) => resolve({ id, name: file.name, ext, type: "image", content: e.target?.result as string })
      r.readAsDataURL(file)
    } else if (TEXT_EXTS.has(ext)) {
      const r = new FileReader()
      r.onload = (e) => resolve({ id, name: file.name, ext, type: "text", content: e.target?.result as string })
      r.readAsText(file, "utf-8")
    } else if (ext === "pdf") {
      const r = new FileReader()
      r.onload = (e) => {
        try {
          const raw = new TextDecoder("latin1").decode(e.target?.result as ArrayBuffer)
          const texts: string[] = []
          const re = /\(([^)]{1,300})\)\s*T[jJ]/g
          let m
          while ((m = re.exec(raw)) !== null) {
            const t = m[1].replace(/\\(\d{3})/g, (_, n) => String.fromCharCode(parseInt(n, 8))).replace(/\\\\/g, "\\").trim()
            if (t.length > 2) texts.push(t)
          }
          const content = texts.length > 5
            ? texts.join(" ")
            : `[PDF: ${file.name} — conteúdo não extraível; usa ferramentas para ler o ficheiro]`
          resolve({ id, name: file.name, ext, type: "text", content })
        } catch {
          resolve({ id, name: file.name, ext, type: "binary" })
        }
      }
      r.readAsArrayBuffer(file)
    } else {
      resolve({ id, name: file.name, ext, type: "binary" })
    }
  })
}

function fileIcon(f: AttachedFile): string {
  if (f.type === "image") return "🖼️"
  if (f.ext === "pdf") return "📕"
  if (f.ext === "md") return "📝"
  if (["xlsx","csv"].includes(f.ext)) return "📊"
  if (["docx","doc"].includes(f.ext)) return "📄"
  return "📎"
}

function ProjectPromptModal({ lang, project, onSave, onClose }: { lang: Lang; project: Project; onSave: (sp: string, workingDir: string) => void; onClose: () => void }) {
  const [value, setValue] = useState(project.system_prompt)
  const [workingDir, setWorkingDir] = useState(project.working_dir ?? "")

  const handlePickDir = async () => {
    const picked = await api.openDirPicker()
    if (picked !== null) setWorkingDir(picked)
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{project.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{lang === "pt" ? "Configurações do projecto" : "Project settings"}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 flex flex-col gap-4">
          {/* Working directory */}
          <div>
            <label className="text-xs font-medium text-foreground mb-1.5 block">
              {lang === "pt" ? "Directório de trabalho" : "Working directory"}
            </label>
            <div className="flex gap-2">
              <input
                value={workingDir}
                onChange={e => setWorkingDir(e.target.value)}
                placeholder={lang === "pt" ? "Opcional — ex: /home/user/projecto" : "Optional — e.g. /home/user/project"}
                className="flex-1 bg-muted/30 border border-border/50 rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/40 transition-colors font-mono min-w-0"
                spellCheck={false}
              />
              <button
                onClick={handlePickDir}
                className="shrink-0 px-3 py-2 rounded-xl border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title={lang === "pt" ? "Escolher pasta" : "Browse"}>
                📁
              </button>
            </div>
            <p className="text-xs text-muted-foreground/60 mt-1.5">
              {lang === "pt"
                ? "Caminhos relativos (ex: src/index.ts) são resolvidos a partir daqui. O bash também arranca neste directório."
                : "Relative paths (e.g. src/index.ts) resolve from here. Bash commands also start in this directory."}
            </p>
          </div>

          {/* System prompt */}
          <div>
            <label className="text-xs font-medium text-foreground mb-1.5 block">
              {lang === "pt" ? "Instruções do projecto" : "Project instructions"}
            </label>
            <textarea
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={lang === "pt"
                ? "Ex: Estás a trabalhar num projecto React com TypeScript. Segue sempre as convenções do projecto e responde em português."
                : "Ex: You are working on a React TypeScript project. Always follow the project conventions."}
              className="w-full bg-muted/30 border border-border/50 rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none resize-none focus:border-primary/40 transition-colors min-h-[120px]"
              rows={5}
            />
            <p className="text-xs text-muted-foreground/60 mt-1.5">
              {lang === "pt"
                ? "Usadas como system prompt em todas as conversas deste projecto."
                : "Used as system prompt in all conversations in this project."}
            </p>
          </div>
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            {lang === "pt" ? "Cancelar" : "Cancel"}
          </button>
          <button onClick={() => onSave(value, workingDir)}
            className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
            {lang === "pt" ? "Guardar" : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}

interface Props {
  onNavigate: (p: Page) => void
  colorMode: "dark" | "light"
  setColorMode: (m: "dark" | "light") => void
  lang: Lang
  setLang: (l: Lang) => void
}

interface ActiveStream {
  cancel: () => void
  accum: string
  toolEvents: ToolEvent[]
  placeholderId: number
  currentMessages: Message[]
  userMsg: Message
  content: string
}

export default function ChatPage({ onNavigate, colorMode, setColorMode, lang, setLang }: Props) {
  const [convs, setConvs] = useState<{ id: number; title: string; project_id?: number }[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null)
  const [projectPromptOpen, setProjectPromptOpen] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [input, setInput] = useState("")
  const [modelClass, setModelClass] = useState<ModelClassKey>("auto")
  const [strategy, setStrategy] = useState<string>("smartest")
  const [selectedModel, setSelectedModel] = useState("")
  // PLAN/BUILD mode — PLAN (default) is chat-only; BUILD attaches bash/filesystem
  // tools. Persisted per user. Storage key kept as "toolsEnabled" for compatibility.
  const [toolsEnabled, setToolsEnabled] = useState<boolean>(() => localStorage.getItem("nexus.toolsEnabled") === "true")
  const [convId, setConvId] = useState<number | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 768)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [availProviders, setAvailProviders] = useState<Record<string, CategorizedProvider[]> | null>(null)
  // Queue, not a single slot: several conversations can stream (and request
  // tool permission) at the same time, so each needs its own visible prompt
  // instead of the latest one silently replacing an earlier pending one.
  const [permReqs, setPermReqs] = useState<PermissionRequest[]>([])
  const [updateState, setUpdateState] = useState<{ status: "available" | "downloading" | "ready" | "error"; version?: string; percent?: number; message?: string; phase?: "download" | "install" } | null>(null)
  const [artifact, setArtifact] = useState<Artifact | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState("")
  const [systemPromptOpen, setSystemPromptOpen] = useState(false)
  const systemPromptTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const isAtBottomRef = useRef(true)
  const skipAnimRef = useRef(false)
  const mountedRef = useRef(true)
  const convIdRef = useRef<number | null>(null)
  const messagesRef = useRef<Message[]>([])
  // Lets handleEdit/handleRegenerate (defined above sendMessage, and kept
  // referentially stable for MessageBubble's memo) call the current
  // sendMessage without capturing a stale copy of it.
  const sendMessageRef = useRef<(content?: string) => Promise<void>>(async () => {})
  const convsRef = useRef<{ id: number; title: string }[]>([])
  const cleanupPermRef = useRef<(() => void) | null>(null)
  const cleanupResolvedRef = useRef<(() => void) | null>(null)
  const [pendingFiles, setPendingFiles] = useState<AttachedFile[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Per-conversation, not a single flag — two conversations can each be
  // summarizing their own context at the same time.
  const [summarizingConvIds, setSummarizingConvIds] = useState<Set<number>>(new Set())
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({})
  const [modelSwitch, setModelSwitch] = useState<{ from: string; to: string } | null>(null)
  const lastResponseModelRef = useRef<string>("")
  const modelSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Parallel stream state — one entry per active conversation stream
  const activeStreamsRef = useRef<Map<number, ActiveStream>>(new Map())
  const [, tickStreams] = useReducer((x: number) => x + 1, 0)

  // Derived from active streams for the current conversation
  const currentStream = activeStreamsRef.current.get(convId ?? -1)
  const loading = !!currentStream
  const streamingContent = currentStream?.accum ?? ""
  const toolEvents = currentStream?.toolEvents ?? []
  const activeConvIds = new Set(activeStreamsRef.current.keys())

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { convsRef.current = convs }, [convs])

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  useEffect(() => {
    const nexus = (window as any).nexus
    if (nexus?.permissions?.onRequest) {
      cleanupPermRef.current = nexus.permissions.onRequest((data: PermissionRequest) => {
        setPermReqs(prev => prev.some(r => r.id === data.id) ? prev : [...prev, data])
      })
    }
    if (nexus?.permissions?.onResolved) {
      cleanupResolvedRef.current = nexus.permissions.onResolved((id: string) => {
        setPermReqs(prev => prev.filter(r => r.id !== id))
      })
    }
    return () => { cleanupPermRef.current?.(); cleanupResolvedRef.current?.() }
  }, [])

  useEffect(() => {
    const nexus = (window as any).nexus
    if (!nexus?.ipc) return
    const onAvailable = (_: any, { version }: { version: string }) => setUpdateState({ status: "available", version })
    const onProgress = (_: any, { percent }: { percent: number }) => setUpdateState(prev => prev ? { ...prev, status: "downloading", percent } : null)
    const onReady = () => setUpdateState(prev => prev ? { ...prev, status: "ready" } : null)
    const onError = (_: any, { message, phase }: { message: string; phase?: "download" | "install" }) => setUpdateState(prev => ({ ...prev, status: "error", message, phase, version: prev?.version }))
    nexus.ipc.on("nexus:update:available", onAvailable)
    nexus.ipc.on("nexus:update:progress", onProgress)
    nexus.ipc.on("nexus:update:ready", onReady)
    nexus.ipc.on("nexus:update:error", onError)
    return () => {
      nexus.ipc.off("nexus:update:available", onAvailable)
      nexus.ipc.off("nexus:update:progress", onProgress)
      nexus.ipc.off("nexus:update:ready", onReady)
      nexus.ipc.off("nexus:update:error", onError)
    }
  }, [])

  useEffect(() => {
    const loadProviders = () => api.getAvailableProviders().then(setAvailProviders).catch(() => {})
    loadProviders()
    // Re-fetch when the main process applies a fresh remote catalog
    const unsubscribe = api.onCatalogUpdated(loadProviders)
    return unsubscribe
  }, [])
  useEffect(() => { api.listProjects().then(setProjects).catch(() => {}) }, [])

  // Poll cooldowns every 8s — ramps down when no active streams
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>
    const poll = () => api.getCooldowns().then(c => {
      setCooldowns(c)
      // If no more cooldowns and no active streams, slow down or stop
    }).catch(() => {})
    poll()
    timer = setInterval(poll, 8000)
    return () => clearInterval(timer)
  }, [])
  // During streaming, jump instantly (many updates/sec) — smooth scroll would
  // restart its animation on every chunk and make the pane visibly judder.
  // Only animate smoothly when a full message lands (send/receive).
  useEffect(() => {
    if (!isAtBottomRef.current) return
    const instant = skipAnimRef.current || !!streamingContent
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? "auto" : "smooth" })
    skipAnimRef.current = false
  }, [messages, streamingContent])

  const handleScrollContainer = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 80
    isAtBottomRef.current = atBottom
    setShowScrollBtn(!atBottom)
  }, [])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    isAtBottomRef.current = true
    setShowScrollBtn(false)
  }, [])

  const loadConvs = useCallback(async () => {
    const list = await api.listConversations().catch(() => null)
    if (list && mountedRef.current) setConvs(list)
    return list
  }, [])

  const switchConv = useCallback(async (id: number) => {
    convIdRef.current = id
    setConvId(id)
    isAtBottomRef.current = true
    skipAnimRef.current = true
    setShowScrollBtn(false)
    const active = activeStreamsRef.current.get(id)
    if (active) {
      // Attach to in-progress stream — show what's accumulated so far
      setMessages([
        ...active.currentMessages,
        active.userMsg,
        { id: active.placeholderId, role: "assistant", content: active.accum },
      ])
      setSystemPrompt("")
      setSystemPromptOpen(false)
      tickStreams()
      return
    }
    const conv = await api.getConversation(id).catch(() => null)
    if (conv && mountedRef.current) {
      setMessages(Array.isArray(conv.messages) ? conv.messages : [])
      setSystemPrompt(conv.system_prompt || "")
      setSystemPromptOpen(false)
    }
  }, [])

  const newConv = useCallback(async (projId?: number | null) => {
    const effectiveProjId = projId !== undefined ? projId : activeProjectId
    const conv = await api.createConversation(t(lang, "newConversation"), effectiveProjId ?? undefined).catch(() => null)
    if (conv && mountedRef.current) {
      convIdRef.current = conv.id
      isAtBottomRef.current = true
      skipAnimRef.current = true
      setConvId(conv.id); setMessages([])
      const projSystemPrompt = effectiveProjId
        ? projects.find(p => p.id === effectiveProjId)?.system_prompt || ""
        : ""
      setSystemPrompt(projSystemPrompt); setSystemPromptOpen(false)
      setConvs(prev => prev.some(c => c.id === conv.id) ? prev : [...prev, conv])
    }
  }, [lang, activeProjectId, projects])

  const exportConv = useCallback((format: "md" | "json") => {
    if (messagesRef.current.length === 0) return
    const title = convs.find(c => c.id === convIdRef.current)?.title || "conversa"
    const safe = title.replace(/[^a-z0-9]/gi, "_").toLowerCase()
    const msgs = messagesRef.current.filter(m => m.role !== "system")
    let content: string; let mime: string
    if (format === "json") {
      content = JSON.stringify(msgs.map(m => ({ role: m.role, content: m.content, model: m.model, created_at: m.id })), null, 2)
      mime = "application/json"
    } else {
      const lines = msgs.map(m => `**${m.role === "user" ? (lang === "pt" ? "Tu" : "You") : (m.model || "Assistente")}**\n\n${m.content}`)
      content = `# ${title}\n\n` + lines.join("\n\n---\n\n")
      mime = "text/markdown"
    }
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = `${safe}.${format === "json" ? "json" : "md"}`
    a.click(); URL.revokeObjectURL(url)
    setExportOpen(false)
  }, [convs, lang])

  const renameConv = useCallback(async (id: number, title: string) => {
    setConvs(prev => prev.map(c => c.id === id ? { ...c, title } : c))
    await api.updateConversationTitle(id, title).catch(() => null)
  }, [])

  // Both of these used to stop after dropping the old messages and dumping
  // the text back into the input box, leaving the user to press send again —
  // so "Enviar" and "Regenerar" appeared to do nothing at all. They now send
  // for real. The ref indirection keeps these callbacks stable (MessageBubble
  // is memoized on their identity) without capturing a stale sendMessage.
  const truncateAndSend = async (msgId: number, content: string) => {
    await api.truncateMessages(convIdRef.current!, msgId).catch(() => null)
    const truncated = messagesRef.current.filter(m => m.id < msgId)
    // Set by hand: the effect that syncs this ref only runs after the
    // re-render, and sendMessage reads it now to build the history it sends.
    messagesRef.current = truncated
    setMessages(truncated)
    await sendMessageRef.current(content)
  }

  const handleEdit = useCallback(async (msgId: number, newContent: string) => {
    if (!convIdRef.current) return
    await truncateAndSend(msgId, newContent)
  }, [])

  const handleRegenerate = useCallback(async (msgId: number) => {
    if (!convIdRef.current) return
    const msgs = messagesRef.current
    const idx = msgs.findIndex(m => m.id === msgId)
    if (idx < 1) return
    const prevUser = [...msgs].slice(0, idx).reverse().find(m => m.role === "user")
    if (!prevUser) return
    await truncateAndSend(msgId, prevUser.content)
  }, [])

  const deleteConv = useCallback(async (id: number) => {
    if (!mountedRef.current) return
    const prevConvs = convs
    setConvs(prev => prev.filter(c => c.id !== id))
    if (convIdRef.current === id) {
      const next = prevConvs.find(c => c.id !== id)
      if (next) await switchConv(next.id)
      else { setConvId(null); setMessages([]) }
    }
    await api.deleteConversation(id).catch(() => null)
  }, [convs, switchConv])

  useEffect(() => {
    if (convId !== null) convIdRef.current = convId
  }, [convId])

  const handleToolsToggle = useCallback((v: boolean) => {
    setToolsEnabled(v)
    localStorage.setItem("nexus.toolsEnabled", String(v))
  }, [])

  const handleProjectCreate = useCallback(async (name: string) => {
    const p = await api.createProject(name).catch(() => null)
    if (p) setProjects(prev => [...prev, p])
  }, [])

  const handleProjectDelete = useCallback(async (id: number) => {
    await api.deleteProject(id).catch(() => null)
    setProjects(prev => prev.filter(p => p.id !== id))
    if (activeProjectId === id) setActiveProjectId(null)
    setConvs(prev => prev.map(c => c.project_id === id ? { ...c, project_id: undefined } : c))
  }, [activeProjectId])

  const handleProjectRename = useCallback(async (id: number, name: string) => {
    await api.updateProject(id, { name }).catch(() => null)
    setProjects(prev => prev.map(p => p.id === id ? { ...p, name } : p))
  }, [])

  const handleProjectSystemPromptSave = useCallback(async (id: number, sp: string, workingDir: string) => {
    const updates: Partial<Pick<Project, "system_prompt" | "working_dir">> = { system_prompt: sp }
    if (workingDir.trim()) updates.working_dir = workingDir.trim()
    else updates.working_dir = undefined
    await api.updateProject(id, updates).catch(() => null)
    setProjects(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p))
    setProjectPromptOpen(null)
  }, [])

  const handleMoveConv = useCallback(async (cid: number, projectId: number | null) => {
    await api.updateConversationProject(cid, projectId).catch(() => null)
    setConvs(prev => prev.map(c => {
      if (c.id !== cid) return c
      const { project_id: _drop, ...rest } = c
      return projectId !== null ? { ...rest, project_id: projectId } : rest
    }))
  }, [])

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false)
  }, [])

  const handleDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (!files.length) return
    const results = await Promise.all(files.map(readSingleFile))
    setPendingFiles(prev => [...prev, ...results])
  }, [])

  useEffect(() => {
    (async () => {
      const list = await loadConvs()
      if (!list || list.length === 0) await newConv()
      else if (!convIdRef.current) await switchConv(list[0].id)
    })()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      const isInput = tag === "INPUT" || tag === "TEXTAREA"
      if (e.key === "k" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); newConv() }
      if (e.key === "/" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setSidebarOpen(true) }
      if (e.key === "Escape" && artifact) { setArtifact(null) }
      if (e.key === "Escape" && exportOpen) { setExportOpen(false) }
      if (e.key === "b" && (e.ctrlKey || e.metaKey) && !isInput) { e.preventDefault(); setSidebarOpen(p => !p) }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [artifact, exportOpen, newConv])

  useEffect(() => {
    if (!streamingContent) return
    for (const l of ["html", "svg"]) {
      const complete = new RegExp("```" + l + "\\n([\\s\\S]*?)```", "i").exec(streamingContent)
      if (complete) { setArtifact({ content: complete[1].trim(), lang: l, streaming: false }); return }
      const partial = new RegExp("```" + l + "\\n([\\s\\S]+)", "i").exec(streamingContent)
      if (partial) { setArtifact({ content: partial[1].trim(), lang: l, streaming: true }); return }
    }
  }, [streamingContent])

  const handleFileInput = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const results = await Promise.all(Array.from(files).map(readSingleFile))
    setPendingFiles(prev => [...prev, ...results])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  // Called two ways: from the input box (InputArea wires this straight to
  // onClick, so the first argument is a MouseEvent — hence the typeof check
  // rather than plain truthiness) and from an edited/regenerated message,
  // which passes the text to send directly instead of going through the box.
  const sendMessage = async (overrideContent?: string) => {
    const override = typeof overrideContent === "string" ? overrideContent.trim() : ""
    if ((!override && !input.trim() && pendingFiles.length === 0) || loading) return
    let content = override || input.trim()
    if (pendingFiles.length > 0) {
      if (!content) content = lang === "pt" ? "Analisa os seguintes ficheiros:" : "Analyze the following files:"
      for (const f of pendingFiles) {
        if (f.type === "text") {
          content += `\n\n<attachment name="${f.name}">\n\`\`\`${f.ext}\n${f.content}\n\`\`\`\n</attachment>`
        } else if (f.type === "image") {
          content += `\n\n<attachment name="${f.name}">\n![${f.name}](${f.content})\n</attachment>`
        } else {
          content += `\n\n**${f.name}** (${f.ext.toUpperCase()} — usa ferramentas para ler o conteúdo)`
        }
      }
    }
    // Don't wipe a draft the user left in the box just because they resent an
    // older message from the thread.
    if (!override) setInput("")
    setPendingFiles([])

    const ts = Date.now()
    const placeholderId = -ts
    const userMsg: Message = { id: ts, role: "user", content }
    const currentMessages = messagesRef.current
    setMessages([...currentMessages, userMsg, { id: placeholderId, role: "assistant", content: "" }])

    const ipcMessages: { role: string; content: string }[] = []
    if (systemPrompt) ipcMessages.push({ role: "system", content: systemPrompt })
    for (const m of currentMessages.filter(m => m.role !== "system")) {
      ipcMessages.push({ role: m.role, content: m.content })
    }
    ipcMessages.push({ role: "user", content })

    // Context summarization: if total chars > 100k, summarize oldest portion
    const CTX_LIMIT = 100_000
    const CTX_KEEP_LAST = 20
    const totalChars = ipcMessages.reduce((s, m) => s + (m.content?.length || 0), 0)
    if (totalChars > CTX_LIMIT && ipcMessages.length > CTX_KEEP_LAST + 2) {
      const systemMsgs = ipcMessages.filter(m => m.role === "system")
      const convoMsgs = ipcMessages.filter(m => m.role !== "system")
      const splitAt = Math.max(0, convoMsgs.length - CTX_KEEP_LAST)
      const toSummarize = convoMsgs.slice(0, splitAt)
      const toKeep = convoMsgs.slice(splitAt)
      const sendCid = convIdRef.current
      const summaryKey = `nexus-ctx-${sendCid ?? 0}-${toSummarize.length}`
      let summaryText = localStorage.getItem(summaryKey)
      if (!summaryText) {
        if (sendCid !== null) setSummarizingConvIds(prev => new Set(prev).add(sendCid))
        try {
          const summaryPrompt = [
            { role: "system" as const, content: "Summarize the following conversation concisely, preserving key facts, decisions, and context needed for continuation. Output only the summary." },
            ...toSummarize.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
          ]
          const result = await api.sendToProvider(summaryPrompt, { modelClass: "trabalhador", strategy: "fastest" })
          summaryText = result.content
          if (summaryText) localStorage.setItem(summaryKey, summaryText)
        } catch { /* fall through with no summary */ } finally {
          if (sendCid !== null) setSummarizingConvIds(prev => { const next = new Set(prev); next.delete(sendCid); return next })
        }
      }
      if (summaryText) {
        ipcMessages.length = 0
        ipcMessages.push(...systemMsgs)
        ipcMessages.push({ role: "system", content: `[Earlier conversation summary]\n${summaryText}` })
        ipcMessages.push(...toKeep)
      }
    }

    const finalize = async (actualCid: number, fullContent: string, model: string, isError = false) => {
      const s = activeStreamsRef.current.get(actualCid)
      activeStreamsRef.current.delete(actualCid)
      tickStreams()

      const savedCurrentMessages = s?.currentMessages ?? currentMessages
      const savedUserMsg = s?.userMsg ?? userMsg

      const assistantMsg: Message = isError
        ? { id: ts + 1, role: "assistant", content: `❌ ${fullContent}` }
        : { id: ts + 1, role: "assistant", content: fullContent, model }
      const finalMsgs = [...savedCurrentMessages, savedUserMsg, assistantMsg]

      if (actualCid === convIdRef.current && mountedRef.current) {
        setMessages(finalMsgs)
        // Detect model switch (only notify for current conversation)
        if (!isError && model) {
          const prev = lastResponseModelRef.current
          if (prev && prev !== model) {
            if (modelSwitchTimerRef.current) clearTimeout(modelSwitchTimerRef.current)
            setModelSwitch({ from: prev, to: model })
            modelSwitchTimerRef.current = setTimeout(() => setModelSwitch(null), 7000)
          }
          lastResponseModelRef.current = model
        }
        // Refresh cooldowns immediately after a response (fallback may have updated them)
        api.getCooldowns().then(setCooldowns).catch(() => {})
      }
      await api.saveMessages(actualCid, finalMsgs).catch(() => null)
      if (!isError) {
        const curTitle = convsRef.current.find(c => c.id === actualCid)?.title
        if (!curTitle || curTitle === t(lang, "newConversation")) {
          const savedContent = s?.content ?? content
          const autoTitle = savedContent.length > 42 ? savedContent.slice(0, 40) + "…" : savedContent
          await api.updateConversationTitle(actualCid, autoTitle).catch(() => null)
          await loadConvs()
        }
      }
    }

    const startStream = (actualCid: number) => {
      let temperature: number | undefined
      if (selectedModel && availProviders) {
        for (const providers of Object.values(availProviders)) {
          for (const p of providers) {
            if (p.models.some(m => m.id === selectedModel)) {
              try { temperature = JSON.parse(localStorage.getItem(`nexus-agent-pref-${p.id}`) || "{}").temperature } catch { /* */ }
              break
            }
          }
        }
      }

      const streamState: ActiveStream = {
        cancel: () => {},
        accum: "",
        toolEvents: [],
        placeholderId,
        currentMessages,
        userMsg,
        content,
      }
      activeStreamsRef.current.set(actualCid, streamState)
      tickStreams()

      const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null
      const cancel = api.streamToProvider(
        ipcMessages,
        { modelClass, model: selectedModel || undefined, strategy, temperature, workingDir: activeProject?.working_dir || undefined, toolsEnabled, lang, convId: actualCid },
        (chunk) => {
          const s = activeStreamsRef.current.get(actualCid)
          if (!s) return
          s.accum += chunk
          if (actualCid === convIdRef.current && mountedRef.current) {
            tickStreams()
            setMessages(prev => prev.map(m => m.id === placeholderId ? { ...m, content: s.accum } : m))
          }
        },
        (result) => { finalize(actualCid, result.content, result.model) },
        (err) => { finalize(actualCid, err, "", true) },
        (ev) => {
          const s = activeStreamsRef.current.get(actualCid)
          if (!s) return
          const mapped = { id: ev.id, name: ev.name, arguments: ev.args, status: ev.status, result: ev.result, started_at: ev.started_at, completed_at: ev.completed_at }
          const idx = s.toolEvents.findIndex(e => e.id === ev.id)
          if (idx >= 0) s.toolEvents[idx] = mapped
          else s.toolEvents.push(mapped)
          if (actualCid === convIdRef.current) tickStreams()
        },
      )
      streamState.cancel = cancel
    }

    const cid = convIdRef.current
    if (!cid) {
      api.createConversation(t(lang, "newConversation"), activeProjectId ?? undefined).then(conv => {
        if (!mountedRef.current) return
        convIdRef.current = conv.id
        setConvId(conv.id)
        setConvs(prev => prev.some(c => c.id === conv.id) ? prev : [...prev, conv])
        startStream(conv.id)
      }).catch(() => {})
    } else {
      startStream(cid)
    }
  }
  sendMessageRef.current = sendMessage

  const handleStop = () => {
    const cid = convIdRef.current
    if (!cid) return
    const s = activeStreamsRef.current.get(cid)
    if (s) {
      s.cancel()
      activeStreamsRef.current.delete(cid)
      setMessages(prev => prev.filter(m => m.id !== s.placeholderId))
      tickStreams()
    }
  }

  const renderItems = useMemo(() => {
    type Item = { type: "single"; msg: Message }
    const items: Item[] = messages.map(msg => ({ type: "single", msg }))
    return items
  }, [messages])

  const artifactCtx = useMemo(() => ({
    artifact,
    openArtifact: (content: string, l: string) => setArtifact({ content, lang: l }),
    closeArtifact: () => setArtifact(null),
  }), [artifact])

  return (
    <ArtifactContext.Provider value={artifactCtx}>
    <div className="h-screen overflow-hidden bg-background flex">
      <ConversationSidebar lang={lang} convs={convs} convId={convId} sidebarOpen={sidebarOpen} isMobile={isMobile}
        onSelect={switchConv} onNew={newConv} onDelete={deleteConv} onRename={renameConv}
        onClose={() => setSidebarOpen(false)} activeConvIds={activeConvIds}
        projects={projects} activeProjectId={activeProjectId}
        onProjectSelect={setActiveProjectId}
        onProjectCreate={handleProjectCreate}
        onProjectDelete={handleProjectDelete}
        onProjectRename={handleProjectRename}
        onProjectSystemPrompt={(id) => setProjectPromptOpen(id)}
        onMoveConv={handleMoveConv} />

      {isMobile && mobileMenuOpen && (
        <>
          <div className="fixed inset-0 bg-black/60 z-50" onClick={() => setMobileMenuOpen(false)} />
          <div className="fixed top-0 right-0 z-50 w-56 bg-card border-l border-border h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-medium text-foreground">{t(lang, "menu")}</span>
              <button onClick={() => setMobileMenuOpen(false)} className="p-1 text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <div className="flex-1 p-3 flex flex-col gap-1 overflow-y-auto">
              <button onClick={() => { setMobileMenuOpen(false); onNavigate("memories") }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground hover:bg-accent transition-colors">
                <Brain size={16} className="text-muted-foreground" /> {lang === "pt" ? "Memórias" : "Memories"}
              </button>
              <button onClick={() => { setMobileMenuOpen(false); onNavigate("skills") }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground hover:bg-accent transition-colors">
                <Wrench size={16} className="text-muted-foreground" /> {lang === "pt" ? "Minhas Skills" : "My Skills"}
              </button>
              <button onClick={() => { setMobileMenuOpen(false); onNavigate("analytics") }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground hover:bg-accent transition-colors">
                <BarChart3 size={16} className="text-muted-foreground" /> {t(lang, "analyticsTitle")}
              </button>
              <button onClick={() => { setMobileMenuOpen(false); onNavigate("settings") }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground hover:bg-accent transition-colors">
                <Settings size={16} className="text-muted-foreground" /> {t(lang, "settingsTitle")}
              </button>
              <button onClick={() => { setMobileMenuOpen(false); onNavigate("faq") }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground hover:bg-accent transition-colors">
                <HelpCircle size={16} className="text-muted-foreground" /> FAQ
              </button>
            </div>
            <div className="p-3 border-t border-border flex flex-col gap-1">
              <button onClick={() => { setMobileMenuOpen(false); setColorMode(colorMode === "dark" ? "light" : "dark") }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground hover:bg-accent transition-colors">
                {colorMode === "dark" ? <Sun size={16} className="text-muted-foreground" /> : <Moon size={16} className="text-muted-foreground" />}
                {colorMode === "dark" ? t(lang, "lightMode") : t(lang, "darkMode")}
              </button>
              <button onClick={() => { setMobileMenuOpen(false); setLang(lang === "pt" ? "en" : "pt") }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground hover:bg-accent transition-colors">
                {lang === "pt" ? "🇬🇧 English" : "🇵🇹 Português"}
              </button>
            </div>
          </div>
        </>
      )}

      <div className="flex-1 flex min-w-0 relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}>
        {isDragging && (
          <div className="absolute inset-0 z-50 bg-primary/10 border-2 border-dashed border-primary rounded-none flex items-center justify-center pointer-events-none">
            <div className="bg-card border border-primary/40 rounded-2xl px-8 py-5 flex flex-col items-center gap-2 shadow-xl">
              <span className="text-2xl">📎</span>
              <p className="text-sm font-medium text-foreground">{lang === "pt" ? "Largar ficheiros aqui" : "Drop files here"}</p>
            </div>
          </div>
        )}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-card border-b border-border px-2 py-2 flex items-center gap-1">
          <button onClick={() => setSidebarOpen(p => !p)}
            className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0">
            <AlignLeft size={18} />
          </button>
          <h1 className="text-foreground font-bold text-base flex-1 truncate px-1">DaazNexus</h1>
          <div className="flex md:hidden items-center">
            <button onClick={() => newConv()}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <Plus size={18} />
            </button>
            <button onClick={() => setMobileMenuOpen(true)}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <MoreVertical size={18} />
            </button>
          </div>
          <div className="hidden md:flex items-center gap-1">
            <button onClick={() => onNavigate("analytics")}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title={t(lang, "analyticsTitle")}>
              <BarChart3 size={18} />
            </button>
            <button onClick={() => onNavigate("skills")}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title={lang === "pt" ? "Minhas Skills" : "My Skills"}>
              <Wrench size={18} />
            </button>
            <button onClick={() => onNavigate("memories")}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title={lang === "pt" ? "Memórias" : "Memories"}>
              <Brain size={18} />
            </button>
            {messages.length > 0 && (
              <div className="relative">
                <button onClick={() => setExportOpen(p => !p)}
                  className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title={lang === "pt" ? "Exportar conversa" : "Export conversation"}>
                  <Download size={18} />
                </button>
                {exportOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-xl shadow-lg overflow-hidden min-w-[140px]">
                      <button onClick={() => exportConv("md")} className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-accent transition-colors flex items-center gap-2">
                        <span>📝</span> Markdown
                      </button>
                      <button onClick={() => exportConv("json")} className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-accent transition-colors flex items-center gap-2">
                        <span>📋</span> JSON
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            <button onClick={() => onNavigate("settings")}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title={t(lang, "settingsTitle")}>
              <Settings size={18} />
            </button>
            <button onClick={() => onNavigate("faq")}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="FAQ">
              <HelpCircle size={18} />
            </button>
            <div className="w-px h-5 bg-border mx-1" />
            <button onClick={() => setColorMode(colorMode === "dark" ? "light" : "dark")}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title={colorMode === "dark" ? t(lang, "lightMode") : t(lang, "darkMode")}>
              {colorMode === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button onClick={() => setLang(lang === "pt" ? "en" : "pt")}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-xs font-bold"
              title={lang === "pt" ? "English" : "Português"}>
              {lang === "pt" ? "EN" : "PT"}
            </button>
          </div>
        </header>

        <ModelSelector lang={lang} modelClass={modelClass} onModelClassChange={v => { setModelClass(v); setSelectedModel("") }}
          strategy={strategy} onStrategyChange={setStrategy}
          selectedModel={selectedModel} onModelChange={setSelectedModel} availProviders={availProviders}
          cooldowns={cooldowns} toolsEnabled={toolsEnabled} onToolsToggle={handleToolsToggle} />

        {/* System prompt bar */}
        <div className="border-b border-border/50 bg-muted/20 shrink-0">
          <button
            onClick={() => setSystemPromptOpen(p => !p)}
            className="w-full flex items-center gap-2 px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <span>{systemPromptOpen ? "▼" : "▶"}</span>
            <span className="font-medium">{lang === "pt" ? "Instruções do sistema" : "System prompt"}</span>
            {systemPrompt && !systemPromptOpen && (
              <span className="ml-1 text-primary/60 truncate max-w-[300px]">{systemPrompt}</span>
            )}
            {!systemPrompt && !systemPromptOpen && (
              <span className="text-muted-foreground/40">{lang === "pt" ? "Opcional — define o comportamento do modelo" : "Optional — define model behavior"}</span>
            )}
          </button>
          {systemPromptOpen && (
            <div className="px-4 pb-2">
              <textarea
                value={systemPrompt}
                onChange={e => {
                  const val = e.target.value
                  setSystemPrompt(val)
                  if (systemPromptTimer.current) clearTimeout(systemPromptTimer.current)
                  systemPromptTimer.current = setTimeout(() => {
                    if (convIdRef.current) api.setSystemPrompt(convIdRef.current, val).catch(() => null)
                  }, 800)
                }}
                placeholder={lang === "pt"
                  ? "Ex: És um assistente especializado em Python. Responde sempre em português, de forma concisa."
                  : "Ex: You are a Python expert. Always respond concisely in English."}
                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none resize-none border border-border/40 rounded-xl px-3 py-2 focus:border-primary/40 transition-colors min-h-[60px] max-h-[120px]"
                rows={3}
              />
            </div>
          )}
        </div>

        <div ref={scrollContainerRef} onScroll={handleScrollContainer} className="flex-1 overflow-y-auto px-4 py-4 relative">
          {showScrollBtn && (
            <button
              onClick={scrollToBottom}
              className="fixed bottom-28 right-6 z-50 flex items-center justify-center w-9 h-9 rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90 transition-opacity"
              title={lang === "pt" ? "Ir para o fim" : "Scroll to bottom"}>
              <ArrowDown size={18} />
            </button>
          )}
          <div className="flex flex-col gap-4">
            {messages.length === 0 ? (() => {
              const hasAnyProvider = availProviders && (
                (availProviders.free?.length ?? 0) > 0 ||
                (availProviders.paid?.length ?? 0) > 0 ||
                (availProviders.local?.length ?? 0) > 0
              )
              // Onboarding: no API keys configured
              if (availProviders !== null && !hasAnyProvider) return (
                <div className="max-w-md mx-auto w-full mt-20 flex flex-col items-center gap-5 text-center">
                  <div className="text-4xl">🔑</div>
                  <div>
                    <h2 className="text-base font-semibold text-foreground mb-1">
                      {lang === "pt" ? "Bem-vindo ao DaazNexus" : "Welcome to DaazNexus"}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {lang === "pt"
                        ? "Para começar, adiciona pelo menos uma API key nas Definições."
                        : "To get started, add at least one API key in Settings."}
                    </p>
                  </div>
                  <div className="bg-muted/30 border border-border/50 rounded-2xl px-5 py-4 text-left w-full space-y-2">
                    <p className="text-xs font-medium text-foreground mb-1">{lang === "pt" ? "Opções gratuitas:" : "Free options:"}</p>
                    {[
                      { name: "Groq", url: "https://console.groq.com", note: lang === "pt" ? "Llama, Gemma — muito rápido" : "Llama, Gemma — very fast" },
                      { name: "Google AI Studio", url: "https://aistudio.google.com", note: lang === "pt" ? "Gemini Flash — generoso" : "Gemini Flash — generous" },
                      { name: "Together AI", url: "https://together.ai", note: lang === "pt" ? "Vários modelos open-source" : "Many open-source models" },
                    ].map(p => (
                      <div key={p.name} className="flex items-center gap-3">
                        <span className="text-xs font-medium text-foreground w-28 shrink-0">{p.name}</span>
                        <span className="text-xs text-muted-foreground">{p.note}</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => onNavigate("settings")}
                    className="px-6 py-2.5 bg-primary text-primary-foreground rounded-full text-sm font-medium hover:opacity-90 transition-opacity">
                    {lang === "pt" ? "Ir para Definições" : "Open Settings"}
                  </button>
                </div>
              )
              // Normal empty state
              return (
                <div className="max-w-7xl mx-auto w-full mt-16 flex flex-col items-center gap-6">
                  <p className="text-muted-foreground/70 text-sm">{t(lang, "howCanIHelp")}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                    {[
                      { label: t(lang, "prompt1Label"), sub: t(lang, "prompt1Sub") },
                      { label: t(lang, "prompt2Label"), sub: t(lang, "prompt2Sub") },
                      { label: t(lang, "prompt3Label"), sub: t(lang, "prompt3Sub") },
                      { label: t(lang, "prompt4Label"), sub: t(lang, "prompt4Sub") },
                    ].map(p => (
                      <button key={p.label} onClick={() => setInput(p.label)}
                        className="text-left px-4 py-3 rounded-2xl border border-border hover:border-primary/40 hover:bg-accent transition-colors">
                        <p className="text-sm font-medium text-foreground">{p.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{p.sub}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })() : (
              renderItems.map(item => (
                <div key={item.msg.id} className="max-w-7xl mx-auto w-full">
                  {item.msg.id < 0 && convId !== null && summarizingConvIds.has(convId) ? (
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground animate-pulse">
                      <span>⏳</span>
                      <span>{lang === "pt" ? "A sumarizar contexto…" : "Summarizing context…"}</span>
                    </div>
                  ) : (
                    <MessageBubble lang={lang} msg={item.msg} streamingContent={streamingContent} loading={loading}
                      toolEvents={toolEvents} isStreaming={item.msg.id < 0} showToolEvents={true}
                      onEdit={handleEdit} onRegenerate={handleRegenerate} />
                  )}
                </div>
              ))
            )}

            <div className="max-w-7xl mx-auto w-full">
              <InputArea lang={lang} input={input} onInputChange={setInput} onSend={sendMessage} onStop={handleStop}
                loading={loading} hasFiles={pendingFiles.length > 0}
                uploadButton={
                  <>
                    <input type="file" ref={fileInputRef} className="hidden" multiple onChange={handleFileInput}
                      accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.docx,.xlsx,.txt,.md,.json,.py,.js,.ts,.tsx,.jsx,.html,.css,.sql,.csv,.yml,.yaml,.sh,.xml,.rb,.go,.rs" />
                    <PromptLibrary lang={lang} currentInput={input} onSelect={setInput} />
                    <button
                      className="bg-muted hover:bg-accent text-muted-foreground hover:text-foreground rounded-full w-9 h-9 flex items-center justify-center font-bold text-lg shrink-0 transition-colors border border-border"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={loading}
                      title={lang === "pt" ? "Anexar ficheiro" : "Attach file"}>
                      +
                    </button>
                  </>
                }
                filePreviews={pendingFiles.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pb-1">
                    {pendingFiles.map(f => (
                      <div key={f.id} className="bg-accent border border-border rounded-full px-2.5 py-1 flex items-center gap-1.5 max-w-[180px]">
                        <span className="text-xs shrink-0">{fileIcon(f)}</span>
                        <span className="text-xs text-foreground truncate">{f.name}</span>
                        <button onClick={() => setPendingFiles(prev => prev.filter(p => p.id !== f.id))}
                          className="text-muted-foreground hover:text-destructive text-base leading-none shrink-0 ml-0.5">×</button>
                      </div>
                    ))}
                  </div>
                ) : undefined}
              />
            </div>
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      {artifact && (
        <ArtifactPanel artifact={artifact} onClose={() => setArtifact(null)} lang={lang} />
      )}
      </div>

    </div>

    {modelSwitch && (
      <div className="perm-toast fixed bottom-4 right-4 z-[90] bg-card border border-border rounded-xl shadow-xl px-4 py-3 flex items-start gap-3 max-w-[280px]">
        <span className="text-base shrink-0 mt-0.5">↻</span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">
            {lang === "pt" ? "Modelo alterado" : "Model changed"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
            <span className="line-through opacity-60">{modelSwitch.from.split("/").pop()}</span>
            {" → "}
            <span className="text-primary font-medium">{modelSwitch.to.split("/").pop()}</span>
          </p>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">
            {lang === "pt" ? "Limite atingido, AUTO escolheu outro modelo." : "Rate limit reached, AUTO picked another model."}
          </p>
        </div>
        <button onClick={() => setModelSwitch(null)}
          className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5">
          <X size={13} />
        </button>
      </div>
    )}

    {permReqs.length > 0 && (
      <PermissionModal
        reqs={permReqs.map(r => ({
          ...r,
          convTitle: r.convId != null ? convs.find(c => c.id === r.convId)?.title : undefined,
        }))}
        onRespond={(req, granted, always) => {
          (window as any).nexus?.permissions?.respond?.(req.id, granted, always)
          setPermReqs(prev => prev.filter(r => r.id !== req.id))
        }}
      />
    )}

    {projectPromptOpen !== null && (() => {
      const proj = projects.find(p => p.id === projectPromptOpen)
      if (!proj) return null
      return (
        <ProjectPromptModal
          lang={lang}
          project={proj}
          onSave={(sp, wd) => handleProjectSystemPromptSave(proj.id, sp, wd)}
          onClose={() => setProjectPromptOpen(null)}
        />
      )
    })()}

    {updateState && (
      <div className="perm-toast fixed bottom-4 left-4 z-[100] w-72 bg-card border border-primary/40 rounded-xl shadow-2xl overflow-hidden">
        <div className="px-3 pt-3 pb-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs">🔄</span>
            <span className="text-xs font-semibold text-foreground">
              {updateState.status === "available" && `Nova versão ${updateState.version} disponível`}
              {updateState.status === "downloading" && `A transferir… ${updateState.percent ?? 0}%`}
              {updateState.status === "ready" && "Pronto para instalar"}
              {updateState.status === "error" && (lang === "pt" ? "Falha na actualização" : "Update failed")}
            </span>
          </div>
          {updateState.status === "downloading" && (
            <div className="h-1 bg-muted rounded-full overflow-hidden mt-1">
              <div className="h-full bg-primary transition-all rounded-full" style={{ width: `${updateState.percent ?? 0}%` }} />
            </div>
          )}
          {updateState.status === "error" && updateState.message && (
            <p className="text-[10px] text-muted-foreground mt-1 break-words">{updateState.message}</p>
          )}
        </div>
        <div className="flex border-t border-border">
          <button onClick={() => setUpdateState(null)}
            className="flex-1 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors border-r border-border">
            {lang === "pt" ? "Ignorar" : "Dismiss"}
          </button>
          {updateState.status === "available" && (
            <button onClick={() => { (window as any).nexus?.update?.download?.(); setUpdateState(prev => prev ? { ...prev, status: "downloading", percent: 0 } : null) }}
              className="flex-1 py-2 text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
              {lang === "pt" ? "Transferir" : "Download"}
            </button>
          )}
          {updateState.status === "error" && updateState.phase !== "install" && (
            <button onClick={() => { (window as any).nexus?.update?.download?.(); setUpdateState(prev => prev ? { ...prev, status: "downloading", percent: 0, message: undefined } : null) }}
              className="flex-1 py-2 text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
              {lang === "pt" ? "Tentar novamente" : "Retry"}
            </button>
          )}
          {updateState.status === "ready" && (
            <button onClick={() => (window as any).nexus?.update?.install?.()}
              className="flex-1 py-2 text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
              {lang === "pt" ? "Reiniciar" : "Restart"}
            </button>
          )}
        </div>
      </div>
    )}
    </ArtifactContext.Provider>
  )
}
