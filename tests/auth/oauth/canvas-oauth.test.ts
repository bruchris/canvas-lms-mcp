import { describe, expect, it, vi } from 'vitest'
import { CanvasOAuthClient, CanvasOAuthError } from '../../../src/auth/oauth/canvas-oauth'

const NOW = 1_800_000_000_000

function makeClient(fetchImpl: typeof fetch, scopes?: string) {
  return new CanvasOAuthClient({
    baseUrl: 'https://school.instructure.com/',
    clientId: '10000000000001',
    clientSecret: 'dev-key-secret',
    redirectUri: 'http://127.0.0.1:3001/oauth/canvas/callback',
    fetch: fetchImpl,
    now: () => NOW,
    ...(scopes ? { scopes } : {}),
  })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('CanvasOAuthClient (#302 §9)', () => {
  describe('authorizationUrl', () => {
    it('targets /login/oauth2/auth with the documented parameters and no scope by default', () => {
      const url = new URL(makeClient(vi.fn()).authorizationUrl('pending-123'))
      expect(url.origin + url.pathname).toBe('https://school.instructure.com/login/oauth2/auth')
      expect(Object.fromEntries(url.searchParams)).toEqual({
        client_id: '10000000000001',
        response_type: 'code',
        redirect_uri: 'http://127.0.0.1:3001/oauth/canvas/callback',
        state: 'pending-123',
      })
    })

    it('adds scope only when configured', () => {
      const url = new URL(makeClient(vi.fn(), 'url:GET|/api/v1/courses').authorizationUrl('s'))
      expect(url.searchParams.get('scope')).toBe('url:GET|/api/v1/courses')
    })
  })

  describe('exchangeCode', () => {
    // QA S6/W1 (#356): the token call needs the same wall-clock bound as
    // `revoke`, or a hung Canvas holds the per-grant refresh dedup in the
    // resource server and every request on that grant waits with it.
    it('bounds the call with an AbortSignal', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ access_token: 'a', refresh_token: 'r', user: { id: 1 } }))
      await makeClient(fetchMock).exchangeCode('c')
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(init.signal).toBeInstanceOf(AbortSignal)
      expect(init.signal!.aborted).toBe(false)
    })

    it('posts a form-encoded authorization_code grant with the Developer Key and maps the response', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          access_token: 'canvas-access',
          token_type: 'Bearer',
          user: { id: 42, name: 'Pat Example' },
          refresh_token: 'canvas-refresh',
          expires_in: 3600,
          canvas_region: 'eu-west-1',
        }),
      )
      const result = await makeClient(fetchMock).exchangeCode('the-code')

      expect(result).toEqual({
        accessToken: 'canvas-access',
        refreshToken: 'canvas-refresh',
        expiresAt: NOW + 3_600_000,
        canvasUserId: '42',
      })
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://school.instructure.com/login/oauth2/token')
      expect(init.method).toBe('POST')
      expect((init.headers as Record<string, string>)['Content-Type']).toBe(
        'application/x-www-form-urlencoded',
      )
      expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
        grant_type: 'authorization_code',
        client_id: '10000000000001',
        client_secret: 'dev-key-secret',
        redirect_uri: 'http://127.0.0.1:3001/oauth/canvas/callback',
        code: 'the-code',
      })
    })

    it('discards the user name — only the id is kept (§9)', async () => {
      const result = await makeClient(
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse({ access_token: 'a', refresh_token: 'r', user: { id: '7', name: 'X' } }),
          ),
      ).exchangeCode('c')
      expect(result).not.toHaveProperty('name')
      expect(result.canvasUserId).toBe('7')
    })

    it('falls back to a one-hour lifetime when expires_in is missing or nonsense', async () => {
      const result = await makeClient(
        vi.fn().mockResolvedValue(
          jsonResponse({
            access_token: 'a',
            refresh_token: 'r',
            user: { id: 1 },
            expires_in: 'soon',
          }),
        ),
      ).exchangeCode('c')
      expect(result.expiresAt).toBe(NOW + 3_600_000)
    })

    it.each([
      [{ refresh_token: 'r', user: { id: 1 } }, /no access_token/],
      [{ access_token: 'a', user: { id: 1 } }, /no refresh_token/],
      [{ access_token: 'a', refresh_token: 'r' }, /no user\.id/],
    ])('rejects a malformed token response %j', async (body, message) => {
      // A fresh Response per call: a body can only be read once.
      const client = makeClient(vi.fn().mockImplementation(async () => jsonResponse(body)))
      await expect(client.exchangeCode('c')).rejects.toMatchObject({ kind: 'malformed' })
      await expect(client.exchangeCode('c')).rejects.toThrow(message)
    })

    it('classifies a 4xx invalid_grant without surfacing the Canvas error body', async () => {
      const client = makeClient(
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse({ error: 'invalid_grant', error_description: 'leaky detail' }, 400),
          ),
      )
      const error = await client.exchangeCode('c').catch((e) => e)
      expect(error).toBeInstanceOf(CanvasOAuthError)
      expect(error.kind).toBe('invalid_grant')
      expect(error.status).toBe(400)
      expect(error.message).not.toContain('leaky detail')
    })

    it('classifies 5xx and network failures as unavailable', async () => {
      await expect(
        makeClient(vi.fn().mockResolvedValue(jsonResponse({}, 503))).exchangeCode('c'),
      ).rejects.toMatchObject({ kind: 'unavailable', status: 503 })
      await expect(
        makeClient(vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))).exchangeCode('c'),
      ).rejects.toMatchObject({ kind: 'unavailable' })
    })

    it('classifies a non-JSON 200 as malformed', async () => {
      const client = makeClient(vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })))
      await expect(client.exchangeCode('c')).rejects.toMatchObject({ kind: 'malformed' })
    })
  })

  describe('refresh', () => {
    // QA S6/W1 (#356). Refresh is the call that runs under the per-grant dedup
    // lock, so an unbounded one here is the worst of the three.
    it('bounds the call with an AbortSignal', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'a' }))
      await makeClient(fetchMock).refresh('canvas-refresh')
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(init.signal).toBeInstanceOf(AbortSignal)
      expect(init.signal!.aborted).toBe(false)
    })

    it('posts a refresh_token grant and keeps the old refresh token when Canvas does not rotate', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ access_token: 'new-access', expires_in: 3600, user: { id: 42 } }),
        )
      const result = await makeClient(fetchMock).refresh('canvas-refresh')
      expect(result).toEqual({ accessToken: 'new-access', expiresAt: NOW + 3_600_000 })
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(Object.fromEntries(new URLSearchParams(init.body as string))).toMatchObject({
        grant_type: 'refresh_token',
        refresh_token: 'canvas-refresh',
        redirect_uri: 'http://127.0.0.1:3001/oauth/canvas/callback',
      })
    })

    it('passes a rotated refresh token through if Canvas ever sends one', async () => {
      const result = await makeClient(
        vi.fn().mockResolvedValue(jsonResponse({ access_token: 'a', refresh_token: 'rotated' })),
      ).refresh('old')
      expect(result.refreshToken).toBe('rotated')
    })

    it('reports a revoked refresh token as invalid_grant', async () => {
      await expect(
        makeClient(
          vi.fn().mockResolvedValue(jsonResponse({ error: 'invalid_grant' }, 400)),
        ).refresh('x'),
      ).rejects.toMatchObject({ kind: 'invalid_grant', status: 400 })
    })
  })

  // Canvas's OAuth error taxonomy, read from `lib/canvas/oauth/request_error.rb`
  // at master `1c9f0bb8013e` on 2026-09-20: `invalid_client_id` and
  // `invalid_client_secret` both map to `{error: "invalid_client"}` with
  // `http_status: 401`, while every `invalid_grant` variant takes the default
  // 400. Classifying 401 as a dead grant (QA W2, #356) meant one rotated or
  // mistyped `CANVAS_OAUTH_CLIENT_SECRET` revoked every user's grant on their
  // next refresh. The grant is dead only when Canvas says `invalid_grant`.
  describe('error classification (QA W2, #356)', () => {
    it('treats a 401 invalid_client as unavailable and tells the operator which config is wrong', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const error = await makeClient(
          vi
            .fn()
            .mockResolvedValue(
              jsonResponse({ error: 'invalid_client', error_description: 'invalid client' }, 401),
            ),
        )
          .refresh('still-good')
          .catch((e) => e)
        expect(error).toBeInstanceOf(CanvasOAuthError)
        expect(error.kind).toBe('unavailable')
        expect(error.status).toBe(401)
        expect(error.message).not.toContain('invalid client')
        expect(logged).toHaveBeenCalledWith(
          expect.stringContaining('CANVAS_OAUTH_CLIENT_ID/CANVAS_OAUTH_CLIENT_SECRET'),
        )
      } finally {
        logged.mockRestore()
      }
    })

    it('treats a 400 invalid_request (redirect_uri does not match the Developer Key) as unavailable', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        await expect(
          makeClient(
            vi.fn().mockResolvedValue(
              jsonResponse(
                {
                  error: 'invalid_request',
                  error_description: 'redirect_uri does not match client settings',
                },
                400,
              ),
            ),
          ).exchangeCode('c'),
        ).rejects.toMatchObject({ kind: 'unavailable', status: 400 })
        expect(logged).toHaveBeenCalled()
      } finally {
        logged.mockRestore()
      }
    })

    it('still calls an unreadable 400 a dead grant, so the re-authorization path survives a WAF', async () => {
      await expect(
        makeClient(
          vi.fn().mockResolvedValue(new Response('<html>Blocked</html>', { status: 400 })),
        ).refresh('x'),
      ).rejects.toMatchObject({ kind: 'invalid_grant', status: 400 })
    })

    it('never calls an unreadable 401 a dead grant — Canvas only uses 401 for invalid_client', async () => {
      await expect(
        makeClient(vi.fn().mockResolvedValue(new Response(null, { status: 401 }))).refresh('x'),
      ).rejects.toMatchObject({ kind: 'unavailable', status: 401 })
    })

    it('leaves a 403 from a WAF and a 429 rate limit as unavailable', async () => {
      for (const status of [403, 429]) {
        await expect(
          makeClient(vi.fn().mockResolvedValue(new Response(null, { status }))).refresh('x'),
        ).rejects.toMatchObject({ kind: 'unavailable', status })
      }
    })
  })

  // N4 (#356). The Canvas `error` code reaches an operator's console inside the
  // "rejected this server's own OAuth request" line. It is upstream text — a
  // compromised or misbehaving Canvas, or a proxy in front of it, controls it —
  // and a raw newline or ANSI escape in a log line forges further lines or
  // repaints the terminal. Only a well-formed code (`/^[a-z_]{1,64}$/`) is
  // printed; anything else becomes a fixed marker. Classification is untouched.
  describe('operator log hygiene (N4, #356)', () => {
    const MARKER = '<unrecognized>'

    /** A C0 control (newline, ESC, NUL, …) or DEL: what a forged or repainted log line is made of. */
    function hasControlCharacter(text: string): boolean {
      return [...text].some((char) => {
        const code = char.charCodeAt(0)
        return code < 0x20 || code === 0x7f
      })
    }

    /** One failing token request with `error: <code>`; what was logged and thrown. */
    async function rejectWith(code: unknown, status = 401) {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const error = await makeClient(
          vi.fn().mockResolvedValue(
            jsonResponse(
              {
                error: code,
                error_description: 'DESCRIPTION-LEAK client_secret=dev-key-secret',
                access_token: 'ACCESS-LEAK',
                refresh_token: 'REFRESH-LEAK',
              },
              status,
            ),
          ),
        )
          .refresh('still-good')
          .catch((e) => e)
        const lines = logged.mock.calls.map((call) => call.map(String).join(' '))
        return { error, lines }
      } finally {
        logged.mockRestore()
      }
    }

    it.each(['invalid_client', 'invalid_request', 'unsupported_grant_type', 'a'.repeat(64)])(
      'prints a well-formed error code verbatim: %s',
      async (code) => {
        const { error, lines } = await rejectWith(code)
        expect(lines).toHaveLength(1)
        expect(lines[0]).toContain(`(error=${code}, HTTP 401)`)
        expect(error).toMatchObject({ kind: 'unavailable', status: 401 })
      },
    )

    it.each([
      ['a newline that forges a second log line', 'invalid_client\nFATAL: forged line'],
      ['a trailing newline', 'invalid_client\n'],
      ['a carriage return', 'invalid_client\rFATAL: forged line'],
      ['an ANSI colour escape', '[31minvalid_client[0m'],
      ['an ANSI clear-screen escape', 'invalid_client[2J'],
      ['a NUL byte', 'invalid_client '],
    ])('replaces a code carrying %s with the marker', async (_label, code) => {
      const { error, lines } = await rejectWith(code)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain(`(error=${MARKER}, HTTP 401)`)
      expect(hasControlCharacter(lines[0])).toBe(false)
      expect(lines[0]).not.toContain('forged')
      expect(lines[0]).not.toContain('invalid_client')
      expect(error).toMatchObject({ kind: 'unavailable', status: 401 })
    })

    it.each([
      ['just over the 64-character limit', 'a'.repeat(65)],
      ['10 000 characters', 'a'.repeat(10_000)],
    ])('replaces a code that is %s with the marker, so the line stays short', async (_l, code) => {
      const { lines } = await rejectWith(code)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain(`(error=${MARKER}, HTTP 401)`)
      expect(lines[0]).not.toContain('aaaa')
      expect(lines[0].length).toBeLessThan(600)
    })

    it.each([
      ['upper case', 'Invalid_Client'],
      ['a hyphen', 'invalid-client'],
      ['a digit', 'invalid_client2'],
      ['a space', 'invalid client'],
      ['a non-ASCII letter', 'invalid_cliént'],
    ])('replaces a code with %s with the marker', async (_label, code) => {
      const { lines } = await rejectWith(code)
      expect(lines[0]).toContain(`(error=${MARKER}, HTTP 401)`)
    })

    it('keeps the taxonomy: a malformed code is still not a dead grant', async () => {
      // `invalid_grant` with anything appended is not Canvas's `invalid_grant`,
      // so it must not be able to revoke a user's grant. It behaves exactly as
      // any other unrecognised code did before the marker: a server-config fault.
      for (const code of ['invalid_grant\n', 'INVALID_GRANT', 'invalid_grant ', 'a'.repeat(65)]) {
        const { error } = await rejectWith(code, 400)
        expect(error).toBeInstanceOf(CanvasOAuthError)
        expect(error).toMatchObject({ kind: 'unavailable', status: 400 })
      }
      // The well-formed dead-grant code is unchanged, and logs nothing.
      const dead = await rejectWith('invalid_grant', 400)
      expect(dead.error).toMatchObject({ kind: 'invalid_grant', status: 400 })
      expect(dead.lines).toEqual([])
    })

    it.each([
      ['an empty string', ''],
      ['a number', 42],
      ['null', null],
      ['an object', { code: 'invalid_client' }],
    ])('still treats %s as no readable code, so a 400 stays a dead grant', async (_l, code) => {
      const { error, lines } = await rejectWith(code, 400)
      expect(error).toMatchObject({ kind: 'invalid_grant', status: 400 })
      expect(lines).toEqual([])
    })

    it('never logs descriptions, tokens, secrets or other upstream free text', async () => {
      for (const code of ['invalid_client', 'bad\nvalue', 'a'.repeat(200)]) {
        const { error, lines } = await rejectWith(code)
        const everything = [...lines, error.message].join('\n')
        for (const leak of ['DESCRIPTION-LEAK', 'ACCESS-LEAK', 'REFRESH-LEAK', 'dev-key-secret']) {
          expect(everything).not.toContain(leak)
        }
        // The line names the config knobs, never their values.
        expect(lines[0]).toContain('CANVAS_OAUTH_CLIENT_ID/CANVAS_OAUTH_CLIENT_SECRET')
      }
    })
  })

  describe('revoke', () => {
    // QA S6 (#356): a hung Canvas otherwise holds the per-grant refresh dedup
    // in the resource server, so every request on that grant waits with it.
    it('bounds the call with an AbortSignal', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
      await makeClient(fetchMock).revoke('canvas-access')
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(init.signal).toBeInstanceOf(AbortSignal)
      expect(init.signal!.aborted).toBe(false)
    })

    it('sends DELETE /login/oauth2/token with the Canvas access token as bearer', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
      await makeClient(fetchMock).revoke('canvas-access')
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://school.instructure.com/login/oauth2/token')
      expect(init.method).toBe('DELETE')
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer canvas-access')
    })

    it('treats 401 (already revoked) as success', async () => {
      await expect(
        makeClient(vi.fn().mockResolvedValue(new Response(null, { status: 401 }))).revoke('x'),
      ).resolves.toBeUndefined()
    })

    it('throws on other failures so the caller can log them', async () => {
      await expect(
        makeClient(vi.fn().mockResolvedValue(new Response(null, { status: 500 }))).revoke('x'),
      ).rejects.toMatchObject({ kind: 'unavailable' })
      await expect(
        makeClient(vi.fn().mockRejectedValue(new Error('down'))).revoke('x'),
      ).rejects.toMatchObject({ kind: 'unavailable' })
    })
  })
})
