import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeFileSystem } from '../../src/init/io'

// Delegates to the real implementation by default so every test below hits the
// actual filesystem; only the EACCES test overrides a single call.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn(actual.readFile) }
})

const mockedReadFile = vi.mocked(readFile)

describe('nodeFileSystem', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'canvas-mcp-nodefs-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  describe('exists', () => {
    it('returns false for a missing path (ENOENT)', async () => {
      expect(await nodeFileSystem.exists(join(dir, 'missing.json'))).toBe(false)
    })

    it('returns true for a present, readable file', async () => {
      const file = join(dir, 'present.json')
      await nodeFileSystem.writeFile(file, '{}')
      expect(await nodeFileSystem.exists(file)).toBe(true)
    })

    it('returns true when readFile rejects with a non-ENOENT error (e.g. EACCES)', async () => {
      mockedReadFile.mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }))
      expect(await nodeFileSystem.exists(join(dir, 'unreadable.json'))).toBe(true)
    })
  })

  describe('readFile / writeFile', () => {
    it('round-trips UTF-8 content, including non-ASCII text', async () => {
      const file = join(dir, 'utf8.txt')
      const content = 'héllo wörld — 日本語 📚'

      await nodeFileSystem.writeFile(file, content)

      expect(await nodeFileSystem.readFile(file)).toBe(content)
      // Confirm the bytes on disk are actually UTF-8, not just assumed.
      const raw = await readFile(file)
      expect(raw.equals(Buffer.from(content, 'utf8'))).toBe(true)
    })
  })

  describe('copyFile / rename', () => {
    it('copyFile duplicates content and leaves the source in place', async () => {
      const src = join(dir, 'copy-src.json')
      const dest = join(dir, 'copy-dest.json')
      await nodeFileSystem.writeFile(src, '{"a":1}')

      await nodeFileSystem.copyFile(src, dest)

      expect(await nodeFileSystem.readFile(dest)).toBe('{"a":1}')
      expect(await nodeFileSystem.exists(src)).toBe(true)
    })

    it('rename moves content and removes the source', async () => {
      const src = join(dir, 'rename-src.json')
      const dest = join(dir, 'rename-dest.json')
      await nodeFileSystem.writeFile(src, '{"b":2}')

      await nodeFileSystem.rename(src, dest)

      expect(await nodeFileSystem.readFile(dest)).toBe('{"b":2}')
      expect(await nodeFileSystem.exists(src)).toBe(false)
    })
  })

  describe('mkdir', () => {
    it('defaults to recursive: true, creating a two-level-deep path with no options', async () => {
      const nested = join(dir, 'nested-a', 'nested-b')

      await nodeFileSystem.mkdir(nested)

      const file = join(nested, 'ok.txt')
      await nodeFileSystem.writeFile(file, 'ok')
      expect(await nodeFileSystem.readFile(file)).toBe('ok')
    })

    it('rejects when { recursive: false } and the parent does not exist', async () => {
      const nested = join(dir, 'no-such-parent', 'child')

      await expect(nodeFileSystem.mkdir(nested, { recursive: false })).rejects.toThrow()
    })
  })
})
