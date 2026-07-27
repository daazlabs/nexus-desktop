import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

// Two scopes, mirroring the web app (see backend/tools/skills.py there):
//   - Global: markdown files bundled with the app under skills/ (frontmatter:
//     name, description) — same for every install. For recipes that improve
//     DaazNexus itself (e.g. analysing one of the user's own n8n workflows).
//   - Personal: entries in ~/.daaznexus/skills.json, created via the "Minhas
//     Skills" page. Desktop is single-user/local, so unlike the web backend
//     there's no per-account isolation to enforce — it's just this machine's
//     own file, never sent anywhere.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// dist-electron/main/tools/skills.js -> nexus-desktop root (tools->main->dist-electron).
// Packaged builds get skills/ copied into resources instead (see electron-builder.yml).
const GLOBAL_SKILLS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'skills')
  : path.resolve(__dirname, '..', '..', '..', 'skills')

const PERSONAL_SKILLS_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.daaznexus',
  'skills.json',
)

interface SkillEntry {
  description: string
  instructions: string
}

interface PersonalSkill {
  id: number
  name: string
  description: string
  instructions: string
  created_at: string
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?\n)---\s*\n([\s\S]*)$/

function parseFrontmatter(text: string): { name: string; description: string; instructions: string } | null {
  const match = FRONTMATTER_RE.exec(text)
  if (!match) return null
  const nameMatch = /^name:\s*(.+)$/m.exec(match[1])
  const descMatch = /^description:\s*(.+)$/m.exec(match[1])
  if (!nameMatch) return null
  return {
    name: nameMatch[1].trim(),
    description: descMatch ? descMatch[1].trim() : '',
    instructions: match[2].trim(),
  }
}

let globalSkillsCache: Record<string, SkillEntry> | null = null

function loadGlobalSkills(): Record<string, SkillEntry> {
  if (globalSkillsCache) return globalSkillsCache
  const skills: Record<string, SkillEntry> = {}
  try {
    for (const fname of fs.readdirSync(GLOBAL_SKILLS_DIR)) {
      if (!fname.endsWith('.md')) continue
      const parsed = parseFrontmatter(fs.readFileSync(path.join(GLOBAL_SKILLS_DIR, fname), 'utf-8'))
      if (parsed) skills[parsed.name] = { description: parsed.description, instructions: parsed.instructions }
    }
  } catch {
    // No bundled skills dir (e.g. dev checkout without it yet) — fine, just none available.
  }
  globalSkillsCache = skills
  return skills
}

function loadPersonalSkills(): PersonalSkill[] {
  try {
    return JSON.parse(fs.readFileSync(PERSONAL_SKILLS_PATH, 'utf-8'))
  } catch {
    return []
  }
}

function savePersonalSkills(skills: PersonalSkill[]): void {
  fs.mkdirSync(path.dirname(PERSONAL_SKILLS_PATH), { recursive: true })
  fs.writeFileSync(PERSONAL_SKILLS_PATH, JSON.stringify(skills, null, 2), 'utf-8')
}

export function listPersonalSkills(): PersonalSkill[] {
  return loadPersonalSkills().sort((a, b) => b.id - a.id)
}

export function createPersonalSkill(name: string, description: string, instructions: string): PersonalSkill {
  const skills = loadPersonalSkills()
  if (skills.some(s => s.name === name)) {
    throw new Error(`Já tens um skill chamado '${name}'.`)
  }
  const skill: PersonalSkill = { id: Date.now(), name, description, instructions, created_at: new Date().toISOString() }
  skills.push(skill)
  savePersonalSkills(skills)
  return skill
}

export function updatePersonalSkill(id: number, name: string, description: string, instructions: string): PersonalSkill {
  const skills = loadPersonalSkills()
  if (skills.some(s => s.name === name && s.id !== id)) {
    throw new Error(`Já tens um skill chamado '${name}'.`)
  }
  const idx = skills.findIndex(s => s.id === id)
  if (idx === -1) throw new Error('Skill não encontrado.')
  skills[idx] = { ...skills[idx], name, description, instructions }
  savePersonalSkills(skills)
  return skills[idx]
}

export function deletePersonalSkill(id: number): void {
  savePersonalSkills(loadPersonalSkills().filter(s => s.id !== id))
}

export function catalogPrompt(): string {
  const global = loadGlobalSkills()
  const personal = loadPersonalSkills()
  if (!Object.keys(global).length && !personal.length) return ''

  const parts = [
    '\n\nYou also have skills available — reusable step-by-step instructions ' +
    'for specific recurring tasks. Call usar_skill(nome) BEFORE attempting a ' +
    'task that matches one of these; it returns the exact steps to follow ' +
    'using your other tools. Do not improvise an approach for a task a skill ' +
    'already covers.',
  ]
  if (Object.keys(global).length) {
    const lines = Object.entries(global).map(([name, s]) => `- ${name}: ${s.description}`)
    parts.push('Skills:\n' + lines.join('\n'))
  }
  if (personal.length) {
    const lines = personal.map(s => `- ${s.name}: ${s.description}`)
    parts.push('This user\'s own personal skills:\n' + lines.join('\n'))
  }
  return parts.join('\n')
}

export function usarSkill(nome: string): string {
  const global = loadGlobalSkills()
  if (global[nome]) return global[nome].instructions
  const personal = loadPersonalSkills().find(s => s.name === nome)
  if (personal) return personal.instructions
  const available = [...Object.keys(global), ...loadPersonalSkills().map(s => s.name)].join(', ') || '(nenhuma)'
  return `Skill '${nome}' não encontrada. Skills disponíveis: ${available}`
}
