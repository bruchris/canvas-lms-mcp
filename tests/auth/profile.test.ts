import { describe, expect, it } from 'vitest'
import {
  AUTH_PROFILES,
  assertProfileSupportsTransport,
  defaultAuthProfile,
  parseAuthProfile,
  profileRequiresStaticToken,
  resolveAuthProfile,
  transportForProfile,
} from '../../src/auth/profile'

describe('auth profile boundary (#302 §3)', () => {
  it('names exactly the three profiles from the April 22 design', () => {
    expect([...AUTH_PROFILES]).toEqual([
      'local_static_token',
      'remote_static_token',
      'oauth_brokered',
    ])
  })

  describe('parseAuthProfile', () => {
    it('returns undefined for unset and empty input', () => {
      expect(parseAuthProfile(undefined, 'x')).toBeUndefined()
      expect(parseAuthProfile('', 'x')).toBeUndefined()
      expect(parseAuthProfile('   ', 'x')).toBeUndefined()
    })

    it('trims and lower-cases known values', () => {
      expect(parseAuthProfile('  OAuth_Brokered ', 'x')).toBe('oauth_brokered')
    })

    it('throws on an unknown value instead of falling back — a typo must not widen access', () => {
      expect(() => parseAuthProfile('oauth', 'CANVAS_AUTH_PROFILE')).toThrow(
        /Unknown CANVAS_AUTH_PROFILE value 'oauth'.*local_static_token, remote_static_token, oauth_brokered/,
      )
    })
  })

  describe('defaults and transport compatibility', () => {
    it('defaults stdio to local_static_token and serve to remote_static_token (backwards compatible)', () => {
      expect(defaultAuthProfile('stdio')).toBe('local_static_token')
      expect(defaultAuthProfile('http')).toBe('remote_static_token')
    })

    it('maps each profile to one transport', () => {
      expect(transportForProfile('local_static_token')).toBe('stdio')
      expect(transportForProfile('remote_static_token')).toBe('http')
      expect(transportForProfile('oauth_brokered')).toBe('http')
    })

    it('rejects a stdio profile on serve and an HTTP profile on stdio', () => {
      expect(() => assertProfileSupportsTransport('local_static_token', 'http')).toThrow(
        /stdio profile and cannot be used with 'serve'/,
      )
      expect(() => assertProfileSupportsTransport('oauth_brokered', 'stdio')).toThrow(
        /requires the HTTP transport/,
      )
      expect(() => assertProfileSupportsTransport('remote_static_token', 'stdio')).toThrow(
        /requires the HTTP transport/,
      )
      expect(() => assertProfileSupportsTransport('oauth_brokered', 'http')).not.toThrow()
    })
  })

  describe('profileRequiresStaticToken', () => {
    it('only the OAuth profile starts without a Canvas token (acceptance: starts without CANVAS_API_TOKEN)', () => {
      expect(profileRequiresStaticToken('local_static_token')).toBe(true)
      expect(profileRequiresStaticToken('remote_static_token')).toBe(true)
      expect(profileRequiresStaticToken('oauth_brokered')).toBe(false)
    })
  })

  describe('resolveAuthProfile', () => {
    it('flag beats env beats transport default', () => {
      expect(resolveAuthProfile({ mode: 'http' })).toBe('remote_static_token')
      expect(resolveAuthProfile({ mode: 'http', env: 'oauth_brokered' })).toBe('oauth_brokered')
      expect(
        resolveAuthProfile({ mode: 'http', env: 'oauth_brokered', flag: 'remote_static_token' }),
      ).toBe('remote_static_token')
    })

    it('does not parse the env var when the flag is present, so a bad ambient value cannot break a valid override', () => {
      expect(resolveAuthProfile({ mode: 'http', env: 'garbage', flag: 'oauth_brokered' })).toBe(
        'oauth_brokered',
      )
    })

    it('surfaces an invalid winning source', () => {
      expect(() => resolveAuthProfile({ mode: 'http', env: 'garbage' })).toThrow(
        /CANVAS_AUTH_PROFILE/,
      )
      expect(() => resolveAuthProfile({ mode: 'http', flag: 'garbage' })).toThrow(/--auth-profile/)
    })

    it('checks the resolved profile against the transport', () => {
      expect(() => resolveAuthProfile({ mode: 'stdio', env: 'oauth_brokered' })).toThrow(
        /requires the HTTP transport/,
      )
    })
  })
})
