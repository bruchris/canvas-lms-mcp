// Canvas Developer Key client (design §9). The one place this server acts as
// an OAuth *client* — toward the configured Canvas institution.
//
// Endpoints per https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth_endpoints
// (verified 2026-09-17):
//   GET    /login/oauth2/auth   client_id, response_type=code, redirect_uri, state, scope
//   POST   /login/oauth2/token  grant_type=authorization_code | refresh_token (form-encoded)
//   DELETE /login/oauth2/token  Authorization: Bearer <access token>
//
// Canvas access tokens live one hour; refresh tokens do not rotate.

import { version } from '../../../package.json'

const USER_AGENT = `canvas-lms-mcp/${version}`
/** Fallback when Canvas omits `expires_in`; matches the documented lifetime. */
const DEFAULT_EXPIRES_IN_SECONDS = 3600

export type CanvasOAuthErrorKind =
  /** Canvas refused the grant: code invalid/expired, or the token was revoked. */
  | 'invalid_grant'
  /** Canvas answered, but not with a usable token response. */
  | 'malformed'
  /** Canvas is unreachable or returned a 5xx. */
  | 'unavailable'

export class CanvasOAuthError extends Error {
  readonly kind: CanvasOAuthErrorKind
  readonly status?: number

  constructor(kind: CanvasOAuthErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'CanvasOAuthError'
    this.kind = kind
    this.status = status
  }
}

export interface CanvasOAuthClientConfig {
  baseUrl: string
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes?: string
  fetch?: typeof fetch
  now?: () => number
}

export interface CanvasTokenSet {
  accessToken: string
  refreshToken: string
  /** Epoch milliseconds. */
  expiresAt: number
  canvasUserId: string
}

export interface CanvasRefreshedToken {
  accessToken: string
  expiresAt: number
  /** Present only if Canvas ever starts rotating refresh tokens. */
  refreshToken?: string
}

interface CanvasTokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  user?: { id?: unknown }
}

export class CanvasOAuthClient {
  private readonly config: CanvasOAuthClientConfig
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number

  constructor(config: CanvasOAuthClientConfig) {
    this.config = { ...config, baseUrl: config.baseUrl.replace(/\/+$/, '') }
    this.fetchImpl = config.fetch ?? globalThis.fetch
    this.now = config.now ?? Date.now
  }

  /** Where to send the user's browser. `state` is the pending authorization id. */
  authorizationUrl(state: string): string {
    const url = new URL(`${this.config.baseUrl}/login/oauth2/auth`)
    url.searchParams.set('client_id', this.config.clientId)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('redirect_uri', this.config.redirectUri)
    url.searchParams.set('state', state)
    if (this.config.scopes) url.searchParams.set('scope', this.config.scopes)
    return url.toString()
  }

  async exchangeCode(code: string): Promise<CanvasTokenSet> {
    const body = await this.tokenRequest({ grant_type: 'authorization_code', code })
    const accessToken = requireString(body.access_token, 'access_token')
    const refreshToken = requireString(body.refresh_token, 'refresh_token')
    const userId = body.user?.id
    if (typeof userId !== 'number' && typeof userId !== 'string') {
      throw new CanvasOAuthError('malformed', 'Canvas token response has no user.id')
    }
    return {
      accessToken,
      refreshToken,
      expiresAt: this.expiresAt(body.expires_in),
      canvasUserId: String(userId),
    }
  }

  async refresh(refreshToken: string): Promise<CanvasRefreshedToken> {
    const body = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    })
    const accessToken = requireString(body.access_token, 'access_token')
    const result: CanvasRefreshedToken = {
      accessToken,
      expiresAt: this.expiresAt(body.expires_in),
    }
    if (typeof body.refresh_token === 'string' && body.refresh_token !== '') {
      result.refreshToken = body.refresh_token
    }
    return result
  }

  /** Revoke a Canvas access token (and with it the grant's refresh token). */
  async revoke(accessToken: string): Promise<void> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}/login/oauth2/token`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': USER_AGENT },
      })
    } catch {
      throw new CanvasOAuthError('unavailable', 'Canvas could not be reached to revoke the token')
    }
    // 401 means the token is already gone — the outcome we wanted.
    if (response.ok || response.status === 401) return
    throw new CanvasOAuthError(
      response.status >= 500 ? 'unavailable' : 'malformed',
      `Canvas token revocation failed with HTTP ${response.status}`,
      response.status,
    )
  }

  private expiresAt(expiresIn: unknown): number {
    const seconds =
      typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0
        ? expiresIn
        : DEFAULT_EXPIRES_IN_SECONDS
    return this.now() + seconds * 1000
  }

  private async tokenRequest(params: Record<string, string>): Promise<CanvasTokenResponse> {
    const form = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      ...params,
    })
    let response: Response
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}/login/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: form.toString(),
      })
    } catch {
      throw new CanvasOAuthError('unavailable', 'Canvas could not be reached')
    }
    if (response.status >= 500) {
      throw new CanvasOAuthError(
        'unavailable',
        `Canvas token endpoint returned HTTP ${response.status}`,
        response.status,
      )
    }
    if (!response.ok) {
      // 400/401/403: the code or refresh token is not (or no longer) valid.
      // The Canvas error body is deliberately not surfaced anywhere.
      throw new CanvasOAuthError(
        'invalid_grant',
        `Canvas rejected the ${params.grant_type} request (HTTP ${response.status})`,
        response.status,
      )
    }
    try {
      return (await response.json()) as CanvasTokenResponse
    } catch {
      throw new CanvasOAuthError('malformed', 'Canvas token response was not JSON')
    }
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new CanvasOAuthError('malformed', `Canvas token response has no ${field}`)
  }
  return value
}
