import { describe, it, expect } from 'vitest'
import { createMemoryFileSystem } from '../../src/init/io'

describe('memoryFileSystem', () => {
  it('reports a file as not existing before it is written', async () => {
    const fs = createMemoryFileSystem()
    await fs.mkdir('/tmp', { recursive: true })
    expect(await fs.exists('/tmp/cfg.json')).toBe(false)
  })

  it('writes and reads back a file once the parent dir exists', async () => {
    const fs = createMemoryFileSystem()
    await fs.mkdir('/tmp/x', { recursive: true })
    await fs.writeFile('/tmp/x/cfg.json', '{"a":1}')
    expect(await fs.readFile('/tmp/x/cfg.json')).toBe('{"a":1}')
    expect(await fs.exists('/tmp/x/cfg.json')).toBe(true)
  })

  it('refuses to write into a non-existent directory', async () => {
    const fs = createMemoryFileSystem()
    await expect(fs.writeFile('/no/such/dir/cfg.json', '{}')).rejects.toThrow(/ENOENT/)
  })

  it('seeds initial files via the constructor', async () => {
    const fs = createMemoryFileSystem({ '/seed.json': '{"seed":true}' })
    expect(await fs.readFile('/seed.json')).toBe('{"seed":true}')
  })

  it('rename is atomic-ish: source disappears, dest holds the content', async () => {
    const fs = createMemoryFileSystem()
    await fs.mkdir('/a', { recursive: true })
    await fs.writeFile('/a/cfg.json.tmp', '{"v":2}')
    await fs.rename('/a/cfg.json.tmp', '/a/cfg.json')
    expect(await fs.readFile('/a/cfg.json')).toBe('{"v":2}')
    expect(await fs.exists('/a/cfg.json.tmp')).toBe(false)
  })

  it('supports Windows-style paths under mkdir/writeFile', async () => {
    const fs = createMemoryFileSystem()
    await fs.mkdir('C:\\Users\\A\\.cursor', { recursive: true })
    await fs.writeFile('C:\\Users\\A\\.cursor\\mcp.json', '{}')
    expect(await fs.readFile('C:\\Users\\A\\.cursor\\mcp.json')).toBe('{}')
  })

  it('copyFile duplicates content; the source still exists', async () => {
    const fs = createMemoryFileSystem()
    await fs.mkdir('/d', { recursive: true })
    await fs.writeFile('/d/orig.json', '{"o":1}')
    await fs.copyFile('/d/orig.json', '/d/orig.json.bak')
    expect(await fs.readFile('/d/orig.json.bak')).toBe('{"o":1}')
    expect(await fs.exists('/d/orig.json')).toBe(true)
  })
})
