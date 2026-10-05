import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  TOKEN_PREFIX,
  hashToken,
  isValidCodeChallenge,
  isValidCodeVerifier,
  mintToken,
  randomId,
  sha256Base64Url,
  timingSafeEqualStrings,
  verifyHashedSecret,
  verifyPkceS256,
} from '../../../src/auth/oauth/crypto'

describe('OAuth crypto helpers (#302 §6)', () => {
  describe('mintToken', () => {
    it('prefixes every kind so a leaked string is recognisable, and never repeats', () => {
      const seen = new Set<string>()
      for (const kind of Object.keys(TOKEN_PREFIX) as Array<keyof typeof TOKEN_PREFIX>) {
        for (let i = 0; i < 20; i++) {
          const token = mintToken(kind)
          expect(token.startsWith(TOKEN_PREFIX[kind])).toBe(true)
          // 32 bytes → 43 base64url characters.
          expect(token.slice(TOKEN_PREFIX[kind].length)).toMatch(/^[A-Za-z0-9_-]{43}$/)
          expect(seen.has(token)).toBe(false)
          seen.add(token)
        }
      }
    })

    it('randomId is 43 base64url characters', () => {
      expect(randomId()).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(randomId()).not.toBe(randomId())
    })
  })

  describe('hashing', () => {
    it('hashToken is SHA-256 hex, so stores hold lookup keys rather than credentials', () => {
      const expected = createHash('sha256').update('mcpat_abc').digest('hex')
      expect(hashToken('mcpat_abc')).toBe(expected)
      expect(hashToken('mcpat_abc')).not.toContain('mcpat_abc')
    })

    it('verifyHashedSecret round-trips and rejects the wrong secret', () => {
      const hash = hashToken('s3cret')
      expect(verifyHashedSecret('s3cret', hash)).toBe(true)
      expect(verifyHashedSecret('s3cret2', hash)).toBe(false)
    })

    it('timingSafeEqualStrings compares unequal lengths as false without throwing', () => {
      expect(timingSafeEqualStrings('a', 'ab')).toBe(false)
      expect(timingSafeEqualStrings('ab', 'ab')).toBe(true)
      expect(timingSafeEqualStrings('', '')).toBe(true)
    })
  })

  describe('PKCE S256 (RFC 7636)', () => {
    // The worked example from RFC 7636 Appendix B.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

    it('accepts the RFC test vector', () => {
      expect(sha256Base64Url(verifier)).toBe(challenge)
      expect(verifyPkceS256(verifier, challenge)).toBe(true)
    })

    it('rejects a verifier that does not hash to the challenge', () => {
      expect(verifyPkceS256(`${verifier.slice(0, -1)}A`, challenge)).toBe(false)
    })

    it('rejects verifiers outside the 43–128 unreserved-character range', () => {
      expect(isValidCodeVerifier('a'.repeat(42))).toBe(false)
      expect(isValidCodeVerifier('a'.repeat(43))).toBe(true)
      expect(isValidCodeVerifier('a'.repeat(128))).toBe(true)
      expect(isValidCodeVerifier('a'.repeat(129))).toBe(false)
      expect(isValidCodeVerifier(`${'a'.repeat(42)}+`)).toBe(false)
      expect(verifyPkceS256('short', sha256Base64Url('short'))).toBe(false)
    })

    it('rejects a challenge that is not 43 base64url characters', () => {
      expect(isValidCodeChallenge(challenge)).toBe(true)
      expect(isValidCodeChallenge(`${challenge}=`)).toBe(false)
      expect(isValidCodeChallenge('plain-text-challenge')).toBe(false)
      expect(verifyPkceS256(verifier, 'plain-text-challenge')).toBe(false)
    })
  })
})
