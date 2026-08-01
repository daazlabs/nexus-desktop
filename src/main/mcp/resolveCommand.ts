import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const isWin = process.platform === 'win32'

// The MCP SDK's StdioClientTransport spawns via `cross-spawn`, which already
// resolves Windows .cmd/.bat shims (npx, npm, etc.) and PATHEXT correctly —
// so no shell wrapper is needed here, unlike a raw `child_process.spawn`.
// What cross-spawn can't fix is a wrong PATH in the first place (see
// fixPath() in index.ts, called at startup for the macOS Finder-launch
// case). This just turns a bare, unhelpful ENOENT into a clear message
// before the SDK ever tries to spawn the process.
export async function resolveCommand(command: string): Promise<string> {
  if (command.includes('/') || command.includes('\\')) return command

  try {
    if (isWin) {
      await execFileAsync('where', [command])
    } else {
      await execFileAsync('which', [command])
    }
    return command
  } catch {
    throw new Error(
      `Comando MCP "${command}" não foi encontrado no PATH. Confirma que está instalado e acessível (experimenta correr "${command} --version" num terminal).`,
    )
  }
}

// StdioClientTransport defaults to a minimal, safety-filtered environment
// (see DEFAULT_INHERITED_ENV_VARS in the SDK) rather than the full
// process.env — enough to break servers that expect a normal shell env
// (PATH additions from pyenv/nvm, PYTHONPATH, etc). Passing the full env
// through here mirrors what a terminal-launched server would already see.
export function buildEnv(extra?: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) base[k] = v
  }
  return { ...base, ...(extra ?? {}) }
}
