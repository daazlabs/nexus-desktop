import { useState, useEffect } from "react"
import { api } from "../api/client"
import type { Page } from "../constants"
import type { Lang } from "../i18n"

type Memory = { id: number; fact: string; created_at: string }

export default function MemoriesPage({ lang, onNavigate }: { lang: Lang; onNavigate: (p: Page) => void }) {
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [msg, setMsg] = useState("")
  const [adding, setAdding] = useState(false)
  const [newFact, setNewFact] = useState("")

  const load = () => {
    setLoading(true)
    api.listMemories().then(d => { setMemories(d.memories); setLoading(false) }).catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const remove = async (id: number) => {
    await api.deleteMemory(id).catch(() => null)
    setMemories(prev => prev.filter(m => m.id !== id))
  }

  const clearAll = async () => {
    await api.clearMemories().catch(() => null)
    setMemories([])
    setClearConfirm(false)
    setMsg(lang === "pt" ? "Todas as memórias eliminadas." : "All memories cleared.")
    setTimeout(() => setMsg(""), 3000)
  }

  const addMemory = async () => {
    const trimmed = newFact.trim()
    if (!trimmed) return
    const m = await api.addMemory(trimmed).catch(() => null)
    if (m) {
      setMemories(prev => [m, ...prev])
      setNewFact("")
      setAdding(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🧠</span>
            <h1 className="text-foreground font-bold text-lg">
              {lang === "pt" ? "Memórias" : "Memories"}
            </h1>
          </div>
          <button onClick={() => onNavigate("chat")} className="text-muted-foreground hover:text-foreground transition-colors text-sm">
            ← {lang === "pt" ? "Voltar ao chat" : "Back to chat"}
          </button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <p className="text-muted-foreground text-sm">
          {lang === "pt"
            ? "Factos que o assistente tem em conta em todas as conversas. Podes adicionar informação pessoal para respostas mais personalizadas."
            : "Facts the assistant keeps in mind across all conversations. Add personal information for more personalized responses."}
        </p>

        {msg && <div className="bg-secondary border border-border rounded-xl px-4 py-3 text-sm text-foreground">{msg}</div>}

        <div className="flex items-center justify-between">
          <button
            onClick={() => { setAdding(p => !p); setNewFact("") }}
            className="text-xs bg-primary/20 text-primary hover:bg-primary/30 px-3 py-1.5 rounded-full transition-colors">
            {adding ? (lang === "pt" ? "Cancelar" : "Cancel") : (lang === "pt" ? "+ Adicionar facto" : "+ Add fact")}
          </button>
        </div>

        {adding && (
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <textarea
              value={newFact}
              onChange={e => setNewFact(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addMemory() } if (e.key === "Escape") setAdding(false) }}
              placeholder={lang === "pt" ? "Ex: Prefiro respostas em português, sou developer Python..." : "Ex: I prefer concise answers, I'm a Python developer..."}
              className="w-full bg-secondary text-foreground rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary/50 resize-none"
              rows={3}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setAdding(false)} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 transition-colors">
                {lang === "pt" ? "Cancelar" : "Cancel"}
              </button>
              <button onClick={addMemory} disabled={!newFact.trim()}
                className="text-xs bg-primary text-primary-foreground rounded-full px-4 py-1.5 hover:opacity-90 disabled:opacity-40 transition-opacity">
                {lang === "pt" ? "Guardar" : "Save"}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-12 bg-secondary/50 rounded-xl animate-pulse" />)}
          </div>
        ) : memories.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <div className="text-4xl mb-3">🧠</div>
            <p className="text-sm">
              {lang === "pt" ? "Ainda sem memórias. Adiciona factos sobre ti!" : "No memories yet. Add facts about yourself!"}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs">{memories.length} {lang === "pt" ? "factos guardados" : "facts saved"}</span>
              {clearConfirm ? (
                <div className="flex items-center gap-2">
                  <span className="text-red-400 text-xs">{lang === "pt" ? "Tens a certeza?" : "Are you sure?"}</span>
                  <button onClick={clearAll} className="text-xs bg-red-700 hover:bg-red-600 text-white px-2 py-1 rounded transition-colors">
                    {lang === "pt" ? "Sim, apagar tudo" : "Yes, clear all"}
                  </button>
                  <button onClick={() => setClearConfirm(false)} className="text-xs bg-secondary hover:bg-secondary/70 text-secondary-foreground px-2 py-1 rounded transition-colors">
                    {lang === "pt" ? "Cancelar" : "Cancel"}
                  </button>
                </div>
              ) : (
                <button onClick={() => setClearConfirm(true)} className="text-xs text-red-400/60 hover:text-red-400 transition-colors">
                  {lang === "pt" ? "Apagar tudo" : "Clear all"}
                </button>
              )}
            </div>
            <div className="space-y-2">
              {memories.map(m => (
                <div key={m.id} className="bg-card border border-border rounded-xl px-4 py-3 flex items-start justify-between gap-3 group">
                  <div className="flex items-start gap-2 min-w-0">
                    <span className="text-muted-foreground mt-0.5 shrink-0">💡</span>
                    <span className="text-foreground text-sm">{m.fact}</span>
                  </div>
                  <button
                    onClick={() => remove(m.id)}
                    className="shrink-0 text-muted-foreground hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 text-lg leading-none mt-0.5"
                    title={lang === "pt" ? "Eliminar" : "Delete"}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
