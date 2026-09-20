import { describe, expect, it, vi } from 'vitest'
import {
  ClientRegistrationError,
  ClientResolver,
  isCimdClientId,
  parseScopeParam,
  registrationResponse,
  validateClientMetadata,
} from '../../../src/auth/oauth/clients'
import { hashToken } from '../../../src/auth/oauth/crypto'
import { MemoryOAuthStore } from '../../../src/auth/oauth/store'

const NOW = 1_800_000_000_000

function resolver(overrides: Partial<ConstructorParameters<typeof ClientResolver>[0]> = {}) {
  const store = new MemoryOAuthStore()
  const fetchMock = vi.fn()
  const r = new ClientResolver({
    store,
    config: { clients: [], cimdAllowedHosts: ['chatgpt.com'], dynamicRegistration: true },
    fetch: fetchMock as unknown as typeof fetch,
    now: () => NOW,
    ...overrides,
  })
  return { store, fetchMock, resolver: r }
}

function cimdDoc(url: string, extra: Record<string, unknown> = {}) {
  return {
    client_id: url,
    client_name: 'Codex',
    redirect_uris: ['http://127.0.0.1/callback'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    ...extra,
  }
}

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
}

describe('client resolution (#302 §7.3)', () => {
  describe('parseScopeParam', () => {
    it('parses known scopes, dedupes, and rejects unknown or empty input', () => {
      expect(parseScopeParam('canvas:read canvas:write canvas:read')).toEqual([
        'canvas:read',
        'canvas:write',
      ])
      expect(parseScopeParam('canvas:read admin')).toBeUndefined()
      expect(parseScopeParam('')).toBeUndefined()
      expect(parseScopeParam(null)).toBeUndefined()
    })
  })

  describe('isCimdClientId', () => {
    it('requires https and a path component', () => {
      expect(isCimdClientId('https://chatgpt.com/oauth/codex/x/client.json')).toBe(true)
      expect(isCimdClientId('https://chatgpt.com')).toBe(false)
      expect(isCimdClientId('https://chatgpt.com/')).toBe(false)
      expect(isCimdClientId('http://chatgpt.com/client.json')).toBe(false)
      expect(isCimdClientId('mcpcl_abc')).toBe(false)
    })
  })

  describe('pre-registered clients', () => {
    it('seeds the store, hashing any secret', async () => {
      const { store, resolver: r } = resolver({
        config: {
          clients: [
            {
              client_id: 'codex-local',
              client_name: 'Codex',
              redirect_uris: ['http://127.0.0.1/callback'],
            },
            {
              client_id: 'portal',
              redirect_uris: ['https://portal.example.edu/cb'],
              client_secret: 'portal-secret',
            },
          ],
          cimdAllowedHosts: [],
          dynamicRegistration: true,
        },
      })
      await r.seedPreregistered()
      const pub = await store.getClient('codex-local')
      expect(pub).toMatchObject({
        source: 'preregistered',
        tokenEndpointAuthMethod: 'none',
        clientName: 'Codex',
      })
      const conf = await store.getClient('portal')
      expect(conf).toMatchObject({ tokenEndpointAuthMethod: 'client_secret_basic' })
      expect(conf?.clientSecretHash).toBe(hashToken('portal-secret'))
      expect(JSON.stringify(conf)).not.toContain('portal-secret')
      expect(await r.resolve('portal')).toBeDefined()
    })
  })

  describe('dynamic registration (RFC 7591)', () => {
    it('registers a public client with the MCP defaults and returns the RFC response', async () => {
      const { resolver: r, store } = resolver()
      const result = await r.register({
        client_name: 'Codex',
        redirect_uris: ['http://127.0.0.1/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      })
      expect(result.clientSecret).toBeUndefined()
      expect(result.client.clientId).toMatch(/^mcpcl_/)
      expect(result.client.source).toBe('dynamic')
      expect(await store.getClient(result.client.clientId)).toBeDefined()
      expect(registrationResponse(result)).toEqual({
        client_id: result.client.clientId,
        client_id_issued_at: Math.floor(NOW / 1000),
        redirect_uris: ['http://127.0.0.1/callback'],
        client_name: 'Codex',
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      })
    })

    it('issues and hashes a secret for confidential clients; the plain secret is returned exactly once', async () => {
      const { resolver: r, store } = resolver()
      const result = await r.register({
        redirect_uris: ['https://portal.example.edu/cb'],
        token_endpoint_auth_method: 'client_secret_post',
      })
      expect(result.clientSecret).toMatch(/^mcpcs_/)
      const stored = await store.getClient(result.client.clientId)
      expect(stored?.clientSecretHash).toBe(hashToken(result.clientSecret!))
      expect(registrationResponse(result)).toMatchObject({
        client_secret: result.clientSecret,
        client_secret_expires_at: 0,
      })
    })

    it('defaults to client_secret_basic when the method is omitted (RFC 7591 §2) and to both grant types', async () => {
      const { resolver: r } = resolver()
      const result = await r.register({ redirect_uris: ['https://a.example/cb'] })
      expect(result.client.tokenEndpointAuthMethod).toBe('client_secret_basic')
      expect(result.clientSecret).toBeDefined()
      expect(result.client.grantTypes).toEqual(['authorization_code', 'refresh_token'])
    })

    it.each([
      [null, 'invalid_client_metadata', /JSON object/],
      [{}, 'invalid_redirect_uri', /redirect_uris must be a non-empty array/],
      [{ redirect_uris: [] }, 'invalid_redirect_uri', /non-empty/],
      [{ redirect_uris: ['http://evil.example/cb'] }, 'invalid_redirect_uri', /must use https/],
      [{ redirect_uris: ['myapp://cb'] }, 'invalid_redirect_uri', /must use https/],
      [
        { redirect_uris: Array.from({ length: 11 }, (_, i) => `https://a.example/cb${i}`) },
        'invalid_redirect_uri',
        /At most 10/,
      ],
      [
        { redirect_uris: ['https://a.example/cb'], client_name: '' },
        'invalid_client_metadata',
        /client_name/,
      ],
      [
        { redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'private_key_jwt' },
        'invalid_client_metadata',
        /token_endpoint_auth_method must be one of/,
      ],
      [
        { redirect_uris: ['https://a.example/cb'], grant_types: ['client_credentials'] },
        'invalid_client_metadata',
        /grant_types may only contain/,
      ],
      [
        { redirect_uris: ['https://a.example/cb'], grant_types: ['refresh_token'] },
        'invalid_client_metadata',
        /must include authorization_code/,
      ],
      [
        { redirect_uris: ['https://a.example/cb'], response_types: ['token'] },
        'invalid_client_metadata',
        /response_types may only contain "code"/,
      ],
      [
        { redirect_uris: ['https://a.example/cb'], scope: 'canvas:admin' },
        'invalid_client_metadata',
        /scope may only contain/,
      ],
    ])('rejects %j with %s', async (body, error, message) => {
      const { resolver: r } = resolver()
      const failure = await r.register(body).catch((e) => e)
      expect(failure).toBeInstanceOf(ClientRegistrationError)
      expect(failure.error).toBe(error)
      expect(failure.message).toMatch(message)
    })

    it('truncates over-long names and dedupes redirect URIs', () => {
      const meta = validateClientMetadata(
        {
          client_name: 'x'.repeat(500),
          redirect_uris: ['https://a.example/cb', 'https://a.example/cb'],
        },
        { requirePublic: false },
      )
      expect(meta.clientName).toHaveLength(200)
      expect(meta.redirectUris).toEqual(['https://a.example/cb'])
    })
  })

  describe('Client ID Metadata Documents', () => {
    const CODEX_ID = 'https://chatgpt.com/oauth/codex/abc123/client.json'

    it('fetches an allowlisted document once, validates it, and caches it', async () => {
      const { resolver: r, fetchMock, store } = resolver()
      fetchMock.mockResolvedValue(
        jsonResponse(cimdDoc(CODEX_ID), { headers: { 'Cache-Control': 'max-age=120' } }),
      )

      const client = await r.resolve(CODEX_ID)
      expect(client).toMatchObject({
        clientId: CODEX_ID,
        clientName: 'Codex',
        source: 'cimd',
        tokenEndpointAuthMethod: 'none',
        redirectUris: ['http://127.0.0.1/callback'],
        cimdExpiresAt: NOW + 120_000,
      })
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(CODEX_ID)
      expect(init.redirect).toBe('manual')
      expect(init.signal).toBeInstanceOf(AbortSignal)

      await r.resolve(CODEX_ID)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(await store.getClient(CODEX_ID)).toBeDefined()
    })

    it('bounds the cache lifetime to [60s, 1h] and honours no-store as the minimum', async () => {
      const { resolver: r, fetchMock } = resolver()
      fetchMock.mockResolvedValueOnce(
        jsonResponse(cimdDoc(CODEX_ID), { headers: { 'Cache-Control': 'max-age=999999' } }),
      )
      expect((await r.resolve(CODEX_ID))?.cimdExpiresAt).toBe(NOW + 3_600_000)
      const { resolver: r2, fetchMock: f2 } = resolver()
      f2.mockResolvedValueOnce(
        jsonResponse(cimdDoc(CODEX_ID), { headers: { 'Cache-Control': 'no-store' } }),
      )
      expect((await r2.resolve(CODEX_ID))?.cimdExpiresAt).toBe(NOW + 60_000)
      const { resolver: r3, fetchMock: f3 } = resolver()
      f3.mockResolvedValueOnce(jsonResponse(cimdDoc(CODEX_ID)))
      expect((await r3.resolve(CODEX_ID))?.cimdExpiresAt).toBe(NOW + 3_600_000)
    })

    it('re-fetches an expired cache entry', async () => {
      let now = NOW
      const { resolver: r, fetchMock } = resolver({ now: () => now })
      fetchMock.mockResolvedValue(
        jsonResponse(cimdDoc(CODEX_ID), { headers: { 'Cache-Control': 'max-age=60' } }),
      )
      await r.resolve(CODEX_ID)
      now += 61_000
      await r.resolve(CODEX_ID)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('never fetches a host that is not allowlisted (the SSRF control)', async () => {
      const { resolver: r, fetchMock } = resolver()
      expect(await r.resolve('https://evil.example/client.json')).toBeUndefined()
      expect(await r.resolve('https://chatgpt.com.evil.example/client.json')).toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('honours the * wildcard and the disabled state', async () => {
      const { resolver: any, fetchMock } = resolver({
        config: { clients: [], cimdAllowedHosts: ['*'], dynamicRegistration: true },
      })
      fetchMock.mockResolvedValue(jsonResponse(cimdDoc('https://any.example/c.json')))
      expect(await any.resolve('https://any.example/c.json')).toBeDefined()
      expect(any.cimdEnabled).toBe(true)

      const { resolver: off, fetchMock: f2 } = resolver({
        config: { clients: [], cimdAllowedHosts: [], dynamicRegistration: true },
      })
      expect(off.cimdEnabled).toBe(false)
      expect(await off.resolve(CODEX_ID)).toBeUndefined()
      expect(f2).not.toHaveBeenCalled()
    })

    it.each([
      ['client_id mismatch', jsonResponse(cimdDoc('https://chatgpt.com/other.json'))],
      [
        'non-JSON content type',
        new Response('{}', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      ],
      [
        'redirect',
        new Response(null, { status: 302, headers: { Location: 'https://evil.example/x' } }),
      ],
      ['404', jsonResponse({}, { status: 404 })],
      [
        'invalid JSON',
        new Response('nope', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ],
      [
        'confidential method',
        jsonResponse(cimdDoc(CODEX_ID, { token_endpoint_auth_method: 'client_secret_post' })),
      ],
      [
        'bad redirect uri',
        jsonResponse(cimdDoc(CODEX_ID, { redirect_uris: ['http://evil.example/cb'] })),
      ],
      [
        'oversized',
        new Response(JSON.stringify(cimdDoc(CODEX_ID, { pad: 'x'.repeat(70_000) })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ],
    ])('rejects a document with %s', async (_label, response) => {
      const { resolver: r, fetchMock, store } = resolver()
      fetchMock.mockResolvedValue(response)
      expect(await r.resolve(CODEX_ID)).toBeUndefined()
      expect(await store.getClient(CODEX_ID)).toBeUndefined()
    })

    it('treats a network failure as an unknown client', async () => {
      const { resolver: r, fetchMock } = resolver()
      fetchMock.mockRejectedValue(new Error('timeout'))
      expect(await r.resolve(CODEX_ID)).toBeUndefined()
    })
  })
})
