import { describe, expect, it } from 'vitest'
import {
  findMatchingRedirectUri,
  isLoopbackHost,
  redirectUriMatches,
  validateRedirectUri,
} from '../../../src/auth/oauth/redirect-uri'

describe('redirect URI rules (#302 §7.1)', () => {
  describe('isLoopbackHost', () => {
    it('recognises localhost, 127/8, and ::1 in both spellings', () => {
      for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '[::1]']) {
        expect(isLoopbackHost(host), host).toBe(true)
      }
    })

    it('rejects everything else, including lookalikes', () => {
      for (const host of [
        'localhost.evil.com',
        '127.0.0.1.evil.com',
        '10.0.0.1',
        'example.com',
        '',
      ]) {
        expect(isLoopbackHost(host), host).toBe(false)
      }
    })
  })

  describe('validateRedirectUri (registration)', () => {
    it('accepts https anywhere and http on loopback', () => {
      expect(validateRedirectUri('https://claude.ai/api/mcp/auth_callback').ok).toBe(true)
      expect(validateRedirectUri('http://127.0.0.1/callback').ok).toBe(true)
      expect(validateRedirectUri('http://127.0.0.1:1455/callback').ok).toBe(true)
      expect(validateRedirectUri('http://[::1]:8080/cb').ok).toBe(true)
      expect(validateRedirectUri('http://localhost:3000/callback').ok).toBe(true)
    })

    it('rejects plain http off loopback, custom schemes, fragments, credentials, and relative URIs', () => {
      const cases: Array<[string, RegExp]> = [
        ['http://example.com/callback', /https, or http on a loopback host/],
        ['myapp://callback', /https, or http on a loopback host/],
        ['https://example.com/cb#frag', /fragment/],
        ['https://user:pw@example.com/cb', /credentials/],
        ['/relative/callback', /not an absolute URL/],
      ]
      for (const [uri, reason] of cases) {
        const result = validateRedirectUri(uri)
        expect(result.ok, uri).toBe(false)
        if (!result.ok) expect(result.reason).toMatch(reason)
      }
    })
  })

  describe('redirectUriMatches (authorization request)', () => {
    it('is an exact string match for https URIs — no prefix, case, or trailing-slash leniency', () => {
      const registered = 'https://claude.ai/api/mcp/auth_callback'
      expect(redirectUriMatches(registered, registered)).toBe(true)
      expect(redirectUriMatches(registered, `${registered}/`)).toBe(false)
      expect(redirectUriMatches(registered, `${registered}?x=1`)).toBe(false)
      expect(
        redirectUriMatches(registered, 'https://claude.ai/api/mcp/auth_callback/../evil'),
      ).toBe(false)
      expect(redirectUriMatches(registered, 'https://CLAUDE.ai/api/mcp/auth_callback')).toBe(false)
      expect(redirectUriMatches('https://example.com:8443/cb', 'https://example.com:8444/cb')).toBe(
        false,
      )
    })

    it('ignores only the port for loopback http registrations (RFC 8252 §7.3, what Codex needs)', () => {
      expect(
        redirectUriMatches('http://127.0.0.1/callback', 'http://127.0.0.1:53117/callback'),
      ).toBe(true)
      expect(
        redirectUriMatches('http://127.0.0.1:1455/callback', 'http://127.0.0.1:60000/callback'),
      ).toBe(true)
      expect(redirectUriMatches('http://[::1]/cb', 'http://[::1]:9999/cb')).toBe(true)
      expect(redirectUriMatches('http://localhost/cb', 'http://localhost:4444/cb')).toBe(true)
    })

    it('still requires scheme, host, path, and query to match on loopback', () => {
      expect(redirectUriMatches('http://127.0.0.1/callback', 'http://127.0.0.1:1/other')).toBe(
        false,
      )
      expect(redirectUriMatches('http://127.0.0.1/callback', 'http://localhost:1/callback')).toBe(
        false,
      )
      expect(redirectUriMatches('http://127.0.0.1/callback', 'https://127.0.0.1:1/callback')).toBe(
        false,
      )
      expect(
        redirectUriMatches('http://127.0.0.1/callback', 'http://127.0.0.1:1/callback?a=1'),
      ).toBe(false)
      expect(redirectUriMatches('http://127.0.0.1/callback', 'http://127.0.0.1:1/callback#f')).toBe(
        false,
      )
    })

    it('never applies the port exception to a non-loopback host that merely looks similar', () => {
      expect(
        redirectUriMatches('http://127.0.0.1.evil.com/cb', 'http://127.0.0.1.evil.com:81/cb'),
      ).toBe(false)
    })

    it('findMatchingRedirectUri returns the registered form that matched', () => {
      const registered = ['https://a.example/cb', 'http://127.0.0.1/callback']
      expect(findMatchingRedirectUri(registered, 'http://127.0.0.1:5000/callback')).toBe(
        'http://127.0.0.1/callback',
      )
      expect(findMatchingRedirectUri(registered, 'https://b.example/cb')).toBeUndefined()
    })
  })
})
