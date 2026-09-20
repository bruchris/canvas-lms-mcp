import { describe, expect, it, vi } from 'vitest'
import { ResourceServer } from '../../../src/auth/oauth/resource-server'
import { hashToken } from '../../../src/auth/oauth/crypto'
import { harness, loggedInTokens, makeReq, type Harness } from './harness'

function resourceServer(h: Harness, now?: () => number) {
  const revokeGrant = vi.fn((grantId: string) => h.as.revokeGrant(grantId))
  const rs = new ResourceServer({
    config: h.config,
    store: h.store,
    canvas: h.canvasClient,
    revokeGrant,
    now: now ?? (() => 1_800_000_000_000),
    log: h.log,
  })
  return { rs, revokeGrant }
}

const auth = (token: string) =>
  makeReq({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${token}` } })

/** Expire only the Canvas side of a grant, leaving the MCP access token valid. */
async function expireCanvasToken(h: Harness, grantId: string, now: number) {
  const grant = (await h.store.getGrant(grantId))!
  await h.store.updateGrant({ ...grant, canvas: { ...grant.canvas, expiresAt: now - 1 } })
}

describe('ResourceServer (#302 §8)', () => {
  it('challenges an unauthenticated request with 401 + resource_metadata + scope (what makes Codex show "Not logged in")', async () => {
    const h = await harness()
    const { rs } = resourceServer(h)
    const outcome = await rs.authenticate(makeReq({ method: 'POST', url: '/mcp' }))
    expect(outcome).toEqual({
      ok: false,
      status: 401,
      error: 'unauthorized',
      description: 'Authentication required',
      wwwAuthenticate:
        'Bearer resource_metadata="http://127.0.0.1:3001/.well-known/oauth-protected-resource/mcp", scope="canvas:read canvas:write"',
    })
  })

  it('refuses X-Canvas-Token outright in this profile (acceptance: never accepted)', async () => {
    const h = await harness()
    const { rs } = resourceServer(h)
    const { tokens } = await loggedInTokens(h)
    const outcome = await rs.authenticate(
      makeReq({
        method: 'POST',
        url: '/mcp',
        headers: { authorization: `Bearer ${tokens.accessToken}`, 'x-canvas-token': 'pat' },
      }),
    )
    expect(outcome).toMatchObject({ ok: false, status: 400, error: 'invalid_request' })
    expect((outcome as { description: string }).description).toContain(
      'X-Canvas-Token is not accepted',
    )
  })

  it('rejects a non-Bearer scheme', async () => {
    const h = await harness()
    const { rs } = resourceServer(h)
    const outcome = await rs.authenticate(
      makeReq({ method: 'POST', url: '/mcp', headers: { authorization: 'Basic abc' } }),
    )
    expect(outcome).toMatchObject({
      ok: false,
      status: 401,
      description: expect.stringMatching(/Bearer scheme/),
    })
  })

  it.each([
    ['an unknown token', () => 'mcpat_unknown'],
    ['a Canvas token used as the MCP bearer', () => 'canvas-access-canvas-code-login'],
  ])('answers 401 invalid_token to %s', async (_label, token) => {
    const h = await harness()
    const { rs } = resourceServer(h)
    await loggedInTokens(h)
    const outcome = await rs.authenticate(auth(token()))
    expect(outcome).toMatchObject({ ok: false, status: 401, error: 'invalid_token' })
    expect((outcome as { wwwAuthenticate: string }).wwwAuthenticate).toContain(
      'error="invalid_token"',
    )
    expect((outcome as { wwwAuthenticate: string }).wwwAuthenticate).toContain('resource_metadata=')
  })

  it('rejects a refresh token presented as a bearer', async () => {
    const h = await harness()
    const { rs } = resourceServer(h)
    const { tokens } = await loggedInTokens(h)
    expect(await rs.authenticate(auth(tokens.refreshToken!))).toMatchObject({
      ok: false,
      status: 401,
      error: 'invalid_token',
    })
  })

  it('rejects an expired access token and forgets it', async () => {
    let now = 1_800_000_000_000
    const h = await harness({ now: () => now })
    const { rs } = resourceServer(h, () => now)
    const { tokens } = await loggedInTokens(h)
    now += 61 * 60 * 1000
    expect(await rs.authenticate(auth(tokens.accessToken))).toMatchObject({
      ok: false,
      status: 401,
      error: 'invalid_token',
      description: 'Access token has expired',
    })
    expect(await h.store.getToken(hashToken(tokens.accessToken))).toBeUndefined()
  })

  it('rejects a token minted for another resource (audience binding)', async () => {
    const h = await harness()
    const { rs } = resourceServer(h)
    const { tokens } = await loggedInTokens(h)
    const record = (await h.store.getToken(hashToken(tokens.accessToken)))!
    await h.store.putToken({ ...record, resource: 'https://other.example/mcp' })
    expect(await rs.authenticate(auth(tokens.accessToken))).toMatchObject({
      ok: false,
      status: 401,
      description: 'Access token was not issued for this resource',
    })
  })

  it('rejects a token whose grant was revoked, and forgets the token', async () => {
    const h = await harness()
    const { rs } = resourceServer(h)
    const { tokens } = await loggedInTokens(h)
    await h.as.revokeGrant(tokens.grantId)
    expect(await rs.authenticate(auth(tokens.accessToken))).toMatchObject({
      ok: false,
      status: 401,
      error: 'invalid_token',
    })
  })

  it('answers 403 insufficient_scope when canvas:read is missing', async () => {
    const h = await harness()
    const { rs } = resourceServer(h)
    const { tokens } = await loggedInTokens(h)
    const record = (await h.store.getToken(hashToken(tokens.accessToken)))!
    await h.store.putToken({ ...record, scopes: ['canvas:write'] })
    const outcome = await rs.authenticate(auth(tokens.accessToken))
    expect(outcome).toMatchObject({ ok: false, status: 403, error: 'insufficient_scope' })
    expect((outcome as { wwwAuthenticate: string }).wwwAuthenticate).toBe(
      'Bearer resource_metadata="http://127.0.0.1:3001/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", error_description="canvas:read is required", scope="canvas:read canvas:write"',
    )
  })

  it('on success hands back the Canvas token behind the grant — never the MCP bearer', async () => {
    const h = await harness()
    const { rs } = resourceServer(h)
    const { tokens, client } = await loggedInTokens(h, { scope: 'canvas:read' })
    const outcome = await rs.authenticate(auth(tokens.accessToken))
    expect(outcome).toEqual({
      ok: true,
      canvasToken: 'canvas-access-canvas-code-login',
      scopes: ['canvas:read'],
      grantId: tokens.grantId,
      clientId: client.clientId,
    })
    expect((outcome as { canvasToken: string }).canvasToken).not.toBe(tokens.accessToken)
    expect(h.canvas.refreshCount).toBe(0)
  })

  it('refreshes the Canvas token when it is about to expire and stores the new one', async () => {
    let now = 1_800_000_000_000
    const h = await harness({ now: () => now })
    const { rs } = resourceServer(h, () => now)
    const { tokens } = await loggedInTokens(h)
    now += 59 * 60 * 1000 + 30 * 1000 // 30 s before Canvas expiry → inside the 60 s skew
    const outcome = await rs.authenticate(auth(tokens.accessToken))
    expect(outcome).toMatchObject({ ok: true, canvasToken: 'canvas-access-refreshed-1' })
    expect(h.canvas.refreshCount).toBe(1)
    expect(h.canvas.tokenRequests.at(-1)).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'canvas-refresh-canvas-code-login',
    })
    const grant = (await h.store.getGrant(tokens.grantId))!
    expect(grant.canvas.accessToken).toBe('canvas-access-refreshed-1')
    expect(grant.canvas.refreshToken).toBe('canvas-refresh-canvas-code-login')
    expect(grant.canvas.expiresAt).toBe(now + 3_600_000)
  })

  it('deduplicates concurrent refreshes of one grant', async () => {
    const now = 1_800_000_000_000
    const h = await harness({ now: () => now })
    const { rs } = resourceServer(h, () => now)
    const { tokens } = await loggedInTokens(h)
    await expireCanvasToken(h, tokens.grantId, now)
    const outcomes = await Promise.all(
      [1, 2, 3].map(() => rs.authenticate(auth(tokens.accessToken))),
    )
    expect(outcomes.every((o) => o.ok)).toBe(true)
    expect(h.canvas.refreshCount).toBe(1)
  })

  it('treats a Canvas refusal to refresh as revocation: grant revoked, 401 invalid_token', async () => {
    const now = 1_800_000_000_000
    const h = await harness({ now: () => now })
    const { rs, revokeGrant } = resourceServer(h, () => now)
    const { tokens } = await loggedInTokens(h)
    await expireCanvasToken(h, tokens.grantId, now)
    h.canvas.nextTokenResponse = { status: 400, body: { error: 'invalid_grant' } }
    const outcome = await rs.authenticate(auth(tokens.accessToken))
    expect(outcome).toMatchObject({
      ok: false,
      status: 401,
      error: 'invalid_token',
      description: 'Canvas authorization was revoked; sign in again',
    })
    expect(revokeGrant).toHaveBeenCalledWith(tokens.grantId)
    expect(await h.store.getGrant(tokens.grantId)).toBeUndefined()
    expect(await h.store.getToken(hashToken(tokens.accessToken))).toBeUndefined()
  })

  // QA S2 (#356). Every non-5xx Canvas failure used to map to invalid_grant,
  // and the caller answers invalid_grant by revoking the grant at Canvas. One
  // rate-limit or WAF episode during refresh logged out every active user.
  it.each([403, 408, 429])(
    'keeps the grant when Canvas answers %i during a refresh',
    async (status) => {
      const now = 1_800_000_000_000
      const h = await harness({ now: () => now })
      const { rs, revokeGrant } = resourceServer(h, () => now)
      const { tokens } = await loggedInTokens(h)
      await expireCanvasToken(h, tokens.grantId, now)
      h.canvas.nextTokenResponse = { status, body: { error: 'nope' } }
      expect(await rs.authenticate(auth(tokens.accessToken))).toMatchObject({
        ok: false,
        status: 503,
        error: 'temporarily_unavailable',
      })
      expect(revokeGrant).not.toHaveBeenCalled()
      expect(await h.store.getGrant(tokens.grantId)).toBeDefined()
      expect(h.canvas.revoked).toEqual([])
    },
  )

  it('answers 503 and keeps the grant when Canvas is merely unreachable', async () => {
    const now = 1_800_000_000_000
    const h = await harness({ now: () => now })
    const { rs } = resourceServer(h, () => now)
    const { tokens } = await loggedInTokens(h)
    await expireCanvasToken(h, tokens.grantId, now)
    h.canvas.fetch.mockRejectedValueOnce(new Error('down'))
    expect(await rs.authenticate(auth(tokens.accessToken))).toMatchObject({
      ok: false,
      status: 503,
      error: 'temporarily_unavailable',
    })
    expect(await h.store.getGrant(tokens.grantId)).toBeDefined()
  })

  it('reports the path-aware resource metadata URL for a prefixed issuer', async () => {
    const h = await harness({ env: { CANVAS_MCP_ISSUER: 'https://apps.example.edu/canvas' } })
    const { rs } = resourceServer(h)
    expect(rs.resourceMetadataUrl).toBe(
      'https://apps.example.edu/.well-known/oauth-protected-resource/canvas/mcp',
    )
    expect(rs.challenge()).toContain(
      'resource_metadata="https://apps.example.edu/.well-known/oauth-protected-resource/canvas/mcp"',
    )
  })
})
