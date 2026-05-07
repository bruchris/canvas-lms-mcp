import { describe, it, expect } from 'vitest'
import { CLIENTS, CLIENT_IDS, getClient, type PathEnv } from '../../src/init/clients'

const linuxEnv: PathEnv = { platform: 'linux', home: '/home/alice' }
const macEnv: PathEnv = { platform: 'darwin', home: '/Users/alice' }
const winEnv: PathEnv = {
  platform: 'win32',
  home: 'C:\\Users\\Alice',
  appData: 'C:\\Users\\Alice\\AppData\\Roaming',
}

describe('clients registry', () => {
  it('exposes the seven v1 clients in stable order', () => {
    expect(CLIENT_IDS).toEqual([
      'claude-desktop',
      'claude-code',
      'cursor',
      'vscode',
      'windsurf',
      'codex',
      'continue',
    ])
  })

  it('returns undefined for unknown ids', () => {
    expect(getClient('emacs')).toBeUndefined()
  })

  it('returns the descriptor for a known id', () => {
    const cursor = getClient('cursor')
    expect(cursor?.name).toBe('Cursor')
    expect(cursor?.format).toBe('json')
    expect(cursor?.wrapperKey).toBe('mcpServers')
  })

  it('VS Code uses the "servers" wrapper key (not "mcpServers")', () => {
    expect(getClient('vscode')?.wrapperKey).toBe('servers')
  })

  it('Codex CLI is the only TOML target', () => {
    const tomlClients = CLIENTS.filter((c) => c.format === 'toml')
    expect(tomlClients.map((c) => c.id)).toEqual(['codex'])
  })
})

describe('clients path resolution — Linux', () => {
  const paths = Object.fromEntries(CLIENTS.map((c) => [c.id, c.resolvePath(linuxEnv)]))

  it('matches the snapshot for every client', () => {
    expect(paths).toMatchInlineSnapshot(`
      {
        "claude-code": "/home/alice/.claude.json",
        "claude-desktop": "/home/alice/.config/Claude/claude_desktop_config.json",
        "codex": "/home/alice/.codex/config.toml",
        "continue": "/home/alice/.continue/config.json",
        "cursor": "/home/alice/.cursor/mcp.json",
        "vscode": "/home/alice/.config/Code/User/mcp.json",
        "windsurf": "/home/alice/.codeium/windsurf/mcp_config.json",
      }
    `)
  })
})

describe('clients path resolution — macOS', () => {
  const paths = Object.fromEntries(CLIENTS.map((c) => [c.id, c.resolvePath(macEnv)]))

  it('matches the snapshot for every client', () => {
    expect(paths).toMatchInlineSnapshot(`
      {
        "claude-code": "/Users/alice/.claude.json",
        "claude-desktop": "/Users/alice/Library/Application Support/Claude/claude_desktop_config.json",
        "codex": "/Users/alice/.codex/config.toml",
        "continue": "/Users/alice/.continue/config.json",
        "cursor": "/Users/alice/.cursor/mcp.json",
        "vscode": "/Users/alice/Library/Application Support/Code/User/mcp.json",
        "windsurf": "/Users/alice/.codeium/windsurf/mcp_config.json",
      }
    `)
  })
})

describe('clients path resolution — Windows', () => {
  const paths = Object.fromEntries(CLIENTS.map((c) => [c.id, c.resolvePath(winEnv)]))

  it('matches the snapshot for every client', () => {
    expect(paths).toMatchInlineSnapshot(`
      {
        "claude-code": "C:\\Users\\Alice\\.claude.json",
        "claude-desktop": "C:\\Users\\Alice\\AppData\\Roaming\\Claude\\claude_desktop_config.json",
        "codex": "C:\\Users\\Alice\\.codex\\config.toml",
        "continue": "C:\\Users\\Alice\\.continue\\config.json",
        "cursor": "C:\\Users\\Alice\\.cursor\\mcp.json",
        "vscode": "C:\\Users\\Alice\\AppData\\Roaming\\Code\\User\\mcp.json",
        "windsurf": "C:\\Users\\Alice\\.codeium\\windsurf\\mcp_config.json",
      }
    `)
  })

  it('throws if APPDATA is unset for clients that need it', () => {
    const winNoAppData: PathEnv = { ...winEnv, appData: undefined }
    expect(() => getClient('claude-desktop')!.resolvePath(winNoAppData)).toThrow(/APPDATA/)
    expect(() => getClient('vscode')!.resolvePath(winNoAppData)).toThrow(/APPDATA/)
  })

  it('does not require APPDATA for home-anchored clients', () => {
    const winNoAppData: PathEnv = { ...winEnv, appData: undefined }
    expect(() => getClient('cursor')!.resolvePath(winNoAppData)).not.toThrow()
    expect(() => getClient('claude-code')!.resolvePath(winNoAppData)).not.toThrow()
  })
})
