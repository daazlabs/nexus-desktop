import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32

const VAULT_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.daaznexus',
  'vault.json',
)

let _vaultKeys: Record<string, { encrypted: string; iv: string; tag: string }> | null = null
let _cachedKey: Buffer | null = null

function getEncryptionKey(): Buffer {
  if (_cachedKey) return _cachedKey

  const envKey = process.env.ENCRYPTION_KEY || process.env.NEXUS_VAULT_KEY
  if (envKey) {
    const hash = crypto.createHash('sha256').update(envKey).digest()
    _cachedKey = hash
    return hash
  }

  const keyPath = path.join(
    process.env.HOME || process.env.USERPROFILE || '.',
    '.daaznexus',
    '.vault-key',
  )
  try {
    const raw = fs.readFileSync(keyPath, 'utf-8').trim()
    // Retroactively tighten permissions for installs from before this file
    // was written with mode 0o600 below — it decrypts every stored provider
    // API key, so it should never be world/group-readable regardless of the
    // process umask. Best-effort: never let a chmod failure break startup.
    try { fs.chmodSync(keyPath, 0o600) } catch { /* e.g. read-only fs, ignore */ }
    const hash = crypto.createHash('sha256').update(raw).digest()
    _cachedKey = hash
    return hash
  } catch {
    const generated = crypto.randomBytes(32).toString('hex')
    fs.mkdirSync(path.dirname(keyPath), { recursive: true })
    // mode 0o600: owner read/write only. Without this the key inherits the
    // process umask (often 022 -> world-readable 644) and sits right next
    // to vault.json (the encrypted keys it protects) — anyone with read
    // access to the directory could decrypt every stored API key.
    fs.writeFileSync(keyPath, generated, { encoding: 'utf-8', mode: 0o600 })
    const hash = crypto.createHash('sha256').update(generated).digest()
    _cachedKey = hash
    return hash
  }
}

function loadVault(): Record<string, { encrypted: string; iv: string; tag: string }> {
  if (_vaultKeys) return _vaultKeys
  try {
    const raw = fs.readFileSync(VAULT_PATH, 'utf-8')
    _vaultKeys = JSON.parse(raw)
    return _vaultKeys!
  } catch {
    _vaultKeys = {}
    return _vaultKeys
  }
}

function saveVault(): void {
  fs.mkdirSync(path.dirname(VAULT_PATH), { recursive: true })
  fs.writeFileSync(VAULT_PATH, JSON.stringify(_vaultKeys, null, 2), 'utf-8')
}

export function encryptValue(value: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(value, 'utf-8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')
  return `${iv.toString('hex')}:${authTag}:${encrypted}`
}

export function decryptValue(encrypted: string): string {
  try {
    const key = getEncryptionKey()
    const parts = encrypted.split(':')
    if (parts.length < 3) return ''
    const iv = Buffer.from(parts[0], 'hex')
    const authTag = Buffer.from(parts[1], 'hex')
    const data = parts.slice(2).join(':')
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    let decrypted = decipher.update(data, 'hex', 'utf-8')
    decrypted += decipher.final('utf-8')
    return decrypted
  } catch {
    return ''
  }
}

export function saveSystemKey(providerId: string, apiKey: string): void {
  const vault = loadVault()
  vault[providerId] = {
    encrypted: encryptValue(apiKey),
    iv: '',
    tag: '',
  }
  saveVault()
}

export function getSystemKey(providerId: string): string | null {
  const vault = loadVault()
  const entry = vault[providerId]
  if (!entry) return null
  return decryptValue(entry.encrypted)
}

export function deleteSystemKey(providerId: string): boolean {
  const vault = loadVault()
  if (!vault[providerId]) return false
  delete vault[providerId]
  saveVault()
  return true
}

export function listVaultProviders(): string[] {
  const vault = loadVault()
  return Object.keys(vault)
}

export function hasVaultKey(providerId: string): boolean {
  const vault = loadVault()
  return providerId in vault
}

export function resolveKey(providerId: string): string | null {
  const key = getSystemKey(providerId)
  if (key) return key

  const envVarName = `${providerId.toUpperCase()}_API_KEY`
  const envKey = process.env[envVarName] || process.env[`NEXUS_${providerId.toUpperCase()}_KEY`]
  return envKey || null
}
