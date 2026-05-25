import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryFileSystem } from '../../src/init/io'
import { mergeJsonConfig, type McpEntry } from '../../src/init/json-merge'

const entry: McpEntry = {
  command: 'npx',
  args: ['canvas-lms-mcp', '--stdio'],
  env: { CANVAS_API_TOKEN: 'tok', CANVAS_BASE_URL: 'https://school.instructure.com/api/v1' },
}

describe('mergeJsonConfig', () => {
  let fs: ReturnType<typeof createMemoryFileSystem>

  beforeEach(() => {
    fs = createMemoryFileSystem()
  })

  it('creates a new config file when none exists', async () => {
    await mergeJsonConfig(fs, '/home/alice/.cursor/mcp.json', 'mcpServers', 'canvas-lms', entry)
    const raw = await fs.readFile('/home/alice/.cursor/mcp.json')
    const config = JSON.parse(raw) as Record<string, unknown>
    expect(config).toMatchObject({ mcpServers: { 'canvas-lms': entry } })
    expect(await fs.exists('/home/alice/.cursor/mcp.json.bak')).toBe(false)
  })

  it('preserves pre-existing keys when merging', async () => {
    await fs.mkdir('/home/alice/.cursor', { recursive: true })
    await fs.writeFile(
      '/home/alice/.cursor/mcp.json',
      JSON.stringify({ mcpServers: { 'other-server': { command: 'other' } } }, null, 2) + '\n',
    )
    await mergeJsonConfig(fs, '/home/alice/.cursor/mcp.json', 'mcpServers', 'canvas-lms', entry)
    const config = JSON.parse(await fs.readFile('/home/alice/.cursor/mcp.json')) as Record<
      string,
      unknown
    >
    expect(config).toMatchObject({
      mcpServers: { 'other-server': { command: 'other' }, 'canvas-lms': entry },
    })
  })

  it('preserves top-level keys outside the wrapper', async () => {
    await fs.mkdir('/home/alice/.cursor', { recursive: true })
    await fs.writeFile(
      '/home/alice/.cursor/mcp.json',
      JSON.stringify({ version: 1, mcpServers: {} }, null, 2) + '\n',
    )
    await mergeJsonConfig(fs, '/home/alice/.cursor/mcp.json', 'mcpServers', 'canvas-lms', entry)
    const config = JSON.parse(await fs.readFile('/home/alice/.cursor/mcp.json')) as Record<
      string,
      unknown
    >
    expect(config.version).toBe(1)
    expect(config.mcpServers).toMatchObject({ 'canvas-lms': entry })
  })

  it('is idempotent: second write produces identical output', async () => {
    await mergeJsonConfig(fs, '/home/alice/.cursor/mcp.json', 'mcpServers', 'canvas-lms', entry)
    const first = await fs.readFile('/home/alice/.cursor/mcp.json')
    await mergeJsonConfig(fs, '/home/alice/.cursor/mcp.json', 'mcpServers', 'canvas-lms', entry, {
      noBackup: true,
    })
    const second = await fs.readFile('/home/alice/.cursor/mcp.json')
    expect(second).toBe(first)
  })

  it('creates a .bak backup when overwriting an existing file', async () => {
    await fs.mkdir('/home/alice/.cursor', { recursive: true })
    const original = JSON.stringify({ mcpServers: {} }, null, 2) + '\n'
    await fs.writeFile('/home/alice/.cursor/mcp.json', original)
    await mergeJsonConfig(fs, '/home/alice/.cursor/mcp.json', 'mcpServers', 'canvas-lms', entry)
    expect(await fs.exists('/home/alice/.cursor/mcp.json.bak')).toBe(true)
    expect(await fs.readFile('/home/alice/.cursor/mcp.json.bak')).toBe(original)
  })

  it('skips the .bak when noBackup is true', async () => {
    await fs.mkdir('/home/alice/.cursor', { recursive: true })
    await fs.writeFile('/home/alice/.cursor/mcp.json', JSON.stringify({ mcpServers: {} }) + '\n')
    await mergeJsonConfig(fs, '/home/alice/.cursor/mcp.json', 'mcpServers', 'canvas-lms', entry, {
      noBackup: true,
    })
    expect(await fs.exists('/home/alice/.cursor/mcp.json.bak')).toBe(false)
  })

  it('creates missing parent directories', async () => {
    await mergeJsonConfig(
      fs,
      '/home/alice/.config/Claude/claude_desktop_config.json',
      'mcpServers',
      'canvas-lms',
      entry,
    )
    expect(await fs.exists('/home/alice/.config/Claude/claude_desktop_config.json')).toBe(true)
  })

  it('leaves no .tmp file after a successful write', async () => {
    await mergeJsonConfig(fs, '/home/alice/.cursor/mcp.json', 'mcpServers', 'canvas-lms', entry)
    expect(await fs.exists('/home/alice/.cursor/mcp.json.tmp')).toBe(false)
  })

  it('handles Windows-style paths', async () => {
    await mergeJsonConfig(
      fs,
      'C:\\Users\\Alice\\AppData\\Roaming\\Claude\\claude_desktop_config.json',
      'mcpServers',
      'canvas-lms',
      entry,
    )
    const raw = await fs.readFile(
      'C:\\Users\\Alice\\AppData\\Roaming\\Claude\\claude_desktop_config.json',
    )
    expect(JSON.parse(raw)).toMatchObject({ mcpServers: { 'canvas-lms': entry } })
  })

  it('creates a fresh mcpServers wrapper when config has none', async () => {
    await fs.mkdir('/home/alice/.cursor', { recursive: true })
    await fs.writeFile('/home/alice/.cursor/mcp.json', '{"version":2}\n')
    await mergeJsonConfig(fs, '/home/alice/.cursor/mcp.json', 'mcpServers', 'canvas-lms', entry)
    const config = JSON.parse(await fs.readFile('/home/alice/.cursor/mcp.json')) as Record<
      string,
      unknown
    >
    expect(config).toMatchObject({ version: 2, mcpServers: { 'canvas-lms': entry } })
  })
})
