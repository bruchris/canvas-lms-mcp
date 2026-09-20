// OAuth 2.1 resource server for /mcp (design §8). Validates the inbound MCP
// bearer token and resolves the Canvas access token behind its grant,
// refreshing it server-side when needed. The MCP token stops here; the
// Canvas token starts here.

import type { IncomingMessage } from 'node:http'
import { CanvasOAuthClient, CanvasOAuthError } from './canvas-oauth'
import { MCP_SCOPES, type McpScope, type OAuthProfileConfig } from './config'
import { hashToken } from './crypto'
import { firstHeader, parseBearer } from './http-util'
import type { Grant, OAuthStore } from './store'

/** Refresh the Canvas token this long before it expires. */
export const CANVAS_REFRESH_SKEW_MS = 60 * 1000

export interface ResourceServerOptions {
  config: OAuthProfileConfig
  store: OAuthStore
  canvas: CanvasOAuthClient
  /** Provided by the authorization server so both sides revoke the same way. */
  revokeGrant: (grantId: string) => Promise<void>
  now?: () => number
  log?: { warn(message: string): void }
}

export type AuthOutcome =
  | {
      ok: true
      /** The Canvas token to build the server with. Never the MCP token. */
      canvasToken: string
      scopes: McpScope[]
      grantId: string
      clientId: string
    }
  | {
      ok: false
      status: 400 | 401 | 403 | 503
      error: string
      description: string
      /** `WWW-Authenticate` value for 401/403 responses. */
      wwwAuthenticate?: string
    }

export class ResourceServer {
  private readonly config: OAuthProfileConfig
  private readonly store: OAuthStore
  private readonly canvas: CanvasOAuthClient
  private readonly revokeGrant: (grantId: string) => Promise<void>
  private readonly now: () => number
  private readonly log: { warn(message: string): void }
  /** In-flight Canvas refreshes, one per grant, so concurrent requests share one. */
  private readonly refreshing = new Map<string, Promise<Grant>>()

  constructor(options: ResourceServerOptions) {
    this.config = options.config
    this.store = options.store
    this.canvas = options.canvas
    this.revokeGrant = options.revokeGrant
    this.now = options.now ?? Date.now
    this.log = options.log ?? console
  }

  get resourceMetadataUrl(): string {
    const origin = new URL(this.config.issuer).origin
    return `${origin}/.well-known/oauth-protected-resource${this.config.issuerPath}/mcp`
  }

  /** RFC 6750 §3 / RFC 9728 §5.1 challenge. */
  challenge(params: { error?: string; description?: string; scope?: string } = {}): string {
    const parts = [`resource_metadata="${this.resourceMetadataUrl}"`]
    if (params.error) parts.push(`error="${params.error}"`)
    if (params.description)
      parts.push(`error_description="${params.description.replace(/["\\]/g, '')}"`)
    parts.push(`scope="${params.scope ?? MCP_SCOPES.join(' ')}"`)
    return `Bearer ${parts.join(', ')}`
  }

  private unauthorized(description: string, error?: string): AuthOutcome {
    return {
      ok: false,
      status: 401,
      error: error ?? 'unauthorized',
      description,
      wwwAuthenticate: this.challenge(error ? { error, description } : {}),
    }
  }

  async authenticate(req: IncomingMessage): Promise<AuthOutcome> {
    if (firstHeader(req, 'x-canvas-token') !== undefined) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_request',
        description:
          'X-Canvas-Token is not accepted by the oauth_brokered profile. Authenticate with the MCP OAuth flow, or run the remote_static_token profile.',
      }
    }
    const authorization = firstHeader(req, 'authorization')
    const bearer = parseBearer(authorization)
    if (!bearer) {
      return this.unauthorized(
        authorization
          ? 'Authorization header must use the Bearer scheme'
          : 'Authentication required',
      )
    }

    const now = this.now()
    const record = await this.store.getToken(hashToken(bearer))
    if (!record || record.kind !== 'access') {
      return this.unauthorized('Access token is invalid', 'invalid_token')
    }
    if (record.expiresAt <= now) {
      await this.store.deleteToken(record.hash)
      return this.unauthorized('Access token has expired', 'invalid_token')
    }
    if (record.resource !== this.config.resource) {
      // Audience binding (RFC 8707): a token minted for another resource is not ours.
      return this.unauthorized('Access token was not issued for this resource', 'invalid_token')
    }
    const grant = await this.store.getGrant(record.grantId)
    if (!grant) {
      await this.store.deleteToken(record.hash)
      return this.unauthorized('The authorization behind this token was revoked', 'invalid_token')
    }
    if (!record.scopes.includes('canvas:read')) {
      return {
        ok: false,
        status: 403,
        error: 'insufficient_scope',
        description: 'canvas:read is required',
        wwwAuthenticate: this.challenge({
          error: 'insufficient_scope',
          description: 'canvas:read is required',
          scope: MCP_SCOPES.join(' '),
        }),
      }
    }

    let live: Grant
    try {
      live = await this.ensureFreshCanvasToken(grant)
    } catch (error) {
      const kind = error instanceof CanvasOAuthError ? error.kind : 'unknown'
      if (kind === 'invalid_grant') {
        // Canvas no longer honours the refresh token: the user revoked the
        // integration, or an admin disabled the key. The grant is dead.
        this.log.warn(`Canvas refresh refused for grant ${grant.id}; revoking grant`)
        await this.revokeGrant(grant.id)
        return this.unauthorized('Canvas authorization was revoked; sign in again', 'invalid_token')
      }
      this.log.warn(`Canvas refresh failed (${kind}) for grant ${grant.id}`)
      return {
        ok: false,
        status: 503,
        error: 'temporarily_unavailable',
        description: 'Canvas could not be reached to refresh the authorization',
      }
    }
    return {
      ok: true,
      canvasToken: live.canvas.accessToken,
      scopes: record.scopes,
      grantId: live.id,
      clientId: record.clientId,
    }
  }

  private ensureFreshCanvasToken(grant: Grant): Promise<Grant> {
    if (grant.canvas.expiresAt > this.now() + CANVAS_REFRESH_SKEW_MS) {
      return Promise.resolve(grant)
    }
    const inFlight = this.refreshing.get(grant.id)
    if (inFlight) return inFlight
    const task = (async () => {
      try {
        const refreshed = await this.canvas.refresh(grant.canvas.refreshToken)
        const updated: Grant = {
          ...grant,
          canvas: {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken ?? grant.canvas.refreshToken,
            expiresAt: refreshed.expiresAt,
          },
        }
        await this.store.updateGrant(updated)
        return updated
      } finally {
        this.refreshing.delete(grant.id)
      }
    })()
    this.refreshing.set(grant.id, task)
    return task
  }
}
