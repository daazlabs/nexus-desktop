import { useState, useRef, useEffect } from "react"
import { X, ChevronDown, Search } from "lucide-react"
import type { Lang } from "../../i18n"
import { t } from "../../i18n"

const MAX_SLOTS = 2

interface Props {
  lang: Lang
  // Flat list of paid/API ("cerebro") model ids — same source ChatPage
  // already computes for "Avaliar com…" (cerebroModels, filtered by the
  // per-model `paid` flag). Unlike the web MultiModelSelector this never
  // mixes in free/local models, so there's no category grouping to show.
  cerebroModels: string[]
  compareModels: string[]
  onChange: (models: string[]) => void
}

export default function CompareModelSelector({ lang, cerebroModels, compareModels, onChange }: Props) {
  const [openSlot, setOpenSlot] = useState<number | null>(null)
  const [search, setSearch] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenSlot(null)
        setSearch("")
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const openDropdown = (slotIdx: number) => {
    if (openSlot === slotIdx) { setOpenSlot(null); setSearch("") }
    else { setOpenSlot(slotIdx); setSearch("") }
  }

  const selectModel = (slotIdx: number, modelId: string) => {
    const next = [...compareModels]
    next[slotIdx] = modelId
    onChange(next)
    setOpenSlot(null)
    setSearch("")
  }

  const removeSlot = (slotIdx: number) => {
    onChange(compareModels.filter((_, i) => i !== slotIdx))
    if (openSlot === slotIdx) { setOpenSlot(null); setSearch("") }
    else if (openSlot !== null && openSlot > slotIdx) setOpenSlot(openSlot - 1)
  }

  const addSlot = () => {
    if (compareModels.length < MAX_SLOTS) {
      onChange([...compareModels, ""])
      setOpenSlot(compareModels.length)
      setSearch("")
    }
  }

  const filteredModels = search
    ? cerebroModels.filter(m => m.toLowerCase().includes(search.toLowerCase()))
    : cerebroModels

  const filled = compareModels.filter(Boolean).length

  return (
    <div className="border-b border-border bg-card/50 px-4 py-3">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-xs text-muted-foreground font-medium">{t(lang, "compareModels")}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded-full font-mono ${filled === MAX_SLOTS ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
          {filled}/{MAX_SLOTS}
        </span>
        {compareModels.length > 0 && (
          <button onClick={() => { onChange([]); setOpenSlot(null); setSearch("") }}
            className="text-xs text-muted-foreground/60 hover:text-muted-foreground ml-auto">{t(lang, "clear")}</button>
        )}
      </div>

      <div ref={containerRef} className="flex flex-wrap items-center gap-2">
        {compareModels.map((modelId, slotIdx) => (
          <div key={slotIdx} className="relative">
            <div className="flex items-center">
              <button
                onClick={() => openDropdown(slotIdx)}
                className={`flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-l-full text-xs border transition-colors ${
                  modelId
                    ? "border-primary/50 bg-primary/10 text-foreground hover:bg-primary/15"
                    : "border-border/60 text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                }`}>
                <span className="max-w-[160px] truncate">{modelId || t(lang, "chooseModel")}</span>
                <ChevronDown size={12} className={`shrink-0 transition-transform ${openSlot === slotIdx ? "rotate-180" : ""}`} />
              </button>
              <button
                onClick={() => removeSlot(slotIdx)}
                className="flex items-center justify-center w-6 h-7 rounded-r-full border border-l-0 border-border/60 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
                <X size={11} />
              </button>
            </div>

            {openSlot === slotIdx && (
              <div className={`absolute top-full mt-1 z-50 bg-card border border-border rounded-xl shadow-xl w-64 overflow-hidden ${slotIdx > 0 ? "right-0" : "left-0"}`}>
                <div className="p-2 border-b border-border/50">
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/60">
                    <Search size={12} className="text-muted-foreground shrink-0" />
                    <input
                      autoFocus
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t(lang, "searchModel")}
                      className="bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 outline-none w-full"
                    />
                    {search && (
                      <button onClick={() => setSearch("")} className="text-muted-foreground/50 hover:text-muted-foreground">
                        <X size={11} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="max-h-56 overflow-y-auto">
                  {filteredModels.map(m => {
                    const isCurrentSlot = compareModels[slotIdx] === m
                    const usedInOther = compareModels.some((id, i) => id === m && i !== slotIdx)
                    return (
                      <button
                        key={m}
                        disabled={usedInOther}
                        onClick={() => selectModel(slotIdx, m)}
                        className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between gap-2 ${
                          isCurrentSlot
                            ? "bg-primary/15 text-foreground"
                            : usedInOther
                            ? "text-muted-foreground/25 cursor-not-allowed"
                            : "text-foreground hover:bg-accent"
                        }`}>
                        <span className="truncate">{m}</span>
                        {isCurrentSlot && <span className="text-primary shrink-0 text-[10px]">✓</span>}
                        {usedInOther && <span className="text-muted-foreground/25 shrink-0 text-[10px]">{t(lang, "inUse")}</span>}
                      </button>
                    )
                  })}
                  {filteredModels.length === 0 && (
                    <p className="px-3 py-4 text-xs text-muted-foreground text-center">{t(lang, "noModelFound")}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {compareModels.length < MAX_SLOTS && (
          <button
            onClick={addSlot}
            className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs border border-dashed border-border/60 text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-colors">
            {t(lang, "addSlot")}
          </button>
        )}

        {cerebroModels.length === 0 && (
          <p className="text-xs text-amber-400/90 flex items-center gap-1.5">
            <span>⚠</span>
            <span>{t(lang, "noModelsMulti")}</span>
          </p>
        )}
      </div>
    </div>
  )
}
