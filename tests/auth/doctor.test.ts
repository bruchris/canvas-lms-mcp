import { describe, expect, it, vi } from 'vitest'
import { diagnose, formatReport, scanDoctorArgs } from '../../src/auth/doctor'
import { doctorArgv, main } from '../../src/doctor'

const SECRETS = ['pat-SECRET-token', 'dev-key-SECRET', '10000000000001']

function report(argv: string[], env: Record<string, string | undefined>) {
  const r = diagnose(argv, env)
  return { r, text: formatReport(r) }
}

describe('doctor (#302 §11)', () => {
  it('scans the same flags parseArgs reads, in both forms, without exiting', () => {
    expect(
      scanDoctorArgs([
        'serve',
        '--auth-profile=oauth_brokered',
        '--issuer',
        'http://127.0.0.1:1',
        '--host',
        'x',
      ]),
    ).toEqual({
      mode: 'http',
      authProfile: 'oauth_brokered',
      issuer: 'http://127.0.0.1:1',
      host: 'x',
    })
    expect(scanDoctorArgs(['--token', 't', '--base-url', 'u'])).toEqual({
      mode: 'stdio',
      token: 't',
      baseUrl: 'u',
    })
    expect(scanDoctorArgs(['--token'])).toEqual({ mode: 'stdio', token: '' })
  })

  it('stdio with a PAT: ready, and says why no host OAuth badge is possible', () => {
    const { r, text } = report([], {
      CANVAS_API_TOKEN: SECRETS[0],
      CANVAS_BASE_URL: 'https://school.instructure.com',
    })
    expect(r.ready).toBe(true)
    expect(r.profile).toBe('local_static_token')
    expect(text).toContain('[ok     ] Canvas base URL')
    expect(text).toContain('personal access token set (CANVAS_API_TOKEN)')
    expect(text).toContain('Auth Unsupported')
    expect(text).toContain('Result: ready (local_static_token)')
  })

  it('stdio without a credential: not ready, names the fix, exit code 1', () => {
    const { r, text } = report([], { CANVAS_BASE_URL: 'https://school.instructure.com' })
    expect(r.ready).toBe(false)
    expect(text).toContain('[MISSING] Canvas credential')
    expect(text).toContain('--token or CANVAS_API_TOKEN')
    expect(text).toContain('Result: not ready')
  })

  it('never prints the base URL or a credential value (identity-safe)', () => {
    const env = {
      CANVAS_API_TOKEN: SECRETS[0],
      CANVAS_BASE_URL: 'https://very-specific-school.instructure.com',
      CANVAS_OAUTH_CLIENT_ID: SECRETS[2],
      CANVAS_OAUTH_CLIENT_SECRET: SECRETS[1],
      CANVAS_MCP_ISSUER: 'http://127.0.0.1:3001',
    }
    for (const argv of [
      [],
      ['serve'],
      ['serve', '--auth-profile', 'oauth_brokered'],
      ['--token', 'flag-SECRET'],
    ]) {
      const { text } = report(argv, env)
      expect(text).not.toContain('very-specific-school')
      for (const secret of [...SECRETS, 'flag-SECRET']) expect(text).not.toContain(secret)
    }
  })

  it('flags a base URL that ends in /api/v1, has a path, or is not https', () => {
    expect(
      report([], { CANVAS_API_TOKEN: 't', CANVAS_BASE_URL: 'https://s.instructure.com/api/v1' })
        .text,
    ).toContain('ends with /api/v1')
    expect(
      report([], { CANVAS_API_TOKEN: 't', CANVAS_BASE_URL: 'https://s.instructure.com/canvas' })
        .text,
    ).toContain('has a path')
    expect(
      report([], { CANVAS_API_TOKEN: 't', CANVAS_BASE_URL: 'http://s.instructure.com' }).text,
    ).toContain('is not https')
    expect(report([], { CANVAS_API_TOKEN: 't', CANVAS_BASE_URL: 'nope' }).text).toContain(
      'not an absolute URL',
    )
    expect(report([], { CANVAS_API_TOKEN: 't' }).r.ready).toBe(false)
  })

  it('reports an invalid or mismatched profile as not ready', () => {
    expect(report([], { CANVAS_AUTH_PROFILE: 'oauth' }).text).toContain(
      "Unknown CANVAS_AUTH_PROFILE value 'oauth'",
    )
    const mismatch = report(['--auth-profile', 'oauth_brokered'], {})
    expect(mismatch.r.ready).toBe(false)
    expect(mismatch.text).toContain('runs on http, but the command line selects stdio')
  })

  it('oauth_brokered: lists each required input by name and validates the whole config', () => {
    const env = {
      CANVAS_BASE_URL: 'https://school.instructure.com',
      CANVAS_MCP_ISSUER: 'http://127.0.0.1:3001',
      CANVAS_OAUTH_CLIENT_ID: SECRETS[2],
      CANVAS_OAUTH_CLIENT_SECRET: SECRETS[1],
    }
    const { r, text } = report(['serve', '--auth-profile', 'oauth_brokered'], env)
    expect(r.ready).toBe(true)
    expect(text).toContain('none required — obtained per user through Canvas OAuth')
    expect(text).toContain('[ok     ] Issuer')
    expect(text).toContain('[ok     ] Canvas Developer Key ID')
    expect(text).toContain('[ok     ] Canvas Developer Key secret')
    expect(text).toContain('resource http://127.0.0.1:3001/mcp, bind 127.0.0.1')
    expect(text).toContain('in-memory')
    expect(text).toContain('CIMD trusted hosts: chatgpt.com')
    expect(text).toContain('clients see "Not logged in"')

    const missing = report(['serve', '--auth-profile', 'oauth_brokered'], {
      ...env,
      CANVAS_OAUTH_CLIENT_SECRET: undefined,
    })
    expect(missing.r.ready).toBe(false)
    expect(missing.text).toContain('[MISSING] Canvas Developer Key secret')
    expect(missing.text).toContain('[MISSING] OAuth configuration')

    const leftover = report(['serve', '--auth-profile', 'oauth_brokered'], {
      ...env,
      CANVAS_API_TOKEN: 'x',
    })
    expect(leftover.text).toContain('[warn   ] Canvas credential')

    const exposed = report(['serve', '--auth-profile', 'oauth_brokered', '--host', '0.0.0.0'], env)
    expect(exposed.r.ready).toBe(false)
    expect(exposed.text).toContain('must bind a loopback host too')
  })

  it('entry point strips the subcommand words and returns the exit code', () => {
    expect(doctorArgv(['doctor', '--token', 't'])).toEqual(['--token', 't'])
    expect(doctorArgv(['auth', 'status'])).toEqual([])
    expect(doctorArgv(['--token', 't'])).toEqual(['--token', 't'])
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const saved = { ...process.env }
    try {
      delete process.env.CANVAS_API_TOKEN
      delete process.env.CANVAS_BASE_URL
      expect(main(['doctor'])).toBe(1)
      process.env.CANVAS_API_TOKEN = 't'
      process.env.CANVAS_BASE_URL = 'https://school.instructure.com'
      expect(main(['auth', 'status'])).toBe(0)
      expect(log).toHaveBeenCalledWith(expect.stringContaining('canvas-lms-mcp doctor'))
    } finally {
      process.env = saved
      log.mockRestore()
    }
  })
})
