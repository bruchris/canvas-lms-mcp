import { describe, expect, it } from 'vitest'
import {
  ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_CIMD_ALLOWED_HOSTS,
  MCP_SCOPES,
  OAuthConfigError,
  loadOAuthProfileConfig,
  parseIssuer,
  resolveBindHost,
  type OAuthEnv,
} from '../../../src/auth/oauth/config'

const BASE_ENV: OAuthEnv = {
  CANVAS_BASE_URL: 'https://school.instructure.com',
  CANVAS_MCP_ISSUER: 'http://127.0.0.1:3001',
  CANVAS_OAUTH_CLIENT_ID: '10000000000001',
  CANVAS_OAUTH_CLIENT_SECRET: 'dev-key-secret',
}

describe('OAuth profile configuration (#302 §5)', () => {
  describe('parseIssuer', () => {
    it('accepts http on loopback and https anywhere, stripping the trailing slash', () => {
      expect(parseIssuer('http://127.0.0.1:3001/').issuer).toBe('http://127.0.0.1:3001')
      expect(parseIssuer('http://localhost:3001').issuer).toBe('http://localhost:3001')
      expect(parseIssuer('https://canvas-mcp.example.edu/').issuer).toBe(
        'https://canvas-mcp.example.edu',
      )
    })

    it('keeps a path prefix and reports it separately (RFC 8414 path-inserted well-known)', () => {
      const parsed = parseIssuer('https://apps.example.edu/canvas-mcp/')
      expect(parsed.issuer).toBe('https://apps.example.edu/canvas-mcp')
      expect(parsed.issuerPath).toBe('/canvas-mcp')
      expect(parseIssuer('http://127.0.0.1:3001').issuerPath).toBe('')
    })

    it('refuses plain http off loopback — hosted authorization endpoints require HTTPS', () => {
      expect(() => parseIssuer('http://canvas-mcp.example.edu')).toThrow(/must use https/)
      expect(() => parseIssuer('http://10.0.0.5:3001')).toThrow(/must use https/)
    })

    it('refuses query strings, fragments, credentials, other schemes, and relative values', () => {
      expect(() => parseIssuer('https://x.example/?a=1')).toThrow(/query string or fragment/)
      expect(() => parseIssuer('https://x.example/#f')).toThrow(/query string or fragment/)
      expect(() => parseIssuer('https://u:p@x.example/')).toThrow(/credentials/)
      expect(() => parseIssuer('ftp://x.example/')).toThrow(/http \(loopback only\) or https/)
      expect(() => parseIssuer('canvas-mcp.example.edu')).toThrow(/absolute URL/)
    })
  })

  describe('loadOAuthProfileConfig', () => {
    it('builds the resource identifier from the issuer and normalises the Canvas origin', () => {
      const config = loadOAuthProfileConfig({
        ...BASE_ENV,
        CANVAS_BASE_URL: 'https://school.instructure.com/',
      })
      expect(config.issuer).toBe('http://127.0.0.1:3001')
      expect(config.resource).toBe('http://127.0.0.1:3001/mcp')
      expect(config.canvas.baseUrl).toBe('https://school.instructure.com')
      expect(config.canvas.clientId).toBe('10000000000001')
      expect(config.canvas.clientSecret).toBe('dev-key-secret')
      expect(config.canvas.scopes).toBeUndefined()
      expect(config.clients).toEqual([])
      expect(config.dynamicRegistration).toBe(true)
      expect(config.cimdAllowedHosts).toEqual(DEFAULT_CIMD_ALLOWED_HOSTS)
      expect(config.store).toBeUndefined()
    })

    it('does not require CANVAS_API_TOKEN (acceptance: OAuth profile starts without it)', () => {
      expect(() => loadOAuthProfileConfig(BASE_ENV)).not.toThrow()
    })

    it('CLI overrides win over the environment', () => {
      const config = loadOAuthProfileConfig(BASE_ENV, {
        issuer: 'https://hosted.example.edu',
        baseUrl: 'https://other.instructure.com',
      })
      expect(config.issuer).toBe('https://hosted.example.edu')
      expect(config.canvas.baseUrl).toBe('https://other.instructure.com')
    })

    it.each([
      ['CANVAS_BASE_URL', /Canvas base URL required/],
      ['CANVAS_MCP_ISSUER', /CANVAS_MCP_ISSUER \(or --issuer\) is required/],
      ['CANVAS_OAUTH_CLIENT_ID', /CANVAS_OAUTH_CLIENT_ID is required/],
      ['CANVAS_OAUTH_CLIENT_SECRET', /CANVAS_OAUTH_CLIENT_SECRET is required/],
    ])('names %s when it is missing', (key, message) => {
      const env = { ...BASE_ENV }
      delete env[key as keyof OAuthEnv]
      expect(() => loadOAuthProfileConfig(env)).toThrow(OAuthConfigError)
      expect(() => loadOAuthProfileConfig(env)).toThrow(message)
    })

    it('requires https for the Canvas base URL (a Canvas token travels on it)', () => {
      expect(() =>
        loadOAuthProfileConfig({ ...BASE_ENV, CANVAS_BASE_URL: 'http://school.instructure.com' }),
      ).toThrow(/CANVAS_BASE_URL must use https/)
      // A local Canvas dev instance is the one legitimate exception.
      expect(() =>
        loadOAuthProfileConfig({ ...BASE_ENV, CANVAS_BASE_URL: 'http://localhost:3000' }),
      ).not.toThrow()
    })

    it('passes Canvas scopes through untouched', () => {
      const config = loadOAuthProfileConfig({
        ...BASE_ENV,
        CANVAS_OAUTH_SCOPES: 'url:GET|/api/v1/courses url:GET|/api/v1/users/:user_id/profile',
      })
      expect(config.canvas.scopes).toBe(
        'url:GET|/api/v1/courses url:GET|/api/v1/users/:user_id/profile',
      )
    })

    describe('pre-registered clients', () => {
      it('parses a valid array', () => {
        const config = loadOAuthProfileConfig({
          ...BASE_ENV,
          CANVAS_MCP_OAUTH_CLIENTS: JSON.stringify([
            {
              client_id: 'codex-local',
              client_name: 'Codex',
              redirect_uris: ['http://127.0.0.1/callback'],
            },
            {
              client_id: 'portal',
              redirect_uris: ['https://portal.example.edu/oauth/cb'],
              client_secret: 'portal-secret',
            },
          ]),
        })
        expect(config.clients).toHaveLength(2)
        expect(config.clients[1]?.client_secret).toBe('portal-secret')
      })

      it.each([
        ['not json', /must be a JSON array/],
        ['{"client_id":"x"}', /must be a JSON array/],
        ['[1]', /\[0\] must be an object/],
        [
          '[{"redirect_uris":["https://a.example/cb"]}]',
          /\[0\]\.client_id must be a non-empty string/,
        ],
        ['[{"client_id":"x"}]', /\[0\]\.redirect_uris must be a non-empty array/],
        [
          '[{"client_id":"x","redirect_uris":[]}]',
          /\[0\]\.redirect_uris must be a non-empty array/,
        ],
        [
          '[{"client_id":"x","redirect_uris":["http://example.com/cb"]}]',
          /\[0\]: redirect_uri 'http:\/\/example.com\/cb' must use https/,
        ],
        [
          '[{"client_id":"x","redirect_uris":["https://a.example/cb"]},{"client_id":"x","redirect_uris":["https://b.example/cb"]}]',
          /\[1\]\.client_id 'x' is registered twice/,
        ],
        [
          '[{"client_id":"x","redirect_uris":["https://a.example/cb"],"client_secret":5}]',
          /client_secret must be a string/,
        ],
      ])('rejects %s', (raw, message) => {
        expect(() =>
          loadOAuthProfileConfig({ ...BASE_ENV, CANVAS_MCP_OAUTH_CLIENTS: raw }),
        ).toThrow(message)
      })

      it('treats an empty value as no clients', () => {
        expect(
          loadOAuthProfileConfig({ ...BASE_ENV, CANVAS_MCP_OAUTH_CLIENTS: '  ' }).clients,
        ).toEqual([])
      })
    })

    describe('registration switches', () => {
      it('CANVAS_MCP_OAUTH_DCR=false disables dynamic registration; other values follow isEnvTruthy', () => {
        expect(
          loadOAuthProfileConfig({ ...BASE_ENV, CANVAS_MCP_OAUTH_DCR: 'false' })
            .dynamicRegistration,
        ).toBe(false)
        expect(
          loadOAuthProfileConfig({ ...BASE_ENV, CANVAS_MCP_OAUTH_DCR: 'true' }).dynamicRegistration,
        ).toBe(true)
        expect(
          loadOAuthProfileConfig({ ...BASE_ENV, CANVAS_MCP_OAUTH_DCR: 'no' }).dynamicRegistration,
        ).toBe(false)
      })

      it('CIMD hosts: default chatgpt.com, comma list lower-cased, * wildcard, none/empty disables', () => {
        expect(loadOAuthProfileConfig(BASE_ENV).cimdAllowedHosts).toEqual(['chatgpt.com'])
        expect(
          loadOAuthProfileConfig({
            ...BASE_ENV,
            CANVAS_MCP_OAUTH_CIMD_ALLOWED_HOSTS: 'ChatGPT.com, clients.example.edu',
          }).cimdAllowedHosts,
        ).toEqual(['chatgpt.com', 'clients.example.edu'])
        expect(
          loadOAuthProfileConfig({
            ...BASE_ENV,
            CANVAS_MCP_OAUTH_CIMD_ALLOWED_HOSTS: 'a.example,*',
          }).cimdAllowedHosts,
        ).toEqual(['*'])
        expect(
          loadOAuthProfileConfig({ ...BASE_ENV, CANVAS_MCP_OAUTH_CIMD_ALLOWED_HOSTS: 'none' })
            .cimdAllowedHosts,
        ).toEqual([])
        expect(
          loadOAuthProfileConfig({ ...BASE_ENV, CANVAS_MCP_OAUTH_CIMD_ALLOWED_HOSTS: '' })
            .cimdAllowedHosts,
        ).toEqual([])
      })

      it('rejects a CIMD entry that is not a hostname', () => {
        expect(() =>
          loadOAuthProfileConfig({
            ...BASE_ENV,
            CANVAS_MCP_OAUTH_CIMD_ALLOWED_HOSTS: 'https://chatgpt.com',
          }),
        ).toThrow(/is not a hostname/)
      })
    })

    describe('encrypted store', () => {
      it('requires a key of at least 16 characters when a path is set', () => {
        expect(() =>
          loadOAuthProfileConfig({ ...BASE_ENV, CANVAS_MCP_OAUTH_STORE: '/var/lib/x.enc' }),
        ).toThrow(/CANVAS_MCP_OAUTH_STORE_KEY \(at least 16 characters\) is required/)
        expect(() =>
          loadOAuthProfileConfig({
            ...BASE_ENV,
            CANVAS_MCP_OAUTH_STORE: '/var/lib/x.enc',
            CANVAS_MCP_OAUTH_STORE_KEY: 'short',
          }),
        ).toThrow(/at least 16 characters/)
        const config = loadOAuthProfileConfig({
          ...BASE_ENV,
          CANVAS_MCP_OAUTH_STORE: '/var/lib/x.enc',
          CANVAS_MCP_OAUTH_STORE_KEY: 'a-long-enough-secret-value',
        })
        expect(config.store).toEqual({
          path: '/var/lib/x.enc',
          keySecret: 'a-long-enough-secret-value',
        })
      })

      it('refuses a key without a path, so a half-configured store is not silently in-memory', () => {
        expect(() =>
          loadOAuthProfileConfig({
            ...BASE_ENV,
            CANVAS_MCP_OAUTH_STORE_KEY: 'a-long-enough-secret-value',
          }),
        ).toThrow(/set both or neither/)
      })
    })
  })

  describe('resolveBindHost', () => {
    it('defaults to loopback (acceptance: localhost mode binds only to loopback by default)', () => {
      const config = loadOAuthProfileConfig(BASE_ENV)
      expect(resolveBindHost(config, undefined)).toBe('127.0.0.1')
      expect(resolveBindHost(config, '')).toBe('127.0.0.1')
    })

    it('refuses to expose a loopback issuer on the network', () => {
      const config = loadOAuthProfileConfig(BASE_ENV)
      expect(() => resolveBindHost(config, '0.0.0.0')).toThrow(/must bind a loopback host too/)
      expect(resolveBindHost(config, '::1')).toBe('::1')
    })

    it('lets an https issuer bind any host (hosted behind TLS termination)', () => {
      const config = loadOAuthProfileConfig({
        ...BASE_ENV,
        CANVAS_MCP_ISSUER: 'https://canvas-mcp.example.edu',
      })
      expect(resolveBindHost(config, '0.0.0.0')).toBe('0.0.0.0')
      expect(resolveBindHost(config, undefined)).toBe('127.0.0.1')
    })
  })

  it('exposes the two MCP scopes and a one-hour access-token lifetime', () => {
    expect([...MCP_SCOPES]).toEqual(['canvas:read', 'canvas:write'])
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(3600)
  })
})
