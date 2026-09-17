import { describe, expect, it, vi } from 'vitest'
import { errorRedirect, normalizeResource } from '../../../src/auth/oauth/authorization-server'
import { hashToken } from '../../../src/auth/oauth/crypto'
import {
  BASE_ENV,
  FORM_HEADERS,
  PKCE,
  completeLogin,
  consentFields,
  cookieValue,
  exchange,
  form,
  harness,
  loggedInTokens,
  pkcePair,
  registerPublicClient,
} from './harness'

function authorizeUrl(clientId: string, overrides: Record<string, string | null> = {}): string {
  const params: Record<string, string> = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: 'http://127.0.0.1:53117/callback',
    code_challenge: PKCE.challenge,
    code_challenge_method: 'S256',
    state: 'st',
    resource: 'http://127.0.0.1:3001/mcp',
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) delete params[k]
    else params[k] = v
  }
  return `/oauth/authorize?${new URLSearchParams(params)}`
}

describe('AuthorizationServer (#302 §7)', () => {
  describe('metadata', () => {
    it('serves RFC 9728 protected-resource metadata pointing at itself', async () => {
      const h = await harness()
      const res = await h.send({ url: '/.well-known/oauth-protected-resource/mcp' })
      expect(res._status).toBe(200)
      expect(res._json()).toEqual({
        resource: 'http://127.0.0.1:3001/mcp',
        authorization_servers: ['http://127.0.0.1:3001'],
        bearer_methods_supported: ['header'],
        scopes_supported: ['canvas:read', 'canvas:write'],
        resource_name: 'Canvas LMS MCP',
        resource_documentation: expect.stringContaining('docs/oauth-profile.md'),
      })
      // Root form too, for clients that do not append the path.
      expect((await h.send({ url: '/.well-known/oauth-protected-resource' }))._status).toBe(200)
    })

    it('serves RFC 8414 authorization-server metadata with PKCE S256, DCR, CIMD, and revocation', async () => {
      const h = await harness()
      const res = await h.send({ url: '/.well-known/oauth-authorization-server' })
      expect(res._status).toBe(200)
      expect(res._json()).toMatchObject({
        issuer: 'http://127.0.0.1:3001',
        authorization_endpoint: 'http://127.0.0.1:3001/oauth/authorize',
        token_endpoint: 'http://127.0.0.1:3001/oauth/token',
        registration_endpoint: 'http://127.0.0.1:3001/oauth/register',
        revocation_endpoint: 'http://127.0.0.1:3001/oauth/revoke',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: [
          'none',
          'client_secret_basic',
          'client_secret_post',
        ],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['canvas:read', 'canvas:write'],
        client_id_metadata_document_supported: true,
      })
    })

    it('omits registration_endpoint when DCR is off and reports CIMD off when no hosts are trusted', async () => {
      const h = await harness({
        env: { CANVAS_MCP_OAUTH_DCR: 'false', CANVAS_MCP_OAUTH_CIMD_ALLOWED_HOSTS: 'none' },
      })
      const body = (
        await h.send({ url: '/.well-known/oauth-authorization-server' })
      )._json() as Record<string, unknown>
      expect(body).not.toHaveProperty('registration_endpoint')
      expect(body.client_id_metadata_document_supported).toBe(false)
    })

    it('uses the path-inserted well-known forms for an issuer with a path, plus root fallbacks', async () => {
      const h = await harness({ env: { CANVAS_MCP_ISSUER: 'https://apps.example.edu/canvas' } })
      expect(h.as.wellKnownPaths()).toEqual({
        protectedResource: [
          '/.well-known/oauth-protected-resource/canvas/mcp',
          '/.well-known/oauth-protected-resource/canvas',
          '/.well-known/oauth-protected-resource',
          '/.well-known/oauth-protected-resource/mcp',
        ],
        authorizationServer: [
          '/.well-known/oauth-authorization-server/canvas',
          '/.well-known/oauth-authorization-server',
        ],
      })
      const prm = await h.send({ url: '/.well-known/oauth-protected-resource/canvas/mcp' })
      expect(prm._json()).toMatchObject({ resource: 'https://apps.example.edu/canvas/mcp' })
      const as = await h.send({ url: '/.well-known/oauth-authorization-server/canvas' })
      expect(as._json()).toMatchObject({
        issuer: 'https://apps.example.edu/canvas',
        token_endpoint: 'https://apps.example.edu/canvas/oauth/token',
      })
      expect(h.as.resourceMetadataUrl).toBe(
        'https://apps.example.edu/.well-known/oauth-protected-resource/canvas/mcp',
      )
      // Endpoints route with or without the prefix.
      expect(
        (
          await h.send({
            method: 'POST',
            url: '/canvas/oauth/token',
            headers: FORM_HEADERS,
            body: '',
          })
        )._status,
      ).toBe(400)
      expect(
        (await h.send({ method: 'POST', url: '/oauth/token', headers: FORM_HEADERS, body: '' }))
          ._status,
      ).toBe(400)
    })

    it('answers 405 to the wrong method and false for unknown paths', async () => {
      const h = await harness()
      expect(
        (await h.send({ method: 'POST', url: '/.well-known/oauth-authorization-server' }))._status,
      ).toBe(405)
      expect((await h.send({ method: 'GET', url: '/oauth/token' }))._status).toBe(405)
      expect((await h.send({ url: '/mcp' }))._status).toBe(404)
    })
  })

  describe('dynamic client registration', () => {
    it('registers and returns 201 with the RFC 7591 body', async () => {
      const h = await harness()
      const res = await h.send({
        method: 'POST',
        url: '/oauth/register',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          redirect_uris: ['http://127.0.0.1/callback'],
          token_endpoint_auth_method: 'none',
        }),
      })
      expect(res._status).toBe(201)
      expect(res._json()).toMatchObject({
        client_id: expect.stringMatching(/^mcpcl_/),
        token_endpoint_auth_method: 'none',
      })
      expect(res._headers['cache-control']).toBe('no-store')
    })

    it('rejects bad metadata, non-JSON bodies, and is 404 when disabled', async () => {
      const h = await harness()
      const bad = await h.send({
        method: 'POST',
        url: '/oauth/register',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }),
      })
      expect(bad._status).toBe(400)
      expect(bad._json()).toMatchObject({ error: 'invalid_redirect_uri' })
      const notJson = await h.send({
        method: 'POST',
        url: '/oauth/register',
        headers: FORM_HEADERS,
        body: 'x=1',
      })
      expect(notJson._status).toBe(400)
      expect(notJson._json()).toMatchObject({ error: 'invalid_request' })

      const off = await harness({ env: { CANVAS_MCP_OAUTH_DCR: 'false' } })
      const res = await off.send({
        method: 'POST',
        url: '/oauth/register',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: ['http://127.0.0.1/callback'] }),
      })
      expect(res._status).toBe(404)
    })
  })

  describe('authorize', () => {
    it('renders an HTML error, never a redirect, when the client or redirect URI cannot be trusted', async () => {
      const h = await harness()
      const client = await registerPublicClient(h)
      const cases = [
        authorizeUrl(client.clientId, { client_id: null }),
        authorizeUrl('mcpcl_unknown'),
        authorizeUrl(client.clientId, { redirect_uri: 'https://evil.example/cb' }),
        authorizeUrl(client.clientId, { redirect_uri: 'http://127.0.0.1/other' }),
      ]
      for (const url of cases) {
        const res = await h.send({ url })
        expect(res._status, url).toBe(400)
        expect(res._headers['content-type']).toContain('text/html')
        expect(res._headers.location).toBeUndefined()
        expect(res._headers['content-security-policy']).toContain("default-src 'none'")
      }
    })

    it('uses the single registered redirect URI when none is presented, and refuses to guess among several', async () => {
      const h = await harness()
      const single = await registerPublicClient(h)
      const ok = await h.send({ url: authorizeUrl(single.clientId, { redirect_uri: null }) })
      expect(ok._status).toBe(200)
      expect(ok._body).toContain('http://127.0.0.1/callback')

      const multi = await h.send({
        method: 'POST',
        url: '/oauth/register',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          redirect_uris: ['http://127.0.0.1/a', 'http://127.0.0.1/b'],
          token_endpoint_auth_method: 'none',
        }),
      })
      const multiId = (multi._json() as { client_id: string }).client_id
      const res = await h.send({ url: authorizeUrl(multiId, { redirect_uri: null }) })
      expect(res._status).toBe(400)
      expect(res._headers.location).toBeUndefined()
    })

    it.each([
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ code_challenge: null }, 'invalid_request'],
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ code_challenge_method: null }, 'invalid_request'],
      [{ code_challenge: 'too-short' }, 'invalid_request'],
      [{ scope: 'canvas:read admin' }, 'invalid_scope'],
      [{ resource: 'https://other.example/mcp' }, 'invalid_target'],
    ])('redirects %j back to the client as %s, echoing state', async (overrides, error) => {
      const h = await harness()
      const client = await registerPublicClient(h)
      const res = await h.send({ url: authorizeUrl(client.clientId, overrides) })
      expect(res._status).toBe(302)
      const target = new URL(res._headers.location!)
      expect(target.origin + target.pathname).toBe('http://127.0.0.1:53117/callback')
      expect(target.searchParams.get('error')).toBe(error)
      expect(target.searchParams.get('state')).toBe('st')
      expect(h.store.snapshot().pending).toHaveLength(0)
    })

    it('renders the consent page and stores a pending authorization with only hashes', async () => {
      const h = await harness()
      const client = await registerPublicClient(h)
      const res = await h.send({ url: authorizeUrl(client.clientId) })
      expect(res._status).toBe(200)
      expect(res._headers['content-type']).toContain('text/html')
      expect(res._headers['cache-control']).toBe('no-store')
      expect(res._body).toContain('Codex')
      expect(res._body).toContain('http://127.0.0.1:53117/callback')
      expect(res._body).toContain('school.instructure.com')
      expect(res._body).toContain('canvas:read')
      expect(res._body).toContain('canvas:write')
      const { pending, csrf } = consentFields(res._body)
      const stored = h.store.snapshot().pending[0]!
      expect(stored.id).toBe(pending)
      expect(stored.csrfHash).toBe(hashToken(csrf))
      expect(JSON.stringify(stored)).not.toContain(csrf)
      expect(stored).toMatchObject({
        clientId: client.clientId,
        redirectUri: 'http://127.0.0.1:53117/callback',
        state: 'st',
        codeChallenge: PKCE.challenge,
        scopes: ['canvas:read', 'canvas:write'],
        resource: 'http://127.0.0.1:3001/mcp',
      })
      expect(stored.consentedAt).toBeUndefined()
    })

    it('narrows scopes when the client asks for less, and tolerates a missing resource parameter', async () => {
      const h = await harness()
      const client = await registerPublicClient(h)
      const res = await h.send({
        url: authorizeUrl(client.clientId, { scope: 'canvas:read', resource: null }),
      })
      expect(res._status).toBe(200)
      expect(h.store.snapshot().pending[0]!.scopes).toEqual(['canvas:read'])
      expect(res._body).not.toContain('canvas:write')
    })

    it('purges expired pending authorizations on the way in (throttled to once a minute)', async () => {
      let now = 1_800_000_000_000
      const h = await harness({ now: () => now })
      const client = await registerPublicClient(h)
      await h.send({ url: authorizeUrl(client.clientId) })
      now += 11 * 60 * 1000
      await h.send({ url: authorizeUrl(client.clientId) })
      expect(h.store.snapshot().pending).toHaveLength(1)
    })
  })

  describe('consent', () => {
    async function pendingFor(h: Awaited<ReturnType<typeof harness>>) {
      const client = await registerPublicClient(h)
      const res = await h.send({
        url: authorizeUrl(client.clientId, { resource: h.config.resource }),
      })
      return { client, ...consentFields(res._body) }
    }

    it('refuses a cross-origin submission', async () => {
      const h = await harness()
      const { pending, csrf } = await pendingFor(h)
      const res = await h.send({
        method: 'POST',
        url: '/oauth/authorize/continue',
        headers: { ...FORM_HEADERS, origin: 'https://evil.example' },
        body: form({ pending, csrf, decision: 'allow' }),
      })
      expect(res._status).toBe(403)
      expect(res._headers.location).toBeUndefined()
    })

    it('refuses an unknown pending id, a wrong CSRF nonce, and an unknown decision', async () => {
      const h = await harness()
      const { pending, csrf } = await pendingFor(h)
      const post = (fields: Record<string, string>) =>
        h.send({
          method: 'POST',
          url: '/oauth/authorize/continue',
          headers: FORM_HEADERS,
          body: form(fields),
        })
      expect((await post({ pending: 'nope', csrf, decision: 'allow' }))._status).toBe(400)
      expect((await post({ pending, csrf: 'wrong', decision: 'allow' }))._status).toBe(400)
      expect((await post({ pending, csrf, decision: 'maybe' }))._status).toBe(400)
      expect(h.store.snapshot().pending).toHaveLength(1)
    })

    it('deny sends access_denied to the client and drops the pending authorization', async () => {
      const h = await harness()
      const { pending, csrf } = await pendingFor(h)
      const res = await h.send({
        method: 'POST',
        url: '/oauth/authorize/continue',
        headers: FORM_HEADERS,
        body: form({ pending, csrf, decision: 'deny' }),
      })
      expect(res._status).toBe(302)
      const target = new URL(res._headers.location!)
      expect(target.searchParams.get('error')).toBe('access_denied')
      expect(target.searchParams.get('state')).toBe('st')
      expect(h.store.snapshot().pending).toHaveLength(0)
    })

    it('allow sets the flow cookie, records consent, and redirects to Canvas with state = pending id', async () => {
      const h = await harness()
      const { pending, csrf } = await pendingFor(h)
      const res = await h.send({
        method: 'POST',
        url: '/oauth/authorize/continue',
        headers: { ...FORM_HEADERS, origin: 'http://127.0.0.1:3001' },
        body: form({ pending, csrf, decision: 'allow' }),
      })
      expect(res._status).toBe(302)
      const canvasUrl = new URL(res._headers.location!)
      expect(canvasUrl.origin + canvasUrl.pathname).toBe(
        'https://school.instructure.com/login/oauth2/auth',
      )
      expect(canvasUrl.searchParams.get('state')).toBe(pending)
      expect(canvasUrl.searchParams.get('client_id')).toBe('10000000000001')
      expect(canvasUrl.searchParams.get('redirect_uri')).toBe(
        'http://127.0.0.1:3001/oauth/canvas/callback',
      )
      expect(canvasUrl.searchParams.get('response_type')).toBe('code')

      const setCookie = res._headers['set-cookie']!
      expect(setCookie).toMatch(/^canvas_mcp_authz=/)
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie).toContain('SameSite=Lax')
      expect(setCookie).toContain('Path=/oauth/')
      expect(setCookie).not.toContain('Secure')
      const stored = h.store.snapshot().pending[0]!
      expect(stored.consentedAt).toBeDefined()
      expect(stored.cookieHash).toBe(hashToken(cookieValue(setCookie)))
    })

    it('marks the cookie Secure on an https issuer', async () => {
      const h = await harness({ env: { CANVAS_MCP_ISSUER: 'https://canvas-mcp.example.edu' } })
      const { pending, csrf } = await pendingFor(h)
      const res = await h.send({
        method: 'POST',
        url: '/oauth/authorize/continue',
        headers: FORM_HEADERS,
        body: form({ pending, csrf, decision: 'allow' }),
      })
      expect(res._headers['set-cookie']).toContain('Secure')
    })

    it('rejects a second submission of the same form', async () => {
      const h = await harness()
      const { pending, csrf } = await pendingFor(h)
      const body = form({ pending, csrf, decision: 'allow' })
      await h.send({
        method: 'POST',
        url: '/oauth/authorize/continue',
        headers: FORM_HEADERS,
        body,
      })
      const again = await h.send({
        method: 'POST',
        url: '/oauth/authorize/continue',
        headers: FORM_HEADERS,
        body,
      })
      expect(again._status).toBe(400)
      expect(h.store.snapshot().pending).toHaveLength(0)
    })

    it('rejects an expired pending authorization', async () => {
      let now = 1_800_000_000_000
      const h = await harness({ now: () => now })
      const { pending, csrf } = await pendingFor(h)
      now += 11 * 60 * 1000
      const res = await h.send({
        method: 'POST',
        url: '/oauth/authorize/continue',
        headers: FORM_HEADERS,
        body: form({ pending, csrf, decision: 'allow' }),
      })
      expect(res._status).toBe(400)
    })
  })

  describe('Canvas callback', () => {
    async function consented(h: Awaited<ReturnType<typeof harness>>) {
      const client = await registerPublicClient(h)
      const page = await h.send({ url: authorizeUrl(client.clientId) })
      const { pending, csrf } = consentFields(page._body)
      const cont = await h.send({
        method: 'POST',
        url: '/oauth/authorize/continue',
        headers: FORM_HEADERS,
        body: form({ pending, csrf, decision: 'allow' }),
      })
      return { client, pending, cookie: cookieValue(cont._headers['set-cookie']) }
    }
    const withCookie = (cookie: string) => ({
      cookie: `canvas_mcp_authz=${encodeURIComponent(cookie)}`,
    })

    it('completes the login: grant stored with Canvas tokens, code redirected with the client state, cookie cleared', async () => {
      const h = await harness()
      const { client, pending, cookie } = await consented(h)
      const res = await h.send({
        url: `/oauth/canvas/callback?code=cv-code&state=${pending}`,
        headers: withCookie(cookie),
      })
      expect(res._status).toBe(302)
      const target = new URL(res._headers.location!)
      expect(target.origin + target.pathname).toBe('http://127.0.0.1:53117/callback')
      expect(target.searchParams.get('state')).toBe('st')
      const code = target.searchParams.get('code')!
      expect(code).toMatch(/^mcpac_/)
      expect(res._headers['set-cookie']).toMatch(/^canvas_mcp_authz=; .*Max-Age=0/)

      expect(h.canvas.tokenRequests[0]).toEqual({
        grant_type: 'authorization_code',
        client_id: '10000000000001',
        client_secret: 'dev-key-secret',
        redirect_uri: 'http://127.0.0.1:3001/oauth/canvas/callback',
        code: 'cv-code',
      })
      const snapshot = h.store.snapshot()
      expect(snapshot.pending).toHaveLength(0)
      expect(snapshot.grants).toHaveLength(1)
      expect(snapshot.grants[0]).toMatchObject({
        clientId: client.clientId,
        canvasUserId: '42',
        canvas: { accessToken: 'canvas-access-cv-code', refreshToken: 'canvas-refresh-cv-code' },
      })
      expect(JSON.stringify(snapshot)).not.toContain('Pat Example')
      expect(snapshot.codes).toHaveLength(1)
      expect(snapshot.codes[0]!.hash).toBe(hashToken(code))
      expect(JSON.stringify(snapshot)).not.toContain(code)
      // Logged by grant id and client id only.
      const logged = h.log.warn.mock.calls.map((c) => String(c[0])).join('\n')
      expect(logged).toContain(`grant ${snapshot.grants[0]!.id}`)
      expect(logged).not.toContain(code)
      expect(logged).not.toContain('canvas-access')
    })

    it('is single-use: a second callback with the same state fails', async () => {
      const h = await harness()
      const { pending, cookie } = await consented(h)
      await h.send({
        url: `/oauth/canvas/callback?code=cv&state=${pending}`,
        headers: withCookie(cookie),
      })
      const again = await h.send({
        url: `/oauth/canvas/callback?code=cv&state=${pending}`,
        headers: withCookie(cookie),
      })
      expect(again._status).toBe(400)
      expect(again._headers.location).toBeUndefined()
      expect(h.store.snapshot().grants).toHaveLength(1)
    })

    it('refuses to complete without the flow cookie (login CSRF), and does not redirect', async () => {
      const h = await harness()
      const { pending } = await consented(h)
      const res = await h.send({ url: `/oauth/canvas/callback?code=cv&state=${pending}` })
      expect(res._status).toBe(400)
      expect(res._headers.location).toBeUndefined()
      expect(res._body).toContain('different browser session')
      expect(h.store.snapshot().grants).toHaveLength(0)
      expect(h.canvas.tokenRequests).toHaveLength(0)
    })

    it('refuses a wrong cookie, a missing state, an unknown state, and a flow that skipped consent', async () => {
      const h = await harness()
      const { pending } = await consented(h)
      expect(
        (
          await h.send({
            url: `/oauth/canvas/callback?code=cv&state=${pending}`,
            headers: withCookie('wrong'),
          })
        )._status,
      ).toBe(400)
      expect((await h.send({ url: '/oauth/canvas/callback?code=cv' }))._status).toBe(400)
      expect((await h.send({ url: '/oauth/canvas/callback?code=cv&state=unknown' }))._status).toBe(
        400,
      )

      const client = await registerPublicClient(h)
      const page = await h.send({ url: authorizeUrl(client.clientId) })
      const unconsented = consentFields(page._body).pending
      const res = await h.send({ url: `/oauth/canvas/callback?code=cv&state=${unconsented}` })
      expect(res._status).toBe(400)
      expect(h.store.snapshot().grants).toHaveLength(0)
    })

    it('maps a Canvas denial to access_denied for the client', async () => {
      const h = await harness()
      const { pending, cookie } = await consented(h)
      const res = await h.send({
        url: `/oauth/canvas/callback?error=access_denied&state=${pending}`,
        headers: withCookie(cookie),
      })
      expect(res._status).toBe(302)
      expect(new URL(res._headers.location!).searchParams.get('error')).toBe('access_denied')
      expect(h.canvas.tokenRequests).toHaveLength(0)
    })

    it.each([
      [
        { status: 400, body: { error: 'invalid_grant', error_description: 'leaky' } },
        'access_denied',
      ],
      [{ status: 503, body: {} }, 'temporarily_unavailable'],
      [{ status: 200, body: { nope: true } }, 'server_error'],
    ])(
      'maps a Canvas exchange failure %j to %s without leaking Canvas details',
      async (canvasResponse, error) => {
        const h = await harness()
        const { pending, cookie } = await consented(h)
        h.canvas.nextTokenResponse = canvasResponse
        const res = await h.send({
          url: `/oauth/canvas/callback?code=cv&state=${pending}`,
          headers: withCookie(cookie),
        })
        expect(res._status).toBe(302)
        const target = new URL(res._headers.location!)
        expect(target.searchParams.get('error')).toBe(error)
        expect(res._headers.location).not.toContain('leaky')
        expect(h.store.snapshot().grants).toHaveLength(0)
      },
    )
  })

  describe('token endpoint: authorization_code', () => {
    it('issues audience-bound access and refresh tokens, stored only as hashes', async () => {
      const h = await harness()
      const client = await registerPublicClient(h)
      const login = await completeLogin(h, client)
      const res = await h.send({
        method: 'POST',
        url: '/oauth/token',
        headers: FORM_HEADERS,
        body: form({
          grant_type: 'authorization_code',
          client_id: client.clientId,
          code: login.code,
          code_verifier: login.verifier,
          redirect_uri: login.redirectUri,
          resource: h.config.resource,
        }),
      })
      expect(res._status).toBe(200)
      expect(res._headers['cache-control']).toBe('no-store')
      const body = res._json() as Record<string, unknown>
      expect(body).toMatchObject({
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'canvas:read canvas:write',
      })
      expect(body.access_token).toMatch(/^mcpat_/)
      expect(body.refresh_token).toMatch(/^mcprt_/)
      // Neither MCP token is a Canvas token.
      expect(body.access_token).not.toContain('canvas')
      const snapshot = h.store.snapshot()
      expect(snapshot.tokens.map((t) => t.kind).sort()).toEqual(['access', 'refresh'])
      expect(snapshot.tokens.every((t) => t.resource === 'http://127.0.0.1:3001/mcp')).toBe(true)
      expect(snapshot.tokens.every((t) => t.grantId === login.grantId)).toBe(true)
      expect(JSON.stringify(snapshot)).not.toContain(body.access_token as string)
      expect(JSON.stringify(snapshot)).not.toContain(body.refresh_token as string)
    })

    async function tokenRequest(
      h: Awaited<ReturnType<typeof harness>>,
      fields: Record<string, string>,
    ) {
      return h.send({
        method: 'POST',
        url: '/oauth/token',
        headers: FORM_HEADERS,
        body: form(fields),
      })
    }

    it.each([
      ['wrong verifier', { code_verifier: pkcePair('other').verifier }, 'invalid_grant', /PKCE/],
      [
        'wrong redirect_uri',
        { redirect_uri: 'http://127.0.0.1/callback' },
        'invalid_grant',
        /redirect_uri/,
      ],
      ['unknown code', { code: 'mcpac_nope' }, 'invalid_grant', /invalid or expired/],
      [
        'wrong resource',
        { resource: 'https://other.example/mcp' },
        'invalid_target',
        /only issues tokens for/,
      ],
    ])('rejects %s', async (_label, overrides, error, message) => {
      const h = await harness()
      const client = await registerPublicClient(h)
      const login = await completeLogin(h, client, {
        presentedRedirect: 'http://127.0.0.1:53117/callback',
      })
      const res = await tokenRequest(h, {
        grant_type: 'authorization_code',
        client_id: client.clientId,
        code: login.code,
        code_verifier: login.verifier,
        redirect_uri: login.redirectUri,
        ...overrides,
      })
      expect(res._status).toBe(400)
      expect(res._json()).toMatchObject({ error })
      expect((res._json() as { error_description: string }).error_description).toMatch(message)
      expect(h.store.snapshot().tokens).toHaveLength(0)
    })

    it('rejects a code issued to another client', async () => {
      const h = await harness()
      const a = await registerPublicClient(h)
      const b = await registerPublicClient(h)
      const login = await completeLogin(h, a)
      const res = await tokenRequest(h, {
        grant_type: 'authorization_code',
        client_id: b.clientId,
        code: login.code,
        code_verifier: login.verifier,
        redirect_uri: login.redirectUri,
      })
      expect(res._status).toBe(400)
      expect(res._json()).toMatchObject({ error: 'invalid_grant' })
    })

    it('a replayed code revokes the whole grant, including at Canvas (OAuth 2.1 §4.1.2)', async () => {
      const h = await harness()
      const client = await registerPublicClient(h)
      const login = await completeLogin(h, client)
      const fields = {
        grant_type: 'authorization_code',
        client_id: client.clientId,
        code: login.code,
        code_verifier: login.verifier,
        redirect_uri: login.redirectUri,
      }
      const first = await tokenRequest(h, fields)
      expect(first._status).toBe(200)
      const second = await tokenRequest(h, fields)
      expect(second._status).toBe(400)
      expect(second._json()).toMatchObject({ error: 'invalid_grant' })
      const snapshot = h.store.snapshot()
      expect(snapshot.grants).toHaveLength(0)
      expect(snapshot.tokens).toHaveLength(0)
      expect(h.canvas.revoked).toEqual([`canvas-access-canvas-code-login`])
      expect(h.log.warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/replay/)
    })

    it('rejects an expired code', async () => {
      let now = 1_800_000_000_000
      const h = await harness({ now: () => now })
      const client = await registerPublicClient(h)
      const login = await completeLogin(h, client)
      now += 6 * 60 * 1000
      const res = await tokenRequest(h, {
        grant_type: 'authorization_code',
        client_id: client.clientId,
        code: login.code,
        code_verifier: login.verifier,
        redirect_uri: login.redirectUri,
      })
      expect(res._json()).toMatchObject({ error: 'invalid_grant' })
    })

    it('requires code, code_verifier, and redirect_uri; rejects unsupported grant types and JSON bodies', async () => {
      const h = await harness()
      const client = await registerPublicClient(h)
      const missing = await tokenRequest(h, {
        grant_type: 'authorization_code',
        client_id: client.clientId,
        code: 'x',
      })
      expect(missing._json()).toMatchObject({ error: 'invalid_request' })
      const unsupported = await tokenRequest(h, {
        grant_type: 'client_credentials',
        client_id: client.clientId,
      })
      expect(unsupported._json()).toMatchObject({ error: 'unsupported_grant_type' })
      const json = await h.send({
        method: 'POST',
        url: '/oauth/token',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code' }),
      })
      expect(json._status).toBe(400)
      expect(json._json()).toMatchObject({ error: 'invalid_request' })
    })

    it('omits the refresh token for a client that did not register the refresh_token grant', async () => {
      const h = await harness()
      const reg = await h.send({
        method: 'POST',
        url: '/oauth/register',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          redirect_uris: ['http://127.0.0.1/callback'],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code'],
        }),
      })
      const client = {
        clientId: (reg._json() as { client_id: string }).client_id,
        redirectUri: 'http://127.0.0.1/callback',
      }
      const login = await completeLogin(h, client)
      const tokens = await exchange(h, login)
      expect(tokens.refreshToken).toBeUndefined()
      expect(h.store.snapshot().tokens).toHaveLength(1)
    })
  })

  describe('token endpoint: client authentication', () => {
    async function confidentialClient(
      h: Awaited<ReturnType<typeof harness>>,
      method: 'client_secret_basic' | 'client_secret_post',
    ) {
      const reg = await h.send({
        method: 'POST',
        url: '/oauth/register',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          redirect_uris: ['https://portal.example.edu/cb'],
          token_endpoint_auth_method: method,
        }),
      })
      const body = reg._json() as { client_id: string; client_secret: string }
      return {
        clientId: body.client_id,
        secret: body.client_secret,
        redirectUri: 'https://portal.example.edu/cb',
      }
    }

    it('accepts client_secret_basic and client_secret_post, and rejects a wrong secret with 401', async () => {
      const h = await harness()
      const c = await confidentialClient(h, 'client_secret_basic')
      const login = await completeLogin(h, c)
      const basic = `Basic ${Buffer.from(`${c.clientId}:${c.secret}`).toString('base64')}`
      const ok = await h.send({
        method: 'POST',
        url: '/oauth/token',
        headers: { ...FORM_HEADERS, authorization: basic },
        body: form({
          grant_type: 'authorization_code',
          code: login.code,
          code_verifier: login.verifier,
          redirect_uri: c.redirectUri,
        }),
      })
      expect(ok._status).toBe(200)

      const login2 = await completeLogin(h, c, { seed: 'two' })
      const post = await h.send({
        method: 'POST',
        url: '/oauth/token',
        headers: FORM_HEADERS,
        body: form({
          grant_type: 'authorization_code',
          client_id: c.clientId,
          client_secret: c.secret,
          code: login2.code,
          code_verifier: login2.verifier,
          redirect_uri: c.redirectUri,
        }),
      })
      expect(post._status).toBe(200)

      const wrong = await h.send({
        method: 'POST',
        url: '/oauth/token',
        headers: {
          ...FORM_HEADERS,
          authorization: `Basic ${Buffer.from(`${c.clientId}:nope`).toString('base64')}`,
        },
        body: form({
          grant_type: 'authorization_code',
          code: 'x',
          code_verifier: 'y',
          redirect_uri: c.redirectUri,
        }),
      })
      expect(wrong._status).toBe(401)
      expect(wrong._json()).toMatchObject({ error: 'invalid_client' })
      expect(wrong._headers['www-authenticate']).toBe('Basic realm="canvas-lms-mcp"')

      const noSecret = await h.send({
        method: 'POST',
        url: '/oauth/token',
        headers: FORM_HEADERS,
        body: form({
          grant_type: 'authorization_code',
          client_id: c.clientId,
          code: 'x',
          code_verifier: 'y',
          redirect_uri: c.redirectUri,
        }),
      })
      expect(noSecret._status).toBe(401)
      expect(noSecret._headers['www-authenticate']).toBeUndefined()
    })

    it('rejects a public client that presents a secret, two auth methods at once, an unknown client, and a missing client_id', async () => {
      const h = await harness()
      const pub = await registerPublicClient(h)
      const send = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
        h.send({
          method: 'POST',
          url: '/oauth/token',
          headers: { ...FORM_HEADERS, ...headers },
          body: form(fields),
        })
      const base = {
        grant_type: 'authorization_code',
        code: 'x',
        code_verifier: 'y',
        redirect_uri: 'http://127.0.0.1/callback',
      }
      expect((await send({ ...base, client_id: pub.clientId, client_secret: 's' }))._status).toBe(
        401,
      )
      expect(
        (
          await send(
            { ...base, client_secret: 's' },
            { authorization: `Basic ${Buffer.from('a:b').toString('base64')}` },
          )
        )._json(),
      ).toMatchObject({ error: 'invalid_request' })
      expect((await send({ ...base, client_id: 'mcpcl_unknown' }))._status).toBe(401)
      expect((await send(base))._json()).toMatchObject({ error: 'invalid_request' })
    })

    it('authenticates a pre-registered confidential client from CANVAS_MCP_OAUTH_CLIENTS', async () => {
      const h = await harness({
        env: {
          CANVAS_MCP_OAUTH_CLIENTS: JSON.stringify([
            {
              client_id: 'portal',
              redirect_uris: ['https://portal.example.edu/cb'],
              client_secret: 'portal-secret',
            },
          ]),
        },
      })
      const login = await completeLogin(h, {
        clientId: 'portal',
        redirectUri: 'https://portal.example.edu/cb',
      })
      const res = await h.send({
        method: 'POST',
        url: '/oauth/token',
        headers: {
          ...FORM_HEADERS,
          authorization: `Basic ${Buffer.from('portal:portal-secret').toString('base64')}`,
        },
        body: form({
          grant_type: 'authorization_code',
          code: login.code,
          code_verifier: login.verifier,
          redirect_uri: login.redirectUri,
        }),
      })
      expect(res._status).toBe(200)
    })
  })

  describe('token endpoint: refresh_token', () => {
    const refresh = (
      h: Awaited<ReturnType<typeof harness>>,
      clientId: string,
      refreshToken: string,
      extra: Record<string, string> = {},
    ) =>
      h.send({
        method: 'POST',
        url: '/oauth/token',
        headers: FORM_HEADERS,
        body: form({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: refreshToken,
          ...extra,
        }),
      })

    it('rotates: the old refresh token dies, the new pair works, the grant is untouched', async () => {
      const h = await harness()
      const { client, tokens } = await loggedInTokens(h)
      const res = await refresh(h, client.clientId, tokens.refreshToken!)
      expect(res._status).toBe(200)
      const body = res._json() as { access_token: string; refresh_token: string; scope: string }
      expect(body.refresh_token).not.toBe(tokens.refreshToken)
      expect(body.access_token).not.toBe(tokens.accessToken)
      expect(body.scope).toBe('canvas:read canvas:write')

      const replay = await refresh(h, client.clientId, tokens.refreshToken!)
      expect(replay._status).toBe(400)
      expect(replay._json()).toMatchObject({ error: 'invalid_grant' })

      const again = await refresh(h, client.clientId, body.refresh_token)
      expect(again._status).toBe(200)
      expect(h.store.snapshot().grants).toHaveLength(1)
      expect(h.canvas.refreshCount).toBe(0)
    })

    it('lets a refresh narrow scopes but never widen them, and a refused widening does not burn the token', async () => {
      const h = await harness()
      const { client, tokens } = await loggedInTokens(h, { scope: 'canvas:read' })
      const wider = await refresh(h, client.clientId, tokens.refreshToken!, {
        scope: 'canvas:read canvas:write',
      })
      expect(wider._json()).toMatchObject({ error: 'invalid_scope' })
      const narrower = await refresh(h, client.clientId, tokens.refreshToken!, {
        scope: 'canvas:read',
      })
      expect(narrower._status).toBe(200)
      expect((narrower._json() as { scope: string }).scope).toBe('canvas:read')
    })

    it('a foreign client’s attempt does not consume a legitimate refresh token', async () => {
      const h = await harness()
      const { client, tokens } = await loggedInTokens(h)
      const other = await registerPublicClient(h)
      expect((await refresh(h, other.clientId, tokens.refreshToken!))._json()).toMatchObject({
        error: 'invalid_grant',
      })
      expect((await refresh(h, client.clientId, tokens.refreshToken!))._status).toBe(200)
    })

    it('rejects another client, an access token, an expired token, a revoked grant, and a wrong resource', async () => {
      const h = await harness()
      const { client, tokens } = await loggedInTokens(h)
      const other = await registerPublicClient(h)
      expect((await refresh(h, other.clientId, tokens.refreshToken!))._json()).toMatchObject({
        error: 'invalid_grant',
      })
      expect((await refresh(h, client.clientId, tokens.accessToken))._json()).toMatchObject({
        error: 'invalid_grant',
      })
      // The access token survives being mistaken for a refresh token.
      expect(await h.store.getToken(hashToken(tokens.accessToken))).toBeDefined()
      expect(
        (
          await refresh(h, client.clientId, tokens.refreshToken!, {
            resource: 'https://other.example/mcp',
          })
        )._json(),
      ).toMatchObject({
        error: 'invalid_target',
      })

      let now = 1_800_000_000_000
      const h2 = await harness({ now: () => now })
      const two = await loggedInTokens(h2)
      now += 31 * 24 * 60 * 60 * 1000
      // Either the purge already dropped it ("invalid") or the expiry check
      // caught it ("expired"); both are invalid_grant and both leave no token.
      expect(
        (await refresh(h2, two.client.clientId, two.tokens.refreshToken!))._json(),
      ).toMatchObject({
        error: 'invalid_grant',
      })
      expect(await h2.store.getToken(hashToken(two.tokens.refreshToken!))).toBeUndefined()

      const h3 = await harness()
      const three = await loggedInTokens(h3)
      await h3.store.deleteGrant(three.tokens.grantId)
      expect(
        (await refresh(h3, three.client.clientId, three.tokens.refreshToken!))._json(),
      ).toMatchObject({ error: 'invalid_grant' })
    })
  })

  describe('revocation (RFC 7009)', () => {
    const revoke = (h: Awaited<ReturnType<typeof harness>>, clientId: string, token: string) =>
      h.send({
        method: 'POST',
        url: '/oauth/revoke',
        headers: FORM_HEADERS,
        body: form({ client_id: clientId, token }),
      })

    it.each(['access', 'refresh'] as const)(
      'revoking the %s token revokes the whole grant and the Canvas token',
      async (kind) => {
        const h = await harness()
        const { client, tokens } = await loggedInTokens(h)
        const res = await revoke(
          h,
          client.clientId,
          kind === 'access' ? tokens.accessToken : tokens.refreshToken!,
        )
        expect(res._status).toBe(200)
        const snapshot = h.store.snapshot()
        expect(snapshot.grants).toHaveLength(0)
        expect(snapshot.tokens).toHaveLength(0)
        expect(h.canvas.revoked).toEqual(['canvas-access-canvas-code-login'])
      },
    )

    it('returns 200 for an unknown token, 400 for another client’s token, and 400 without a token', async () => {
      const h = await harness()
      const { tokens } = await loggedInTokens(h)
      const other = await registerPublicClient(h)
      expect((await revoke(h, other.clientId, 'mcpat_unknown'))._status).toBe(200)
      const foreign = await revoke(h, other.clientId, tokens.accessToken)
      expect(foreign._status).toBe(400)
      expect(foreign._json()).toMatchObject({ error: 'unauthorized_client' })
      expect(h.store.snapshot().grants).toHaveLength(1)
      const missing = await h.send({
        method: 'POST',
        url: '/oauth/revoke',
        headers: FORM_HEADERS,
        body: form({ client_id: other.clientId }),
      })
      expect(missing._status).toBe(400)
    })

    it('refreshes an expired Canvas token first so Canvas can revoke it, and survives a Canvas outage', async () => {
      let now = 1_800_000_000_000
      const h = await harness({ now: () => now })
      const { client, tokens } = await loggedInTokens(h)
      now += 2 * 60 * 60 * 1000
      await revoke(h, client.clientId, tokens.refreshToken!)
      expect(h.canvas.refreshCount).toBe(1)
      expect(h.canvas.revoked).toEqual(['canvas-access-refreshed-1'])

      const h2 = await harness()
      const two = await loggedInTokens(h2)
      h2.canvas.fetch.mockRejectedValueOnce(new Error('down'))
      const res = await revoke(h2, two.client.clientId, two.tokens.accessToken)
      expect(res._status).toBe(200)
      expect(h2.store.snapshot().grants).toHaveLength(0)
      expect(h2.log.warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(
        /Canvas token revocation failed \(unavailable\)/,
      )
    })
  })

  describe('helpers', () => {
    it('normalizeResource lower-cases scheme/host, strips a trailing slash, and rejects fragments', () => {
      expect(normalizeResource('HTTPS://MCP.Example.com/mcp/')).toBe('https://mcp.example.com/mcp')
      expect(normalizeResource('https://mcp.example.com/mcp#frag')).toBeUndefined()
      expect(normalizeResource('not a url')).toBeUndefined()
    })

    it('errorRedirect appends error, description, and state', () => {
      const url = new URL(errorRedirect('http://127.0.0.1:1/cb?keep=1', 'access_denied', 'no', 's'))
      expect(url.searchParams.get('keep')).toBe('1')
      expect(url.searchParams.get('error')).toBe('access_denied')
      expect(url.searchParams.get('error_description')).toBe('no')
      expect(url.searchParams.get('state')).toBe('s')
    })

    it('the harness base env is the documented minimum', () => {
      expect(Object.keys(BASE_ENV).sort()).toEqual([
        'CANVAS_BASE_URL',
        'CANVAS_MCP_ISSUER',
        'CANVAS_OAUTH_CLIENT_ID',
        'CANVAS_OAUTH_CLIENT_SECRET',
      ])
      expect(vi.isMockFunction(vi.fn())).toBe(true)
    })
  })
})
