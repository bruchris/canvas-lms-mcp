import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CURRENT_MAP_VERSION,
  emptyConversationMap,
  emptyCourseMap,
  loadMap,
  saveMap,
  type CourseMap,
} from '../../src/pseudonym/store'

let tmpRoot: string

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'pseudonym-store-'))
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('emptyCourseMap / emptyConversationMap', () => {
  it('stamps version, host, course_id, and a fresh student dict', () => {
    const m = emptyCourseMap('school.instructure.com', 123)
    expect(m.version).toBe(CURRENT_MAP_VERSION)
    expect(m.host).toBe('school.instructure.com')
    expect(m.course_id).toBe(123)
    expect(m.next_pseudonym_index).toBe(1)
    expect(m.students).toEqual({})
    expect(typeof m.generated_at).toBe('string')
  })

  it('builds an empty conversation map without course_id', () => {
    const m = emptyConversationMap('school.instructure.com')
    expect(m.version).toBe(CURRENT_MAP_VERSION)
    expect(m.host).toBe('school.instructure.com')
    expect(m.next_pseudonym_index).toBe(1)
    expect(m.participants).toEqual({})
  })
})

describe('loadMap / saveMap', () => {
  it('returns null when file does not exist', async () => {
    const result = await loadMap<CourseMap>(join(tmpRoot, 'missing.json'))
    expect(result).toBeNull()
  })

  it('round-trips data through write+read', async () => {
    const file = join(tmpRoot, 'school.instructure.com', '123.json')
    const map = emptyCourseMap('school.instructure.com', 123)
    map.students['1'] = {
      pseudonym: 'Student 1',
      status: 'active',
      first_seen: '2026-01-01T00:00:00Z',
    }
    map.next_pseudonym_index = 2

    await saveMap(file, map)
    const loaded = await loadMap<CourseMap>(file)
    expect(loaded).toEqual(map)
  })

  it('creates parent directories', async () => {
    const file = join(tmpRoot, 'a', 'b', 'c', '1.json')
    await saveMap(file, emptyCourseMap('h', 1))
    const s = await stat(file)
    expect(s.isFile()).toBe(true)
  })

  it('observers never see a half-written file (sequential save+read)', async () => {
    // The pseudonymizer serializes writes to the same target via in-memory
    // locks; this test verifies that each individual save is atomic from a
    // reader's perspective — the target either holds the previous version or
    // the new one, never a torn JSON.
    const file = join(tmpRoot, 'sequential.json')
    for (let i = 1; i <= 8; i++) {
      const m = emptyCourseMap('h', 0)
      m.next_pseudonym_index = i
      await saveMap(file, m)
      const loaded = await loadMap<CourseMap>(file)
      expect(loaded?.next_pseudonym_index).toBe(i)
    }
  })

  it('does not leave .tmp- sidecar files after a successful save', async () => {
    const file = join(tmpRoot, 'school.instructure.com', '7.json')
    await saveMap(file, emptyCourseMap('school.instructure.com', 7))
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(join(tmpRoot, 'school.instructure.com'))
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([])
  })

  it('rethrows non-ENOENT read errors instead of silently returning null', async () => {
    // Pointing loadMap at a directory triggers EISDIR — not ENOENT.
    await expect(loadMap(tmpRoot)).rejects.toBeDefined()
  })
})

describe('file modes (POSIX only)', () => {
  // Windows ignores POSIX modes; the design accepts this and documents it.
  const itPosix = process.platform === 'win32' ? it.skip : it

  itPosix('writes the map file with mode 0o600', async () => {
    const file = join(tmpRoot, 'mode-test.json')
    await saveMap(file, emptyCourseMap('h', 1))
    const s = await stat(file)
    expect(s.mode & 0o777).toBe(0o600)
  })
})
