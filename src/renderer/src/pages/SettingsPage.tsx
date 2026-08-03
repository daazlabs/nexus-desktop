import { useState, useEffect } from "react"
import { api } from "../api/client"
import type { CategorizedProvider } from "../types"
import type { Page } from "../constants"
import type { Lang } from "../i18n"
import { t } from "../i18n"
import { DEFAULT_THEME_COLOR } from "../constants"

type SettingsTab = "free" | "paid" | "local" | "connectors"

const SETTINGS_TABS: { key: SettingsTab; label: string; color: string }[] = [
  { key: "free", label: "FREE", color: "#34d399" },
  { key: "paid", label: "PAID", color: "#a78bfa" },
  { key: "local", label: "LOCAL", color: "#fbbf24" },
  { key: "connectors", label: "CONNECTORS", color: "#38bdf8" },
]

// Pre-fills the token's description and minimal scope so the user doesn't have
// to figure out which checkboxes to tick on GitHub's own page.
const CONNECTOR_HELP_URLS: Record<string, string> = {
  github: "https://github.com/settings/tokens/new?description=DaazNexus&scopes=repo",
  magnific: "https://freepik.com/api",
}

const PROVIDER_COLORS: Record<string, string> = {
  groq: "#f97316", openrouter: "#8b5cf6", gemini: "#4285f4", github: "#6e40c9",
  deepseek: "#06b6d4", mistral: "#ec4899", anthropic: "#d97706", openai: "#10b981",
  xai: "#e11d48", perplexity: "#0ea5e9", cohere: "#14b8a6", together: "#eab308",
  replicate: "#d946ef", huggingface: "#facc15", cerebras: "#3b82f6", nvidia: "#76b900",
  cloudflare: "#f38020", zhipu: "#8b5cf6", kilo: "#a855f7", pollinations: "#22d3ee",
  ovh: "#00a3ff", opencodezen: "#6366f1",
}

// Things the user must already have and that the app cannot install for
// them. Shown on the card *before* setup starts — finding out after a
// five-minute download that something external was missing all along is the
// worst way to learn it. New connectors with an external dependency: add an
// entry here; connectors that need nothing outside the app stay absent.
const CONNECTOR_REQUIREMENTS: Record<string, Record<Lang, string[]>> = {
  autocad: {
    pt: [
      "AutoCAD instalado no Windows e aberto quando ligares (o Nexus comanda a janela que estiver aberta).",
    ],
    en: [
      "AutoCAD installed on Windows and open when you connect (Nexus drives whichever window is open).",
    ],
  },
  // Versions per the adb-mcp README at the pinned tag v0.85.4. Premiere's UXP
  // support only exists in the Beta build — the regular release won't load
  // the plugin, which is the kind of thing that costs an hour to discover.
  photoshop: {
    pt: [
      "Creative Cloud Desktop instalado — é ele que instala o plugin (o ficheiro .ccx).",
      "Photoshop 26.0 (2025) ou mais recente, para suportar plugins UXP.",
    ],
    en: [
      "Creative Cloud Desktop installed — it's what installs the plugin (the .ccx file).",
      "Photoshop 26.0 (2025) or newer, for UXP plugin support.",
    ],
  },
  premiere: {
    pt: [
      "Creative Cloud Desktop instalado — é ele que instala o plugin (o ficheiro .ccx).",
      "Premiere Pro Beta 25.3 (build 46) ou mais recente. Tem mesmo de ser a versão Beta: a versão normal do Premiere ainda não carrega plugins UXP.",
    ],
    en: [
      "Creative Cloud Desktop installed — it's what installs the plugin (the .ccx file).",
      "Premiere Pro Beta 25.3 (build 46) or newer. It has to be the Beta build: regular Premiere doesn't load UXP plugins yet.",
    ],
  },
}

function Requirements({ lang, id }: { lang: Lang; id: string }) {
  const items = CONNECTOR_REQUIREMENTS[id]?.[lang]
  if (!items?.length) return null
  return (
    <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
      <p className="mb-1 text-xs font-medium text-foreground/80">
        {lang === "pt" ? "Precisas de ter:" : "You'll need:"}
      </p>
      <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground leading-relaxed">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  )
}

// The one-click connectors (AutoCAD, Photoshop, Premiere) download a private
// Python runtime on first connect — a few minutes and a few dozen MB. Say so
// up front, and name the folder, so nobody is surprised by the wait and
// anyone can find the files to delete them later.
function InstallInfo({ lang, what, dir }: { lang: Lang; what: string; dir: string }) {
  if (!dir) return null
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer hover:text-foreground transition-colors">
        {lang === "pt" ? "O que vai ser instalado, e onde?" : "What gets installed, and where?"}
      </summary>
      <div className="mt-2 space-y-1.5 border-l border-border pl-3 leading-relaxed">
        <p>{what}</p>
        <p>
          {lang === "pt" ? "Fica em:" : "It goes in:"}{" "}
          <code className="font-mono text-[11px] text-foreground/80 break-all">{dir}</code>
        </p>
        <p>
          {lang === "pt"
            ? "Podes apagar esta pasta quando quiseres para libertar espaço — a app volta a preparar tudo da próxima vez que ligares."
            : "You can delete that folder any time to free up space — the app sets everything up again next time you connect."}
        </p>
      </div>
    </details>
  )
}

interface Props {
  lang: Lang
  themeColor: string
  setThemeColor: (c: string) => void
  onNavigate: (p: Page) => void
}

export default function SettingsPage({ lang, themeColor, setThemeColor, onNavigate }: Props) {
  const [tab, setTab] = useState<SettingsTab>("free")
  const [categorized, setCategorized] = useState<Record<string, CategorizedProvider[]> | null>(null)
  const [configs, setConfigs] = useState<Record<string, { api_key: string; model: string; temperature: number; has_api_key: boolean }>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null)
  const [remoteUrl, setRemoteUrl] = useState("")
  const [remoteKey, setRemoteKey] = useState("")
  const [remoteSaved, setRemoteSaved] = useState<boolean | null>(null)
  const [connectors, setConnectors] = useState<{ id: string; name: string; authMethodSupported: string; status: string; available: boolean; lastError?: string }[]>([])
  const [connectorInput, setConnectorInput] = useState<Record<string, string>>({})
  const [connectorSaving, setConnectorSaving] = useState<string | null>(null)
  const [wpForm, setWpForm] = useState({ siteUrl: "", username: "", appPassword: "" })
  const [n8nForm, setN8nForm] = useState({ baseUrl: "", apiKey: "" })

  type McpServerRow = {
    id: string; command: string; args: string[]; env: Record<string, string>
    enabled: boolean; transport: "stdio" | "http"; url?: string; cwd?: string
    status: "connected" | "disconnected" | "error"; error?: string; toolCount?: number
  }
  const emptyMcpForm = { id: "", command: "", argsText: "", envText: "", transport: "stdio" as "stdio" | "http", url: "", cwd: "" }
  const [mcpServers, setMcpServers] = useState<McpServerRow[]>([])
  const [mcpForm, setMcpForm] = useState(emptyMcpForm)
  const [mcpFormOpen, setMcpFormOpen] = useState(false)
  const [mcpSaving, setMcpSaving] = useState(false)
  const [mcpError, setMcpError] = useState<string | null>(null)
  const [mcpTesting, setMcpTesting] = useState<string | null>(null)
  const [mcpTestResult, setMcpTestResult] = useState<Record<string, { ok: boolean; error?: string; toolCount?: number }>>({})

  const [autocadStatus, setAutocadStatus] = useState<{ supported: boolean; provisioned: boolean; connected: boolean; installDir: string } | null>(null)
  const [autocadInstalling, setAutocadInstalling] = useState(false)
  const [autocadProgress, setAutocadProgress] = useState<{ step: string; pct: number } | null>(null)
  const [autocadError, setAutocadError] = useState<string | null>(null)

  const [photoshopStatus, setPhotoshopStatus] = useState<{
    supported: boolean; provisioned: boolean; proxyRunning: boolean
    mcpConnected: boolean; pluginConnected: boolean; connected: boolean; installDir: string
    pluginInstallerError?: string
  } | null>(null)
  const [photoshopInstalling, setPhotoshopInstalling] = useState(false)
  const [photoshopProgress, setPhotoshopProgress] = useState<{ step: string; pct: number } | null>(null)
  const [photoshopError, setPhotoshopError] = useState<string | null>(null)
  const [photoshopDisconnecting, setPhotoshopDisconnecting] = useState(false)

  const [premiereStatus, setPremiereStatus] = useState<{
    supported: boolean; provisioned: boolean; proxyRunning: boolean
    mcpConnected: boolean; pluginConnected: boolean; connected: boolean; installDir: string
    pluginInstallerError?: string
  } | null>(null)
  const [premiereInstalling, setPremiereInstalling] = useState(false)
  const [premiereProgress, setPremiereProgress] = useState<{ step: string; pct: number } | null>(null)
  const [premiereError, setPremiereError] = useState<string | null>(null)
  const [premiereDisconnecting, setPremiereDisconnecting] = useState(false)

  const loadConnectors = () => api.listConnectors().then(setConnectors).catch(() => {})
  const loadMcpServers = () => api.listMcpServers().then(setMcpServers).catch(() => {})
  const loadAutocadStatus = () => api.getAutocadStatus().then(setAutocadStatus).catch(() => {})
  const loadPhotoshopStatus = () => api.getPhotoshopStatus().then(setPhotoshopStatus).catch(() => {})
  const loadPremiereStatus = () => api.getPremiereStatus().then(setPremiereStatus).catch(() => {})

  useEffect(() => {
    api.getProvidersCategorized().then(setCategorized).catch(() => {})
    const saved = api.getRemoteOllama()
    setRemoteUrl(saved.url)
    setRemoteKey(saved.key ? "••••••••" : "")
    loadConnectors()
    loadMcpServers()
    loadAutocadStatus()
    loadPhotoshopStatus()
    loadPremiereStatus()
  }, [])

  // Auto-detects the manual "Connect" click inside the Photoshop/Premiere
  // plugin panel — polls the cheap status handle only while everything else
  // is ready and we're actually waiting on that one remaining manual step.
  useEffect(() => {
    const awaitingPlugin =
      photoshopStatus?.provisioned && photoshopStatus?.proxyRunning &&
      photoshopStatus?.mcpConnected && !photoshopStatus?.pluginConnected
    if (!awaitingPlugin) return
    const id = setInterval(loadPhotoshopStatus, 2500)
    return () => clearInterval(id)
  }, [photoshopStatus])

  useEffect(() => {
    const awaitingPlugin =
      premiereStatus?.provisioned && premiereStatus?.proxyRunning &&
      premiereStatus?.mcpConnected && !premiereStatus?.pluginConnected
    if (!awaitingPlugin) return
    const id = setInterval(loadPremiereStatus, 2500)
    return () => clearInterval(id)
  }, [premiereStatus])

  useEffect(() => {
    if (!categorized) return
    const all = [...categorized.free, ...categorized.paid, ...categorized.local]
    all.forEach(p => {
      if (configs[p.id]) return
      api.getAgentConfig(p.id).then((cfg: any) => {
        setConfigs(prev => ({
          ...prev,
          [p.id]: {
            api_key: "",
            model: cfg.params?.model || p.models?.[0]?.id || "",
            temperature: cfg.params?.temperature ?? 0.7,
            has_api_key: cfg.has_api_key === true,
          },
        }))
      }).catch(() => {
        setConfigs(prev => ({
          ...prev,
          [p.id]: { api_key: "", model: p.models?.[0]?.id || "", temperature: 0.7, has_api_key: false },
        }))
      })
    })
  }, [categorized])

  const saveRemote = async () => {
    const keyToSave = remoteKey === "••••••••" ? api.getRemoteOllama().key : remoteKey
    await api.saveRemoteOllama(remoteUrl, keyToSave)
    setRemoteSaved(true)
    setTimeout(() => setRemoteSaved(null), 3000)
  }

  const save = async (providerId: string) => {
    setSaving(providerId)
    try {
      await api.saveAgentConfig(providerId, configs[providerId])
      const hasKey = !!configs[providerId]?.api_key || configs[providerId]?.has_api_key
      setConfigs(prev => ({ ...prev, [providerId]: { ...prev[providerId], api_key: "", has_api_key: !!hasKey } }))
      setMsg({ id: providerId, text: t(lang, "settingsSaved"), ok: true })
    } catch (err) {
      setMsg({ id: providerId, text: `Error: ${err instanceof Error ? err.message : "?"}`, ok: false })
    }
    setSaving(null)
    setTimeout(() => setMsg(null), 3000)
  }

  const providers = tab === "connectors" ? [] : (categorized?.[tab] || [])
  const tabLabel = SETTINGS_TABS.find(tb => tb.key === tab)!

  const connectToken = async (connectorId: string) => {
    const token = (connectorInput[connectorId] || "").trim()
    if (!token) return
    setConnectorSaving(connectorId)
    try {
      await api.setConnectorToken(connectorId, token)
      setConnectorInput(prev => ({ ...prev, [connectorId]: "" }))
      await loadConnectors()
    } finally {
      setConnectorSaving(null)
    }
  }

  const connectOAuth = async (connectorId: string) => {
    setConnectorSaving(connectorId)
    try {
      await api.connectConnectorOAuth(connectorId)
      await loadConnectors()
    } catch (err) {
      setMsg({ id: connectorId, text: `Error: ${err instanceof Error ? err.message : "?"}`, ok: false })
    }
    setConnectorSaving(null)
  }

  const connectWordPress = async () => {
    const { siteUrl, username, appPassword } = wpForm
    if (!siteUrl.trim() || !username.trim() || !appPassword.trim()) return
    setConnectorSaving("wordpress")
    try {
      await api.setWordPressCredentials(siteUrl, username, appPassword)
      setWpForm({ siteUrl: "", username: "", appPassword: "" })
      await loadConnectors()
    } catch (err) {
      setMsg({ id: "wordpress", text: `Error: ${err instanceof Error ? err.message : "?"}`, ok: false })
    }
    setConnectorSaving(null)
  }

  const connectN8n = async () => {
    const { baseUrl, apiKey } = n8nForm
    if (!baseUrl.trim() || !apiKey.trim()) return
    setConnectorSaving("n8n")
    try {
      await api.setN8nCredentials(baseUrl, apiKey)
      setN8nForm({ baseUrl: "", apiKey: "" })
      await loadConnectors()
    } catch (err) {
      setMsg({ id: "n8n", text: `Error: ${err instanceof Error ? err.message : "?"}`, ok: false })
    }
    setConnectorSaving(null)
  }

  const disconnectConnector = async (connectorId: string) => {
    setConnectorSaving(connectorId)
    try {
      await api.disconnectConnector(connectorId)
      await loadConnectors()
    } finally {
      setConnectorSaving(null)
    }
  }

  const autocadInstallWhat = lang === "pt"
    ? "Um Python portátil só para a app, mais as bibliotecas pywin32, mcp e pydantic — cerca de 40 MB, 1 a 3 minutos na primeira vez. Não mexe em nenhum Python que já tenhas instalado."
    : "A portable Python just for the app, plus the pywin32, mcp and pydantic libraries — about 40 MB, 1 to 3 minutes the first time. It doesn't touch any Python you already have."

  const adobeInstallWhat = (appName: string) => lang === "pt"
    ? `O gestor de Python (uv), o servidor de ligação e o plugin do ${appName} — cerca de 100 MB, 2 a 5 minutos na primeira vez. O Photoshop e o Premiere partilham os mesmos ficheiros, por isso o segundo é muito mais rápido.`
    : `The Python manager (uv), the connection server and the ${appName} plugin — about 100 MB, 2 to 5 minutes the first time. Photoshop and Premiere share the same files, so the second one is much quicker.`

  const installAutocad = () => {
    setAutocadInstalling(true)
    setAutocadError(null)
    setAutocadProgress({ step: lang === "pt" ? "A começar…" : "Starting…", pct: 0 })
    api.installAutocad(
      (p) => setAutocadProgress(p),
      async (res) => {
        setAutocadInstalling(false)
        setAutocadProgress(null)
        if (!res.ok) setAutocadError(res.error || (lang === "pt" ? "Erro desconhecido." : "Unknown error."))
        await loadAutocadStatus()
      },
    )
  }

  const installPhotoshop = () => {
    setPhotoshopInstalling(true)
    setPhotoshopError(null)
    setPhotoshopProgress({ step: lang === "pt" ? "A começar…" : "Starting…", pct: 0 })
    api.installPhotoshop(
      (p) => setPhotoshopProgress(p),
      async (res) => {
        setPhotoshopInstalling(false)
        setPhotoshopProgress(null)
        if (!res.ok) setPhotoshopError(res.error || (lang === "pt" ? "Erro desconhecido." : "Unknown error."))
        await loadPhotoshopStatus()
      },
    )
  }

  const disconnectPhotoshop = async () => {
    setPhotoshopDisconnecting(true)
    try {
      await api.disconnectPhotoshop()
      await loadPhotoshopStatus()
    } finally {
      setPhotoshopDisconnecting(false)
    }
  }

  const installPremiere = () => {
    setPremiereInstalling(true)
    setPremiereError(null)
    setPremiereProgress({ step: lang === "pt" ? "A começar…" : "Starting…", pct: 0 })
    api.installPremiere(
      (p) => setPremiereProgress(p),
      async (res) => {
        setPremiereInstalling(false)
        setPremiereProgress(null)
        if (!res.ok) setPremiereError(res.error || (lang === "pt" ? "Erro desconhecido." : "Unknown error."))
        await loadPremiereStatus()
      },
    )
  }

  const disconnectPremiere = async () => {
    setPremiereDisconnecting(true)
    try {
      await api.disconnectPremiere()
      await loadPremiereStatus()
    } finally {
      setPremiereDisconnecting(false)
    }
  }

  const parseArgs = (text: string): string[] => text.split("\n").map(l => l.trim()).filter(Boolean)
  const parseEnv = (text: string): Record<string, string> => {
    const env: Record<string, string> = {}
    for (const line of text.split("\n")) {
      const idx = line.indexOf("=")
      if (idx <= 0) continue
      env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
    return env
  }

  const openMcpForm = (preset?: Partial<typeof emptyMcpForm>) => {
    setMcpForm({ ...emptyMcpForm, ...preset })
    setMcpError(null)
    setMcpFormOpen(true)
  }

  const pickMcpFile = async () => {
    const picked = await api.pickFile()
    if (!picked) return
    setMcpForm(prev => ({ ...prev, argsText: prev.argsText ? prev.argsText : picked }))
  }

  const pickMcpCwd = async () => {
    const picked = await api.openDirPicker()
    if (!picked) return
    setMcpForm(prev => ({ ...prev, cwd: picked }))
  }

  const saveMcpServer = async () => {
    setMcpError(null)
    const id = mcpForm.id.trim()
    if (!id) { setMcpError(lang === "pt" ? "Falta o nome do servidor." : "Server name is required."); return }
    if (mcpForm.transport === "http" ? !mcpForm.url.trim() : !mcpForm.command.trim()) {
      setMcpError(lang === "pt" ? "Falta o comando (ou URL, para HTTP)." : "Missing command (or URL, for HTTP).")
      return
    }
    setMcpSaving(true)
    try {
      await api.upsertMcpServer(id, {
        command: mcpForm.command.trim(),
        args: parseArgs(mcpForm.argsText),
        env: parseEnv(mcpForm.envText),
        transport: mcpForm.transport,
        url: mcpForm.url.trim() || undefined,
        cwd: mcpForm.cwd.trim() || undefined,
        enabled: true,
      })
      setMcpFormOpen(false)
      setMcpForm(emptyMcpForm)
      await loadMcpServers()
    } catch (err) {
      setMcpError(err instanceof Error ? err.message : String(err))
    }
    setMcpSaving(false)
  }

  const toggleMcpServer = async (s: McpServerRow) => {
    await api.upsertMcpServer(s.id, { command: s.command, args: s.args, env: s.env, transport: s.transport, url: s.url, cwd: s.cwd, enabled: !s.enabled })
    await loadMcpServers()
  }

  const removeMcpServer = async (id: string) => {
    await api.removeMcpServer(id)
    setMcpTestResult(prev => { const next = { ...prev }; delete next[id]; return next })
    await loadMcpServers()
  }

  const testMcpServer = async (id: string) => {
    setMcpTesting(id)
    try {
      const res = await api.testMcpServer(id)
      setMcpTestResult(prev => ({ ...prev, [id]: { ok: res.ok, error: res.error, toolCount: res.tools?.length } }))
      await loadMcpServers()
    } finally {
      setMcpTesting(null)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <h1 className="text-foreground font-bold text-lg">{t(lang, "settingsTitle")}</h1>
          <button onClick={() => onNavigate("chat")} className="text-muted-foreground hover:text-foreground transition-colors text-sm">{t(lang, "settingsBack")}</button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 pt-6">
        <div className="bg-card border border-primary/30 rounded-xl p-5 border-l-4 border-l-primary">
          <h2 className="text-foreground font-bold text-lg mb-1">{t(lang, "settingsTitle")}</h2>
          <p className="text-muted-foreground text-sm">{lang === "pt" ? "Adiciona as tuas API Keys para cada provider. As chaves são encriptadas e guardadas localmente." : "Add your API keys for each provider. Keys are encrypted and stored locally."}</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-3">
        <div className="flex gap-1 bg-card rounded-xl p-1 border border-border">
          {SETTINGS_TABS.map(tb => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              className={`flex-1 py-2 rounded-lg font-medium transition-all ${tab === tb.key ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              style={tab === tb.key ? { color: tb.color } : undefined}>
              {tb.label}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground/60 mt-2 mb-1 text-xs">
          {tabLabel.key === "free" ? t(lang, "settingsFreeDesc")
            : tabLabel.key === "paid" ? t(lang, "settingsPaidDesc")
            : tabLabel.key === "local" ? t(lang, "settingsLocalDesc")
            : (lang === "pt"
                ? "Liga as tuas próprias contas externas (GitHub, Google Drive, Gmail, WordPress, n8n) para o assistente as poder usar em modo BUILD. Cada conector usa a tua própria conta — nada é partilhado com outros utilizadores."
                : "Link your own external accounts (GitHub, Google Drive, Gmail, WordPress, n8n) so the assistant can use them in BUILD mode. Each connector uses your own account — nothing is shared with other users.")}
        </p>
        {tab === "connectors" && (
          <button onClick={() => onNavigate("faq")} className="text-primary hover:text-primary/80 text-xs mb-4 inline-block transition-colors">
            {lang === "pt" ? "Ver FAQ →" : "See FAQ →"}
          </button>
        )}
      </div>

      {tab === "connectors" && (
        <div className="max-w-3xl mx-auto p-4 space-y-3">
          {connectors.map(c => {
            const connected = c.status === "connected"
            return (
              <div key={c.id} className={`bg-card border rounded-xl p-4 transition-colors ${connected ? "border-green-700/40 border-l-4 border-l-green-500" : "border-border"}`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="font-medium text-sm text-foreground">{c.name}</span>
                  {connected
                    ? <span className="inline-flex items-center gap-1 bg-green-500/15 text-green-400 border border-green-500/30 rounded-full px-2.5 py-0.5 text-xs font-medium">{lang === "pt" ? "Ligado" : "Connected"}</span>
                    : <span className="text-xs text-muted-foreground">{lang === "pt" ? "Desligado" : "Disconnected"}</span>}
                </div>
                {c.lastError && (
                  <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
                    <p className="text-xs font-medium text-red-400">
                      {lang === "pt"
                        ? "O servidor deste conector não arrancou — as suas ferramentas não estão disponíveis no chat."
                        : "This connector's server failed to start — its tools aren't available in the chat."}
                    </p>
                    <p className="mt-1 text-xs text-red-400/80 break-words">{c.lastError}</p>
                  </div>
                )}
                {connected ? (
                  <button
                    onClick={() => disconnectConnector(c.id)}
                    disabled={connectorSaving === c.id}
                    className="text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50">
                    {lang === "pt" ? "Desligar" : "Disconnect"}
                  </button>
                ) : c.id === "wordpress" ? (
                  <div className="space-y-2">
                    <input
                      className="w-full rounded-lg px-3 py-2 border border-border bg-input/30 text-foreground text-sm outline-none font-mono"
                      type="url"
                      value={wpForm.siteUrl}
                      onChange={e => setWpForm(prev => ({ ...prev, siteUrl: e.target.value }))}
                      placeholder={lang === "pt" ? "URL do site (ex: https://oteusite.com)" : "Site URL (e.g. https://yoursite.com)"}
                    />
                    <input
                      className="w-full rounded-lg px-3 py-2 border border-border bg-input/30 text-foreground text-sm outline-none"
                      type="text"
                      value={wpForm.username}
                      onChange={e => setWpForm(prev => ({ ...prev, username: e.target.value }))}
                      placeholder={lang === "pt" ? "O teu utilizador WordPress" : "Your WordPress username"}
                    />
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-muted-foreground">Application Password</label>
                      <a href={wpForm.siteUrl ? `${wpForm.siteUrl.replace(/\/+$/, '')}/wp-admin/profile.php` : undefined}
                        target="_blank" rel="noopener noreferrer"
                        className={`inline-flex items-center gap-1 text-xs transition-colors ${wpForm.siteUrl ? "text-primary hover:text-primary/80" : "text-muted-foreground/40 pointer-events-none"}`}>
                        {lang === "pt" ? "Criar Application Password" : "Create Application Password"} ↗
                      </a>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        className="flex-1 rounded-lg px-3 py-2 border border-border bg-input/30 text-foreground text-sm outline-none font-mono"
                        type="password"
                        value={wpForm.appPassword}
                        onChange={e => setWpForm(prev => ({ ...prev, appPassword: e.target.value }))}
                        placeholder={lang === "pt" ? "Cola a Application Password gerada" : "Paste the generated Application Password"}
                      />
                      <button
                        onClick={connectWordPress}
                        disabled={connectorSaving === "wordpress" || !wpForm.siteUrl.trim() || !wpForm.username.trim() || !wpForm.appPassword.trim()}
                        className="bg-primary text-primary-foreground rounded-full px-4 py-2 font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap">
                        {lang === "pt" ? "Ligar" : "Connect"}
                      </button>
                    </div>
                  </div>
                ) : c.id === "n8n" ? (
                  <div className="space-y-2">
                    <input
                      className="w-full rounded-lg px-3 py-2 border border-border bg-input/30 text-foreground text-sm outline-none font-mono"
                      type="url"
                      value={n8nForm.baseUrl}
                      onChange={e => setN8nForm(prev => ({ ...prev, baseUrl: e.target.value }))}
                      placeholder={lang === "pt" ? "URL da instância (ex: http://localhost:5678)" : "Instance URL (e.g. http://localhost:5678)"}
                    />
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-muted-foreground">API Key</label>
                      <span className="text-xs text-muted-foreground/60">
                        {lang === "pt" ? "Definições → n8n API, na tua instância" : "Settings → n8n API, on your instance"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        className="flex-1 rounded-lg px-3 py-2 border border-border bg-input/30 text-foreground text-sm outline-none font-mono"
                        type="password"
                        value={n8nForm.apiKey}
                        onChange={e => setN8nForm(prev => ({ ...prev, apiKey: e.target.value }))}
                        placeholder={lang === "pt" ? "Cola a API key gerada" : "Paste the generated API key"}
                      />
                      <button
                        onClick={connectN8n}
                        disabled={connectorSaving === "n8n" || !n8nForm.baseUrl.trim() || !n8nForm.apiKey.trim()}
                        className="bg-primary text-primary-foreground rounded-full px-4 py-2 font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap">
                        {lang === "pt" ? "Ligar" : "Connect"}
                      </button>
                    </div>
                  </div>
                ) : c.authMethodSupported === "oauth" ? (
                  !c.available ? (
                    <p className="text-xs text-muted-foreground">
                      {lang === "pt"
                        ? `Ainda não configurado (falta o Desktop Client ID de ${c.name}).`
                        : `Not configured yet (missing ${c.name} Desktop Client ID).`}
                    </p>
                  ) : (
                    <button
                      onClick={() => connectOAuth(c.id)}
                      disabled={connectorSaving === c.id}
                      className="bg-primary text-primary-foreground rounded-full px-4 py-2 font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity">
                      {lang === "pt" ? `Ligar com ${c.name}` : `Connect with ${c.name}`}
                    </button>
                  )
                ) : (
                  <div>
                    {CONNECTOR_HELP_URLS[c.id] && (
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-muted-foreground">{lang === "pt" ? "Personal Access Token" : "Personal Access Token"}</label>
                        <a href={CONNECTOR_HELP_URLS[c.id]} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:text-primary/80 text-xs transition-colors">
                          {lang === "pt" ? `Criar token em ${c.name}` : `Create token on ${c.name}`} ↗
                        </a>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        className="flex-1 rounded-lg px-3 py-2 border border-border bg-input/30 text-foreground text-sm outline-none font-mono"
                        type="password"
                        value={connectorInput[c.id] || ""}
                        onChange={e => setConnectorInput(prev => ({ ...prev, [c.id]: e.target.value }))}
                        placeholder={lang === "pt" ? "Cola o teu Personal Access Token" : "Paste your Personal Access Token"}
                      />
                      <button
                        onClick={() => connectToken(c.id)}
                        disabled={connectorSaving === c.id || !(connectorInput[c.id] || "").trim()}
                        className="bg-primary text-primary-foreground rounded-full px-4 py-2 font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap">
                        {lang === "pt" ? "Ligar" : "Connect"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          <div className={`bg-card border rounded-xl p-4 transition-colors ${autocadStatus?.connected ? "border-green-700/40 border-l-4 border-l-green-500" : "border-border"}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="font-medium text-sm text-foreground">AutoCAD</span>
              {autocadStatus?.connected
                ? <span className="inline-flex items-center gap-1 bg-green-500/15 text-green-400 border border-green-500/30 rounded-full px-2.5 py-0.5 text-xs font-medium">{lang === "pt" ? "Ligado" : "Connected"}</span>
                : <span className="text-xs text-muted-foreground">{lang === "pt" ? "Desligado" : "Disconnected"}</span>}
            </div>
            {!autocadStatus?.supported ? (
              <p className="text-xs text-muted-foreground">
                {lang === "pt"
                  ? "Só disponível no Windows — o AutoCAD é controlado via COM, uma tecnologia que não existe no macOS/Linux."
                  : "Windows only — AutoCAD is controlled via COM automation, which doesn't exist on macOS/Linux."}
              </p>
            ) : autocadStatus?.connected ? (
              <div className="space-y-2">
                <button
                  onClick={() => disconnectConnector("autocad")}
                  disabled={connectorSaving === "autocad"}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50">
                  {lang === "pt" ? "Desligar" : "Disconnect"}
                </button>
                <InstallInfo lang={lang} what={autocadInstallWhat} dir={autocadStatus.installDir} />
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {lang === "pt"
                    ? "Abre o AutoCAD e clica em Ligar. Na primeira vez demora um pouco (a app prepara tudo sozinha) — nada para instalar ou configurar à mão."
                    : "Open AutoCAD, then click Connect. The first time takes a little while (the app sets everything up on its own) — nothing to install or configure by hand."}
                </p>
                <Requirements lang={lang} id="autocad" />
                <InstallInfo lang={lang} what={autocadInstallWhat} dir={autocadStatus?.installDir ?? ""} />
                <button
                  onClick={installAutocad}
                  disabled={autocadInstalling}
                  className="bg-primary text-primary-foreground rounded-full px-4 py-2 font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity">
                  {autocadInstalling ? (lang === "pt" ? "A ligar…" : "Connecting…") : (lang === "pt" ? "Ligar AutoCAD" : "Connect AutoCAD")}
                </button>
                {autocadProgress && (
                  <div className="space-y-1">
                    <div className="h-1.5 bg-border rounded-full overflow-hidden">
                      <div className="h-full bg-primary transition-all" style={{ width: `${autocadProgress.pct}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground">{autocadProgress.step}</p>
                  </div>
                )}
                {autocadError && <p className="text-xs text-red-400">{autocadError}</p>}
              </div>
            )}
          </div>

          <div className={`bg-card border rounded-xl p-4 transition-colors ${photoshopStatus?.connected ? "border-green-700/40 border-l-4 border-l-green-500" : "border-border"}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="font-medium text-sm text-foreground">Photoshop</span>
              {photoshopStatus?.connected
                ? <span className="inline-flex items-center gap-1 bg-green-500/15 text-green-400 border border-green-500/30 rounded-full px-2.5 py-0.5 text-xs font-medium">{lang === "pt" ? "Ligado" : "Connected"}</span>
                : <span className="text-xs text-muted-foreground">{lang === "pt" ? "Desligado" : "Disconnected"}</span>}
            </div>
            {!photoshopStatus?.supported ? (
              <p className="text-xs text-muted-foreground">
                {lang === "pt"
                  ? "Só disponível no macOS e Windows (64-bit)."
                  : "macOS and Windows (64-bit) only."}
              </p>
            ) : photoshopStatus?.connected ? (
              <div className="space-y-2">
                <button
                  onClick={disconnectPhotoshop}
                  disabled={photoshopDisconnecting}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50">
                  {lang === "pt" ? "Desligar" : "Disconnect"}
                </button>
                <InstallInfo lang={lang} what={adobeInstallWhat("Photoshop")} dir={photoshopStatus.installDir} />
              </div>
            ) : photoshopInstalling ? (
              <div className="space-y-2">
                <button
                  disabled
                  className="bg-primary text-primary-foreground rounded-full px-4 py-2 font-medium text-sm opacity-50">
                  {lang === "pt" ? "A ligar…" : "Connecting…"}
                </button>
                {photoshopProgress && (
                  <div className="space-y-1">
                    <div className="h-1.5 bg-border rounded-full overflow-hidden">
                      <div className="h-full bg-primary transition-all" style={{ width: `${photoshopProgress.pct}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground">{photoshopProgress.step}</p>
                  </div>
                )}
                <InstallInfo lang={lang} what={adobeInstallWhat("Photoshop")} dir={photoshopStatus?.installDir ?? ""} />
                {photoshopError && <p className="text-xs text-red-400">{photoshopError}</p>}
              </div>
            ) : photoshopStatus?.provisioned && photoshopStatus?.proxyRunning && photoshopStatus?.mcpConnected ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {lang === "pt"
                    ? "✓ Photoshop MCP pronto. Abre o Photoshop → menu Plugins → Photoshop MCP Agent → clica Connect no painel."
                    : "✓ Photoshop MCP ready. Open Photoshop → Plugins menu → Photoshop MCP Agent → click Connect in the panel."}
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                  {lang === "pt" ? "A verificar a ligação…" : "Checking connection…"}
                </div>
                {photoshopStatus?.pluginInstallerError && (
                  <p className="text-xs text-amber-400 leading-relaxed">
                    {lang === "pt"
                      ? "O instalador do plugin não chegou a abrir. Isso costuma querer dizer que falta o Creative Cloud Desktop, que é quem abre ficheiros .ccx — instala-o, ou abre o ficheiro à mão pelo link abaixo."
                      : "The plugin installer never opened. That usually means Creative Cloud Desktop is missing — it's what opens .ccx files. Install it, or open the file by hand with the link below."}
                  </p>
                )}
                <button
                  onClick={() => api.showPhotoshopInstaller()}
                  className="text-xs text-muted-foreground underline hover:text-foreground transition-colors">
                  {lang === "pt" ? "Não abriu o instalador do plugin? Mostra o ficheiro" : "Plugin installer didn't open? Show the file"}
                </button>
                {photoshopError && <p className="text-xs text-red-400">{photoshopError}</p>}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {lang === "pt"
                    ? "A app prepara tudo sozinha (Python, proxy). No fim abre-se o instalador do plugin — só falta abrir o Photoshop e clicar Connect no painel; detectamos a ligação automaticamente."
                    : "The app sets everything up on its own (Python, proxy). At the end the plugin installer opens — just open Photoshop and click Connect in the panel; we detect the connection automatically."}
                </p>
                <Requirements lang={lang} id="photoshop" />
                <InstallInfo lang={lang} what={adobeInstallWhat("Photoshop")} dir={photoshopStatus?.installDir ?? ""} />
                <button
                  onClick={installPhotoshop}
                  disabled={photoshopInstalling}
                  className="bg-primary text-primary-foreground rounded-full px-4 py-2 font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity">
                  {lang === "pt" ? "Ligar Photoshop" : "Connect Photoshop"}
                </button>
                {photoshopError && <p className="text-xs text-red-400">{photoshopError}</p>}
              </div>
            )}
          </div>

          <div className={`bg-card border rounded-xl p-4 transition-colors ${premiereStatus?.connected ? "border-green-700/40 border-l-4 border-l-green-500" : "border-border"}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="font-medium text-sm text-foreground">Premiere Pro</span>
              {premiereStatus?.connected
                ? <span className="inline-flex items-center gap-1 bg-green-500/15 text-green-400 border border-green-500/30 rounded-full px-2.5 py-0.5 text-xs font-medium">{lang === "pt" ? "Ligado" : "Connected"}</span>
                : <span className="text-xs text-muted-foreground">{lang === "pt" ? "Desligado" : "Disconnected"}</span>}
            </div>
            {!premiereStatus?.supported ? (
              <p className="text-xs text-muted-foreground">
                {lang === "pt"
                  ? "Só disponível no macOS e Windows (64-bit)."
                  : "macOS and Windows (64-bit) only."}
              </p>
            ) : premiereStatus?.connected ? (
              <div className="space-y-2">
                <button
                  onClick={disconnectPremiere}
                  disabled={premiereDisconnecting}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50">
                  {lang === "pt" ? "Desligar" : "Disconnect"}
                </button>
                <InstallInfo lang={lang} what={adobeInstallWhat("Premiere Pro")} dir={premiereStatus.installDir} />
              </div>
            ) : premiereInstalling ? (
              <div className="space-y-2">
                <button
                  disabled
                  className="bg-primary text-primary-foreground rounded-full px-4 py-2 font-medium text-sm opacity-50">
                  {lang === "pt" ? "A ligar…" : "Connecting…"}
                </button>
                {premiereProgress && (
                  <div className="space-y-1">
                    <div className="h-1.5 bg-border rounded-full overflow-hidden">
                      <div className="h-full bg-primary transition-all" style={{ width: `${premiereProgress.pct}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground">{premiereProgress.step}</p>
                  </div>
                )}
                <InstallInfo lang={lang} what={adobeInstallWhat("Premiere Pro")} dir={premiereStatus?.installDir ?? ""} />
                {premiereError && <p className="text-xs text-red-400">{premiereError}</p>}
              </div>
            ) : premiereStatus?.provisioned && premiereStatus?.proxyRunning && premiereStatus?.mcpConnected ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {lang === "pt"
                    ? "✓ Premiere MCP pronto. Abre o Premiere → menu Window → UXP Plugins → Premiere MCP Agent → clica Connect no painel."
                    : "✓ Premiere MCP ready. Open Premiere → Window menu → UXP Plugins → Premiere MCP Agent → click Connect in the panel."}
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                  {lang === "pt" ? "A verificar a ligação…" : "Checking connection…"}
                </div>
                {premiereStatus?.pluginInstallerError && (
                  <p className="text-xs text-amber-400 leading-relaxed">
                    {lang === "pt"
                      ? "O instalador do plugin não chegou a abrir. Isso costuma querer dizer que falta o Creative Cloud Desktop, que é quem abre ficheiros .ccx — instala-o, ou abre o ficheiro à mão pelo link abaixo."
                      : "The plugin installer never opened. That usually means Creative Cloud Desktop is missing — it's what opens .ccx files. Install it, or open the file by hand with the link below."}
                  </p>
                )}
                <button
                  onClick={() => api.showPremiereInstaller()}
                  className="text-xs text-muted-foreground underline hover:text-foreground transition-colors">
                  {lang === "pt" ? "Não abriu o instalador do plugin? Mostra o ficheiro" : "Plugin installer didn't open? Show the file"}
                </button>
                {premiereError && <p className="text-xs text-red-400">{premiereError}</p>}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {lang === "pt"
                    ? "A app prepara tudo sozinha (Python, proxy). No fim abre-se o instalador do plugin — só falta abrir o Premiere e clicar Connect no painel; detectamos a ligação automaticamente."
                    : "The app sets everything up on its own (Python, proxy). At the end the plugin installer opens — just open Premiere and click Connect in the panel; we detect the connection automatically."}
                </p>
                <Requirements lang={lang} id="premiere" />
                <InstallInfo lang={lang} what={adobeInstallWhat("Premiere Pro")} dir={premiereStatus?.installDir ?? ""} />
                <button
                  onClick={installPremiere}
                  disabled={premiereInstalling}
                  className="bg-primary text-primary-foreground rounded-full px-4 py-2 font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity">
                  {lang === "pt" ? "Ligar Premiere" : "Connect Premiere"}
                </button>
                {premiereError && <p className="text-xs text-red-400">{premiereError}</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "connectors" && (
        <div className="max-w-3xl mx-auto px-4 pb-2">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
              <h3 className="text-foreground font-medium text-sm">{lang === "pt" ? "Servidores MCP" : "MCP Servers"}</h3>
              <div className="flex items-center gap-2">
                <button onClick={() => mcpFormOpen ? setMcpFormOpen(false) : openMcpForm()}
                  className="text-xs border border-border text-muted-foreground hover:text-foreground rounded-full px-3 py-1 transition-colors">
                  {mcpFormOpen ? (lang === "pt" ? "Cancelar" : "Cancel") : (lang === "pt" ? "+ Servidor" : "+ Server")}
                </button>
              </div>
            </div>
            <p className="text-muted-foreground text-xs mb-3 leading-relaxed">
              {lang === "pt"
                ? "Liga qualquer servidor MCP local (stdio) ou remoto (HTTP) — por exemplo um servidor MCP para AutoCAD instalado neste computador. As ferramentas ficam disponíveis para o assistente em modo BUILD, com o mesmo pedido de permissão usado para bash/ficheiros. Só adiciones servidores em que confies: o comando corre com acesso real à tua máquina."
                : "Connect any local (stdio) or remote (HTTP) MCP server — for example an AutoCAD MCP server installed on this computer. Its tools become available to the assistant in BUILD mode, gated by the same permission prompt used for bash/files. Only add servers you trust: the command runs with real access to your machine."}
            </p>

            {mcpFormOpen && (
              <div className="bg-background/40 border border-border rounded-lg p-3 mb-3 space-y-2">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">{lang === "pt" ? "Nome (identificador único)" : "Name (unique id)"}</label>
                  <input
                    className="w-full rounded-lg px-3 py-2 border border-border bg-input/30 text-foreground text-sm outline-none font-mono"
                    value={mcpForm.id}
                    onChange={e => setMcpForm(prev => ({ ...prev, id: e.target.value }))}
                    placeholder="autocad"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">{lang === "pt" ? "Transporte" : "Transport"}</label>
                    <select
                      className="appearance-none w-full bg-input/30 text-foreground rounded-lg px-3 py-2 border border-border outline-none text-sm"
                      value={mcpForm.transport}
                      onChange={e => setMcpForm(prev => ({ ...prev, transport: e.target.value as "stdio" | "http" }))}>
                      <option value="stdio" className="bg-card text-foreground">stdio ({lang === "pt" ? "local" : "local"})</option>
                      <option value="http" className="bg-card text-foreground">HTTP ({lang === "pt" ? "remoto" : "remote"})</option>
                    </select>
                  </div>
                  {mcpForm.transport === "stdio" && (
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">{lang === "pt" ? "Comando" : "Command"}</label>
                      <input
                        className="w-full rounded-lg px-3 py-2 border border-border bg-input/30 text-foreground text-sm outline-none font-mono"
                        value={mcpForm.command}
                        onChange={e => setMcpForm(prev => ({ ...prev, command: e.target.value }))}
                        placeholder="python"
                      />
                    </div>
                  )}
                </div>
                {mcpForm.transport === "http" ? (
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">URL</label>
                    <input
                      className="w-full rounded-lg px-3 py-2 border border-border bg-input/30 text-foreground text-sm outline-none font-mono"
                      type="url"
                      value={mcpForm.url}
                      onChange={e => setMcpForm(prev => ({ ...prev, url: e.target.value }))}
                      placeholder="http://localhost:3000/mcp"
                    />
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-muted-foreground">{lang === "pt" ? "Argumentos (um por linha)" : "Arguments (one per line)"}</label>
                      <button onClick={pickMcpFile} className="text-xs text-primary hover:text-primary/80 transition-colors">
                        {lang === "pt" ? "Escolher ficheiro…" : "Pick file…"}
                      </button>
                    </div>
                    <textarea
                      className="w-full rounded-lg px-3 py-2 border border-border bg-input/30 text-foreground text-sm outline-none font-mono"
                      rows={2}
                      value={mcpForm.argsText}
                      onChange={e => setMcpForm(prev => ({ ...prev, argsText: e.target.value }))}
                      placeholder={"C:\\cad-mcp\\src\\server.py"}
                    />
                  </div>
                )}
                {mcpForm.transport === "stdio" && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-muted-foreground">{lang === "pt" ? "Pasta de trabalho (opcional)" : "Working directory (optional)"}</label>
                      <button onClick={pickMcpCwd} className="text-xs text-primary hover:text-primary/80 transition-colors">
                        {lang === "pt" ? "Escolher pasta…" : "Pick folder…"}
                      </button>
                    </div>
                    <input
                      className="w-full rounded-lg px-3 py-2 border border-border bg-input/30 text-foreground text-sm outline-none font-mono"
                      value={mcpForm.cwd}
                      onChange={e => setMcpForm(prev => ({ ...prev, cwd: e.target.value }))}
                      placeholder={lang === "pt" ? "Deixa em branco a menos que o servidor precise (ex: CAD-MCP)" : "Leave blank unless the server needs it (e.g. CAD-MCP)"}
                    />
                  </div>
                )}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">{lang === "pt" ? "Variáveis de ambiente (opcional, uma por linha: CHAVE=valor)" : "Environment variables (optional, one per line: KEY=value)"}</label>
                  <textarea
                    className="w-full rounded-lg px-3 py-2 border border-border bg-input/30 text-foreground text-sm outline-none font-mono"
                    rows={2}
                    value={mcpForm.envText}
                    onChange={e => setMcpForm(prev => ({ ...prev, envText: e.target.value }))}
                    placeholder="ACAD_PORT=5005"
                  />
                </div>
                {mcpError && <p className="text-xs text-red-400">{mcpError}</p>}
                <button
                  onClick={saveMcpServer}
                  disabled={mcpSaving}
                  className="bg-primary text-primary-foreground rounded-full px-4 py-2 font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity">
                  {mcpSaving ? t(lang, "adminSaving") : (lang === "pt" ? "Guardar servidor" : "Save server")}
                </button>
              </div>
            )}

            <div className="space-y-2">
              {mcpServers.length === 0 && !mcpFormOpen && (
                <p className="text-muted-foreground/60 text-xs">{lang === "pt" ? "Nenhum servidor MCP configurado." : "No MCP servers configured yet."}</p>
              )}
              {mcpServers.map(s => {
                const test = mcpTestResult[s.id]
                const statusColor = s.status === "connected" ? "text-green-400" : s.status === "error" ? "text-red-400" : "text-muted-foreground"
                const statusLabel = s.status === "connected"
                  ? (lang === "pt" ? "Ligado" : "Connected")
                  : s.status === "error" ? (lang === "pt" ? "Erro" : "Error")
                  : (lang === "pt" ? "Desligado" : "Disconnected")
                return (
                  <div key={s.id} className="border border-border rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <span className="font-mono text-sm text-foreground">{s.id}</span>
                        <span className={`ml-2 text-xs ${statusColor}`}>{statusLabel}{typeof s.toolCount === "number" ? ` · ${s.toolCount} tools` : ""}</span>
                        {!s.enabled && <span className="ml-2 text-xs text-muted-foreground/60">({lang === "pt" ? "desativado" : "disabled"})</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => testMcpServer(s.id)} disabled={mcpTesting === s.id}
                          className="text-xs text-primary hover:text-primary/80 disabled:opacity-50 transition-colors">
                          {mcpTesting === s.id ? "..." : (lang === "pt" ? "Testar" : "Test")}
                        </button>
                        <button onClick={() => toggleMcpServer(s)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                          {s.enabled ? (lang === "pt" ? "Desativar" : "Disable") : (lang === "pt" ? "Ativar" : "Enable")}
                        </button>
                        <button onClick={() => removeMcpServer(s.id)} className="text-xs text-muted-foreground hover:text-destructive transition-colors">
                          {lang === "pt" ? "Remover" : "Remove"}
                        </button>
                      </div>
                    </div>
                    <p className="text-muted-foreground/70 text-xs mt-1 font-mono truncate">
                      {s.transport === "http" ? s.url : `${s.command} ${s.args.join(" ")}`}
                    </p>
                    {s.cwd && (
                      <p className="text-muted-foreground/50 text-xs mt-0.5 font-mono truncate">cwd: {s.cwd}</p>
                    )}
                    {test && (
                      <p className={`text-xs mt-1 ${test.ok ? "text-green-400" : "text-red-400"}`}>
                        {test.ok
                          ? (lang === "pt" ? `OK — ${test.toolCount ?? 0} ferramentas encontradas` : `OK — ${test.toolCount ?? 0} tools found`)
                          : test.error}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto p-4 space-y-3">
        {tab !== "connectors" && providers.length === 0 && tab !== "local" && (
          <p className="text-muted-foreground text-center py-8 text-sm">{t(lang, "settingsNoProviders")}</p>
        )}
        {tab === "local" && providers.length === 0 && (
          <div className="bg-card border border-amber-800/30 rounded-xl p-5 border-l-4 border-l-amber-600">
            <h3 className="text-amber-400 font-medium text-sm mb-2">{t(lang, "settingsLocalTitle")}</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {lang === "pt"
                ? "Os providers locais (Ollama, llama.cpp) correm na tua máquina. Certifica-te que estão a correr no endereço padrão (localhost:11434 para Ollama, localhost:8090 para llama.cpp)."
                : "Local providers (Ollama, llama.cpp) run on your machine. Make sure they are running at the default address (localhost:11434 for Ollama, localhost:8090 for llama.cpp)."}
            </p>
          </div>
        )}

        {providers.map(p => {
          const cfg = configs[p.id] || { api_key: "", model: p.models?.[0]?.id || "", temperature: 0.7, has_api_key: false }
          const hasKey = cfg.has_api_key === true
          return (
            <div key={p.id} className={`bg-card border rounded-xl p-4 transition-colors ${hasKey ? "border-green-700/40 border-l-4 border-l-green-500" : "border-border"}`}>
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <h3 className="font-medium text-sm flex items-center gap-2" style={{ color: PROVIDER_COLORS[p.id] || "#888" }}>
                  {p.name}
                </h3>
                <div className="flex items-center gap-2">
                  {hasKey
                    ? <span className="inline-flex items-center gap-1 bg-green-500/15 text-green-400 border border-green-500/30 rounded-full px-2.5 py-0.5 text-xs font-medium">{t(lang, "settingsActive")}</span>
                    : p.register_url && <a href={p.register_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:text-primary/80 border border-primary/30 rounded-full px-2.5 py-0.5 text-xs transition-colors">{t(lang, "settingsGetKey")} →</a>
                  }
                </div>
              </div>

              {p.requires_key !== false && (
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-muted-foreground">{t(lang, "settingsApiKeyLabel")}</label>
                    {hasKey && p.register_url && (
                      <a href={p.register_url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">{t(lang, "settingsGetNewKey")} ↗</a>
                    )}
                  </div>
                  <input
                    className={`w-full rounded-lg px-3 py-2 border outline-none font-mono text-sm ${hasKey ? "bg-green-900/10 text-green-300 border-green-700/40" : "bg-input/30 text-foreground border-border"}`}
                    type="password"
                    value={cfg.api_key}
                    onChange={e => setConfigs(prev => ({ ...prev, [p.id]: { ...prev[p.id], api_key: e.target.value } }))}
                    placeholder={hasKey ? t(lang, "settingsTypeToReplace") : "sk-..."}
                  />
                </div>
              )}

              {p.models.length > 0 && (
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">{t(lang, "settingsModel")}</label>
                    <select
                      className="appearance-none w-full bg-input/30 text-foreground rounded-lg px-3 py-2 border border-border outline-none text-sm"
                      value={cfg.model}
                      onChange={e => setConfigs(prev => ({ ...prev, [p.id]: { ...prev[p.id], model: e.target.value } }))}>
                      {p.models.map(m => <option key={m.id} value={m.id} className="bg-card text-foreground">{m.id}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">{t(lang, "settingsTemp")}</label>
                    <input
                      className="w-full bg-input/30 text-foreground rounded-lg px-3 py-2 border border-border text-sm outline-none"
                      type="number" min="0" max="2" step="0.1"
                      value={cfg.temperature}
                      onChange={e => setConfigs(prev => ({ ...prev, [p.id]: { ...prev[p.id], temperature: parseFloat(e.target.value) } }))}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  className="bg-primary text-primary-foreground rounded-full px-4 py-2 font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
                  onClick={() => save(p.id)}
                  disabled={saving === p.id}>
                  {saving === p.id ? t(lang, "adminSaving") : t(lang, "settingsSave")}
                </button>
                {msg?.id === p.id && (
                  <span className={`text-xs ${msg.ok ? "text-green-400" : "text-red-400"}`}>{msg.text}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="max-w-3xl mx-auto px-4 pb-4">
        <div className="bg-card border border-primary/20 rounded-xl p-5">
          <h3 className="text-foreground font-medium mb-1">
            {lang === "pt" ? "Acesso Partilhado (Ollama remoto)" : "Shared Access (Remote Ollama)"}
          </h3>
          <p className="text-muted-foreground text-xs mb-4 leading-relaxed">
            {lang === "pt"
              ? "Permite usar os modelos locais (Ollama/llama.cpp) de outro computador através do chat.daazlabs.com. Pede o URL e a chave ao dono do servidor."
              : "Use local models (Ollama/llama.cpp) from another machine via chat.daazlabs.com. Ask the server owner for the URL and key."}
          </p>
          <div className="space-y-2 mb-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                {lang === "pt" ? "URL do servidor" : "Server URL"}
              </label>
              <input
                className="w-full rounded-lg px-3 py-2 border border-border bg-input/30 text-foreground text-sm outline-none font-mono"
                type="url"
                value={remoteUrl}
                onChange={e => setRemoteUrl(e.target.value)}
                placeholder="https://chat.daazlabs.com"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                {lang === "pt" ? "Chave de acesso" : "Access key"}
              </label>
              <input
                className="w-full rounded-lg px-3 py-2 border border-border bg-input/30 text-foreground text-sm outline-none font-mono"
                type="password"
                value={remoteKey}
                onChange={e => setRemoteKey(e.target.value)}
                placeholder="a864f144..."
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={saveRemote}
              className="bg-primary text-primary-foreground rounded-full px-4 py-2 font-medium text-sm hover:opacity-90 transition-opacity">
              {lang === "pt" ? "Guardar" : "Save"}
            </button>
            {remoteUrl && (
              <button
                onClick={() => { setRemoteUrl(""); setRemoteKey(""); api.saveRemoteOllama("", "") }}
                className="text-muted-foreground hover:text-destructive text-sm transition-colors">
                {lang === "pt" ? "Remover" : "Remove"}
              </button>
            )}
            {remoteSaved === true && (
              <span className="text-xs text-green-400">
                {lang === "pt" ? "Guardado — vai ao chat e selecciona Local" : "Saved — go to chat and select Local"}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 pb-6">
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-foreground font-medium mb-3">{t(lang, "settingsTheme")}</h3>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-muted-foreground text-sm">{t(lang, "settingsAccentColor")}</label>
            <input type="color" value={themeColor} onChange={e => setThemeColor(e.target.value)}
              className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border-0" />
            <span className="text-muted-foreground text-sm">{themeColor}</span>
            <button onClick={() => setThemeColor(DEFAULT_THEME_COLOR)}
              className="text-muted-foreground hover:text-foreground ml-auto transition-colors text-sm">
              {t(lang, "settingsReset")}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
