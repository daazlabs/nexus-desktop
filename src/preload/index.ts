import { contextBridge, ipcRenderer } from 'electron'

const api = {
  tools: {
    run: (name: string, args: unknown) => ipcRenderer.invoke('nexus:tools:run', name, args),
    cancel: (id: string) => ipcRenderer.send('nexus:tools:cancel', id),
  },
  permissions: {
    request: (action: string, details: unknown) =>
      ipcRenderer.invoke('nexus:permissions:request', action, details),
    getPolicy: () => ipcRenderer.invoke('nexus:permissions:getPolicy'),
    setPolicy: (pattern: string, decision: string) =>
      ipcRenderer.invoke('nexus:permissions:setPolicy', pattern, decision),
    onRequest: (callback: (data: { id: string; action: string; detail: string }) => void) => {
      const handler = (_: any, data: { id: string; action: string; detail: string }) => callback(data)
      ipcRenderer.on('nexus:permission:request', handler)
      return () => ipcRenderer.removeListener('nexus:permission:request', handler)
    },
    respond: (id: string, granted: boolean, always?: boolean) =>
      ipcRenderer.send('nexus:permissions:response', id, granted, always ?? false),
    onResolved: (callback: (id: string) => void) => {
      const handler = (_: any, id: string) => callback(id)
      ipcRenderer.on('nexus:permission:resolved', handler)
      return () => ipcRenderer.removeListener('nexus:permission:resolved', handler)
    },
  },
  connectors: {
    list: () => ipcRenderer.invoke('nexus:connectors:list'),
    setToken: (connectorId: string, token: string) =>
      ipcRenderer.invoke('nexus:connectors:setToken', connectorId, token),
    disconnect: (connectorId: string) => ipcRenderer.invoke('nexus:connectors:disconnect', connectorId),
    connectOAuth: (connectorId: string) => ipcRenderer.invoke('nexus:connectors:connectOAuth', connectorId),
    setWordPressCredentials: (siteUrl: string, username: string, appPassword: string) =>
      ipcRenderer.invoke('nexus:connectors:setWordPressCredentials', siteUrl, username, appPassword),
    setN8nCredentials: (baseUrl: string, apiKey: string) =>
      ipcRenderer.invoke('nexus:connectors:setN8nCredentials', baseUrl, apiKey),
    autocadStatus: () => ipcRenderer.invoke('nexus:connectors:autocad:status'),
    autocadInstall: (
      onProgress: (data: { step: string; pct: number }) => void,
      onDone: (data: { ok: boolean; status?: unknown; error?: string }) => void,
    ): (() => void) => {
      const progressHandler = (_: any, data: { step: string; pct: number }) => onProgress(data)
      const doneHandler = (_: any, data: { ok: boolean; status?: unknown; error?: string }) => {
        cleanup(); onDone(data)
      }
      const cleanup = () => {
        ipcRenderer.removeListener('nexus:connectors:autocad:progress', progressHandler)
        ipcRenderer.removeListener('nexus:connectors:autocad:done', doneHandler)
      }
      ipcRenderer.on('nexus:connectors:autocad:progress', progressHandler)
      ipcRenderer.on('nexus:connectors:autocad:done', doneHandler)
      ipcRenderer.send('nexus:connectors:autocad:install')
      return cleanup
    },
  },
  mcp: {
    list: () => ipcRenderer.invoke('nexus:mcp:list'),
    upsert: (id: string, def: unknown) => ipcRenderer.invoke('nexus:mcp:upsert', id, def),
    remove: (id: string) => ipcRenderer.invoke('nexus:mcp:remove', id),
    test: (id: string) => ipcRenderer.invoke('nexus:mcp:test', id),
  },
  providers: {
    list: () => ipcRenderer.invoke('nexus:providers:list'),
    modelsByClass: (modelClass: string) => ipcRenderer.invoke('nexus:providers:modelsByClass', modelClass),
    modelsByProvider: (providerId: string) => ipcRenderer.invoke('nexus:providers:modelsByProvider', providerId),
    getProvider: (modelId: string) => ipcRenderer.invoke('nexus:providers:getProvider', modelId),
    cooldowns: (): Promise<Record<string, number>> => ipcRenderer.invoke('nexus:providers:cooldowns'),
    onCatalogUpdated: (callback: () => void): (() => void) => {
      const handler = () => callback()
      ipcRenderer.on('nexus:catalog:updated', handler)
      return () => ipcRenderer.removeListener('nexus:catalog:updated', handler)
    },
    send: (messages: unknown, options: unknown) =>
      ipcRenderer.invoke('nexus:providers:send', messages, options),
    stream: (
      messages: unknown,
      options: unknown,
      onChunk: (chunk: string) => void,
      onDone: (result: { content: string; model: string }) => void,
      onError: (err: string) => void,
    ): (() => void) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const chunkHandler = (_: any, data: { id: string; chunk: string }) => {
        if (data.id === id) onChunk(data.chunk)
      }
      const doneHandler = (_: any, data: { id: string; result: any }) => {
        if (data.id === id) { cleanup(); onDone(data.result) }
      }
      const errorHandler = (_: any, data: { id: string; error: string }) => {
        if (data.id === id) { cleanup(); onError(data.error) }
      }
      const cleanup = () => {
        ipcRenderer.removeListener('nexus:stream:chunk', chunkHandler)
        ipcRenderer.removeListener('nexus:stream:done', doneHandler)
        ipcRenderer.removeListener('nexus:stream:error', errorHandler)
      }
      ipcRenderer.on('nexus:stream:chunk', chunkHandler)
      ipcRenderer.on('nexus:stream:done', doneHandler)
      ipcRenderer.on('nexus:stream:error', errorHandler)
      ipcRenderer.send('nexus:stream:start', { id, messages, options })
      return () => { cleanup(); ipcRenderer.send('nexus:stream:cancel', { id }) }
    },
  },
  skills: {
    list: () => ipcRenderer.invoke('nexus:skills:list'),
    create: (name: string, description: string, instructions: string) =>
      ipcRenderer.invoke('nexus:skills:create', name, description, instructions),
    update: (id: number, name: string, description: string, instructions: string) =>
      ipcRenderer.invoke('nexus:skills:update', id, name, description, instructions),
    delete: (id: number) => ipcRenderer.invoke('nexus:skills:delete', id),
  },
  vault: {
    getKeys: () => ipcRenderer.invoke('nexus:vault:getKeys'),
    setKey: (provider: string, key: string) =>
      ipcRenderer.invoke('nexus:vault:setKey', provider, key),
    deleteKey: (provider: string) => ipcRenderer.invoke('nexus:vault:deleteKey', provider),
    resolveKey: (provider: string) => ipcRenderer.invoke('nexus:vault:resolveKey', provider),
  },
  window: {
    minimize: () => ipcRenderer.send('nexus:window:minimize'),
    maximize: () => ipcRenderer.send('nexus:window:maximize'),
    close: () => ipcRenderer.send('nexus:window:close'),
  },
  update: {
    download: () => ipcRenderer.invoke('nexus:update:download'),
    install: () => ipcRenderer.invoke('nexus:update:install'),
  },
  dialog: {
    openDir: (): Promise<string | null> => ipcRenderer.invoke('nexus:dialog:openDir'),
    openFile: (): Promise<string | null> => ipcRenderer.invoke('nexus:dialog:openFile'),
  },
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('nexus:app:getVersion'),
  },
  ipc: {
    on: (channel: string, fn: (...args: any[]) => void) => {
      const handler = (_: any, ...args: any[]) => fn(_, ...args)
      ipcRenderer.on(channel, handler)
      return handler
    },
    off: (channel: string, fn: (...args: any[]) => void) => ipcRenderer.removeListener(channel, fn),
  },
}

contextBridge.exposeInMainWorld('nexus', api)
