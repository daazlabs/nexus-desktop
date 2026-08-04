import { useState, useEffect, useRef } from "react"
import type { PermissionRequest } from "./types"
import type { Page } from "./constants"
import type { Lang } from "./i18n"
import { DEFAULT_THEME_COLOR, THEME_STORAGE_KEY, COLOR_MODE_KEY } from "./constants"
import ErrorBoundary from "./components/ErrorBoundary"
import ChatPage from "./pages/ChatPage"
import SettingsPage from "./pages/SettingsPage"
import AnalyticsPage from "./pages/AnalyticsPage"
import MemoriesPage from "./pages/MemoriesPage"
import SkillsPage from "./pages/SkillsPage"
import FAQPage from "./pages/FAQPage"
import PermissionModal from "./components/PermissionModal"
import { api } from "./api/client"

const LANG_KEY = "daaznexus-lang"

export default function App() {
  const [page, setPage] = useState<Page>("chat")
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem(LANG_KEY) as Lang) || "pt")
  const [themeColor, setThemeColor] = useState(() => localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME_COLOR)
  const [colorMode, setColorMode] = useState<"dark" | "light">(() => (localStorage.getItem(COLOR_MODE_KEY) as "dark" | "light") || "dark")
  const [permReq, setPermReq] = useState<PermissionRequest | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    document.documentElement.style.setProperty("--primary", themeColor)
    localStorage.setItem(THEME_STORAGE_KEY, themeColor)
  }, [themeColor])

  useEffect(() => {
    document.documentElement.classList.toggle("dark", colorMode === "dark")
    localStorage.setItem(COLOR_MODE_KEY, colorMode)
  }, [colorMode])

  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang)
  }, [lang])

  useEffect(() => {
    const nexus = (window as any).nexus
    if (nexus?.permissions?.onRequest) {
      cleanupRef.current = nexus.permissions.onRequest((data: PermissionRequest) => {
        setPermReq(data)
      })
    }
    return () => cleanupRef.current?.()
  }, [])

  // Auto-learned facts arrive from main (services/memoryExtraction.ts) after
  // any exchange, on any page — kept at this level (not inside ChatPage) so
  // it isn't tied to the chat UI being the active page. api.addMemory does
  // the dedup, so a repeated stable fact across many conversations is only
  // ever stored once.
  useEffect(() => {
    return api.onMemoriesLearned((facts) => {
      facts.forEach((fact) => { api.addMemory(fact).catch(() => null) })
    })
  }, [])

  const handlePermission = (req: PermissionRequest, granted: boolean) => {
    const nexus = (window as any).nexus
    nexus?.permissions?.respond?.(req.id, granted)
    setPermReq(null)
  }

  const permModal = permReq ? (
    <PermissionModal reqs={[permReq]} onRespond={handlePermission} />
  ) : null

  // ChatPage used to be conditionally rendered (early-return per page, like
  // the branches below) — which meant navigating to any other page unmounted
  // it, wiping activeStreamsRef/convId/messages and orphaning any in-flight
  // stream mid-response. It now stays mounted permanently and is only
  // hidden with CSS, so a response keeps streaming (and lands) even while
  // the user is looking at Settings/Analytics/etc. `display: contents` when
  // visible means the wrapper adds no box of its own, so ChatPage's own
  // `h-screen` root behaves exactly as if it were the direct child here.
  return (
    <>
      {/* No permModal here while chat is the visible page: ChatPage renders
          its own PermissionModal (a queue that supports several concurrent
          requests and clears itself on "resolved"). Showing this simpler one
          too meant both received the same request and both stayed mounted —
          clicking one resolved it on the backend, but the other lingered
          with stale state and, if clicked, sent a second (harmless but
          noisy) resolve for an already-resolved id. */}
      {page !== "chat" && permModal}
      <div style={{ display: page === "chat" ? "contents" : "none" }}>
        <ErrorBoundary>
          <ChatPage
            active={page === "chat"}
            onNavigate={setPage}
            colorMode={colorMode}
            setColorMode={setColorMode}
            lang={lang}
            setLang={setLang}
          />
        </ErrorBoundary>
      </div>
      {page === "settings" && (
        <SettingsPage lang={lang} themeColor={themeColor} setThemeColor={setThemeColor} onNavigate={setPage} />
      )}
      {page === "analytics" && <AnalyticsPage onNavigate={setPage} lang={lang} />}
      {page === "memories" && <MemoriesPage lang={lang} onNavigate={setPage} />}
      {page === "skills" && <SkillsPage lang={lang} onNavigate={setPage} />}
      {page === "faq" && <FAQPage lang={lang} onNavigate={setPage} />}
    </>
  )
}
