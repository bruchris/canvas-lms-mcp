import { describe, it, expect, beforeEach } from 'vitest'
import TOML from '@iarna/toml'
import { createMemoryFileSystem } from '../../src/init/io'
import { mergeTomlConfig } from '../../src/init/toml-merge'
import type { McpEntry } from '../../src/init/json-merge'

const entry: McpEntry = {
  command: 'npx',
  args: ['canvas-lms-mcp', '--stdio'],
  env: { CANVAS_API_TOKEN: 'tok', CANVAS_BASE_URL: 'https://school.instructure.com/api/v1' },
}

describe('mergeTomlConfig', () => {
  let fs: ReturnType<typeof createMemoryFileSystem>

  beforeEach(() => {
    fs = createMemoryFileSystem()
  })

  it('creates a new TOML config file when none exists', async () => {
    await mergeTomlConfig(fs, '/home/alice/.codex/config.toml', 'mcp_servers', 'canvas-lms', entry)
    const raw = await fs.readFile('/home/alice/.codex/config.toml')
    const config = TOML.parse(raw)
    expect(config).toMatchObject({
      mcp_servers: { 'canvas-lms': { command: 'npx' } },
    })
    expect(await fs.exists('/home/alice/.codex/config.toml.bak')).toBe(false)
  })

  it('preserves pre-existing mcp_servers entries', async () => {
    await fs.mkdir('/home/alice/.codex', { recursive: true })
    const initial = TOML.stringify({ mcp_servers: { 'other-server': { command: 'other' } } })
    await fs.writeFile('/home/alice/.codex/config.toml', initial)
    await mergeTomlConfig(fs, '/home/alice/.codex/config.toml', 'mcp_servers', 'canvas-lms', entry)
    const config = TOML.parse(await fs.readFile('/home/alice/.codex/config.toml'))
    expect(config).toMatchObject({
      mcp_servers: { 'other-server': { command: 'other' }, 'canvas-lms': { command: 'npx' } },
    })
  })

  it('preserves top-level keys outside the wrapper', async () => {
    await fs.mkdir('/home/alice/.codex', { recursive: true })
    const initial = TOML.stringify({ model: 'gpt-4', mcp_servers: {} })
    await fs.writeFile('/home/alice/.codex/config.toml', initial)
    await mergeTomlConfig(fs, '/home/alice/.codex/config.toml', 'mcp_servers', 'canvas-lms', entry)
    const config = TOML.parse(await fs.readFile('/home/alice/.codex/config.toml'))
    expect(config.model).toBe('gpt-4')
    expect(config.mcp_servers).toMatchObject({ 'canvas-lms': { command: 'npx' } })
  })

  it('is idempotent: second write produces identical output', async () => {
    await mergeTomlConfig(fs, '/home/alice/.codex/config.toml', 'mcp_servers', 'canvas-lms', entry)
    const first = await fs.readFile('/home/alice/.codex/config.toml')
    await mergeTomlConfig(
      fs,
      '/home/alice/.codex/config.toml',
      'mcp_servers',
      'canvas-lms',
      entry,
      { noBackup: true },
    )
    const second = await fs.readFile('/home/alice/.codex/config.toml')
    expect(second).toBe(first)
  })

  it('creates a .bak backup when overwriting an existing file', async () => {
    await fs.mkdir('/home/alice/.codex', { recursive: true })
    const original = TOML.stringify({ mcp_servers: {} })
    await fs.writeFile('/home/alice/.codex/config.toml', original)
    await mergeTomlConfig(fs, '/home/alice/.codex/config.toml', 'mcp_servers', 'canvas-lms', entry)
    expect(await fs.exists('/home/alice/.codex/config.toml.bak')).toBe(true)
    expect(await fs.readFile('/home/alice/.codex/config.toml.bak')).toBe(original)
  })

  it('skips the .bak when noBackup is true', async () => {
    await fs.mkdir('/home/alice/.codex', { recursive: true })
    await fs.writeFile('/home/alice/.codex/config.toml', TOML.stringify({ mcp_servers: {} }))
    await mergeTomlConfig(
      fs,
      '/home/alice/.codex/config.toml',
      'mcp_servers',
      'canvas-lms',
      entry,
      { noBackup: true },
    )
    expect(await fs.exists('/home/alice/.codex/config.toml.bak')).toBe(false)
  })

  it('creates missing parent directories', async () => {
    await mergeTomlConfig(fs, '/home/alice/.codex/config.toml', 'mcp_servers', 'canvas-lms', entry)
    expect(await fs.exists('/home/alice/.codex/config.toml')).toBe(true)
  })

  it('leaves no .tmp file after a successful write', async () => {
    await mergeTomlConfig(fs, '/home/alice/.codex/config.toml', 'mcp_servers', 'canvas-lms', entry)
    expect(await fs.exists('/home/alice/.codex/config.toml.tmp')).toBe(false)
  })

  it('handles Windows-style paths', async () => {
    await mergeTomlConfig(
      fs,
      'C:\\Users\\Alice\\.codex\\config.toml',
      'mcp_servers',
      'canvas-lms',
      entry,
    )
    const raw = await fs.readFile('C:\\Users\\Alice\\.codex\\config.toml')
    const config = TOML.parse(raw)
    expect(config).toMatchObject({ mcp_servers: { 'canvas-lms': { command: 'npx' } } })
  })
})
