import { homedir } from 'node:os'
import { posix as posixPath, win32 as winPath } from 'node:path'

export type ClientId =
  | 'claude-desktop'
  | 'claude-code'
  | 'cursor'
  | 'vscode'
  | 'windsurf'
  | 'codex'
  | 'continue'

export type ConfigFormat = 'json' | 'toml'

export interface ClientDescriptor {
  id: ClientId
  name: string
  format: ConfigFormat
  wrapperKey: string
  resolvePath: (env: PathEnv) => string
}

export interface PathEnv {
  platform: NodeJS.Platform
  home: string
  appData?: string
}

const winAppDataOrThrow = (env: PathEnv): string => {
  if (!env.appData) {
    throw new Error('Cannot resolve Windows config path: %APPDATA% is not set')
  }
  return env.appData
}

const joinFor = (platform: NodeJS.Platform) =>
  platform === 'win32' ? winPath.join : posixPath.join

export const CLIENTS: readonly ClientDescriptor[] = [
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    format: 'json',
    wrapperKey: 'mcpServers',
    resolvePath: (env) => {
      const join = joinFor(env.platform)
      switch (env.platform) {
        case 'win32':
          return join(winAppDataOrThrow(env), 'Claude', 'claude_desktop_config.json')
        case 'darwin':
          return join(
            env.home,
            'Library',
            'Application Support',
            'Claude',
            'claude_desktop_config.json',
          )
        default:
          return join(env.home, '.config', 'Claude', 'claude_desktop_config.json')
      }
    },
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    format: 'json',
    wrapperKey: 'mcpServers',
    resolvePath: (env) => joinFor(env.platform)(env.home, '.claude.json'),
  },
  {
    id: 'cursor',
    name: 'Cursor',
    format: 'json',
    wrapperKey: 'mcpServers',
    resolvePath: (env) => joinFor(env.platform)(env.home, '.cursor', 'mcp.json'),
  },
  {
    id: 'vscode',
    name: 'VS Code (Copilot)',
    format: 'json',
    wrapperKey: 'servers',
    resolvePath: (env) => {
      const join = joinFor(env.platform)
      switch (env.platform) {
        case 'win32':
          return join(winAppDataOrThrow(env), 'Code', 'User', 'mcp.json')
        case 'darwin':
          return join(env.home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json')
        default:
          return join(env.home, '.config', 'Code', 'User', 'mcp.json')
      }
    },
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    format: 'json',
    wrapperKey: 'mcpServers',
    resolvePath: (env) =>
      joinFor(env.platform)(env.home, '.codeium', 'windsurf', 'mcp_config.json'),
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    format: 'toml',
    wrapperKey: 'mcp_servers',
    resolvePath: (env) => joinFor(env.platform)(env.home, '.codex', 'config.toml'),
  },
  {
    id: 'continue',
    name: 'Continue',
    format: 'json',
    wrapperKey: 'mcpServers',
    resolvePath: (env) => joinFor(env.platform)(env.home, '.continue', 'config.json'),
  },
] as const

export const CLIENT_IDS: readonly ClientId[] = CLIENTS.map((c) => c.id)

export function getClient(id: string): ClientDescriptor | undefined {
  return CLIENTS.find((c) => c.id === id)
}

export function currentPathEnv(): PathEnv {
  return {
    platform: process.platform,
    home: homedir(),
    appData: process.env.APPDATA,
  }
}
