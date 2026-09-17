// Grant and token storage for the OAuth profile (design §6).
//
// The `OAuthStore` interface is the seam an embedder replaces with a database.
// `MemoryOAuthStore` is the default and the engine behind `FileOAuthStore`.
//
// Three operations are atomic by contract — `takePendingAuthorization`,
// `consumeAuthorizationCode`, and `takeToken` — because each guards a
// single-use credential. Two concurrent redemptions of one authorization code
// must not both succeed, and a get-then-delete split across an `await` would
// let them.

import type { McpScope } from './config'

export type ClientAuthMethod = 'none' | 'client_secret_basic' | 'client_secret_post'
export type ClientSource = 'preregistered' | 'dynamic' | 'cimd'

export interface RegisteredClient {
  clientId: string
  clientName?: string
  redirectUris: string[]
  tokenEndpointAuthMethod: ClientAuthMethod
  /** SHA-256 hex of the secret; only for confidential clients. */
  clientSecretHash?: string
  grantTypes: string[]
  source: ClientSource
  /** Epoch milliseconds. */
  createdAt: number
  /** CIMD only: when the cached document must be re-fetched (epoch ms). */
  cimdExpiresAt?: number
}

export interface PendingAuthorization {
  /** Random id; doubles as the `state` sent to Canvas. */
  id: string
  clientId: string
  redirectUri: string
  /** The client's own `state`, echoed back untouched. */
  state?: string
  codeChallenge: string
  scopes: McpScope[]
  resource: string
  /** Hash of the CSRF nonce embedded in the consent form. */
  csrfHash: string
  /** Hash of the flow cookie set at consent; absent until the user continues. */
  cookieHash?: string
  consentedAt?: number
  createdAt: number
  expiresAt: number
}

export interface AuthorizationCode {
  /** SHA-256 hex of the code. */
  hash: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  scopes: McpScope[]
  resource: string
  grantId: string
  createdAt: number
  expiresAt: number
  /** Set on first redemption; a second redemption is an attack signal. */
  consumedAt?: number
}

export interface CanvasConnection {
  accessToken: string
  refreshToken: string
  /** Epoch milliseconds. */
  expiresAt: number
}

export interface Grant {
  id: string
  clientId: string
  scopes: McpScope[]
  resource: string
  canvasUserId: string
  canvas: CanvasConnection
  createdAt: number
}

export type TokenKind = 'access' | 'refresh'

export interface TokenRecord {
  /** SHA-256 hex of the token. */
  hash: string
  kind: TokenKind
  grantId: string
  clientId: string
  scopes: McpScope[]
  /** Audience the token was issued for (RFC 8707). */
  resource: string
  createdAt: number
  expiresAt: number
}

export interface ConsumeCodeResult {
  record: AuthorizationCode
  /** True when the code had already been redeemed before this call. */
  alreadyConsumed: boolean
}

export interface OAuthStore {
  getClient(clientId: string): Promise<RegisteredClient | undefined>
  putClient(client: RegisteredClient): Promise<void>
  deleteClient(clientId: string): Promise<void>

  putPendingAuthorization(pending: PendingAuthorization): Promise<void>
  getPendingAuthorization(id: string): Promise<PendingAuthorization | undefined>
  updatePendingAuthorization(pending: PendingAuthorization): Promise<void>
  /** Atomic get-and-delete. */
  takePendingAuthorization(id: string): Promise<PendingAuthorization | undefined>

  putAuthorizationCode(code: AuthorizationCode): Promise<void>
  /** Atomic get-and-mark-consumed. Undefined when unknown or expired. */
  consumeAuthorizationCode(hash: string, now: number): Promise<ConsumeCodeResult | undefined>

  putGrant(grant: Grant): Promise<void>
  getGrant(id: string): Promise<Grant | undefined>
  updateGrant(grant: Grant): Promise<void>
  deleteGrant(id: string): Promise<void>

  putToken(token: TokenRecord): Promise<void>
  getToken(hash: string): Promise<TokenRecord | undefined>
  /** Atomic get-and-delete. */
  takeToken(hash: string): Promise<TokenRecord | undefined>
  deleteToken(hash: string): Promise<void>
  deleteTokensForGrant(grantId: string): Promise<void>

  /** Drop expired pending authorizations, codes, tokens, and CIMD cache entries. */
  purgeExpired(now: number): Promise<void>
}

/** Serialised form of a memory store; what the file store encrypts. */
export interface StoreSnapshot {
  version: 1
  clients: RegisteredClient[]
  pending: PendingAuthorization[]
  codes: AuthorizationCode[]
  grants: Grant[]
  tokens: TokenRecord[]
}

export interface MemoryOAuthStoreOptions {
  /** Cap on dynamically registered clients; oldest is evicted past it. */
  maxDynamicClients?: number
}

export const DEFAULT_MAX_DYNAMIC_CLIENTS = 1000

export class MemoryOAuthStore implements OAuthStore {
  private clients = new Map<string, RegisteredClient>()
  private pending = new Map<string, PendingAuthorization>()
  private codes = new Map<string, AuthorizationCode>()
  private grants = new Map<string, Grant>()
  private tokens = new Map<string, TokenRecord>()
  private readonly maxDynamicClients: number

  constructor(options: MemoryOAuthStoreOptions = {}) {
    this.maxDynamicClients = options.maxDynamicClients ?? DEFAULT_MAX_DYNAMIC_CLIENTS
  }

  static fromSnapshot(
    snapshot: StoreSnapshot,
    options?: MemoryOAuthStoreOptions,
  ): MemoryOAuthStore {
    const store = new MemoryOAuthStore(options)
    for (const c of snapshot.clients) store.clients.set(c.clientId, c)
    for (const p of snapshot.pending) store.pending.set(p.id, p)
    for (const c of snapshot.codes) store.codes.set(c.hash, c)
    for (const g of snapshot.grants) store.grants.set(g.id, g)
    for (const t of snapshot.tokens) store.tokens.set(t.hash, t)
    return store
  }

  snapshot(): StoreSnapshot {
    return {
      version: 1,
      clients: [...this.clients.values()],
      pending: [...this.pending.values()],
      codes: [...this.codes.values()],
      grants: [...this.grants.values()],
      tokens: [...this.tokens.values()],
    }
  }

  async getClient(clientId: string): Promise<RegisteredClient | undefined> {
    return this.clients.get(clientId)
  }

  async putClient(client: RegisteredClient): Promise<void> {
    // Re-insert so Map iteration order stays oldest-first for eviction.
    this.clients.delete(client.clientId)
    this.clients.set(client.clientId, client)
    if (client.source === 'dynamic') this.evictDynamicClients()
  }

  private evictDynamicClients(): void {
    let dynamic = 0
    for (const c of this.clients.values()) if (c.source === 'dynamic') dynamic++
    if (dynamic <= this.maxDynamicClients) return
    for (const [id, c] of this.clients) {
      if (c.source !== 'dynamic') continue
      this.clients.delete(id)
      if (--dynamic <= this.maxDynamicClients) return
    }
  }

  async deleteClient(clientId: string): Promise<void> {
    this.clients.delete(clientId)
  }

  async putPendingAuthorization(pending: PendingAuthorization): Promise<void> {
    this.pending.set(pending.id, pending)
  }

  async getPendingAuthorization(id: string): Promise<PendingAuthorization | undefined> {
    return this.pending.get(id)
  }

  async updatePendingAuthorization(pending: PendingAuthorization): Promise<void> {
    this.pending.set(pending.id, pending)
  }

  async takePendingAuthorization(id: string): Promise<PendingAuthorization | undefined> {
    const found = this.pending.get(id)
    if (found) this.pending.delete(id)
    return found
  }

  async putAuthorizationCode(code: AuthorizationCode): Promise<void> {
    this.codes.set(code.hash, code)
  }

  async consumeAuthorizationCode(
    hash: string,
    now: number,
  ): Promise<ConsumeCodeResult | undefined> {
    const record = this.codes.get(hash)
    if (!record) return undefined
    if (record.expiresAt <= now) {
      this.codes.delete(hash)
      return undefined
    }
    if (record.consumedAt !== undefined) return { record, alreadyConsumed: true }
    const consumed = { ...record, consumedAt: now }
    this.codes.set(hash, consumed)
    return { record: consumed, alreadyConsumed: false }
  }

  async putGrant(grant: Grant): Promise<void> {
    this.grants.set(grant.id, grant)
  }

  async getGrant(id: string): Promise<Grant | undefined> {
    return this.grants.get(id)
  }

  async updateGrant(grant: Grant): Promise<void> {
    this.grants.set(grant.id, grant)
  }

  async deleteGrant(id: string): Promise<void> {
    this.grants.delete(id)
  }

  async putToken(token: TokenRecord): Promise<void> {
    this.tokens.set(token.hash, token)
  }

  async getToken(hash: string): Promise<TokenRecord | undefined> {
    return this.tokens.get(hash)
  }

  async takeToken(hash: string): Promise<TokenRecord | undefined> {
    const found = this.tokens.get(hash)
    if (found) this.tokens.delete(hash)
    return found
  }

  async deleteToken(hash: string): Promise<void> {
    this.tokens.delete(hash)
  }

  async deleteTokensForGrant(grantId: string): Promise<void> {
    for (const [hash, token] of this.tokens) {
      if (token.grantId === grantId) this.tokens.delete(hash)
    }
  }

  async purgeExpired(now: number): Promise<void> {
    for (const [id, p] of this.pending) if (p.expiresAt <= now) this.pending.delete(id)
    for (const [hash, c] of this.codes) if (c.expiresAt <= now) this.codes.delete(hash)
    for (const [hash, t] of this.tokens) if (t.expiresAt <= now) this.tokens.delete(hash)
    for (const [id, c] of this.clients) {
      if (c.source === 'cimd' && c.cimdExpiresAt !== undefined && c.cimdExpiresAt <= now) {
        this.clients.delete(id)
      }
    }
  }
}
