import { describe, it, expect, beforeEach } from 'vitest'
import TOML from '@iarna/toml'
import { createMemoryFileSystem } from '../../src/init/io'
import { writeClientConfigs, type McpEntry } from '../../src/init/config-writer'
import { CLIENTS, type PathEnv } from '../../src/init/clients'

const entry: McpEntry = {
  command: 'npx',
  args: ['canvas-lms-mcp', '--stdio'],
  env: { CANVAS_API_TOKEN: 'tok', CANVAS_BASE_URL: 'https://school.instructure.com/api/v1' },
}

const linuxEnv: PathEnv = { platform: 'linux', home: '/home/alice' }
const winEnv: PathEnv = {
  platform: 'win32',
  home: 'C:\\Users\\Alice',
  appData: 'C:\\Users\\Alice\\AppData\\Roaming',
}

describe('writeClientConfigs', () => {
  let fs: ReturnType<typeof createMemoryFileSystem>

  beforeEach(() => {
    fs = createMemoryFileSystem()
  })

  it('writes JSON config for a single JSON client', async () => {
    const cursor = CLIENTS.find((c) => c.id === 'cursor')!
    await writeClientConfigs(fs, [cursor], entry, { pathEnv: linuxEnv })
    const path = cursor.resolvePath(linuxEnv)
    const config = JSON.parse(await fs.readFile(path)) as Record<string, unknown>
    expect(config).toMatchObject({ mcpServers: { 'canvas-lms': entry } })
  })

  it('writes TOML config for the codex client', async () => {
    const codex = CLIENTS.find((c) => c.id === 'codex')!
    await writeClientConfigs(fs, [codex], entry, { pathEnv: linuxEnv })
    const path = codex.resolvePath(linuxEnv)
    const config = TOML.parse(await fs.readFile(path))
    expect(config).toMatchObject({ mcp_servers: { 'canvas-lms': { command: 'npx' } } })
  })

  it('writes all JSON clients in a single call', async () => {
    const jsonClients = CLIENTS.filter((c) => c.format === 'json')
    await writeClientConfigs(fs, jsonClients, entry, { pathEnv: linuxEnv })
    for (const client of jsonClients) {
      const path = client.resolvePath(linuxEnv)
      expect(await fs.exists(path)).toBe(true)
    }
  })

  it('writes all clients including codex in one call', async () => {
    const allClients = [...CLIENTS]
    await writeClientConfigs(fs, allClients, entry, { pathEnv: linuxEnv })
    for (const client of allClients) {
      const path = client.resolvePath(linuxEnv)
      expect(await fs.exists(path)).toBe(true)
    }
  })

  it('uses a custom serverName from opts', async () => {
    const cursor = CLIENTS.find((c) => c.id === 'cursor')!
    await writeClientConfigs(fs, [cursor], entry, {
      pathEnv: linuxEnv,
      serverName: 'my-canvas',
    })
    const path = cursor.resolvePath(linuxEnv)
    const config = JSON.parse(await fs.readFile(path)) as Record<string, unknown>
    expect(config).toMatchObject({ mcpServers: { 'my-canvas': entry } })
  })

  it('defaults serverName to canvas-lms', async () => {
    const cursor = CLIENTS.find((c) => c.id === 'cursor')!
    await writeClientConfigs(fs, [cursor], entry, { pathEnv: linuxEnv })
    const path = cursor.resolvePath(linuxEnv)
    const config = JSON.parse(await fs.readFile(path)) as Record<string, unknown>
    const servers = config.mcpServers as Record<string, unknown>
    expect(Object.keys(servers)).toContain('canvas-lms')
  })

  it('respects noBackup: no .bak created on overwrite', async () => {
    const cursor = CLIENTS.find((c) => c.id === 'cursor')!
    const path = cursor.resolvePath(linuxEnv)
    await writeClientConfigs(fs, [cursor], entry, { pathEnv: linuxEnv })
    await writeClientConfigs(fs, [cursor], entry, { pathEnv: linuxEnv, noBackup: true })
    expect(await fs.exists(`${path}.bak`)).toBe(false)
  })

  it('creates a .bak for a JSON client when overwriting without noBackup', async () => {
    const cursor = CLIENTS.find((c) => c.id === 'cursor')!
    const path = cursor.resolvePath(linuxEnv)
    await writeClientConfigs(fs, [cursor], entry, { pathEnv: linuxEnv })
    await writeClientConfigs(fs, [cursor], entry, { pathEnv: linuxEnv })
    expect(await fs.exists(`${path}.bak`)).toBe(true)
  })

  it('handles Windows paths for win32 platform', async () => {
    const claudeDesktop = CLIENTS.find((c) => c.id === 'claude-desktop')!
    await writeClientConfigs(fs, [claudeDesktop], entry, { pathEnv: winEnv })
    const path = claudeDesktop.resolvePath(winEnv)
    const config = JSON.parse(await fs.readFile(path)) as Record<string, unknown>
    expect(config).toMatchObject({ mcpServers: { 'canvas-lms': entry } })
  })

  it('is idempotent across repeated runs', async () => {
    const cursor = CLIENTS.find((c) => c.id === 'cursor')!
    await writeClientConfigs(fs, [cursor], entry, { pathEnv: linuxEnv })
    const after1 = await fs.readFile(cursor.resolvePath(linuxEnv))
    await writeClientConfigs(fs, [cursor], entry, { pathEnv: linuxEnv, noBackup: true })
    const after2 = await fs.readFile(cursor.resolvePath(linuxEnv))
    expect(after2).toBe(after1)
  })
})
