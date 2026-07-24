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
}

const PROVIDER_COLORS: Record<string, string> = {
  groq: "#f97316", openrouter: "#8b5cf6", gemini: "#4285f4", github: "#6e40c9",
  deepseek: "#06b6d4", mistral: "#ec4899", anthropic: "#d97706", openai: "#10b981",
  xai: "#e11d48", perplexity: "#0ea5e9", cohere: "#14b8a6", together: "#eab308",
  replicate: "#d946ef", huggingface: "#facc15", cerebras: "#3b82f6", nvidia: "#76b900",
  cloudflare: "#f38020", zhipu: "#8b5cf6", kilo: "#a855f7", pollinations: "#22d3ee",
  ovh: "#00a3ff", opencodezen: "#6366f1",
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
  const [connectors, setConnectors] = useState<{ id: string; name: string; authMethodSupported: string; status: string; available: boolean }[]>([])
  const [connectorInput, setConnectorInput] = useState<Record<string, string>>({})
  const [connectorSaving, setConnectorSaving] = useState<string | null>(null)
  const [wpForm, setWpForm] = useState({ siteUrl: "", username: "", appPassword: "" })
  const [n8nForm, setN8nForm] = useState({ baseUrl: "", apiKey: "" })

  const loadConnectors = () => api.listConnectors().then(setConnectors).catch(() => {})

  useEffect(() => {
    api.getProvidersCategorized().then(setCategorized).catch(() => {})
    const saved = api.getRemoteOllama()
    setRemoteUrl(saved.url)
    setRemoteKey(saved.key ? "••••••••" : "")
    loadConnectors()
  }, [])

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
                        ? "Ainda não configurado (falta o Google Desktop Client ID)."
                        : "Not configured yet (missing Google Desktop Client ID)."}
                    </p>
                  ) : (
                    <button
                      onClick={() => connectOAuth(c.id)}
                      disabled={connectorSaving === c.id}
                      className="bg-primary text-primary-foreground rounded-full px-4 py-2 font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity">
                      {lang === "pt" ? "Ligar com Google" : "Connect with Google"}
                    </button>
                  )
                ) : (
                  <div>
                    {CONNECTOR_HELP_URLS[c.id] && (
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-muted-foreground">{lang === "pt" ? "Personal Access Token" : "Personal Access Token"}</label>
                        <a href={CONNECTOR_HELP_URLS[c.id]} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:text-primary/80 text-xs transition-colors">
                          {lang === "pt" ? "Criar token no GitHub" : "Create token on GitHub"} ↗
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
