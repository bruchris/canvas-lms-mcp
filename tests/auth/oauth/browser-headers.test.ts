// What a real browser does with the response headers on the consent page.
//
// QA R1/R2 (PR #356) were both invisible to the rest of the suite because
// every test posts the consent form itself with a hand-set `origin` header,
// which is not what Chrome sends. The two rules below are modelled from the
// specs, given a control that reproduces the shipped-and-broken values, and
// then applied to the page the authorization server actually serves.
//
// The end-to-end proof is `scripts/verify-consent-browser.mjs` (real headless
// Chrome over the DevTools protocol) and row 5a/6a of the manual matrix in
// `docs/oauth-profile.md`. This file is the part that runs in CI.

import { describe, expect, it } from 'vitest'
import { BASE_ENV, PKCE, harness, registerPublicClient, type Harness } from './harness'

const ISSUER_ORIGIN = new URL(BASE_ENV.CANVAS_MCP_ISSUER!).origin

/**
 * Fetch, "append a request `Origin` header": for a non-CORS POST the browser
 * serialises `null` instead of the real origin under some referrer policies.
 * That `null` is what the server's origin allowlist refused.
 */
function originOnSameOriginFormPost(policy: string): string {
  switch (policy) {
    case 'no-referrer':
      return 'null'
    // "same-origin" nulls the Origin only when the request is cross-origin,
    // and the consent form posts to the issuer itself.
    case 'same-origin':
      return ISSUER_ORIGIN
    // The "strict-*" and "*-when-downgrade" policies null it only on an
    // https → http downgrade, which a same-origin post never is.
    default:
      return ISSUER_ORIGIN
  }
}

/**
 * Referrer Policy: does the browser send any `Referer` when this page
 * navigates to another origin? The consent page's next hop is Canvas, so the
 * answer has to stay "no" — that was the point of `no-referrer`, and a fix
 * that just drops the header would regress it to the browser default.
 */
function sendsRefererCrossOrigin(policy: string): boolean {
  return !['no-referrer', 'same-origin'].includes(policy)
}

/** Every directive name in a CSP header, lower-cased. */
function cspDirectives(header: string): string[] {
  return header
    .split(';')
    .map((part) => part.trim().split(/\s+/)[0]?.toLowerCase() ?? '')
    .filter((name) => name !== '')
}

async function consentPage(h: Harness): Promise<Record<string, string>> {
  const client = await registerPublicClient(h)
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    code_challenge: PKCE.challenge,
    code_challenge_method: 'S256',
    state: 'state-abc',
    resource: h.config.resource,
  })
  const res = await h.send({ url: `/oauth/authorize?${params}` })
  expect(res._status).toBe(200)
  expect(res._body).toContain('<form')
  return res._headers
}

describe('consent page browser contract', () => {
  it('models the two rules so that the shipped-and-broken values fail', () => {
    // Control: the value this PR shipped, which produced `Origin: null` and a
    // 403 from the origin allowlist in Chrome 153.
    expect(originOnSameOriginFormPost('no-referrer')).toBe('null')
    // Control: simply deleting the header falls back to the browser default,
    // which leaks the issuer origin to Canvas as a `Referer`.
    expect(sendsRefererCrossOrigin('strict-origin-when-cross-origin')).toBe(true)
    // Only one value satisfies both rules.
    const both = [
      'no-referrer',
      'no-referrer-when-downgrade',
      'origin',
      'origin-when-cross-origin',
      'same-origin',
      'strict-origin',
      'strict-origin-when-cross-origin',
      'unsafe-url',
    ].filter((p) => originOnSameOriginFormPost(p) !== 'null' && !sendsRefererCrossOrigin(p))
    expect(both).toEqual(['same-origin'])
  })

  it('ships a Referrer-Policy that still sends Origin on the consent POST', async () => {
    const headers = await consentPage(await harness())
    const policy = headers['referrer-policy']
    expect(policy).toBeDefined()
    expect(originOnSameOriginFormPost(policy!)).toBe(ISSUER_ORIGIN)
    expect(sendsRefererCrossOrigin(policy!)).toBe(false)
  })

  it('does not restrict form-action, which Chrome also enforces on the redirect', async () => {
    // Both outcomes of the consent POST are a 302 to another origin — Canvas
    // on allow, the client's redirect URI on deny — and Chrome checks
    // `form-action` against every hop, so `'self'` aborted the navigation.
    // `form-action` has no `default-src` fallback in CSP 3, so omitting it is
    // the whole fix; the rest of the policy is unchanged.
    const headers = await consentPage(await harness())
    const csp = headers['content-security-policy']
    expect(csp).toBeDefined()
    expect(cspDirectives(csp!)).toEqual(['default-src', 'style-src', 'frame-ancestors', 'base-uri'])
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'none'")
  })

  it('applies the same headers to every HTML response, not just the consent page', async () => {
    const h = await harness()
    const consent = await consentPage(h)
    // An HTML error page: unknown client, so no redirect is trusted.
    const error = await h.send({ url: '/oauth/authorize?client_id=mcpcl_unknown' })
    expect(error._status).toBe(400)
    expect(error._headers['content-type']).toContain('text/html')
    for (const name of ['referrer-policy', 'content-security-policy', 'x-frame-options']) {
      expect(error._headers[name], name).toBe(consent[name])
    }
  })
})
