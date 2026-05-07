import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseInitArgs } from '../../src/init/argv'

describe('parseInitArgs', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.CANVAS_API_TOKEN
    delete process.env.CANVAS_BASE_URL
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns sensible defaults with no args', () => {
    const result = parseInitArgs([])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config).toEqual({
      clients: [],
      token: undefined,
      baseUrl: undefined,
      serverName: 'canvas-lms',
      pin: undefined,
      nonInteractive: false,
      dryRun: false,
      noBackup: false,
      showHelp: false,
    })
  })

  it('reads token and base-url from env when flags absent', () => {
    process.env.CANVAS_API_TOKEN = 'env-token'
    process.env.CANVAS_BASE_URL = 'https://canvas.example.com/api/v1'
    const result = parseInitArgs([])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.token).toBe('env-token')
    expect(result.config.baseUrl).toBe('https://canvas.example.com/api/v1')
  })

  it('flags override env vars', () => {
    process.env.CANVAS_API_TOKEN = 'env-token'
    const result = parseInitArgs(['--token', 'flag-token'])
    if (!result.ok) throw new Error('expected ok')
    expect(result.config.token).toBe('flag-token')
  })

  it('accepts repeatable --client flags and dedupes', () => {
    const result = parseInitArgs([
      '--client',
      'cursor',
      '--client',
      'claude-desktop',
      '--client',
      'cursor',
    ])
    if (!result.ok) throw new Error('expected ok')
    expect(result.config.clients).toEqual(['cursor', 'claude-desktop'])
  })

  it('rejects unknown clients with a helpful list', () => {
    const result = parseInitArgs(['--client', 'emacs'])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/Unknown client "emacs"/)
    expect(result.message).toMatch(/cursor/)
    expect(result.flag).toBe('--client')
  })

  it('--non-interactive and --yes are equivalent', () => {
    const a = parseInitArgs(['--non-interactive'])
    const b = parseInitArgs(['--yes'])
    if (!a.ok || !b.ok) throw new Error('expected ok')
    expect(a.config.nonInteractive).toBe(true)
    expect(b.config.nonInteractive).toBe(true)
  })

  it('parses --dry-run and --no-backup', () => {
    const r = parseInitArgs(['--dry-run', '--no-backup'])
    if (!r.ok) throw new Error('expected ok')
    expect(r.config.dryRun).toBe(true)
    expect(r.config.noBackup).toBe(true)
  })

  it('validates --pin as semver', () => {
    const ok = parseInitArgs(['--pin', '1.12.0'])
    expect(ok.ok).toBe(true)
    const bad = parseInitArgs(['--pin', 'latest'])
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.flag).toBe('--pin')
  })

  it('accepts pre-release semver in --pin', () => {
    const r = parseInitArgs(['--pin', '2.0.0-alpha.1'])
    if (!r.ok) throw new Error('expected ok')
    expect(r.config.pin).toBe('2.0.0-alpha.1')
  })

  it('does NOT recognise --version (reserved for "print version")', () => {
    const r = parseInitArgs(['--version', '1.0.0'])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.message).toMatch(/Unknown argument: --version/)
  })

  it('validates --base-url is an http(s) URL', () => {
    const ok = parseInitArgs(['--base-url', 'https://canvas.example.com/api/v1'])
    expect(ok.ok).toBe(true)
    const noScheme = parseInitArgs(['--base-url', 'canvas.example.com'])
    expect(noScheme.ok).toBe(false)
    const ftp = parseInitArgs(['--base-url', 'ftp://canvas.example.com'])
    expect(ftp.ok).toBe(false)
  })

  it('validates --server-name shape', () => {
    const ok = parseInitArgs(['--server-name', 'canvas-lms-2'])
    expect(ok.ok).toBe(true)
    const bad = parseInitArgs(['--server-name', 'Canvas LMS'])
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.flag).toBe('--server-name')
  })

  it('rejects flags missing a value', () => {
    const r = parseInitArgs(['--token'])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.message).toMatch(/Missing value for --token/)
  })

  it('rejects unknown arguments', () => {
    const r = parseInitArgs(['--frobnicate'])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.message).toMatch(/Unknown argument: --frobnicate/)
  })

  it('--help / -h surfaces showHelp', () => {
    const a = parseInitArgs(['--help'])
    const b = parseInitArgs(['-h'])
    if (!a.ok || !b.ok) throw new Error('expected ok')
    expect(a.config.showHelp).toBe(true)
    expect(b.config.showHelp).toBe(true)
  })
})
