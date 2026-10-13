// MCP client resolution (design §7.3): pre-registered clients, RFC 7591
// dynamic registration, and allowlisted Client ID Metadata Documents.

import {
  MCP_SCOPES,
  isMcpScope,
  type McpScope,
  type OAuthProfileConfig,
  type PreregisteredClient,
} from './config'
import { hashToken, mintToken } from './crypto'
import { validateRedirectUri } from './redirect-uri'
import type { ClientAuthMethod, OAuthStore, RegisteredClient } from './store'

export const ALLOWED_GRANT_TYPES = ['authorization_code', 'refresh_token'] as const
export const ALLOWED_AUTH_METHODS: readonly ClientAuthMethod[] = [
  'none',
  'client_secret_basic',
  'client_secret_post',
]
const MAX_REDIRECT_URIS = 10
const MAX_CLIENT_NAME = 200
/** CIMD documents: response cap and cache bounds. */
const MAX_CIMD_BYTES = 64 * 1024
const CIMD_MIN_TTL_MS = 60 * 1000
const CIMD_MAX_TTL_MS = 60 * 60 * 1000
const CIMD_FETCH_TIMEOUT_MS = 5000

export class ClientRegistrationError extends Error {
  readonly error: 'invalid_client_metadata' | 'invalid_redirect_uri'
  constructor(error: ClientRegistrationError['error'], message: string) {
    super(message)
    this.name = 'ClientRegistrationError'
    this.error = error
  }
}

export interface RegistrationResult {
  client: RegisteredClient
  /** Returned once, never stored in the clear. */
  clientSecret?: string
}

export interface ClientResolverOptions {
  store: OAuthStore
  config: Pick<OAuthProfileConfig, 'clients' | 'cimdAllowedHosts' | 'dynamicRegistration'>
  fetch?: typeof fetch
  now?: () => number
}

export function parseScopeParam(raw: string | null | undefined): McpScope[] | undefined {
  if (raw === null || raw === undefined) return undefined
  const parts = raw.split(/\s+/).filter((s) => s !== '')
  if (parts.length === 0) return undefined
  const scopes: McpScope[] = []
  for (const part of parts) {
    if (!isMcpScope(part)) return undefined
    if (!scopes.includes(part)) scopes.push(part)
  }
  return scopes
}

/** Whether a client_id is shaped like a Client ID Metadata Document URL. */
export function isCimdClientId(clientId: string): boolean {
  let url: URL
  try {
    url = new URL(clientId)
  } catch {
    return false
  }
  return url.protocol === 'https:' && url.pathname !== '' && url.pathname !== '/' && url.hash === ''
}

export class ClientResolver {
  private readonly store: OAuthStore
  private readonly config: ClientResolverOptions['config']
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number

  constructor(options: ClientResolverOptions) {
    this.store = options.store
    this.config = options.config
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.now = options.now ?? Date.now
  }

  get cimdEnabled(): boolean {
    return this.config.cimdAllowedHosts.length > 0
  }

  get dynamicRegistrationEnabled(): boolean {
    return this.config.dynamicRegistration
  }

  /** Write the operator's pre-registered clients into the store. Idempotent. */
  async seedPreregistered(): Promise<void> {
    for (const client of this.config.clients) {
      await this.store.putClient(preregisteredToRecord(client, this.now()))
    }
  }

  /**
   * Find a client by id: the store first (pre-registered, dynamic, or a fresh
   * CIMD cache entry), then a CIMD fetch when the id is an allowlisted URL.
   */
  async resolve(clientId: string): Promise<RegisteredClient | undefined> {
    const stored = await this.store.getClient(clientId)
    if (stored) {
      if (
        stored.source !== 'cimd' ||
        stored.cimdExpiresAt === undefined ||
        stored.cimdExpiresAt > this.now()
      ) {
        return stored
      }
      await this.store.deleteClient(clientId)
    }
    if (!this.cimdEnabled || !isCimdClientId(clientId)) return undefined
    if (!this.isCimdHostAllowed(new URL(clientId).hostname)) return undefined
    const fetched = await this.fetchCimd(clientId)
    if (!fetched) return undefined
    await this.store.putClient(fetched)
    return fetched
  }

  isCimdHostAllowed(hostname: string): boolean {
    const hosts = this.config.cimdAllowedHosts
    if (hosts.includes('*')) return true
    return hosts.includes(hostname.toLowerCase())
  }

  private async fetchCimd(clientId: string): Promise<RegisteredClient | undefined> {
    let response: Response
    try {
      response = await this.fetchImpl(clientId, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        // A redirect could leave the allowlisted host; refuse to follow.
        redirect: 'manual',
        signal: AbortSignal.timeout(CIMD_FETCH_TIMEOUT_MS),
      })
    } catch {
      return undefined
    }
    if (response.status !== 200) return undefined
    const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    if (type !== 'application/json') return undefined
    const declaredLength = Number(response.headers.get('content-length') ?? '0')
    if (declaredLength > MAX_CIMD_BYTES) return undefined
    let text: string
    try {
      text = await response.text()
    } catch {
      return undefined
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_CIMD_BYTES) return undefined
    let doc: unknown
    try {
      doc = JSON.parse(text)
    } catch {
      return undefined
    }
    let metadata: ValidatedMetadata
    try {
      metadata = validateClientMetadata(doc, { requirePublic: true })
    } catch {
      return undefined
    }
    if (
      !doc ||
      typeof doc !== 'object' ||
      (doc as Record<string, unknown>).client_id !== clientId
    ) {
      return undefined
    }
    const ttl = cacheTtlMs(response.headers.get('cache-control'))
    const now = this.now()
    return {
      clientId,
      ...(metadata.clientName !== undefined ? { clientName: metadata.clientName } : {}),
      redirectUris: metadata.redirectUris,
      tokenEndpointAuthMethod: 'none',
      grantTypes: metadata.grantTypes,
      source: 'cimd',
      createdAt: now,
      cimdExpiresAt: now + ttl,
    }
  }

  /** RFC 7591 dynamic registration. Throws `ClientRegistrationError`. */
  async register(body: unknown): Promise<RegistrationResult> {
    const metadata = validateClientMetadata(body, { requirePublic: false })
    const now = this.now()
    const clientId = mintToken('client')
    const record: RegisteredClient = {
      clientId,
      ...(metadata.clientName !== undefined ? { clientName: metadata.clientName } : {}),
      redirectUris: metadata.redirectUris,
      tokenEndpointAuthMethod: metadata.tokenEndpointAuthMethod,
      grantTypes: metadata.grantTypes,
      source: 'dynamic',
      createdAt: now,
    }
    let clientSecret: string | undefined
    if (metadata.tokenEndpointAuthMethod !== 'none') {
      clientSecret = mintToken('secret')
      record.clientSecretHash = hashToken(clientSecret)
    }
    await this.store.putClient(record)
    return clientSecret !== undefined ? { client: record, clientSecret } : { client: record }
  }
}

function preregisteredToRecord(client: PreregisteredClient, now: number): RegisteredClient {
  const record: RegisteredClient = {
    clientId: client.client_id,
    ...(client.client_name !== undefined ? { clientName: client.client_name } : {}),
    redirectUris: [...client.redirect_uris],
    tokenEndpointAuthMethod: client.client_secret ? 'client_secret_basic' : 'none',
    grantTypes: [...ALLOWED_GRANT_TYPES],
    source: 'preregistered',
    createdAt: now,
  }
  if (client.client_secret) record.clientSecretHash = hashToken(client.client_secret)
  return record
}

interface ValidatedMetadata {
  redirectUris: string[]
  clientName?: string
  tokenEndpointAuthMethod: ClientAuthMethod
  grantTypes: string[]
}

/**
 * Validate RFC 7591 client metadata. Shared by DCR and CIMD; the latter is
 * public-only because this server does not support `private_key_jwt`.
 */
export function validateClientMetadata(
  body: unknown,
  options: { requirePublic: boolean },
): ValidatedMetadata {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ClientRegistrationError(
      'invalid_client_metadata',
      'Client metadata must be a JSON object',
    )
  }
  const meta = body as Record<string, unknown>

  const uris = meta.redirect_uris
  if (!Array.isArray(uris) || uris.length === 0 || !uris.every((u) => typeof u === 'string')) {
    throw new ClientRegistrationError(
      'invalid_redirect_uri',
      'redirect_uris must be a non-empty array of strings',
    )
  }
  if (uris.length > MAX_REDIRECT_URIS) {
    throw new ClientRegistrationError(
      'invalid_redirect_uri',
      `At most ${MAX_REDIRECT_URIS} redirect_uris may be registered`,
    )
  }
  for (const uri of uris as string[]) {
    const check = validateRedirectUri(uri)
    if (!check.ok) throw new ClientRegistrationError('invalid_redirect_uri', check.reason)
  }

  let clientName: string | undefined
  if (meta.client_name !== undefined) {
    if (typeof meta.client_name !== 'string' || meta.client_name.trim() === '') {
      throw new ClientRegistrationError(
        'invalid_client_metadata',
        'client_name must be a non-empty string',
      )
    }
    clientName = meta.client_name.trim().slice(0, MAX_CLIENT_NAME)
  }

  let tokenEndpointAuthMethod: ClientAuthMethod
  if (meta.token_endpoint_auth_method === undefined) {
    // RFC 7591 §2 default. MCP clients (Codex, the reference SDK) send `none` explicitly.
    tokenEndpointAuthMethod = options.requirePublic ? 'none' : 'client_secret_basic'
  } else if (
    typeof meta.token_endpoint_auth_method === 'string' &&
    (ALLOWED_AUTH_METHODS as readonly string[]).includes(meta.token_endpoint_auth_method)
  ) {
    tokenEndpointAuthMethod = meta.token_endpoint_auth_method as ClientAuthMethod
  } else {
    throw new ClientRegistrationError(
      'invalid_client_metadata',
      `token_endpoint_auth_method must be one of ${ALLOWED_AUTH_METHODS.join(', ')}`,
    )
  }
  if (options.requirePublic && tokenEndpointAuthMethod !== 'none') {
    throw new ClientRegistrationError(
      'invalid_client_metadata',
      'Client ID Metadata Document clients must use token_endpoint_auth_method "none"',
    )
  }

  let grantTypes: string[]
  if (meta.grant_types === undefined) {
    // Deliberately wider than the RFC default of ["authorization_code"]: an
    // MCP client that omits the field still expects a refresh token.
    grantTypes = [...ALLOWED_GRANT_TYPES]
  } else if (
    Array.isArray(meta.grant_types) &&
    meta.grant_types.length > 0 &&
    meta.grant_types.every(
      (g) => typeof g === 'string' && (ALLOWED_GRANT_TYPES as readonly string[]).includes(g),
    )
  ) {
    grantTypes = [...new Set(meta.grant_types as string[])]
    if (!grantTypes.includes('authorization_code')) {
      throw new ClientRegistrationError(
        'invalid_client_metadata',
        'grant_types must include authorization_code',
      )
    }
  } else {
    throw new ClientRegistrationError(
      'invalid_client_metadata',
      `grant_types may only contain ${ALLOWED_GRANT_TYPES.join(' and ')}`,
    )
  }

  if (meta.response_types !== undefined) {
    if (!Array.isArray(meta.response_types) || !meta.response_types.every((r) => r === 'code')) {
      throw new ClientRegistrationError(
        'invalid_client_metadata',
        'response_types may only contain "code"',
      )
    }
  }

  if (meta.scope !== undefined) {
    if (
      typeof meta.scope !== 'string' ||
      (meta.scope.trim() !== '' && !parseScopeParam(meta.scope))
    ) {
      throw new ClientRegistrationError(
        'invalid_client_metadata',
        `scope may only contain ${MCP_SCOPES.join(' and ')}`,
      )
    }
  }

  return {
    redirectUris: [...new Set(uris as string[])],
    ...(clientName !== undefined ? { clientName } : {}),
    tokenEndpointAuthMethod,
    grantTypes,
  }
}

/** Cache lifetime for a CIMD document from its Cache-Control header, bounded. */
function cacheTtlMs(cacheControl: string | null): number {
  if (!cacheControl) return CIMD_MAX_TTL_MS
  const lower = cacheControl.toLowerCase()
  if (/\bno-store\b|\bno-cache\b/.test(lower)) return CIMD_MIN_TTL_MS
  const match = /\bmax-age=(\d+)/.exec(lower)
  if (!match?.[1]) return CIMD_MAX_TTL_MS
  const seconds = Number(match[1])
  return Math.min(CIMD_MAX_TTL_MS, Math.max(CIMD_MIN_TTL_MS, seconds * 1000))
}

/** The RFC 7591 response body for a registered client. */
export function registrationResponse(result: RegistrationResult): Record<string, unknown> {
  const { client } = result
  return {
    client_id: client.clientId,
    ...(result.clientSecret !== undefined
      ? { client_secret: result.clientSecret, client_secret_expires_at: 0 }
      : {}),
    client_id_issued_at: Math.floor(client.createdAt / 1000),
    redirect_uris: client.redirectUris,
    ...(client.clientName !== undefined ? { client_name: client.clientName } : {}),
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    grant_types: client.grantTypes,
    response_types: ['code'],
  }
}
