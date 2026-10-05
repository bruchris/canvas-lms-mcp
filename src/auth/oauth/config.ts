// OAuth profile configuration (design §5). Everything here is read from the
// environment or the command line at startup and validated before the server
// listens. Nothing is ever read from a request.

import { isEnvTruthy } from '../../env'
import { hashToken } from './crypto'
import { isLoopbackHost, validateRedirectUri } from './redirect-uri'

/** Scopes this server issues. MCP scopes, not Canvas scopes (§7.4). */
export const MCP_SCOPES = ['canvas:read', 'canvas:write'] as const
export type McpScope = (typeof MCP_SCOPES)[number]

export function isMcpScope(value: string): value is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(value)
}

/** Default CIMD trust: where Codex hosts its client metadata documents. */
export const DEFAULT_CIMD_ALLOWED_HOSTS = ['chatgpt.com']

/** Lifetimes (seconds). */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
export const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60
export const PENDING_AUTHORIZATION_TTL_SECONDS = 10 * 60

export interface PreregisteredClient {
  client_id: string
  client_name?: string
  redirect_uris: string[]
  /** Present for confidential clients. Stored hashed in the client store. */
  client_secret?: string
}

export interface OAuthProfileConfig {
  /** Canonical issuer: absolute URL, no trailing slash, no query/fragment. */
  issuer: string
  /** `new URL(issuer).pathname` with a trailing slash stripped; '' at the root. */
  issuerPath: string
  /** RFC 8707 resource identifier: `${issuer}/mcp`. */
  resource: string
  canvas: {
    baseUrl: string
    clientId: string
    clientSecret: string
    /** Canvas API scopes, or undefined for the Developer Key default. */
    scopes?: string
  }
  clients: PreregisteredClient[]
  dynamicRegistration: boolean
  /** Lower-cased hostnames; `['*']` = any https host; `[]` = CIMD disabled. */
  cimdAllowedHosts: string[]
  store?: {
    path: string
    keySecret: string
  }
}

/**
 * Every environment variable the OAuth profile reads. The docs drift guard
 * (tests/docs/oauth-profile-doc-consistency.test.ts) checks that each one is
 * documented, so a new variable cannot ship undocumented.
 */
export const OAUTH_ENV_VARS = [
  'CANVAS_AUTH_PROFILE',
  'CANVAS_HTTP_HOST',
  'CANVAS_MCP_ISSUER',
  'CANVAS_OAUTH_CLIENT_ID',
  'CANVAS_OAUTH_CLIENT_SECRET',
  'CANVAS_OAUTH_SCOPES',
  'CANVAS_MCP_OAUTH_CLIENTS',
  'CANVAS_MCP_OAUTH_DCR',
  'CANVAS_MCP_OAUTH_CIMD_ALLOWED_HOSTS',
  'CANVAS_MCP_OAUTH_STORE',
  'CANVAS_MCP_OAUTH_STORE_KEY',
] as const

export interface OAuthEnv {
  CANVAS_BASE_URL?: string
  CANVAS_MCP_ISSUER?: string
  CANVAS_OAUTH_CLIENT_ID?: string
  CANVAS_OAUTH_CLIENT_SECRET?: string
  CANVAS_OAUTH_SCOPES?: string
  CANVAS_MCP_OAUTH_CLIENTS?: string
  CANVAS_MCP_OAUTH_DCR?: string
  CANVAS_MCP_OAUTH_CIMD_ALLOWED_HOSTS?: string
  CANVAS_MCP_OAUTH_STORE?: string
  CANVAS_MCP_OAUTH_STORE_KEY?: string
}

export interface OAuthConfigOverrides {
  /** `--issuer` */
  issuer?: string
  /** `--base-url` / resolved Canvas base URL. */
  baseUrl?: string
}

export class OAuthConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OAuthConfigError'
  }
}

/**
 * Normalise and validate the issuer (§5): absolute, `https` unless loopback,
 * no query or fragment, trailing slash stripped.
 */
export function parseIssuer(raw: string): { issuer: string; issuerPath: string; url: URL } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new OAuthConfigError(
      `CANVAS_MCP_ISSUER must be an absolute URL such as http://127.0.0.1:3001 or https://canvas-mcp.example.edu (got '${raw}')`,
    )
  }
  if (url.search !== '' || url.hash !== '') {
    throw new OAuthConfigError('CANVAS_MCP_ISSUER must not contain a query string or fragment')
  }
  if (url.username !== '' || url.password !== '') {
    throw new OAuthConfigError('CANVAS_MCP_ISSUER must not contain credentials')
  }
  const loopback = isLoopbackHost(url.hostname)
  if (url.protocol === 'http:' && !loopback) {
    throw new OAuthConfigError(
      `CANVAS_MCP_ISSUER '${raw}' is not loopback, so it must use https. ` +
        'Hosted authorization endpoints are only served over TLS.',
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new OAuthConfigError(`CANVAS_MCP_ISSUER must use http (loopback only) or https`)
  }
  const issuerPath = url.pathname.replace(/\/+$/, '')
  const issuer = `${url.origin}${issuerPath}`
  return { issuer, issuerPath, url }
}

export function isLoopbackIssuer(issuer: string): boolean {
  return isLoopbackHost(new URL(issuer).hostname)
}

function parseClients(raw: string | undefined): PreregisteredClient[] {
  if (raw === undefined || raw.trim() === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new OAuthConfigError('CANVAS_MCP_OAUTH_CLIENTS must be a JSON array')
  }
  if (!Array.isArray(parsed)) {
    throw new OAuthConfigError('CANVAS_MCP_OAUTH_CLIENTS must be a JSON array')
  }
  const seen = new Set<string>()
  return parsed.map((entry, index) => {
    const at = `CANVAS_MCP_OAUTH_CLIENTS[${index}]`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new OAuthConfigError(`${at} must be an object`)
    }
    const obj = entry as Record<string, unknown>
    if (typeof obj.client_id !== 'string' || obj.client_id.trim() === '') {
      throw new OAuthConfigError(`${at}.client_id must be a non-empty string`)
    }
    if (seen.has(obj.client_id)) {
      throw new OAuthConfigError(`${at}.client_id '${obj.client_id}' is registered twice`)
    }
    seen.add(obj.client_id)
    if (
      !Array.isArray(obj.redirect_uris) ||
      obj.redirect_uris.length === 0 ||
      !obj.redirect_uris.every((u) => typeof u === 'string')
    ) {
      throw new OAuthConfigError(`${at}.redirect_uris must be a non-empty array of strings`)
    }
    for (const uri of obj.redirect_uris as string[]) {
      const check = validateRedirectUri(uri)
      if (!check.ok) throw new OAuthConfigError(`${at}: ${check.reason}`)
    }
    if (obj.client_name !== undefined && typeof obj.client_name !== 'string') {
      throw new OAuthConfigError(`${at}.client_name must be a string`)
    }
    if (obj.client_secret !== undefined && typeof obj.client_secret !== 'string') {
      throw new OAuthConfigError(`${at}.client_secret must be a string`)
    }
    const client: PreregisteredClient = {
      client_id: obj.client_id,
      redirect_uris: obj.redirect_uris as string[],
    }
    if (typeof obj.client_name === 'string') client.client_name = obj.client_name
    if (typeof obj.client_secret === 'string') client.client_secret = obj.client_secret
    return client
  })
}

function parseCimdHosts(raw: string | undefined): string[] {
  if (raw === undefined) return [...DEFAULT_CIMD_ALLOWED_HOSTS]
  const trimmed = raw.trim().toLowerCase()
  if (trimmed === '' || trimmed === 'none') return []
  const hosts = trimmed
    .split(',')
    .map((h) => h.trim())
    .filter((h) => h !== '')
  if (hosts.includes('*')) return ['*']
  for (const host of hosts) {
    if (!/^[a-z0-9.-]+$/.test(host)) {
      throw new OAuthConfigError(
        `CANVAS_MCP_OAUTH_CIMD_ALLOWED_HOSTS entry '${host}' is not a hostname`,
      )
    }
  }
  return hosts
}

/**
 * Build the OAuth profile configuration, or throw `OAuthConfigError` naming
 * the first thing that is wrong. `overrides` carry CLI flags, which win over
 * the environment.
 */
export function loadOAuthProfileConfig(
  env: OAuthEnv,
  overrides: OAuthConfigOverrides = {},
): OAuthProfileConfig {
  const baseUrlRaw = overrides.baseUrl ?? env.CANVAS_BASE_URL ?? ''
  if (baseUrlRaw.trim() === '') {
    throw new OAuthConfigError('Canvas base URL required. Use --base-url or set CANVAS_BASE_URL')
  }
  let canvasBase: URL
  try {
    canvasBase = new URL(baseUrlRaw)
  } catch {
    throw new OAuthConfigError(`CANVAS_BASE_URL '${baseUrlRaw}' is not an absolute URL`)
  }
  if (canvasBase.protocol !== 'https:' && !isLoopbackHost(canvasBase.hostname)) {
    throw new OAuthConfigError(
      'CANVAS_BASE_URL must use https in the oauth_brokered profile (a Canvas token travels on it)',
    )
  }

  const issuerRaw = overrides.issuer ?? env.CANVAS_MCP_ISSUER
  if (issuerRaw === undefined || issuerRaw.trim() === '') {
    throw new OAuthConfigError(
      'CANVAS_MCP_ISSUER (or --issuer) is required in the oauth_brokered profile: the public URL ' +
        'of this server, e.g. http://127.0.0.1:3001 for a local deployment or https://canvas-mcp.example.edu when hosted',
    )
  }
  const { issuer, issuerPath } = parseIssuer(issuerRaw.trim())

  const clientId = env.CANVAS_OAUTH_CLIENT_ID?.trim() ?? ''
  const clientSecret = env.CANVAS_OAUTH_CLIENT_SECRET ?? ''
  if (clientId === '') {
    throw new OAuthConfigError(
      'CANVAS_OAUTH_CLIENT_ID is required in the oauth_brokered profile (the Canvas Developer Key ID)',
    )
  }
  if (clientSecret === '') {
    throw new OAuthConfigError(
      'CANVAS_OAUTH_CLIENT_SECRET is required in the oauth_brokered profile (the Canvas Developer Key secret)',
    )
  }

  const storePath = env.CANVAS_MCP_OAUTH_STORE?.trim()
  const storeKey = env.CANVAS_MCP_OAUTH_STORE_KEY
  let store: OAuthProfileConfig['store']
  if (storePath) {
    if (!storeKey || storeKey.length < 16) {
      throw new OAuthConfigError(
        'CANVAS_MCP_OAUTH_STORE_KEY (at least 16 characters) is required when CANVAS_MCP_OAUTH_STORE is set: ' +
          'the store holds Canvas refresh tokens and is encrypted at rest',
      )
    }
    store = { path: storePath, keySecret: storeKey }
  } else if (storeKey) {
    throw new OAuthConfigError(
      'CANVAS_MCP_OAUTH_STORE_KEY is set but CANVAS_MCP_OAUTH_STORE is not; set both or neither',
    )
  }

  const scopesRaw = env.CANVAS_OAUTH_SCOPES?.trim()

  return {
    issuer,
    issuerPath,
    resource: `${issuer}/mcp`,
    canvas: {
      baseUrl: canvasBase.origin,
      clientId,
      clientSecret,
      ...(scopesRaw ? { scopes: scopesRaw } : {}),
    },
    clients: parseClients(env.CANVAS_MCP_OAUTH_CLIENTS),
    dynamicRegistration:
      env.CANVAS_MCP_OAUTH_DCR === undefined ? true : isEnvTruthy(env.CANVAS_MCP_OAUTH_DCR),
    cimdAllowedHosts: parseCimdHosts(env.CANVAS_MCP_OAUTH_CIMD_ALLOWED_HOSTS),
    ...(store ? { store } : {}),
  }
}

/**
 * Bind-host rule (§5): a loopback issuer must not be reachable from the
 * network. Returns the host to bind, or throws.
 */
export function resolveBindHost(
  config: OAuthProfileConfig,
  requestedHost: string | undefined,
): string {
  const loopbackIssuer = isLoopbackIssuer(config.issuer)
  if (requestedHost === undefined || requestedHost.trim() === '') {
    return '127.0.0.1'
  }
  const host = requestedHost.trim()
  if (loopbackIssuer && !isLoopbackHost(host)) {
    throw new OAuthConfigError(
      `CANVAS_MCP_ISSUER '${config.issuer}' is loopback, so the server must bind a loopback host too ` +
        `(got --host ${host}). Set an https issuer to expose the OAuth endpoints on the network.`,
    )
  }
  return host
}

/** Hash a pre-registered client secret for storage; exported for the client store. */
export function hashClientSecret(secret: string): string {
  return hashToken(secret)
}
