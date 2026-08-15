import { useState, useRef, useEffect } from "react"
import { Plus, X, Search, Pencil, FolderOpen, Folder, ChevronDown, ChevronRight, FileText } from "lucide-react"
import type { Lang } from "../../i18n"
import { t } from "../../i18n"
import type { Project } from "../../types"

interface Props {
  lang: Lang
  convs: { id: number; title: string; project_id?: number }[]
  convId: number | null
  sidebarOpen: boolean
  isMobile: boolean
  onSelect: (id: number) => void
  onNew: () => void
  onDelete: (id: number) => void
  onRename: (id: number, title: string) => void
  onClose: () => void
  activeConvIds?: Set<number>
  projects: Project[]
  activeProjectId: number | null
  onProjectSelect: (id: number | null) => void
  onProjectCreate: (name: string) => void
  onProjectDelete: (id: number) => void
  onProjectRename: (id: number, name: string) => void
  onProjectSystemPrompt: (id: number) => void
  onMoveConv: (convId: number, projectId: number | null) => void
}

export default function ConversationSidebar({
  lang, convs, convId, sidebarOpen, isMobile,
  onSelect, onNew, onDelete, onRename, onClose,
  activeConvIds, projects, activeProjectId,
  onProjectSelect, onProjectCreate, onProjectDelete, onProjectRename, onProjectSystemPrompt,
  onMoveConv,
}: Props) {
  const [appVersion, setAppVersion] = useState("")
  useEffect(() => {
    (window as any).nexus?.app?.getVersion?.().then(setAppVersion).catch(() => {})
  }, [])
  const [search, setSearch] = useState("")
  const [editingConvId, setEditingConvId] = useState<number | null>(null)
  const [editConvValue, setEditConvValue] = useState("")
  const [moveMenuId, setMoveMenuId] = useState<number | null>(null)
  const [editingProjId, setEditingProjId] = useState<number | null>(null)
  const [editProjValue, setEditProjValue] = useState("")
  const [projectsOpen, setProjectsOpen] = useState(true)
  const [creatingProject, setCreatingProject] = useState(false)
  const [newProjName, setNewProjName] = useState("")
  const convInputRef = useRef<HTMLInputElement>(null)
  const projInputRef = useRef<HTMLInputElement>(null)
  const newProjInputRef = useRef<HTMLInputElement>(null)

  if (isMobile && !sidebarOpen) return null

  const filteredConvs = (() => {
    const byProject = activeProjectId
      ? convs.filter(c => c.project_id === activeProjectId)
      : convs
    return search.trim()
      ? byProject.filter(c => c.title.toLowerCase().includes(search.toLowerCase()))
      : byProject
  })()

  const startEditConv = (id: number, title: string) => {
    setEditingConvId(id); setEditConvValue(title)
    setTimeout(() => convInputRef.current?.select(), 30)
  }
  const commitEditConv = (id: number) => {
    const trimmed = editConvValue.trim()
    if (trimmed && trimmed !== convs.find(c => c.id === id)?.title) onRename(id, trimmed)
    setEditingConvId(null)
  }

  const startEditProj = (id: number, name: string) => {
    setEditingProjId(id); setEditProjValue(name)
    setTimeout(() => projInputRef.current?.select(), 30)
  }
  const commitEditProj = (id: number) => {
    const trimmed = editProjValue.trim()
    if (trimmed && trimmed !== projects.find(p => p.id === id)?.name) onProjectRename(id, trimmed)
    setEditingProjId(null)
  }

  const submitNewProject = () => {
    const name = newProjName.trim()
    if (name) { onProjectCreate(name); setNewProjName("") }
    setCreatingProject(false)
  }

  const content = (
    <>
      {/* Projects section */}
      <div className="border-b border-border/60">
        {/* A <div> here, not a <button> — the "+" below is a real button
            nested inside it, and a button can't contain another button
            (invalid HTML, triggers a React hydration warning). Same
            div-row + button-actions pattern as the per-project rows below. */}
        <div
          onClick={() => setProjectsOpen(p => !p)}
          className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          {projectsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="uppercase tracking-wide">{lang === "pt" ? "Projectos" : "Projects"}</span>
          <button
            onClick={(e) => { e.stopPropagation(); setCreatingProject(true); setProjectsOpen(true); setTimeout(() => newProjInputRef.current?.focus(), 50) }}
            className="ml-auto p-0.5 rounded hover:bg-accent hover:text-foreground transition-colors"
            title={lang === "pt" ? "Novo projecto" : "New project"}>
            <Plus size={12} />
          </button>
        </div>

        {projectsOpen && (
          <div className="px-2 pb-2 space-y-0.5">
            {/* "All" item */}
            <button
              onClick={() => onProjectSelect(null)}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${activeProjectId === null ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}>
              <Folder size={13} className="shrink-0" />
              <span className="flex-1 text-left truncate">{lang === "pt" ? "Todas as convs" : "All conversations"}</span>
            </button>

            {projects.map(p => (
              <div key={p.id}
                className={`group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${activeProjectId === p.id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}
                onClick={() => { if (editingProjId !== p.id) onProjectSelect(p.id) }}>
                {activeProjectId === p.id ? <FolderOpen size={13} className="shrink-0" /> : <Folder size={13} className="shrink-0" />}
                {editingProjId === p.id ? (
                  <input
                    ref={projInputRef}
                    value={editProjValue}
                    onChange={e => setEditProjValue(e.target.value)}
                    onBlur={() => commitEditProj(p.id)}
                    onKeyDown={e => { if (e.key === "Enter") commitEditProj(p.id); if (e.key === "Escape") setEditingProjId(null) }}
                    onClick={e => e.stopPropagation()}
                    className="flex-1 bg-transparent text-foreground text-xs outline-none border-b border-primary/50 min-w-0"
                  />
                ) : (
                  <span className="flex-1 truncate">{p.name}</span>
                )}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={(e) => { e.stopPropagation(); onProjectSystemPrompt(p.id) }}
                    className="p-0.5 rounded hover:bg-background/50 text-muted-foreground hover:text-foreground transition-colors"
                    title={lang === "pt" ? "Instruções do projecto" : "Project instructions"}>
                    <FileText size={10} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); startEditProj(p.id, p.name) }}
                    className="p-0.5 rounded hover:bg-background/50 text-muted-foreground hover:text-foreground transition-colors"
                    title={lang === "pt" ? "Renomear" : "Rename"}>
                    <Pencil size={10} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onProjectDelete(p.id) }}
                    className="p-0.5 rounded hover:bg-background/50 text-muted-foreground hover:text-destructive transition-colors">
                    <X size={11} />
                  </button>
                </div>
                {convs.filter(c => c.project_id === p.id).some(c => activeConvIds?.has(c.id)) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 animate-pulse" />
                )}
              </div>
            ))}

            {creatingProject && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-accent/50 border border-primary/30">
                <Folder size={13} className="shrink-0 text-muted-foreground" />
                <input
                  ref={newProjInputRef}
                  value={newProjName}
                  onChange={e => setNewProjName(e.target.value)}
                  onBlur={submitNewProject}
                  onKeyDown={e => { if (e.key === "Enter") submitNewProject(); if (e.key === "Escape") { setCreatingProject(false); setNewProjName("") } }}
                  placeholder={lang === "pt" ? "Nome do projecto" : "Project name"}
                  className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 outline-none min-w-0"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Conversations section */}
      <div className="px-3 py-2 border-b border-border flex flex-col gap-2">
        <button onClick={() => { onNew(); if (isMobile) onClose() }}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-full text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          <Plus size={16} />
          <span>{t(lang, "newConversation")}</span>
          {activeProjectId !== null && (
            <span className="ml-auto text-[10px] text-primary/60 truncate max-w-[80px]">
              {projects.find(p => p.id === activeProjectId)?.name}
            </span>
          )}
        </button>
        {convs.length > 4 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/40 border border-border/50">
            <Search size={13} className="text-muted-foreground/60 shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t(lang, "searchConversations")}
              className="bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 outline-none w-full"
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-muted-foreground/40 hover:text-muted-foreground">
                <X size={11} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredConvs.length === 0 && (
          <p className="text-muted-foreground/50 text-center py-8 text-xs">
            {search ? t(lang, "noConversationsFound") : t(lang, "noConversations")}
          </p>
        )}
        {filteredConvs.map((c) => {
          const projName = !activeProjectId && c.project_id
            ? projects.find(p => p.id === c.project_id)?.name
            : undefined
          return (
            <div key={c.id} className="relative">
              <div
                className={`group flex items-center gap-1 px-3 py-1.5 rounded-full text-sm cursor-pointer transition-colors ${c.id === convId ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}
                onClick={() => { if (editingConvId !== c.id) { onSelect(c.id); if (isMobile) onClose(); setMoveMenuId(null) } }}>
                {editingConvId === c.id ? (
                  <input
                    ref={convInputRef}
                    value={editConvValue}
                    onChange={e => setEditConvValue(e.target.value)}
                    onBlur={() => commitEditConv(c.id)}
                    onKeyDown={e => { if (e.key === "Enter") commitEditConv(c.id); if (e.key === "Escape") setEditingConvId(null) }}
                    onClick={e => e.stopPropagation()}
                    className="flex-1 bg-transparent text-foreground text-sm outline-none border-b border-primary/50 min-w-0"
                  />
                ) : (
                  <span className="flex-1 truncate">{c.title}</span>
                )}
                {projName && (
                  <span className="text-[9px] text-primary/50 truncate max-w-[52px] shrink-0 leading-none">{projName}</span>
                )}
                {projects.length > 0 && (
                  <button onClick={(e) => { e.stopPropagation(); setMoveMenuId(moveMenuId === c.id ? null : c.id) }}
                    className={`${isMobile ? "opacity-30" : "opacity-0 group-hover:opacity-100"} hover:!opacity-100 text-muted-foreground hover:text-foreground transition-all p-0.5 shrink-0`}
                    title={lang === "pt" ? "Mover para projecto" : "Move to project"}>
                    <FolderOpen size={12} />
                  </button>
                )}
                <button onClick={(e) => { e.stopPropagation(); startEditConv(c.id, c.title) }}
                  className={`${isMobile ? "opacity-30" : "opacity-0 group-hover:opacity-100"} hover:!opacity-100 text-muted-foreground hover:text-foreground transition-all p-0.5 shrink-0`}>
                  <Pencil size={12} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); onDelete(c.id) }}
                  className={`${isMobile ? "opacity-50" : "opacity-0 group-hover:opacity-100"} hover:!opacity-100 text-muted-foreground hover:text-destructive transition-all p-0.5 shrink-0`}>
                  <X size={14} />
                </button>
                {activeConvIds?.has(c.id) && c.id !== convId && (
                  <span className="w-2 h-2 rounded-full bg-primary shrink-0 animate-pulse" title={lang === "pt" ? "A trabalhar…" : "Working…"} />
                )}
              </div>

              {moveMenuId === c.id && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMoveMenuId(null)} />
                  <div className="absolute left-2 right-2 z-20 mt-0.5 bg-card border border-border rounded-xl shadow-xl overflow-hidden">
                    <p className="px-3 pt-2 pb-1 text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                      {lang === "pt" ? "Mover para" : "Move to"}
                    </p>
                    <button
                      onClick={() => { onMoveConv(c.id, null); setMoveMenuId(null) }}
                      className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors ${!c.project_id ? "text-primary font-medium" : "text-foreground"}`}>
                      <Folder size={11} />
                      {lang === "pt" ? "Sem projecto" : "No project"}
                    </button>
                    {projects.map(p => (
                      <button key={p.id}
                        onClick={() => { onMoveConv(c.id, p.id); setMoveMenuId(null) }}
                        className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors ${c.project_id === p.id ? "text-primary font-medium" : "text-foreground"}`}>
                        <Folder size={11} />
                        {p.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      {appVersion && (
        <div className="shrink-0 px-3 py-2 border-t border-border/60 text-[10px] text-muted-foreground/60 select-none">
          DaazNexus Desktop v{appVersion}
        </div>
      )}
    </>
  )

  if (isMobile) {
    return (
      <>
        <div className="fixed inset-0 bg-black/60 z-30" onClick={onClose} />
        <div className="fixed inset-y-0 left-0 z-40 w-64 bg-card flex flex-col">{content}</div>
      </>
    )
  }

  return (
    <div className={`${sidebarOpen ? "w-64" : "w-0 overflow-hidden"} bg-card border-r border-border flex flex-col shrink-0 self-stretch transition-all duration-200`}>
      {content}
    </div>
  )
}
