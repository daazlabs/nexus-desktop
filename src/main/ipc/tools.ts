import { app, ipcMain, BrowserWindow, dialog } from 'electron'
import { readFile, writeFile, listDir, fileInfo, deleteFile, createDir } from '../tools/filesystem.js'
import { runBash } from '../tools/bash.js'
import { checkOrRequestPermission, resolvePermissionWithAlways, getPolicy, setRule, setDefault } from './permissions.js'
import { listProviders, getModelsByClass, getModelsByProvider, getProvider } from '../services/catalog.js'
import { resolveKey, saveSystemKey, deleteSystemKey, listVaultProviders } from '../services/keyVault.js'
import { routeWithFallback, routeWithFallbackStream, getCooldownState } from '../services/fallbackChain.js'
import * as mcpConnectors from '../services/mcpConnectors.js'
import * as customMcpServers from '../services/customMcpServers.js'
import type { CustomMcpServerConfig } from '../services/customMcpServers.js'
import { maybeEnrichWithWeb } from '../services/webSearch.js'
import * as skills from '../tools/skills.js'
import type { ChatMessage } from '../services/providerClients.js'

const activeStreams = new Map<string, boolean>()

// PLAN mode (tools off, the default) has no file/command access at all — the
// model must never pretend otherwise. Told explicitly so it doesn't fabricate
// tool output as plain text and instead tells the user to switch to BUILD.
const PLAN_MODE_SYSTEM_PROMPT: Record<string, string> = {
  pt: 'Estás em modo PLAN no DaazNexus Desktop. Neste modo não tens acesso a nenhuma ferramenta — não podes ler, criar, alterar ou apagar ficheiros, nem executar comandos no computador do utilizador, e nunca deves fingir ou simular que o fizeste. Podes discutir, planear e escrever o conteúdo do que seria feito diretamente na conversa. Se o pedido implicar essas ações (ex: gravar um ficheiro, correr um comando), diz claramente que precisas que o utilizador mude para o modo BUILD (botão junto ao seletor de modelo, no topo do chat) para executares.',
  en: 'You are in PLAN mode in DaazNexus Desktop. In this mode you have no tool access at all — you cannot read, create, modify or delete files, nor run commands on the user\'s computer, and you must never pretend or simulate having done so. You can discuss, plan, and write out the content of what would be done directly in the conversation. If the request implies such actions (e.g. saving a file, running a command), clearly say you need the user to switch to BUILD mode (button next to the model selector, top of the chat) for you to execute it.',
}

// BUILD mode (tools on) grants real, executed access to the user's disk and
// shell via function calling. Models — especially smaller/free ones — tend
// to fall back on their trained "I'm a hosted LLM with no file access"
// disclaimer out of habit, even right after a tool result confirms success.
// Spelling this out, and telling the model to trust its own tool results
// over that instinct, measurably reduces that failure mode.
const BUILD_MODE_SYSTEM_PROMPT: Record<string, string> = {
  pt: 'Estás em modo BUILD no DaazNexus Desktop, uma aplicação de secretária (Electron) com acesso real ao computador do utilizador — não é um sandbox nem uma simulação. As ferramentas bash, read_file, write_file, list_dir, create_dir, delete_file, file_info, create_excel, create_word, create_powerpoint e create_pdf executam mesmo no disco e terminal do utilizador, mediante permissão explícita já concedida por ele. Para pedidos de Excel/Word/PowerPoint usa sempre create_excel/create_word/create_powerpoint (produzem .xlsx/.docx/.pptx reais e abríveis no Office) — nunca escrevas esse conteúdo como texto simples ou CSV a fingir que é um desses formatos. Para PDF usa create_pdf, escrevendo HTML/CSS normal como se fosse uma página web (o motor de renderização real da app trata da conversão). Quando chamas uma ferramenta e recebes um resultado de sucesso (ex: "File written: /caminho"), isso significa que a ação REALMENTE aconteceu — confia nesse resultado e não digas ao utilizador que não tens acesso ao sistema de ficheiros, que estás num "ambiente isolado" ou que "simulaste" a ação. Se o resultado da ferramenta indicar um erro, reporta esse erro específico, não uma explicação genérica de falta de acesso.',
  en: 'You are in BUILD mode in DaazNexus Desktop, a desktop (Electron) application with real access to the user\'s computer — this is not a sandbox or a simulation. The bash, read_file, write_file, list_dir, create_dir, delete_file, file_info, create_excel, create_word, create_powerpoint and create_pdf tools genuinely execute on the user\'s disk and shell, with permission already explicitly granted by them. For Excel/Word/PowerPoint requests always use create_excel/create_word/create_powerpoint (they produce real .xlsx/.docx/.pptx files openable in Office) — never write that content as plain text or CSV pretending it is one of those formats. For PDF use create_pdf, writing normal HTML/CSS as if building a webpage (the app\'s real rendering engine handles the conversion). When you call a tool and get back a success result (e.g. "File written: /path"), that means the action REALLY happened — trust that result, and do not tell the user you lack filesystem access, that you\'re in an "isolated environment", or that you "simulated" the action. If a tool result reports an error, relay that specific error, not a generic no-access disclaimer.',
}

function withModeSystemPrompt(messages: ChatMessage[], toolsEnabled: boolean, lang?: string): ChatMessage[] {
  const table = toolsEnabled ? BUILD_MODE_SYSTEM_PROMPT : PLAN_MODE_SYSTEM_PROMPT
  const text = table[lang === 'en' ? 'en' : 'pt']
  // Skills only make sense in BUILD mode (usar_skill is only attached to the
  // tools array there) — PLAN mode gets the base prompt only.
  const withSkills = toolsEnabled ? text + skills.catalogPrompt() : text
  return [{ role: 'system', content: withSkills }, ...messages]
}

// Read-only, so — unlike bash/write_file — it runs in PLAN mode too, not just
// BUILD: a question needing current info deserves a real answer whether or
// not file/shell tools are enabled for this message.
async function withWebSearchEnrichment(messages: ChatMessage[]): Promise<ChatMessage[]> {
  const lastUser = [...messages].reverse().find(m => m.role === 'user')
  if (!lastUser?.content) return messages
  const enrichment = await maybeEnrichWithWeb(lastUser.content)
  if (!enrichment) return messages
  return [...messages, { role: 'system', content: enrichment }]
}

const DESKTOP_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'bash',
      description: 'Execute a shell command and return its stdout.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run.' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read the full contents of a file as text.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative path to the file.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_file',
      description: 'Write text content to a file, creating it if it does not exist.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to write to.' },
          content: { type: 'string', description: 'Content to write.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_dir',
      description: 'List files and subdirectories inside a directory.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to list.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_dir',
      description: 'Create a directory and any missing parent directories.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to create.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_file',
      description: 'Delete a file permanently.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to delete.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'file_info',
      description: 'Get metadata about a file or directory (size, type, modification time).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file or directory.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_excel',
      description: 'Create a real .xlsx Excel workbook with one or more sheets, bold styled headers, and auto-sized columns. Use this instead of writing raw text when the user asks for a spreadsheet.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Where to save the .xlsx file, e.g. /Users/name/Documents/report.xlsx.' },
          sheets: {
            type: 'array',
            description: 'One entry per worksheet tab.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Sheet tab name (max 31 chars).' },
                headers: { type: 'array', items: { type: 'string' }, description: 'Optional bold header row.' },
                rows: {
                  type: 'array',
                  description: 'Data rows; each row is an array of cell values (string, number, boolean, or null).',
                  items: { type: 'array', items: {} },
                },
              },
              required: ['name', 'rows'],
            },
          },
        },
        required: ['path', 'sheets'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_word',
      description: 'Create a real .docx Word document from structured content (headings, paragraphs, bullet/numbered lists, tables). Use this instead of writing raw text when the user asks for a Word document or report.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Where to save the .docx file.' },
          title: { type: 'string', description: 'Optional document title, rendered as a large title heading at the top.' },
          blocks: {
            type: 'array',
            description: 'Ordered content blocks that make up the document body.',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', description: 'One of: heading1, heading2, heading3, paragraph, bullet, numbered, table.' },
                text: { type: 'string', description: 'Text content — required for every type except table.' },
                rows: {
                  type: 'array',
                  description: 'Only for type "table": array of rows, each an array of cell strings.',
                  items: { type: 'array', items: { type: 'string' } },
                },
                headerRow: { type: 'boolean', description: 'Only for type "table": bold-style the first row as a header.' },
              },
              required: ['type'],
            },
          },
        },
        required: ['path', 'blocks'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_powerpoint',
      description: 'Create a real .pptx PowerPoint presentation with a title slide and content slides (title + bullet points + optional speaker notes). Use this instead of writing raw text when the user asks for a presentation or slides.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Where to save the .pptx file.' },
          title: { type: 'string', description: 'Optional title-slide text, shown centered on its own opening slide.' },
          slides: {
            type: 'array',
            description: 'Content slides, in order.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Slide heading.' },
                bullets: { type: 'array', items: { type: 'string' }, description: 'Bullet points for this slide.' },
                notes: { type: 'string', description: 'Optional speaker notes, not visible on the slide itself.' },
              },
            },
          },
        },
        required: ['path', 'slides'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_pdf',
      description: 'Create a real .pdf file by rendering HTML/CSS through the app\'s built-in browser engine — write normal HTML with inline <style> as if building a webpage (tables, colors, layout, images as base64 data URIs). Use this instead of writing raw text when the user asks for a PDF, and prefer it over create_word for anything that needs precise visual layout.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Where to save the .pdf file.' },
          html: { type: 'string', description: 'A full HTML document (can include a <style> block) to render as the PDF content.' },
          landscape: { type: 'boolean', description: 'Set true for landscape orientation. Defaults to portrait.' },
        },
        required: ['path', 'html'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'usar_skill',
      description: 'Load the step-by-step instructions for a named skill (a reusable recipe for a recurring task, see the skills list in the system prompt). Call this before attempting a matching task yourself, then follow the returned instructions.',
      parameters: {
        type: 'object',
        properties: {
          nome: { type: 'string', description: 'Exact skill name, from the available skills list in the system prompt.' },
        },
        required: ['nome'],
      },
    },
  },
]

export function registerIpcHandlers(): void {

  ipcMain.on('nexus:permissions:response', (_event, id: string, granted: boolean, always: boolean) => {
    resolvePermissionWithAlways(id, granted, always ?? false)
  })

  ipcMain.handle('nexus:tools:run', async (_event, name: string, args: any) => {
    switch (name) {
      case 'read_file': return readFile(args.path)
      case 'write_file': return writeFile(args.path, args.content)
      case 'list_dir': return listDir(args.path)
      case 'file_info': return fileInfo(args.path)
      case 'delete_file': return deleteFile(args.path)
      case 'create_dir': return createDir(args.path)
      case 'bash': return runBash(args.command, args.timeout)
      default: return { success: false, error: `Unknown tool: ${name}` }
    }
  })

  ipcMain.handle('nexus:permissions:request', async (_event, action: string, detail: string) => {
    return checkOrRequestPermission(action, detail)
  })

  ipcMain.handle('nexus:permissions:getPolicy', () => getPolicy())
  ipcMain.handle('nexus:permissions:setPolicy', (_event, pattern: string, decision: string) => {
    if (pattern === '__default__') {
      setDefault(decision as 'allow' | 'deny' | 'ask')
    } else {
      setRule(pattern, decision as 'allow' | 'deny' | 'ask')
    }
    return getPolicy()
  })

  ipcMain.handle('nexus:connectors:list', () => mcpConnectors.listConnectors())
  ipcMain.handle('nexus:connectors:setToken', (_event, connectorId: string, token: string) => {
    mcpConnectors.setConnectorToken(connectorId, token)
    return mcpConnectors.listConnectors()
  })
  ipcMain.handle('nexus:connectors:disconnect', async (_event, connectorId: string) => {
    await mcpConnectors.disconnectConnector(connectorId)
    return mcpConnectors.listConnectors()
  })
  ipcMain.handle('nexus:connectors:connectOAuth', async (_event, connectorId: string) => {
    return mcpConnectors.connectOAuth(connectorId)
  })
  ipcMain.handle('nexus:connectors:setWordPressCredentials', (_event, siteUrl: string, username: string, appPassword: string) => {
    mcpConnectors.setWordPressCredentials(siteUrl, username, appPassword)
    return mcpConnectors.listConnectors()
  })
  ipcMain.handle('nexus:connectors:setN8nCredentials', (_event, baseUrl: string, apiKey: string) => {
    mcpConnectors.setN8nCredentials(baseUrl, apiKey)
    return mcpConnectors.listConnectors()
  })

  // AutoCAD is a one-click connector, not token/OAuth-based: "install"
  // provisions a private Python runtime the first time (download + pip
  // install, streamed as progress events) and connects, then a plain
  // re-click just reconnects (each provisioning step is skipped if already
  // done — see autocadRuntime.ensureAutocadRuntime).
  ipcMain.handle('nexus:connectors:autocad:status', () => mcpConnectors.getAutocadStatus())
  ipcMain.on('nexus:connectors:autocad:install', async (event) => {
    try {
      const status = await mcpConnectors.installAutocad((step, pct) => {
        event.sender.send('nexus:connectors:autocad:progress', { step, pct })
      })
      event.sender.send('nexus:connectors:autocad:done', { ok: true, status })
    } catch (err: any) {
      event.sender.send('nexus:connectors:autocad:done', { ok: false, error: err?.message || String(err) })
    }
  })

  // Photoshop, like AutoCAD, is a one-click connector — but "install" also
  // opens the plugin's .ccx installer and starts polling for the user's
  // manual "Connect" click inside Photoshop (see mcpConnectors.installPhotoshop).
  // A dedicated disconnect handler (rather than reusing
  // nexus:connectors:disconnect) is needed to also stop that polling and
  // kill the proxy subprocess.
  ipcMain.handle('nexus:connectors:photoshop:status', () => mcpConnectors.getPhotoshopStatus())
  ipcMain.on('nexus:connectors:photoshop:install', async (event) => {
    try {
      const status = await mcpConnectors.installPhotoshop((step, pct) => {
        event.sender.send('nexus:connectors:photoshop:progress', { step, pct })
      })
      event.sender.send('nexus:connectors:photoshop:done', { ok: true, status })
    } catch (err: any) {
      event.sender.send('nexus:connectors:photoshop:done', { ok: false, error: err?.message || String(err) })
    }
  })
  ipcMain.handle('nexus:connectors:photoshop:disconnect', async () => {
    await mcpConnectors.disconnectPhotoshop()
    return mcpConnectors.getPhotoshopStatus()
  })
  ipcMain.handle('nexus:connectors:photoshop:showInstaller', () => {
    mcpConnectors.showPhotoshopInstallerInFolder()
  })

  // Same pattern as Photoshop above — see mcpConnectors.installAdobeApp.
  ipcMain.handle('nexus:connectors:premiere:status', () => mcpConnectors.getPremiereStatus())
  ipcMain.on('nexus:connectors:premiere:install', async (event) => {
    try {
      const status = await mcpConnectors.installPremiere((step, pct) => {
        event.sender.send('nexus:connectors:premiere:progress', { step, pct })
      })
      event.sender.send('nexus:connectors:premiere:done', { ok: true, status })
    } catch (err: any) {
      event.sender.send('nexus:connectors:premiere:done', { ok: false, error: err?.message || String(err) })
    }
  })
  ipcMain.handle('nexus:connectors:premiere:disconnect', async () => {
    await mcpConnectors.disconnectPremiere()
    return mcpConnectors.getPremiereStatus()
  })
  ipcMain.handle('nexus:connectors:premiere:showInstaller', () => {
    mcpConnectors.showPremiereInstallerInFolder()
  })

  // Custom MCP servers (e.g. AutoCAD): user-configurable command+args
  // servers, on top of the hardcoded first-party connectors above.
  ipcMain.handle('nexus:mcp:list', () => customMcpServers.listServers())
  ipcMain.handle('nexus:mcp:upsert', async (_event, id: string, def: CustomMcpServerConfig) => {
    await customMcpServers.upsertServer(id, def)
    return customMcpServers.listServers()
  })
  ipcMain.handle('nexus:mcp:remove', async (_event, id: string) => {
    await customMcpServers.removeServer(id)
    return customMcpServers.listServers()
  })
  ipcMain.handle('nexus:mcp:test', (_event, id: string) => customMcpServers.testServer(id))

  ipcMain.handle('nexus:providers:list', () => listProviders())
  ipcMain.handle('nexus:providers:modelsByClass', (_event, modelClass: string) => getModelsByClass(modelClass))
  ipcMain.handle('nexus:providers:modelsByProvider', (_event, providerId: string) => getModelsByProvider(providerId))
  ipcMain.handle('nexus:providers:getProvider', (_event, modelId: string) => getProvider(modelId))

  ipcMain.handle('nexus:providers:send', async (_event, messages: any[], options: any) => {
    // PLAN mode (default) vs BUILD mode: tools are only attached in BUILD.
    const toolsEnabled = options?.toolsEnabled === true
    const tools = toolsEnabled ? [...DESKTOP_TOOLS, ...(await mcpConnectors.listOpenAiToolsForConnectors())] : undefined
    // Tag permission prompts with the conversation they came from so the
    // renderer can show several at once (one per concurrently streaming
    // conversation) instead of one clobbering another.
    const requestPermission = (action: string, detail: string) =>
      checkOrRequestPermission(action, detail, 60000, { convId: options?.convId })
    const enrichedMessages = await withWebSearchEnrichment(messages)
    return routeWithFallback(
      withModeSystemPrompt(enrichedMessages, toolsEnabled, options?.lang),
      options.modelClass,
      options.model,
      options.strategy,
      options.maxTokens,
      tools,
      undefined,
      // Same permission gate as the streaming path: without it, gated tools
      // (bash/filesystem) are denied instead of silently executed.
      requestPermission,
    )
  })

  ipcMain.on('nexus:stream:start', async (event, { id, messages, options }: { id: string; messages: any[]; options: any }) => {
    activeStreams.set(id, true)
    let fullContent = ''
    let usedModel = ''
    const notifyTool = (ev: any) => {
      const chunk = `__TOOL_EVENT__:${JSON.stringify(ev)}`
      event.sender.send('nexus:stream:chunk', { id, chunk })
    }
    // PLAN mode (default) vs BUILD mode: tools are only attached in BUILD.
    const toolsEnabled = options?.toolsEnabled === true
    const tools = toolsEnabled ? [...DESKTOP_TOOLS, ...(await mcpConnectors.listOpenAiToolsForConnectors())] : undefined
    // Tag permission prompts with the conversation they came from so the
    // renderer can show several at once (one per concurrently streaming
    // conversation) instead of one clobbering another.
    const requestPermission = (action: string, detail: string) =>
      checkOrRequestPermission(action, detail, 60000, { convId: options?.convId })
    try {
      const enrichedMessages = await withWebSearchEnrichment(messages)
      const gen = routeWithFallbackStream(
        withModeSystemPrompt(enrichedMessages, toolsEnabled, options?.lang),
        options.modelClass,
        options.model,
        options.strategy,
        options.maxTokens,
        tools,
        requestPermission,
        () => !activeStreams.get(id),
        options.temperature,
        notifyTool,
        options.workingDir,
        options.remoteOllamaUrl,
        options.remoteOllamaKey,
      )
      for await (const chunk of gen) {
        if (!activeStreams.get(id)) break
        if (typeof chunk === 'string' && chunk.startsWith('__MODEL__:')) {
          usedModel = chunk.slice('__MODEL__:'.length)
          continue
        }
        if (typeof chunk === 'string' && chunk.startsWith('__TOOL_EVENT__:')) {
          event.sender.send('nexus:stream:chunk', { id, chunk })
          continue
        }
        fullContent += chunk
        event.sender.send('nexus:stream:chunk', { id, chunk })
      }
      activeStreams.delete(id)
      event.sender.send('nexus:stream:done', { id, result: { content: fullContent, model: usedModel } })
    } catch (err: any) {
      activeStreams.delete(id)
      event.sender.send('nexus:stream:error', { id, error: err?.message || 'Stream failed' })
    }
  })

  ipcMain.on('nexus:stream:cancel', (_event, { id }: { id: string }) => {
    activeStreams.delete(id)
  })

  ipcMain.handle('nexus:vault:getKeys', () => {
    const providers = listVaultProviders()
    const result: Record<string, boolean> = {}
    for (const p of providers) {
      result[p] = true
    }
    return result
  })

  ipcMain.handle('nexus:vault:setKey', (_event, provider: string, key: string) => {
    saveSystemKey(provider, key)
    return true
  })

  ipcMain.handle('nexus:vault:deleteKey', (_event, provider: string) => {
    return deleteSystemKey(provider)
  })

  ipcMain.handle('nexus:vault:resolveKey', (_event, provider: string) => {
    return resolveKey(provider)
  })

  ipcMain.handle('nexus:providers:cooldowns', () => getCooldownState())

  ipcMain.handle('nexus:skills:list', () => skills.listPersonalSkills())
  ipcMain.handle('nexus:skills:create', (_event, name: string, description: string, instructions: string) => {
    try {
      return { ok: true, skill: skills.createPersonalSkill(name, description, instructions) }
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Could not save.' }
    }
  })
  ipcMain.handle('nexus:skills:update', (_event, id: number, name: string, description: string, instructions: string) => {
    try {
      return { ok: true, skill: skills.updatePersonalSkill(id, name, description, instructions) }
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Could not save.' }
    }
  })
  ipcMain.handle('nexus:skills:delete', (_event, id: number) => {
    skills.deletePersonalSkill(id)
    return { detail: 'deleted' }
  })

  ipcMain.handle('nexus:app:getVersion', () => app.getVersion())

  ipcMain.handle('nexus:dialog:openDir', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select project working directory',
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Used by the MCP servers panel in Settings to pick the entry-point
  // script/executable for a custom server (e.g. an AutoCAD MCP server's
  // server.py) without the user having to type an absolute path by hand.
  ipcMain.handle('nexus:dialog:openFile', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      title: 'Select file',
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.on('nexus:window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.on('nexus:window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })
  ipcMain.on('nexus:window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
}
