// Token minting, hashing, and PKCE for the OAuth profile (design §6, §7).
//
// Tokens are opaque: 32 random bytes, base64url, behind a type prefix so a
// leaked string is recognisable to secret scanners. Only SHA-256 hashes are
// ever stored, so a copy of the store is not a copy of the credentials.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const TOKEN_PREFIX = {
  access: 'mcpat_',
  refresh: 'mcprt_',
  code: 'mcpac_',
  client: 'mcpcl_',
  secret: 'mcpcs_',
} as const

export type TokenKind = keyof typeof TOKEN_PREFIX

/** 256 bits of entropy behind a recognisable prefix. */
export function mintToken(kind: TokenKind): string {
  return `${TOKEN_PREFIX[kind]}${randomBytes(32).toString('base64url')}`
}

/** Random opaque identifier (pending authorizations, grants, cookies). */
export function randomId(): string {
  return randomBytes(32).toString('base64url')
}

/** Lookup key for a token, code, or secret. Hex so it is safe in JSON and file names. */
export function hashToken(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value, 'ascii').digest('base64url')
}

/** Constant-time string equality; unequal lengths compare false without leaking where. */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/** True when `secret` hashes to `hash` (client secrets are stored hashed). */
export function verifyHashedSecret(secret: string, hash: string): boolean {
  return timingSafeEqualStrings(hashToken(secret), hash)
}

// RFC 7636 §4.1: verifier is 43–128 characters of the unreserved set.
const CODE_VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/
// The S256 challenge is base64url of 32 bytes: exactly 43 characters, no padding.
const CODE_CHALLENGE_RE = /^[A-Za-z0-9\-_]{43}$/

export function isValidCodeChallenge(challenge: string): boolean {
  return CODE_CHALLENGE_RE.test(challenge)
}

export function isValidCodeVerifier(verifier: string): boolean {
  return CODE_VERIFIER_RE.test(verifier)
}

/**
 * PKCE S256 check (RFC 7636 §4.6). `plain` is not a method this server
 * accepts, so there is nothing to select on: the challenge is always compared
 * to `BASE64URL(SHA256(verifier))`.
 */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  if (!isValidCodeVerifier(codeVerifier) || !isValidCodeChallenge(codeChallenge)) return false
  return timingSafeEqualStrings(sha256Base64Url(codeVerifier), codeChallenge)
}
