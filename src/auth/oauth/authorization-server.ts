// OAuth 2.1 authorization server for MCP clients (design §7).
//
// Endpoints (relative to the issuer):
//   GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728
//   GET  /.well-known/oauth-authorization-server         RFC 8414
//   POST /oauth/register                                 RFC 7591
//   GET  /oauth/authorize                                consent page
//   POST /oauth/authorize/continue                       consent decision → Canvas
//   GET  /oauth/canvas/callback                          Canvas code → MCP code
//   POST /oauth/token                                    authorization_code / refresh_token
//   POST /oauth/revoke                                   RFC 7009
//
// Error discipline: before the client and redirect URI are validated, an
// authorize error renders an HTML page — never a redirect to an unverified
// URI. After that point, errors go back to the client the way OAuth
// specifies. Nothing here ever logs or returns a token, code, verifier, or
// secret.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { CanvasOAuthClient, CanvasOAuthError } from './canvas-oauth'
import {
  ClientRegistrationError,
  ClientResolver,
  parseScopeParam,
  registrationResponse,
} from './clients'
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTHORIZATION_CODE_TTL_SECONDS,
  MCP_SCOPES,
  PENDING_AUTHORIZATION_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  type McpScope,
  type OAuthProfileConfig,
} from './config'
import {
  hashToken,
  isValidCodeChallenge,
  mintToken,
  randomId,
  timingSafeEqualStrings,
  verifyHashedSecret,
  verifyPkceS256,
} from './crypto'
import { renderConsentPage, renderErrorPage, type ConsentScope } from './html'
import {
  BodyError,
  firstHeader,
  parseBasicAuth,
  parseCookies,
  readFormBody,
  readJsonBody,
  sendHtml,
  sendJson,
  sendRedirect,
  serializeCookie,
} from './http-util'
import { findMatchingRedirectUri, isLoopbackHost } from './redirect-uri'
import type {
  Grant,
  OAuthStore,
  PendingAuthorization,
  RegisteredClient,
  TokenRecord,
} from './store'

export const FLOW_COOKIE = 'canvas_mcp_authz'
const PURGE_INTERVAL_MS = 60 * 1000
const CANVAS_REFRESH_SKEW_MS = 60 * 1000

export const SCOPE_DESCRIPTIONS: Record<McpScope, string> = {
  'canvas:read': 'read courses, assignments, grades, and other Canvas data you can see',
  'canvas:write': 'create and change Canvas content on your behalf',
}

export interface AuthorizationServerLogger {
  warn(message: string): void
  error(message: string): void
}

export interface AuthorizationServerOptions {
  config: OAuthProfileConfig
  store: OAuthStore
  clients: ClientResolver
  canvas: CanvasOAuthClient
  now?: () => number
  log?: AuthorizationServerLogger
}

export interface OAuthErrorBody {
  error: string
  error_description?: string
}

type Query = URLSearchParams

/** Canonical comparison for RFC 8707 `resource` values (§7). */
export function normalizeResource(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.hash !== '') return undefined
  const path = url.pathname.replace(/\/+$/, '')
  return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${path}${url.search}`
}

export class AuthorizationServer {
  readonly config: OAuthProfileConfig
  private readonly store: OAuthStore
  private readonly clients: ClientResolver
  private readonly canvas: CanvasOAuthClient
  private readonly now: () => number
  private readonly log: AuthorizationServerLogger
  private lastPurge = 0

  constructor(options: AuthorizationServerOptions) {
    this.config = options.config
    this.store = options.store
    this.clients = options.clients
    this.canvas = options.canvas
    this.now = options.now ?? Date.now
    this.log = options.log ?? console
  }

  // ---------------------------------------------------------------- routing

  /** Well-known documents are host-rooted, so they match on the raw path. */
  wellKnownPaths(): { protectedResource: string[]; authorizationServer: string[] } {
    const p = this.config.issuerPath
    const protectedResource = [`/.well-known/oauth-protected-resource${p}/mcp`]
    const authorizationServer = [`/.well-known/oauth-authorization-server${p}`]
    if (p === '') {
      protectedResource.push('/.well-known/oauth-protected-resource')
    } else {
      protectedResource.push(`/.well-known/oauth-protected-resource${p}`)
      // Root fallbacks for clients that do not insert the path (RFC 9728 §3.1 / RFC 8414 §3.1).
      protectedResource.push(
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-protected-resource/mcp',
      )
      authorizationServer.push('/.well-known/oauth-authorization-server')
    }
    return { protectedResource, authorizationServer }
  }

  /**
   * Dispatch one request. `rawPath` is the request path as received;
   * `path` has the issuer's own path prefix removed. Returns false when the
   * request is not an OAuth endpoint.
   */
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    rawPath: string,
    path: string,
    query: Query,
  ): Promise<boolean> {
    const wellKnown = this.wellKnownPaths()
    if (wellKnown.protectedResource.includes(rawPath)) {
      if (!this.requireMethod(req, res, 'GET')) return true
      sendJson(res, 200, this.protectedResourceMetadata(), {
        'Cache-Control': 'public, max-age=300',
      })
      return true
    }
    if (wellKnown.authorizationServer.includes(rawPath)) {
      if (!this.requireMethod(req, res, 'GET')) return true
      sendJson(res, 200, this.authorizationServerMetadata(), {
        'Cache-Control': 'public, max-age=300',
      })
      return true
    }
    switch (path) {
      case '/oauth/register':
        if (!this.requireMethod(req, res, 'POST')) return true
        await this.handleRegister(req, res)
        return true
      case '/oauth/authorize':
        if (!this.requireMethod(req, res, 'GET')) return true
        await this.handleAuthorize(res, query)
        return true
      case '/oauth/authorize/continue':
        if (!this.requireMethod(req, res, 'POST')) return true
        await this.handleContinue(req, res)
        return true
      case '/oauth/canvas/callback':
        if (!this.requireMethod(req, res, 'GET')) return true
        await this.handleCanvasCallback(req, res, query)
        return true
      case '/oauth/token':
        if (!this.requireMethod(req, res, 'POST')) return true
        await this.handleToken(req, res)
        return true
      case '/oauth/revoke':
        if (!this.requireMethod(req, res, 'POST')) return true
        await this.handleRevoke(req, res)
        return true
      default:
        return false
    }
  }

  private requireMethod(req: IncomingMessage, res: ServerResponse, method: string): boolean {
    if (req.method === method) return true
    sendJson(
      res,
      405,
      { error: 'invalid_request', error_description: `Use ${method}` },
      { Allow: method },
    )
    return false
  }

  // --------------------------------------------------------------- metadata

  get resourceMetadataUrl(): string {
    const origin = new URL(this.config.issuer).origin
    return `${origin}/.well-known/oauth-protected-resource${this.config.issuerPath}/mcp`
  }

  protectedResourceMetadata(): Record<string, unknown> {
    return {
      resource: this.config.resource,
      authorization_servers: [this.config.issuer],
      bearer_methods_supported: ['header'],
      scopes_supported: [...MCP_SCOPES],
      resource_name: 'Canvas LMS MCP',
      resource_documentation:
        'https://github.com/bruchris/canvas-lms-mcp/blob/main/docs/oauth-profile.md',
    }
  }

  authorizationServerMetadata(): Record<string, unknown> {
    const issuer = this.config.issuer
    const authMethods = ['none', 'client_secret_basic', 'client_secret_post']
    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      ...(this.clients.dynamicRegistrationEnabled
        ? { registration_endpoint: `${issuer}/oauth/register` }
        : {}),
      revocation_endpoint: `${issuer}/oauth/revoke`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: authMethods,
      revocation_endpoint_auth_methods_supported: authMethods,
      code_challenge_methods_supported: ['S256'],
      scopes_supported: [...MCP_SCOPES],
      client_id_metadata_document_supported: this.clients.cimdEnabled,
      service_documentation:
        'https://github.com/bruchris/canvas-lms-mcp/blob/main/docs/oauth-profile.md',
    }
  }

  // ------------------------------------------------------------ registration

  async handleRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.clients.dynamicRegistrationEnabled) {
      sendJson(res, 404, {
        error: 'invalid_request',
        error_description: 'Dynamic client registration is disabled',
      })
      return
    }
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch (error) {
      this.sendBodyError(res, error)
      return
    }
    try {
      const result = await this.clients.register(body)
      sendJson(res, 201, registrationResponse(result))
    } catch (error) {
      if (error instanceof ClientRegistrationError) {
        sendJson(res, 400, { error: error.error, error_description: error.message })
        return
      }
      throw error
    }
  }

  // --------------------------------------------------------------- authorize

  async handleAuthorize(res: ServerResponse, query: Query): Promise<void> {
    await this.maybePurge()

    const clientId = query.get('client_id')
    if (!clientId) {
      this.htmlError(res, 400, 'Invalid request', 'The authorization request is missing client_id.')
      return
    }
    const client = await this.clients.resolve(clientId)
    if (!client) {
      this.htmlError(
        res,
        400,
        'Unknown client',
        'This MCP client is not registered with the server. Register it, or check the client_id.',
      )
      return
    }

    const presented = query.get('redirect_uri')
    let redirectUri: string
    if (presented === null) {
      if (client.redirectUris.length !== 1 || client.redirectUris[0] === undefined) {
        this.htmlError(res, 400, 'Invalid request', 'redirect_uri is required for this client.')
        return
      }
      redirectUri = client.redirectUris[0]
    } else {
      if (findMatchingRedirectUri(client.redirectUris, presented) === undefined) {
        this.htmlError(
          res,
          400,
          'Redirect URI not registered',
          'The redirect_uri in this request does not match any registered for the client. Nothing was redirected.',
        )
        return
      }
      redirectUri = presented
    }

    // From here on the redirect target is trusted, and errors go back to it.
    const state = query.get('state') ?? undefined
    const fail = (error: string, description: string) =>
      sendRedirect(res, errorRedirect(redirectUri, error, description, state))

    if (query.get('response_type') !== 'code') {
      fail('unsupported_response_type', 'Only response_type=code is supported')
      return
    }
    const codeChallenge = query.get('code_challenge')
    if (!codeChallenge) {
      fail('invalid_request', 'code_challenge is required (PKCE, S256)')
      return
    }
    if (query.get('code_challenge_method') !== 'S256') {
      fail('invalid_request', 'code_challenge_method must be S256')
      return
    }
    if (!isValidCodeChallenge(codeChallenge)) {
      fail('invalid_request', 'code_challenge is not a valid S256 challenge')
      return
    }
    const rawScope = query.get('scope')
    const scopes =
      rawScope === null || rawScope.trim() === '' ? [...MCP_SCOPES] : parseScopeParam(rawScope)
    if (!scopes) {
      fail('invalid_scope', `Supported scopes: ${MCP_SCOPES.join(' ')}`)
      return
    }
    const resource = query.get('resource')
    if (
      resource !== null &&
      normalizeResource(resource) !== normalizeResource(this.config.resource)
    ) {
      fail('invalid_target', `This server only issues tokens for ${this.config.resource}`)
      return
    }

    const now = this.now()
    const csrf = randomId()
    const pending: PendingAuthorization = {
      id: randomId(),
      clientId: client.clientId,
      redirectUri,
      ...(state !== undefined ? { state } : {}),
      codeChallenge,
      scopes,
      resource: this.config.resource,
      csrfHash: hashToken(csrf),
      createdAt: now,
      expiresAt: now + PENDING_AUTHORIZATION_TTL_SECONDS * 1000,
    }
    await this.store.putPendingAuthorization(pending)

    const redirectUrl = new URL(redirectUri)
    const consentScopes: ConsentScope[] = scopes.map((name) => ({
      name,
      description: SCOPE_DESCRIPTIONS[name],
    }))
    sendHtml(
      res,
      200,
      renderConsentPage({
        clientName: client.clientName ?? client.clientId,
        clientId: client.clientId,
        clientIdIsUrl: client.source === 'cimd',
        redirectUri,
        redirectHost: redirectUrl.host,
        isLoopbackRedirect: isLoopbackHost(redirectUrl.hostname),
        scopes: consentScopes,
        canvasHost: new URL(this.config.canvas.baseUrl).host,
        actionPath: `${this.config.issuerPath}/oauth/authorize/continue`,
        pendingId: pending.id,
        csrf,
      }),
    )
  }

  // ---------------------------------------------------------------- consent

  async handleContinue(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = firstHeader(req, 'origin')
    const issuerOrigin = new URL(this.config.issuer).origin
    if (origin !== undefined && origin !== issuerOrigin) {
      this.htmlError(
        res,
        403,
        'Request blocked',
        'The consent form was submitted from another site.',
      )
      return
    }
    let form: URLSearchParams
    try {
      form = await readFormBody(req)
    } catch (error) {
      this.sendBodyError(res, error)
      return
    }
    const pendingId = form.get('pending') ?? ''
    const csrf = form.get('csrf') ?? ''
    const decision = form.get('decision')

    const pending = await this.store.getPendingAuthorization(pendingId)
    const now = this.now()
    if (!pending || pending.expiresAt <= now) {
      if (pending) await this.store.takePendingAuthorization(pendingId)
      this.htmlError(
        res,
        400,
        'Login attempt expired',
        'This login attempt is no longer valid. Start again from your MCP client.',
      )
      return
    }
    if (!timingSafeEqualStrings(hashToken(csrf), pending.csrfHash)) {
      this.htmlError(
        res,
        400,
        'Invalid request',
        'The consent form did not match this login attempt.',
      )
      return
    }
    if (pending.consentedAt !== undefined) {
      await this.store.takePendingAuthorization(pendingId)
      this.htmlError(res, 400, 'Already answered', 'This consent form was already submitted.')
      return
    }

    if (decision === 'deny') {
      await this.store.takePendingAuthorization(pendingId)
      sendRedirect(
        res,
        errorRedirect(pending.redirectUri, 'access_denied', 'The user declined', pending.state),
      )
      return
    }
    if (decision !== 'allow') {
      this.htmlError(res, 400, 'Invalid request', 'Unknown consent decision.')
      return
    }

    const cookieNonce = randomId()
    await this.store.updatePendingAuthorization({
      ...pending,
      cookieHash: hashToken(cookieNonce),
      consentedAt: now,
    })
    sendRedirect(res, this.canvas.authorizationUrl(pending.id), {
      'Set-Cookie': serializeCookie(FLOW_COOKIE, cookieNonce, {
        secure: this.config.issuer.startsWith('https:'),
        path: `${this.config.issuerPath}/oauth/`,
        maxAge: PENDING_AUTHORIZATION_TTL_SECONDS,
      }),
    })
  }

  // ---------------------------------------------------------- Canvas callback

  async handleCanvasCallback(
    req: IncomingMessage,
    res: ServerResponse,
    query: Query,
  ): Promise<void> {
    const clearCookie = {
      'Set-Cookie': serializeCookie(FLOW_COOKIE, '', {
        secure: this.config.issuer.startsWith('https:'),
        path: `${this.config.issuerPath}/oauth/`,
        maxAge: 0,
      }),
    }
    const state = query.get('state')
    if (!state) {
      this.htmlError(res, 400, 'Invalid callback', 'Canvas returned no state.', clearCookie)
      return
    }
    const pending = await this.store.takePendingAuthorization(state)
    const now = this.now()
    if (
      !pending ||
      pending.expiresAt <= now ||
      pending.consentedAt === undefined ||
      !pending.cookieHash
    ) {
      this.htmlError(
        res,
        400,
        'Login attempt expired',
        'This login attempt is unknown, expired, or skipped the consent step. Start again from your MCP client.',
        clearCookie,
      )
      return
    }
    const cookie = parseCookies(firstHeader(req, 'cookie'))[FLOW_COOKIE]
    if (!cookie || !timingSafeEqualStrings(hashToken(cookie), pending.cookieHash)) {
      // The browser finishing the flow is not the browser that consented.
      // Do not redirect: the client that started this flow may not be the user's.
      this.htmlError(
        res,
        400,
        'Login could not be completed',
        'This login was started in a different browser session, so it was not completed. Start again from your MCP client.',
        clearCookie,
      )
      return
    }

    const canvasError = query.get('error')
    if (canvasError) {
      sendRedirect(
        res,
        errorRedirect(
          pending.redirectUri,
          'access_denied',
          'Canvas authorization was not granted',
          pending.state,
        ),
        clearCookie,
      )
      return
    }
    const canvasCode = query.get('code')
    if (!canvasCode) {
      sendRedirect(
        res,
        errorRedirect(
          pending.redirectUri,
          'server_error',
          'Canvas returned no authorization code',
          pending.state,
        ),
        clearCookie,
      )
      return
    }

    let tokens
    try {
      tokens = await this.canvas.exchangeCode(canvasCode)
    } catch (error) {
      const kind = error instanceof CanvasOAuthError ? error.kind : 'unknown'
      this.log.warn(`Canvas code exchange failed (${kind}) for client ${pending.clientId}`)
      const [oauthError, description] =
        kind === 'invalid_grant'
          ? ['access_denied', 'Canvas rejected the authorization']
          : kind === 'unavailable'
            ? ['temporarily_unavailable', 'Canvas could not be reached']
            : ['server_error', 'Canvas authorization failed']
      sendRedirect(
        res,
        errorRedirect(pending.redirectUri, oauthError, description, pending.state),
        clearCookie,
      )
      return
    }

    const grant: Grant = {
      id: randomId(),
      clientId: pending.clientId,
      scopes: pending.scopes,
      resource: pending.resource,
      canvasUserId: tokens.canvasUserId,
      canvas: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      },
      createdAt: now,
    }
    await this.store.putGrant(grant)

    const code = mintToken('code')
    await this.store.putAuthorizationCode({
      hash: hashToken(code),
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      scopes: pending.scopes,
      resource: pending.resource,
      grantId: grant.id,
      createdAt: now,
      expiresAt: now + AUTHORIZATION_CODE_TTL_SECONDS * 1000,
    })
    this.log.warn(`OAuth grant ${grant.id} created for client ${pending.clientId}`)

    const target = new URL(pending.redirectUri)
    target.searchParams.set('code', code)
    if (pending.state !== undefined) target.searchParams.set('state', pending.state)
    sendRedirect(res, target.toString(), clearCookie)
  }

  // ------------------------------------------------------------------ token

  async handleToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await this.maybePurge()
    let form: URLSearchParams
    try {
      form = await readFormBody(req)
    } catch (error) {
      this.sendBodyError(res, error)
      return
    }
    const auth = await this.authenticateClient(req, form, res)
    if (!auth) return
    const { client } = auth

    const grantType = form.get('grant_type')
    if (grantType === 'authorization_code') {
      await this.exchangeAuthorizationCode(client, form, res)
      return
    }
    if (grantType === 'refresh_token') {
      await this.refreshTokens(client, form, res)
      return
    }
    sendJson(res, 400, {
      error: 'unsupported_grant_type',
      error_description: 'Supported grant types: authorization_code, refresh_token',
    })
  }

  private async exchangeAuthorizationCode(
    client: RegisteredClient,
    form: URLSearchParams,
    res: ServerResponse,
  ): Promise<void> {
    const code = form.get('code')
    const verifier = form.get('code_verifier')
    const redirectUri = form.get('redirect_uri')
    if (!code || !verifier || !redirectUri) {
      sendJson(res, 400, {
        error: 'invalid_request',
        error_description: 'code, code_verifier, and redirect_uri are required',
      })
      return
    }
    const now = this.now()
    const consumed = await this.store.consumeAuthorizationCode(hashToken(code), now)
    if (!consumed) {
      this.invalidGrant(res, 'Authorization code is invalid or expired')
      return
    }
    const record = consumed.record
    if (consumed.alreadyConsumed) {
      // OAuth 2.1 §4.1.2: a replayed code means it leaked. Everything it produced dies.
      this.log.warn(
        `Authorization code replay detected for grant ${record.grantId}; revoking grant`,
      )
      await this.revokeGrant(record.grantId)
      this.invalidGrant(res, 'Authorization code was already used')
      return
    }
    if (record.clientId !== client.clientId) {
      this.invalidGrant(res, 'Authorization code was issued to a different client')
      return
    }
    if (record.redirectUri !== redirectUri) {
      this.invalidGrant(res, 'redirect_uri does not match the authorization request')
      return
    }
    if (!verifyPkceS256(verifier, record.codeChallenge)) {
      this.invalidGrant(res, 'PKCE verification failed')
      return
    }
    const resource = form.get('resource')
    if (resource !== null && normalizeResource(resource) !== normalizeResource(record.resource)) {
      sendJson(res, 400, {
        error: 'invalid_target',
        error_description: `This server only issues tokens for ${record.resource}`,
      })
      return
    }
    const grant = await this.store.getGrant(record.grantId)
    if (!grant) {
      this.invalidGrant(res, 'The authorization behind this code no longer exists')
      return
    }
    await this.issueTokens(res, client, grant, record.scopes)
  }

  private async refreshTokens(
    client: RegisteredClient,
    form: URLSearchParams,
    res: ServerResponse,
  ): Promise<void> {
    const refreshToken = form.get('refresh_token')
    if (!refreshToken) {
      sendJson(res, 400, {
        error: 'invalid_request',
        error_description: 'refresh_token is required',
      })
      return
    }
    // Validate everything first and consume the token last: a request that
    // fails validation (another client, a wrong resource) must not burn a
    // legitimate client's refresh token. The take is atomic, so two racing
    // valid requests still cannot both rotate.
    const hash = hashToken(refreshToken)
    const existing = await this.store.getToken(hash)
    if (!existing || existing.kind !== 'refresh') {
      this.invalidGrant(res, 'Refresh token is invalid')
      return
    }
    const now = this.now()
    if (existing.expiresAt <= now) {
      await this.store.deleteToken(hash)
      this.invalidGrant(res, 'Refresh token has expired')
      return
    }
    if (existing.clientId !== client.clientId) {
      this.invalidGrant(res, 'Refresh token was issued to a different client')
      return
    }
    const grant = await this.store.getGrant(existing.grantId)
    if (!grant) {
      await this.store.deleteToken(hash)
      this.invalidGrant(res, 'The authorization behind this token was revoked')
      return
    }
    const resource = form.get('resource')
    if (resource !== null && normalizeResource(resource) !== normalizeResource(existing.resource)) {
      sendJson(res, 400, {
        error: 'invalid_target',
        error_description: `This server only issues tokens for ${existing.resource}`,
      })
      return
    }
    let scopes = existing.scopes
    const requested = form.get('scope')
    if (requested !== null && requested.trim() !== '') {
      const parsed = parseScopeParam(requested)
      if (!parsed || !parsed.every((s) => existing.scopes.includes(s))) {
        sendJson(res, 400, {
          error: 'invalid_scope',
          error_description: 'Requested scope exceeds the original grant',
        })
        return
      }
      scopes = parsed
    }
    const taken = await this.store.takeToken(hash)
    if (!taken) {
      this.invalidGrant(res, 'Refresh token is invalid')
      return
    }
    await this.issueTokens(res, client, grant, scopes)
  }

  private async issueTokens(
    res: ServerResponse,
    client: RegisteredClient,
    grant: Grant,
    scopes: McpScope[],
  ): Promise<void> {
    const now = this.now()
    const accessToken = mintToken('access')
    const access: TokenRecord = {
      hash: hashToken(accessToken),
      kind: 'access',
      grantId: grant.id,
      clientId: client.clientId,
      scopes,
      resource: grant.resource,
      createdAt: now,
      expiresAt: now + ACCESS_TOKEN_TTL_SECONDS * 1000,
    }
    await this.store.putToken(access)
    const body: Record<string, unknown> = {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: scopes.join(' '),
    }
    if (client.grantTypes.includes('refresh_token')) {
      const refreshToken = mintToken('refresh')
      await this.store.putToken({
        hash: hashToken(refreshToken),
        kind: 'refresh',
        grantId: grant.id,
        clientId: client.clientId,
        scopes,
        resource: grant.resource,
        createdAt: now,
        expiresAt: now + REFRESH_TOKEN_TTL_SECONDS * 1000,
      })
      body.refresh_token = refreshToken
    }
    sendJson(res, 200, body)
  }

  // ----------------------------------------------------------------- revoke

  async handleRevoke(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let form: URLSearchParams
    try {
      form = await readFormBody(req)
    } catch (error) {
      this.sendBodyError(res, error)
      return
    }
    const auth = await this.authenticateClient(req, form, res)
    if (!auth) return
    const token = form.get('token')
    if (!token) {
      sendJson(res, 400, { error: 'invalid_request', error_description: 'token is required' })
      return
    }
    const record = await this.store.getToken(hashToken(token))
    if (!record) {
      // RFC 7009 §2.2: an unknown or already-revoked token is not an error.
      res.writeHead(200, { 'Cache-Control': 'no-store' })
      res.end()
      return
    }
    if (record.clientId !== auth.client.clientId) {
      sendJson(res, 400, {
        error: 'unauthorized_client',
        error_description: 'Token was issued to a different client',
      })
      return
    }
    await this.revokeGrant(record.grantId)
    res.writeHead(200, { 'Cache-Control': 'no-store' })
    res.end()
  }

  /**
   * Revoke everything behind a grant: every MCP token, the grant record, and
   * the Canvas token it holds. Canvas revocation is best-effort — a Canvas
   * outage must not leave the MCP side of the grant alive.
   */
  async revokeGrant(grantId: string): Promise<void> {
    const grant = await this.store.getGrant(grantId)
    await this.store.deleteTokensForGrant(grantId)
    await this.store.deleteGrant(grantId)
    if (!grant) return
    try {
      let accessToken = grant.canvas.accessToken
      if (grant.canvas.expiresAt <= this.now() + CANVAS_REFRESH_SKEW_MS) {
        // Canvas revokes by access token; an expired one is refused, so mint a
        // fresh one just to revoke it (and the refresh token with it).
        const refreshed = await this.canvas.refresh(grant.canvas.refreshToken)
        accessToken = refreshed.accessToken
      }
      await this.canvas.revoke(accessToken)
    } catch (error) {
      const kind = error instanceof CanvasOAuthError ? error.kind : 'unknown'
      if (kind === 'invalid_grant') return // already gone at Canvas
      this.log.warn(
        `Canvas token revocation failed (${kind}) for grant ${grantId}; local grant is revoked`,
      )
    }
  }

  // ---------------------------------------------------------- client auth

  private async authenticateClient(
    req: IncomingMessage,
    form: URLSearchParams,
    res: ServerResponse,
  ): Promise<{ client: RegisteredClient } | undefined> {
    const basic = parseBasicAuth(firstHeader(req, 'authorization'))
    const formId = form.get('client_id')
    const formSecret = form.get('client_secret')
    const invalidClient = (description: string) => {
      const headers: Record<string, string> = {}
      if (basic) headers['WWW-Authenticate'] = 'Basic realm="canvas-lms-mcp"'
      sendJson(res, 401, { error: 'invalid_client', error_description: description }, headers)
      return undefined
    }
    if (basic && formSecret !== null) {
      sendJson(res, 400, {
        error: 'invalid_request',
        error_description: 'Use one client authentication method, not two',
      })
      return undefined
    }
    const clientId = basic?.username ?? formId
    if (!clientId) {
      sendJson(res, 400, { error: 'invalid_request', error_description: 'client_id is required' })
      return undefined
    }
    if (basic && formId !== null && formId !== basic.username) {
      return invalidClient('client_id does not match the Authorization header')
    }
    const client = await this.clients.resolve(clientId)
    if (!client) return invalidClient('Unknown client')
    const presentedSecret = basic?.password ?? formSecret ?? undefined
    if (client.tokenEndpointAuthMethod === 'none') {
      if (presentedSecret !== undefined)
        return invalidClient('This client is public and has no secret')
      return { client }
    }
    if (!client.clientSecretHash || presentedSecret === undefined) {
      return invalidClient('Client authentication required')
    }
    if (!verifyHashedSecret(presentedSecret, client.clientSecretHash)) {
      return invalidClient('Client authentication failed')
    }
    return { client }
  }

  // ---------------------------------------------------------------- helpers

  private invalidGrant(res: ServerResponse, description: string): void {
    sendJson(res, 400, { error: 'invalid_grant', error_description: description })
  }

  private sendBodyError(res: ServerResponse, error: unknown): void {
    if (error instanceof BodyError) {
      sendJson(res, error.status, { error: 'invalid_request', error_description: error.message })
      return
    }
    throw error
  }

  private htmlError(
    res: ServerResponse,
    status: number,
    title: string,
    message: string,
    headers: Record<string, string> = {},
  ): void {
    sendHtml(res, status, renderErrorPage({ title, message }), headers)
  }

  private async maybePurge(): Promise<void> {
    const now = this.now()
    if (now - this.lastPurge < PURGE_INTERVAL_MS) return
    this.lastPurge = now
    await this.store.purgeExpired(now)
  }
}

/** Build `redirect_uri?error=…&error_description=…&state=…`. */
export function errorRedirect(
  redirectUri: string,
  error: string,
  description: string,
  state: string | undefined,
): string {
  const url = new URL(redirectUri)
  url.searchParams.set('error', error)
  url.searchParams.set('error_description', description)
  if (state !== undefined) url.searchParams.set('state', state)
  return url.toString()
}
