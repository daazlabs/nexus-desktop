import { useState, useEffect } from "react"
import { api } from "../api/client"
import type { Page } from "../constants"
import type { Lang } from "../i18n"

type Skill = { id: number; name: string; description: string; instructions: string; created_at: string }

export default function SkillsPage({ lang, onNavigate }: { lang: Lang; onNavigate: (p: Page) => void }) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [instructions, setInstructions] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    api.listSkills().then(d => { setSkills(d.skills); setLoading(false) }).catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const remove = async (id: number) => {
    await api.deleteSkill(id).catch(() => null)
    setSkills(prev => prev.filter(s => s.id !== id))
  }

  const startCreate = () => {
    setEditingId(null)
    setName(""); setDescription(""); setInstructions("")
    setError("")
    setShowForm(true)
  }

  const startEdit = (s: Skill) => {
    setEditingId(s.id)
    setName(s.name); setDescription(s.description); setInstructions(s.instructions)
    setError("")
    setShowForm(true)
  }

  const cancelForm = () => {
    setShowForm(false)
    setEditingId(null)
    setError("")
  }

  const submit = async () => {
    setError("")
    if (!name.trim() || !description.trim() || !instructions.trim()) {
      setError(lang === "pt" ? "Preenche nome, descrição e instruções." : "Fill in name, description and instructions.")
      return
    }
    setSaving(true)
    try {
      if (editingId !== null) {
        const updated = await api.updateSkill(editingId, name.trim(), description.trim(), instructions.trim())
        setSkills(prev => prev.map(s => s.id === editingId ? { ...s, ...updated } : s))
      } else {
        const created = await api.createSkill(name.trim(), description.trim(), instructions.trim())
        setSkills(prev => [{ ...created, created_at: new Date().toISOString() }, ...prev])
      }
      setName(""); setDescription(""); setInstructions(""); setShowForm(false); setEditingId(null)
    } catch (e: any) {
      setError(e?.message || (lang === "pt" ? "Não foi possível guardar." : "Could not save."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      <header className="bg-neutral-900 border-b border-neutral-800 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🛠️</span>
            <h1 className="text-white font-bold text-lg">
              {lang === "pt" ? "Minhas Skills" : "My Skills"}
            </h1>
          </div>
          <button onClick={() => onNavigate("chat")} className="text-neutral-400 hover:text-white transition-colors text-sm">
            ← {lang === "pt" ? "Voltar ao chat" : "Back to chat"}
          </button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <p className="text-neutral-400 text-sm">
          {lang === "pt"
            ? "Um skill é uma receita de instruções que ensinas ao assistente para uma tarefa que repetes muitas vezes. São só teus — privados, ninguém mais na app os vê ou usa."
            : "A skill is a recipe of instructions you teach the assistant for a task you repeat often. They're yours only — private, no one else on the app sees or uses them."}
        </p>

        {!showForm && (
          <button
            onClick={startCreate}
            className="w-full bg-violet-700 hover:bg-violet-600 text-white text-sm font-medium rounded-xl px-4 py-3 transition-colors">
            + {lang === "pt" ? "Criar novo skill" : "Create new skill"}
          </button>
        )}

        {showForm && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-3">
            <h2 className="text-white text-sm font-medium">
              {editingId !== null ? (lang === "pt" ? "Editar skill" : "Edit skill") : (lang === "pt" ? "Novo skill" : "New skill")}
            </h2>
            <div>
              <label className="text-neutral-400 text-xs block mb-1">
                {lang === "pt" ? "Nome" : "Name"}
              </label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={lang === "pt" ? "ex: resumir-emails-trabalho" : "e.g. summarize-work-emails"}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-violet-600"
              />
            </div>
            <div>
              <label className="text-neutral-400 text-xs block mb-1">
                {lang === "pt" ? "Descrição curta" : "Short description"}
              </label>
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={lang === "pt" ? "Uma frase — ajuda o assistente a saber quando usar este skill" : "One sentence — helps the assistant know when to use this skill"}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-violet-600"
              />
            </div>
            <div>
              <label className="text-neutral-400 text-xs block mb-1">
                {lang === "pt" ? "Instruções passo-a-passo" : "Step-by-step instructions"}
              </label>
              <textarea
                value={instructions}
                onChange={e => setInstructions(e.target.value)}
                rows={8}
                placeholder={lang === "pt" ? "Explica ao assistente, passo a passo, como fazer esta tarefa..." : "Explain to the assistant, step by step, how to do this task..."}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-violet-600 resize-y"
              />
            </div>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <div className="flex items-center gap-2">
              <button
                onClick={submit}
                disabled={saving}
                className="bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">
                {saving
                  ? (lang === "pt" ? "A guardar..." : "Saving...")
                  : editingId !== null ? (lang === "pt" ? "Guardar alterações" : "Save changes") : (lang === "pt" ? "Guardar skill" : "Save skill")}
              </button>
              <button
                onClick={cancelForm}
                className="text-neutral-400 hover:text-white text-sm px-4 py-2 transition-colors">
                {lang === "pt" ? "Cancelar" : "Cancel"}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <div key={i} className="h-16 bg-neutral-800/50 rounded-xl animate-pulse" />)}
          </div>
        ) : skills.length === 0 ? (
          !showForm && (
            <div className="text-center py-16 text-neutral-500">
              <div className="text-4xl mb-3">🛠️</div>
              <p className="text-sm">
                {lang === "pt" ? "Ainda sem skills pessoais. Cria o primeiro acima!" : "No personal skills yet. Create your first one above!"}
              </p>
            </div>
          )
        ) : (
          <div className="space-y-2">
            {skills.map(s => (
              <div key={s.id} className="bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 group">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-neutral-500 shrink-0">🛠️</span>
                      <span className="text-white text-sm font-medium">{s.name}</span>
                    </div>
                    <p className="text-neutral-400 text-xs mt-1">{s.description}</p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startEdit(s)}
                      className="text-neutral-500 hover:text-violet-400 transition-colors text-xs"
                      title={lang === "pt" ? "Editar" : "Edit"}>
                      {lang === "pt" ? "Editar" : "Edit"}
                    </button>
                    <button
                      onClick={() => remove(s.id)}
                      className="text-neutral-600 hover:text-red-400 transition-colors text-lg leading-none"
                      title={lang === "pt" ? "Eliminar" : "Delete"}>
                      ×
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
