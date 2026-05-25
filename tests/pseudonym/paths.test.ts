import { describe, it, expect } from 'vitest'
import {
  resolvePseudonymDir,
  normalizeHost,
  mapFilePath,
  conversationsFilePath,
} from '../../src/pseudonym/paths'

describe('resolvePseudonymDir', () => {
  it('honors CANVAS_PSEUDONYM_DIR override on every platform', () => {
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      const dir = resolvePseudonymDir({
        platform,
        env: { CANVAS_PSEUDONYM_DIR: '/custom/path' },
        home: '/home/test',
      })
      expect(dir).toBe('/custom/path')
    }
  })

  it('uses XDG_DATA_HOME on Linux when set', () => {
    const dir = resolvePseudonymDir({
      platform: 'linux',
      env: { XDG_DATA_HOME: '/xdg/data' },
      home: '/home/test',
    })
    expect(dir).toContain('xdg')
    expect(dir).toContain('canvas-lms-mcp')
    expect(dir).toContain('pseudonyms')
  })

  it('falls back to ~/.local/share on Linux without XDG', () => {
    const dir = resolvePseudonymDir({
      platform: 'linux',
      env: {},
      home: '/home/test',
    })
    expect(dir.replace(/\\/g, '/')).toBe('/home/test/.local/share/canvas-lms-mcp/pseudonyms')
  })

  it('uses Application Support on macOS', () => {
    const dir = resolvePseudonymDir({
      platform: 'darwin',
      env: {},
      home: '/Users/test',
    })
    expect(dir.replace(/\\/g, '/')).toBe(
      '/Users/test/Library/Application Support/canvas-lms-mcp/pseudonyms',
    )
  })

  it('uses %APPDATA% on Windows', () => {
    const dir = resolvePseudonymDir({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
      home: 'C:\\Users\\test',
    })
    expect(dir.replace(/\\/g, '/')).toBe('C:/Users/test/AppData/Roaming/canvas-lms-mcp/pseudonyms')
  })

  it('falls back to USERPROFILE on Windows when APPDATA missing', () => {
    const dir = resolvePseudonymDir({
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\test' },
      home: 'C:\\Users\\test',
    })
    expect(dir.replace(/\\/g, '/')).toContain('AppData/Roaming/canvas-lms-mcp/pseudonyms')
  })

  it('treats empty CANVAS_PSEUDONYM_DIR as unset', () => {
    const dir = resolvePseudonymDir({
      platform: 'linux',
      env: { CANVAS_PSEUDONYM_DIR: '' },
      home: '/home/test',
    })
    expect(dir).not.toBe('')
    expect(dir).toContain('canvas-lms-mcp')
  })
})

describe('normalizeHost', () => {
  it('returns lower-cased hostname without port', () => {
    expect(normalizeHost('https://School.Instructure.COM:443/api/v1')).toBe(
      'school.instructure.com',
    )
  })

  it('strips path and trailing slash', () => {
    expect(normalizeHost('https://school.instructure.com/api/v1')).toBe('school.instructure.com')
  })

  it('returns null for unparseable URLs', () => {
    expect(normalizeHost('not a url')).toBeNull()
  })
})

describe('mapFilePath / conversationsFilePath', () => {
  it('joins host and course_id into a .json file', () => {
    const p = mapFilePath('/root', 'school.instructure.com', 12345)
    expect(p.replace(/\\/g, '/')).toBe('/root/school.instructure.com/12345.json')
  })

  it('uses _conversations.json for the cross-course pool', () => {
    const p = conversationsFilePath('/root', 'school.instructure.com')
    expect(p.replace(/\\/g, '/')).toBe('/root/school.instructure.com/_conversations.json')
  })
})
