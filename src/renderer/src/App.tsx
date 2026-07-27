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

  const handlePermission = (req: PermissionRequest, granted: boolean) => {
    const nexus = (window as any).nexus
    nexus?.permissions?.respond?.(req.id, granted)
    setPermReq(null)
  }

  const permModal = permReq ? (
    <PermissionModal reqs={[permReq]} onRespond={handlePermission} />
  ) : null

  if (page === "settings") return (
    <>
      {permModal}
      <SettingsPage lang={lang} themeColor={themeColor} setThemeColor={setThemeColor} onNavigate={setPage} />
    </>
  )

  if (page === "analytics") return (
    <>
      {permModal}
      <AnalyticsPage onNavigate={setPage} lang={lang} />
    </>
  )

  if (page === "memories") return (
    <>
      {permModal}
      <MemoriesPage lang={lang} onNavigate={setPage} />
    </>
  )

  if (page === "skills") return (
    <>
      {permModal}
      <SkillsPage lang={lang} onNavigate={setPage} />
    </>
  )

  if (page === "faq") return (
    <>
      {permModal}
      <FAQPage lang={lang} onNavigate={setPage} />
    </>
  )

  return (
    <ErrorBoundary>
      {/* No {permModal} here: ChatPage renders its own PermissionModal (a
          queue that supports several concurrent requests and clears itself
          on "resolved"). Showing this simpler one too meant both received
          the same request and both stayed mounted — clicking one resolved
          it on the backend, but the other lingered with stale state and,
          if clicked, sent a second (harmless but noisy) resolve for an
          already-resolved id. */}
      <ChatPage
        onNavigate={setPage}
        colorMode={colorMode}
        setColorMode={setColorMode}
        lang={lang}
        setLang={setLang}
      />
    </ErrorBoundary>
  )
}
