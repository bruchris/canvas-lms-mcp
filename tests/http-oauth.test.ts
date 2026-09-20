// End-to-end wire sequence for the oauth_brokered HTTP profile (#302 §13):
// the same steps Codex performs, driven through the real `createHttpHandler`
// with a mocked Canvas and a mocked MCP server factory.

import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: class {
    async handleRequest() {}
    async close() {}
  },
}))

vi.mock('../src/server', () => ({
  createCanvasMCPServer: vi.fn().mockReturnValue({
    server: { connect: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
    canvas: {},
  }),
}))

vi.mock('../src/cli', () => ({
  parseArgs: vi.fn().mockReturnValue({
    token: 'default-token',
    baseUrl: 'https://canvas.example.com',
    mode: 'http',
    port: 3001,
    allowedOrigin: 'http://localhost:3000',
    authProfile: 'remote_static_token',
  }),
}))

vi.mock('node:http', () => ({
  createServer: vi.fn().mockReturnValue({ listen: vi.fn() }),
}))

import { createHttpHandler } from '../src/http'
import { createCanvasMCPServer } from '../src/server'
import { loadOAuthProfileConfig } from '../src/auth/oauth/config'
import { MemoryOAuthStore } from '../src/auth/oauth/store'
import {
  BASE_ENV,
  FORM_HEADERS,
  consentFields,
  cookieValue,
  form,
  makeReq,
  makeRes,
  mockCanvas,
  pkcePair,
  type MockReqInit,
  type MockRes,
} from './auth/oauth/harness'

function setup(env: Partial<typeof BASE_ENV> = {}) {
  const canvas = mockCanvas()
  const oauth = loadOAuthProfileConfig({ ...BASE_ENV, ...env })
  const handler = createHttpHandler({
    authProfile: 'oauth_brokered',
    oauth,
    oauthStore: new MemoryOAuthStore(),
    fetch: canvas.fetch as unknown as typeof fetch,
    allowedOrigin: 'https://app.example',
    role: 'teacher',
  })
  const send = async (init: MockReqInit): Promise<MockRes> => {
    const req = makeReq(init)
    const res = makeRes()
    await handler(req as IncomingMessage, res as ServerResponse)
    return res
  }
  return { canvas, oauth, handler, send }
}

interface Session {
  clientId: string
  accessToken: string
  refreshToken: string
}

/** Register → authorize → consent → Canvas → callback → token. */
async function login(
  ctx: ReturnType<typeof setup>,
  options: { scope?: string; seed?: string } = {},
): Promise<Session> {
  const seed = options.seed ?? 'flow'
  const reg = await ctx.send({
    method: 'POST',
    url: '/oauth/register',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Codex',
      redirect_uris: ['http://127.0.0.1/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    }),
  })
  expect(reg._status).toBe(201)
  const clientId = (reg._json() as { client_id: string }).client_id

  const { verifier, challenge } = pkcePair(seed)
  const redirectUri = 'http://127.0.0.1:53117/callback'
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'codex-state',
    resource: ctx.oauth.resource,
    ...(options.scope ? { scope: options.scope } : {}),
  })
  const consent = await ctx.send({ url: `/oauth/authorize?${params}` })
  expect(consent._status).toBe(200)
  const { pending, csrf } = consentFields(consent._body)

  const cont = await ctx.send({
    method: 'POST',
    url: '/oauth/authorize/continue',
    headers: { ...FORM_HEADERS, origin: 'http://127.0.0.1:3001' },
    body: form({ pending, csrf, decision: 'allow' }),
  })
  expect(cont._status).toBe(302)
  expect(cont._headers.location).toMatch(
    /^https:\/\/school\.instructure\.com\/login\/oauth2\/auth\?/,
  )
  const cookie = cookieValue(cont._headers['set-cookie'])
  const canvasState = new URL(cont._headers.location!).searchParams.get('state')!

  const cb = await ctx.send({
    url: `/oauth/canvas/callback?code=canvas-code-${seed}&state=${encodeURIComponent(canvasState)}`,
    headers: { cookie: `canvas_mcp_authz=${encodeURIComponent(cookie)}` },
  })
  expect(cb._status).toBe(302)
  const target = new URL(cb._headers.location!)
  expect(target.origin + target.pathname).toBe(redirectUri)
  expect(target.searchParams.get('state')).toBe('codex-state')
  const code = target.searchParams.get('code')!

  const token = await ctx.send({
    method: 'POST',
    url: '/oauth/token',
    headers: FORM_HEADERS,
    body: form({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource: ctx.oauth.resource,
    }),
  })
  expect(token._status).toBe(200)
  const body = token._json() as { access_token: string; refresh_token: string }
  return { clientId, accessToken: body.access_token, refreshToken: body.refresh_token }
}

describe('oauth_brokered HTTP profile, end to end (#302)', () => {
  it('walks 401 → discovery → DCR → consent → Canvas → token → /mcp → revoke → 401', async () => {
    const ctx = setup()
    const factory = vi.mocked(createCanvasMCPServer)
    factory.mockClear()

    // 1. Unauthenticated: the challenge that makes a host show "Not logged in".
    const unauth = await ctx.send({ method: 'POST', url: '/mcp' })
    expect(unauth._status).toBe(401)
    expect(unauth._headers['www-authenticate']).toBe(
      'Bearer resource_metadata="http://127.0.0.1:3001/.well-known/oauth-protected-resource/mcp", scope="canvas:read canvas:write"',
    )
    expect(unauth._json()).toEqual({
      error: 'unauthorized',
      error_description: 'Authentication required',
    })
    expect(factory).not.toHaveBeenCalled()

    // 2/3. Discovery.
    const prm = await ctx.send({ url: '/.well-known/oauth-protected-resource/mcp' })
    expect(prm._json()).toMatchObject({ authorization_servers: ['http://127.0.0.1:3001'] })
    const as = await ctx.send({ url: '/.well-known/oauth-authorization-server' })
    expect(as._json()).toMatchObject({ code_challenge_methods_supported: ['S256'] })

    // 4–8. Login.
    const session = await login(ctx)

    // 9. Authenticated call: the server is built with the Canvas token, never the MCP one.
    const ok = await ctx.send({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${session.accessToken}` },
    })
    expect(ok._status).not.toBe(401)
    expect(factory).toHaveBeenCalledTimes(1)
    const config = factory.mock.calls[0]![0]
    expect(config.token).toBe('canvas-access-canvas-code-flow')
    expect(config.token).not.toBe(session.accessToken)
    expect(config.baseUrl).toBe('https://school.instructure.com')
    expect(config.writeTools).toBe('allow')
    expect(config.role).toBe('teacher')
    expect(config.pseudonymizer?.sharedAcrossCallers).toBe(true)

    // 10. A Canvas PAT header is refused in this profile.
    const pat = await ctx.send({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${session.accessToken}`, 'x-canvas-token': 'pat' },
    })
    expect(pat._status).toBe(400)
    expect(pat._json()).toMatchObject({ error: 'invalid_request' })

    // 11. Logout: revoke, then the token is dead and Canvas was told.
    const revoke = await ctx.send({
      method: 'POST',
      url: '/oauth/revoke',
      headers: FORM_HEADERS,
      body: form({ client_id: session.clientId, token: session.refreshToken }),
    })
    expect(revoke._status).toBe(200)
    expect(ctx.canvas.revoked).toEqual(['canvas-access-canvas-code-flow'])
    const after = await ctx.send({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${session.accessToken}` },
    })
    expect(after._status).toBe(401)
    expect(after._headers['www-authenticate']).toContain('error="invalid_token"')
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('a token scoped to canvas:read builds a read-only server', async () => {
    const ctx = setup()
    const factory = vi.mocked(createCanvasMCPServer)
    factory.mockClear()
    const session = await login(ctx, { scope: 'canvas:read', seed: 'ro' })
    await ctx.send({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${session.accessToken}` },
    })
    expect(factory.mock.calls[0]![0].writeTools).toBe('block')
  })

  it('an unauthenticated GET /mcp gets the 401 challenge, not a 405', async () => {
    const ctx = setup()
    const res = await ctx.send({ method: 'GET', url: '/mcp' })
    expect(res._status).toBe(401)
    expect(res._headers['www-authenticate']).toContain('resource_metadata=')
  })

  it('validates Origin: the configured origin and the issuer pass, anything else is 403', async () => {
    const ctx = setup()
    expect(
      (await ctx.send({ method: 'POST', url: '/mcp', headers: { origin: 'https://evil.example' } }))
        ._status,
    ).toBe(403)
    expect(
      (
        await ctx.send({
          method: 'OPTIONS',
          url: '/mcp',
          headers: { origin: 'https://evil.example' },
        })
      )._status,
    ).toBe(403)
    expect(
      (await ctx.send({ url: '/health', headers: { origin: 'https://app.example' } }))._status,
    ).toBe(200)
    expect(
      (await ctx.send({ url: '/health', headers: { origin: 'http://127.0.0.1:3001' } }))._status,
    ).toBe(200)
    expect(
      (
        await ctx.send({
          method: 'OPTIONS',
          url: '/mcp',
          headers: { origin: 'https://app.example' },
        })
      )._status,
    ).toBe(204)
  })

  it('advertises Authorization in CORS allow-headers and exposes WWW-Authenticate', async () => {
    const ctx = setup()
    const res = await ctx.send({ method: 'OPTIONS', url: '/mcp' })
    expect(res._headers['access-control-allow-headers']).toContain('Authorization')
    expect(res._headers['access-control-expose-headers']).toContain('WWW-Authenticate')
  })

  it('serves OAuth endpoints under an issuer path prefix, with or without the prefix on the wire', async () => {
    const ctx = setup({ CANVAS_MCP_ISSUER: 'https://apps.example.edu/canvas' })
    const prm = await ctx.send({ url: '/.well-known/oauth-protected-resource/canvas/mcp' })
    expect(prm._json()).toMatchObject({ resource: 'https://apps.example.edu/canvas/mcp' })
    expect((await ctx.send({ url: '/canvas/health' }))._status).toBe(200)
    expect((await ctx.send({ method: 'POST', url: '/canvas/mcp' }))._status).toBe(401)
    expect((await ctx.send({ method: 'POST', url: '/mcp' }))._status).toBe(401)
  })

  it('refuses to build the OAuth profile without its config', () => {
    expect(() => createHttpHandler({ authProfile: 'oauth_brokered' })).toThrow(
      /requires an oauth config/,
    )
  })

  it('does not expose OAuth endpoints in the static profile', async () => {
    const handler = createHttpHandler({ token: 't', baseUrl: 'https://canvas.example.com' })
    const res = makeRes()
    await handler(
      makeReq({ url: '/.well-known/oauth-protected-resource' }) as IncomingMessage,
      res as ServerResponse,
    )
    expect(res._status).toBe(404)
  })
})
