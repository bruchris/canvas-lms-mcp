// Shared test scaffolding for the OAuth profile: node:http request/response
// doubles, a mocked Canvas, and a fully wired authorization server.

import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { vi } from 'vitest'
import { AuthorizationServer } from '../../../src/auth/oauth/authorization-server'
import { CanvasOAuthClient } from '../../../src/auth/oauth/canvas-oauth'
import { ClientResolver } from '../../../src/auth/oauth/clients'
import {
  loadOAuthProfileConfig,
  type OAuthEnv,
  type OAuthProfileConfig,
} from '../../../src/auth/oauth/config'
import { sha256Base64Url } from '../../../src/auth/oauth/crypto'
import { routePath } from '../../../src/auth/oauth/http-util'
import { MemoryOAuthStore } from '../../../src/auth/oauth/store'

export const NOW = 1_800_000_000_000

export interface MockReqInit {
  method?: string
  url?: string
  headers?: Record<string, string>
  body?: string
}

export function makeReq(init: MockReqInit = {}): IncomingMessage {
  const stream = Readable.from(init.body !== undefined ? [Buffer.from(init.body, 'utf8')] : [])
  const req = stream as unknown as IncomingMessage & { headers: Record<string, string> }
  req.method = init.method ?? 'GET'
  req.url = init.url ?? '/'
  req.headers = Object.fromEntries(
    Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  )
  return req
}

export interface MockRes extends ServerResponse {
  _status: number
  _headers: Record<string, string>
  _body: string
  _json(): unknown
}

export function makeRes(): MockRes {
  const res = {
    _status: 0,
    _headers: {} as Record<string, string>,
    _body: '',
    headersSent: false,
    setHeader(name: string, value: string) {
      res._headers[name.toLowerCase()] = value
    },
    getHeader(name: string) {
      return res._headers[name.toLowerCase()]
    },
    writeHead(status: number, headers?: Record<string, string>) {
      res._status = status
      res.headersSent = true
      if (headers) for (const [k, v] of Object.entries(headers)) res._headers[k.toLowerCase()] = v
      return res
    },
    end(body?: string) {
      if (body) res._body = body
    },
    on: vi.fn(),
    _json() {
      return JSON.parse(res._body)
    },
  }
  return res as unknown as MockRes
}

export function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString()
}

export const FORM_HEADERS = { 'content-type': 'application/x-www-form-urlencoded' }

/** A deterministic PKCE pair. */
export const PKCE = {
  verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
}

export function pkcePair(seed: string): { verifier: string; challenge: string } {
  const verifier = `${seed}-${'v'.repeat(43)}`.slice(0, 64)
  return { verifier, challenge: sha256Base64Url(verifier) }
}

export interface CanvasMock {
  fetch: ReturnType<typeof vi.fn>
  /** Every form body posted to /login/oauth2/token, parsed. */
  tokenRequests: Array<Record<string, string>>
  /** Bearer tokens presented to DELETE /login/oauth2/token. */
  revoked: string[]
  /** Override the next token response (status + body). */
  nextTokenResponse?: { status: number; body: unknown }
  refreshCount: number
}

export function mockCanvas(): CanvasMock {
  const mock: CanvasMock = {
    fetch: vi.fn(),
    tokenRequests: [],
    revoked: [],
    refreshCount: 0,
  }
  mock.fetch.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase()
    if (url.endsWith('/login/oauth2/token') && method === 'POST') {
      const params = Object.fromEntries(new URLSearchParams(init.body as string))
      mock.tokenRequests.push(params)
      if (mock.nextTokenResponse) {
        const { status, body } = mock.nextTokenResponse
        mock.nextTokenResponse = undefined
        return new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (params.grant_type === 'authorization_code') {
        return new Response(
          JSON.stringify({
            access_token: `canvas-access-${params.code}`,
            refresh_token: `canvas-refresh-${params.code}`,
            expires_in: 3600,
            token_type: 'Bearer',
            user: { id: 42, name: 'Pat Example' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      mock.refreshCount++
      return new Response(
        JSON.stringify({
          access_token: `canvas-access-refreshed-${mock.refreshCount}`,
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url.endsWith('/login/oauth2/token') && method === 'DELETE') {
      const auth = (init.headers as Record<string, string>).Authorization ?? ''
      mock.revoked.push(auth.replace(/^Bearer /, ''))
      return new Response(null, { status: 200 })
    }
    throw new Error(`unexpected fetch ${method} ${url}`)
  })
  return mock
}

export interface HarnessOptions {
  env?: Partial<OAuthEnv>
  now?: () => number
  cimdFetch?: typeof fetch
  log?: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }
}

export interface Harness {
  as: AuthorizationServer
  store: MemoryOAuthStore
  config: OAuthProfileConfig
  canvas: CanvasMock
  clients: ClientResolver
  canvasClient: CanvasOAuthClient
  log: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }
  /** Route a request through `AuthorizationServer.handle`. */
  send(init: MockReqInit): Promise<MockRes>
}

export const BASE_ENV: OAuthEnv = {
  CANVAS_BASE_URL: 'https://school.instructure.com',
  CANVAS_MCP_ISSUER: 'http://127.0.0.1:3001',
  CANVAS_OAUTH_CLIENT_ID: '10000000000001',
  CANVAS_OAUTH_CLIENT_SECRET: 'dev-key-secret',
}

export async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const now = options.now ?? (() => NOW)
  const config = loadOAuthProfileConfig({ ...BASE_ENV, ...options.env })
  const store = new MemoryOAuthStore()
  const canvas = mockCanvas()
  const canvasClient = new CanvasOAuthClient({
    baseUrl: config.canvas.baseUrl,
    clientId: config.canvas.clientId,
    clientSecret: config.canvas.clientSecret,
    redirectUri: `${config.issuer}/oauth/canvas/callback`,
    fetch: canvas.fetch as unknown as typeof fetch,
    now,
    ...(config.canvas.scopes ? { scopes: config.canvas.scopes } : {}),
  })
  const clients = new ClientResolver({
    store,
    config,
    fetch: options.cimdFetch ?? (vi.fn() as unknown as typeof fetch),
    now,
  })
  await clients.seedPreregistered()
  const log = options.log ?? { warn: vi.fn(), error: vi.fn() }
  const as = new AuthorizationServer({ config, store, clients, canvas: canvasClient, now, log })

  async function send(init: MockReqInit): Promise<MockRes> {
    const req = makeReq(init)
    const res = makeRes()
    const { path, query } = routePath(req.url, config.issuerPath)
    const rawPath = new URL(req.url ?? '/', 'http://x').pathname
    const handled = await as.handle(req, res, rawPath, path, query)
    if (!handled) {
      res._status = 404
    }
    return res
  }

  return { as, store, config, canvas, clients, canvasClient, log, send }
}

export interface RegisteredPublicClient {
  clientId: string
  redirectUri: string
}

export async function registerPublicClient(
  h: Harness,
  redirectUri = 'http://127.0.0.1/callback',
): Promise<RegisteredPublicClient> {
  const res = await h.send({
    method: 'POST',
    url: '/oauth/register',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Codex',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    }),
  })
  if (res._status !== 201) throw new Error(`registration failed: ${res._body}`)
  return { clientId: (res._json() as { client_id: string }).client_id, redirectUri }
}

export function consentFields(html: string): { pending: string; csrf: string } {
  const pending = /name="pending" value="([^"]+)"/.exec(html)?.[1]
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1]
  if (!pending || !csrf) throw new Error('consent page did not contain the form fields')
  return { pending, csrf }
}

export function cookieValue(setCookie: string | undefined): string {
  const match = /^canvas_mcp_authz=([^;]*)/.exec(setCookie ?? '')
  if (!match?.[1]) throw new Error(`no flow cookie in ${setCookie}`)
  return decodeURIComponent(match[1])
}

export interface CompletedLogin {
  clientId: string
  redirectUri: string
  code: string
  verifier: string
  state: string
  grantId: string
}

/**
 * Drive authorize → consent → Canvas → callback for a public client and
 * return the MCP authorization code (not yet exchanged).
 */
export async function completeLogin(
  h: Harness,
  client: RegisteredPublicClient,
  options: { scope?: string; state?: string; presentedRedirect?: string; seed?: string } = {},
): Promise<CompletedLogin> {
  const { verifier, challenge } = pkcePair(options.seed ?? 'login')
  const state = options.state ?? 'client-state-123'
  const presented = options.presentedRedirect ?? client.redirectUri
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: presented,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    resource: h.config.resource,
    ...(options.scope !== undefined ? { scope: options.scope } : {}),
  })
  const consent = await h.send({ url: `/oauth/authorize?${params}` })
  if (consent._status !== 200)
    throw new Error(`authorize failed: ${consent._status} ${consent._body}`)
  const { pending, csrf } = consentFields(consent._body)

  const cont = await h.send({
    method: 'POST',
    url: '/oauth/authorize/continue',
    headers: { ...FORM_HEADERS, origin: new URL(h.config.issuer).origin },
    body: form({ pending, csrf, decision: 'allow' }),
  })
  if (cont._status !== 302) throw new Error(`continue failed: ${cont._status} ${cont._body}`)
  const cookie = cookieValue(cont._headers['set-cookie'])
  const canvasState = new URL(cont._headers.location!).searchParams.get('state')!

  const cb = await h.send({
    url: `/oauth/canvas/callback?code=canvas-code-${options.seed ?? 'login'}&state=${encodeURIComponent(canvasState)}`,
    headers: { cookie: `canvas_mcp_authz=${encodeURIComponent(cookie)}` },
  })
  if (cb._status !== 302) throw new Error(`callback failed: ${cb._status} ${cb._body}`)
  const target = new URL(cb._headers.location!)
  const code = target.searchParams.get('code')
  if (!code) throw new Error(`callback redirect carried no code: ${cb._headers.location}`)
  const snapshot = h.store.snapshot()
  const grantId = snapshot.grants.at(-1)!.id
  return { clientId: client.clientId, redirectUri: presented, code, verifier, state, grantId }
}

export interface IssuedTokens {
  accessToken: string
  refreshToken?: string
  scope: string
  grantId: string
}

export async function exchange(h: Harness, login: CompletedLogin): Promise<IssuedTokens> {
  const res = await h.send({
    method: 'POST',
    url: '/oauth/token',
    headers: FORM_HEADERS,
    body: form({
      grant_type: 'authorization_code',
      client_id: login.clientId,
      code: login.code,
      code_verifier: login.verifier,
      redirect_uri: login.redirectUri,
      resource: h.config.resource,
    }),
  })
  if (res._status !== 200) throw new Error(`token failed: ${res._status} ${res._body}`)
  const body = res._json() as { access_token: string; refresh_token?: string; scope: string }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    scope: body.scope,
    grantId: login.grantId,
  }
}

/** Register, log in, and exchange in one go. */
export async function loggedInTokens(h: Harness, options: { scope?: string; seed?: string } = {}) {
  const client = await registerPublicClient(h)
  const login = await completeLogin(h, client, options)
  const tokens = await exchange(h, login)
  return { client, login, tokens }
}
