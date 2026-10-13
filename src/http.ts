import { createServer } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { Pseudonymizer } from './pseudonym/pseudonymizer'
import { createCanvasMCPServer } from './server'
import { parseArgs } from './cli'
import { isEnvTruthy } from './env'
import { parseRole } from './tools/roles'
import type { DestructiveToolsMode } from './tools/destructive-policy'
import type { CanvasRole, WriteToolsMode } from './tools/types'
import { AuthorizationServer } from './auth/oauth/authorization-server'
import { CanvasOAuthClient } from './auth/oauth/canvas-oauth'
import { ClientResolver } from './auth/oauth/clients'
import type { OAuthProfileConfig } from './auth/oauth/config'
import { FileOAuthStore } from './auth/oauth/file-store'
import { firstHeader, routePath, sendJson } from './auth/oauth/http-util'
import { ResourceServer } from './auth/oauth/resource-server'
import { MemoryOAuthStore, type OAuthStore } from './auth/oauth/store'

// Public surface for embedders running the HTTP transport themselves.
export { MemoryOAuthStore } from './auth/oauth/store'
export { FileOAuthStore } from './auth/oauth/file-store'
export type { OAuthStore } from './auth/oauth/store'
export { loadOAuthProfileConfig, type OAuthProfileConfig } from './auth/oauth/config'

/** The two profiles the HTTP transport can run (design §3). */
export type HttpAuthProfile = 'remote_static_token' | 'oauth_brokered'

export interface HttpHandlerConfig {
  token?: string
  baseUrl?: string
  allowedOrigin?: string
  role?: CanvasRole
  enableAssignmentSubmission?: boolean
  destructiveTools?: DestructiveToolsMode
  /**
   * Defaults to `remote_static_token`, today's behaviour: the Canvas token
   * arrives in `X-Canvas-Token` or is the configured default. Documented as
   * self-managed only.
   */
  authProfile?: HttpAuthProfile
  /** Required for `oauth_brokered`. */
  oauth?: OAuthProfileConfig
  /**
   * Grant/token store for `oauth_brokered`. Defaults to an in-memory store;
   * `main()` opens a `FileOAuthStore` when `CANVAS_MCP_OAUTH_STORE` is set.
   * Embedders may supply their own implementation.
   */
  oauthStore?: OAuthStore
  /** Test seam: the fetch used toward Canvas and for CIMD documents. */
  fetch?: typeof fetch
}

const DEFAULT_ALLOWED_ORIGIN = 'http://localhost:3000'

interface OAuthRuntime {
  authorizationServer: AuthorizationServer
  resourceServer: ResourceServer
  /**
   * Resolves once the pre-registered clients are in the store. Deliberately a
   * function and not a stored promise: see `buildOAuthRuntime`.
   */
  ready: () => Promise<void>
}

function buildOAuthRuntime(
  config: OAuthProfileConfig,
  store: OAuthStore,
  fetchImpl: typeof fetch | undefined,
): OAuthRuntime {
  const canvas = new CanvasOAuthClient({
    baseUrl: config.canvas.baseUrl,
    clientId: config.canvas.clientId,
    clientSecret: config.canvas.clientSecret,
    redirectUri: `${config.issuer}/oauth/canvas/callback`,
    ...(config.canvas.scopes ? { scopes: config.canvas.scopes } : {}),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })
  const clients = new ClientResolver({ store, config, ...(fetchImpl ? { fetch: fetchImpl } : {}) })
  const authorizationServer = new AuthorizationServer({ config, store, clients, canvas })
  const resourceServer = new ResourceServer({
    config,
    store,
    canvas,
    revokeGrant: (grantId) => authorizationServer.revokeGrant(grantId),
  })
  // Seeding is memoized only while it is succeeding or in flight (QA R5,
  // #356). A single failed `putClient` — a store that went read-only, a full
  // disk — used to be cached as one rejected promise that the handler
  // re-threw on every request for the life of the process, while `/health`
  // kept answering 200, so a health-checked supervisor never restarted it.
  // Dropping the rejection makes the next request retry, so a transient fault
  // heals itself; concurrent requests still share one in-flight attempt, so a
  // persistently broken store logs once per round trip, not once per request.
  let seeding: Promise<void> | undefined
  const ready = (): Promise<void> => {
    if (seeding) return seeding
    const attempt = clients.seedPreregistered().catch((error: unknown) => {
      if (seeding === attempt) seeding = undefined
      console.error('Failed to seed pre-registered OAuth clients:', error)
      throw error
    })
    // The handler awaits this and surfaces the failure as a 500. Attaching a
    // second handler here keeps the startup attempt below from counting as an
    // unhandled rejection before the first request arrives.
    attempt.catch(() => {})
    seeding = attempt
    return attempt
  }
  // Start at construction so the failure is logged at startup rather than
  // waiting for a request that may never come.
  void ready()
  return { authorizationServer, resourceServer, ready }
}

export function createHttpHandler(defaultConfig: HttpHandlerConfig) {
  const authProfile: HttpAuthProfile = defaultConfig.authProfile ?? 'remote_static_token'
  if (authProfile === 'oauth_brokered' && !defaultConfig.oauth) {
    throw new Error('createHttpHandler: authProfile oauth_brokered requires an oauth config')
  }
  const oauthConfig = authProfile === 'oauth_brokered' ? defaultConfig.oauth : undefined
  const baseUrl = oauthConfig?.canvas.baseUrl ?? defaultConfig.baseUrl
  const issuerPath = oauthConfig?.issuerPath ?? ''
  const allowedOrigin = defaultConfig.allowedOrigin ?? DEFAULT_ALLOWED_ORIGIN

  // Origin allowlist (design §7). Browsers on any other origin were already
  // stopped by CORS preflight; this closes DNS rebinding for non-preflighted
  // requests. The issuer's own origin is included so the consent form can post.
  const allowedOrigins = new Set<string>([allowedOrigin])
  if (oauthConfig) allowedOrigins.add(new URL(oauthConfig.issuer).origin)

  const oauth = oauthConfig
    ? buildOAuthRuntime(
        oauthConfig,
        defaultConfig.oauthStore ?? new MemoryOAuthStore(),
        defaultConfig.fetch,
      )
    : undefined

  // Process-wide pseudonymizer keyed on the configured base URL. Pseudonyms
  // are stable across requests because every fresh MCP server reuses this
  // instance and its on-disk map.
  //
  // `sharedAcrossCallers: true` is the security-relevant part (BRU-2511). This
  // one instance serves every caller regardless of the credential they
  // present, so its map is not a safe basis for identity disclosure: the
  // pseudonym → user_id mapping is seeded by whoever fetched a roster first,
  // and `resolve_pseudonym` performs no Canvas-side authorization. The flag
  // makes `resolve_pseudonym` unregistrable on this transport, whatever
  // `CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP` says. Pseudonymization itself is
  // unaffected — student PII is still replaced in every tool response.
  //
  // This is the only construction site the HTTP transport has, and the handler
  // below refuses the request if it is absent, so the factory's own non-shared
  // default can never be reached from here.
  const pseudonymizer = baseUrl
    ? new Pseudonymizer({ baseUrl, sharedAcrossCallers: true })
    : undefined

  if (pseudonymizer?.isEnabled() && isEnvTruthy(process.env.CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP)) {
    console.warn(
      'CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP is set, but resolve_pseudonym is not registered on the ' +
        'HTTP transport: one pseudonym map is shared by every caller, so reverse lookup would let ' +
        'an unrelated token resolve a student it was never shown. Run the stdio transport if you need it.',
    )
  }

  const handle = async (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) => {
    // CORS headers on all responses
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Canvas-Token, X-Canvas-Role, Mcp-Protocol-Version',
    )
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Protocol-Version, WWW-Authenticate')

    const origin = firstHeader(req, 'origin')
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      sendJson(res, 403, { error: 'forbidden', error_description: 'Origin not allowed' })
      return
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const routed = routePath(req.url, issuerPath)
    if (!routed) {
      // The node HTTP parser accepts request targets the URL parser does not
      // (`GET //a:b`). Unauthenticated, so this must never be fatal.
      sendJson(res, 400, {
        error: 'invalid_request',
        error_description: 'Malformed request target',
      })
      return
    }
    const { path, rawPath, query } = routed

    // Health check endpoint
    if (path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }

    if (oauth) {
      await oauth.ready()
      if (await oauth.authorizationServer.handle(req, res, rawPath, path, query)) return
    }

    // Only handle /mcp path
    if (path !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
      return
    }

    let token: string | undefined
    let writeTools: WriteToolsMode | undefined

    if (oauth) {
      // Resource-server checks come before the method check: an unauthenticated
      // GET deserves the 401 challenge that tells the host to show
      // "Not logged in", not a bare 405.
      const outcome = await oauth.resourceServer.authenticate(req)
      if (!outcome.ok) {
        sendJson(
          res,
          outcome.status,
          { error: outcome.error, error_description: outcome.description },
          outcome.wwwAuthenticate ? { 'WWW-Authenticate': outcome.wwwAuthenticate } : {},
        )
        return
      }
      if (req.method !== 'POST') {
        methodNotAllowed(res)
        return
      }
      token = outcome.canvasToken
      writeTools = outcome.scopes.includes('canvas:write') ? 'allow' : 'block'
    } else {
      // Only POST is supported for stateless MCP
      if (req.method !== 'POST') {
        methodNotAllowed(res)
        return
      }
      // Per-request token from header; base URL must come from server config (SSRF protection)
      token = firstHeader(req, 'x-canvas-token') ?? defaultConfig.token
    }

    // Per-request role: X-Canvas-Role header takes precedence over the configured
    // env/CLI role. A valid header (or `all`) overrides; an unrecognised value is
    // ignored with a warning so a misconfigured client can't wipe the server's
    // configured default. The role only narrows which tools are listed — Canvas
    // still enforces real permissions server-side.
    let role = defaultConfig.role
    const rawRole = firstHeader(req, 'x-canvas-role')
    if (rawRole !== undefined && rawRole.trim() !== '') {
      const parsed = parseRole(rawRole)
      if (parsed.invalid) {
        console.warn(`Unknown X-Canvas-Role '${rawRole}'; falling back to the configured role.`)
      } else {
        role = parsed.role
      }
    }

    // `!pseudonymizer` is equivalent to `!baseUrl` today; asserting it here
    // narrows the type so the `createCanvasMCPServer` call below cannot fall
    // back to the factory's own non-shared default.
    if (!token || !baseUrl || !pseudonymizer) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          error:
            'Missing Canvas credentials. Provide X-Canvas-Token header and configure base URL via --base-url or CANVAS_BASE_URL.',
        }),
      )
      return
    }

    // Fresh MCP server per request (per-request credentials); the pseudonymizer
    // is the shared singleton constructed above so pseudonyms remain stable
    // across requests for this host — and, being shared, refuses reverse
    // lookup.
    const { server } = createCanvasMCPServer({
      token,
      baseUrl,
      pseudonymizer,
      role,
      enableAssignmentSubmission: defaultConfig.enableAssignmentSubmission,
      // Server config only. Unlike `role` there is deliberately no
      // `X-Canvas-Destructive-Tools` header: the gate exists to bound what a
      // client can do, so letting the client pick the mode would defeat it.
      destructiveTools: defaultConfig.destructiveTools,
      ...(writeTools ? { writeTools } : {}),
    })

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      })
      await server.connect(transport)
      await transport.handleRequest(req, res)
      res.on('close', () => {
        try {
          transport.close()
          server.close()
        } catch (cleanupError) {
          console.error('Error during MCP cleanup:', cleanupError)
        }
      })
    } catch (error) {
      console.error('Error handling MCP request:', error)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          }),
        )
      }
    }
  }

  // Nothing above may end the process. Every path in `handle` is reachable
  // by an unauthenticated client, and `createServer` ignores the promise a
  // rejecting handler returns, so an escaping error became an unhandled
  // rejection and node exited (QA R3, #356). The individual fixes keep the
  // known cases from throwing at all; this makes the class non-fatal.
  return async (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) => {
    try {
      await handle(req, res)
    } catch (error) {
      console.error('Unhandled error handling HTTP request:', error)
      try {
        if (!res.headersSent) {
          sendJson(res, 500, { error: 'server_error', error_description: 'Internal server error' })
        } else if (!res.writableEnded) {
          res.end()
        }
      } catch {
        // The socket is already gone: usually the client aborted.
      }
    }
  }
}

function methodNotAllowed(res: import('node:http').ServerResponse): void {
  res.writeHead(405, { 'Content-Type': 'application/json' })
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    }),
  )
}

/** Open the configured grant store: encrypted file when set, memory otherwise. */
export async function openOAuthStore(config: OAuthProfileConfig): Promise<OAuthStore> {
  if (!config.store) return new MemoryOAuthStore()
  return FileOAuthStore.open(config.store.path, config.store.keySecret)
}

async function main() {
  const config = parseArgs(process.argv.slice(2))
  const port = config.port
  const oauthProfile = config.authProfile === 'oauth_brokered' && config.oauth !== undefined

  let oauthStore: OAuthStore | undefined
  if (oauthProfile && config.oauth) {
    try {
      oauthStore = await openOAuthStore(config.oauth)
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  }

  const httpServer = createServer(
    createHttpHandler({
      token: config.token,
      baseUrl: config.baseUrl,
      allowedOrigin: config.allowedOrigin,
      role: config.role,
      enableAssignmentSubmission: config.enableAssignmentSubmission,
      destructiveTools: config.destructiveTools,
      authProfile: oauthProfile ? 'oauth_brokered' : 'remote_static_token',
      ...(oauthProfile ? { oauth: config.oauth, oauthStore } : {}),
    }),
  )

  const onListening = () => {
    const shownHost = config.host ?? 'localhost'
    console.log(`Canvas LMS MCP server listening on http://${shownHost}:${port}`)
    console.log(`Auth profile: ${config.authProfile}`)
    if (oauthProfile && config.oauth) {
      console.log(`MCP endpoint: ${config.oauth.resource} (OAuth: issuer ${config.oauth.issuer})`)
      console.log(
        `Grant store: ${config.oauth.store ? 'encrypted file' : 'in-memory (grants reset on restart)'}`,
      )
    } else {
      console.log(`MCP endpoint: http://${shownHost}:${port}/mcp`)
    }
    console.log(`Health check: http://${shownHost}:${port}/health`)
  }

  if (config.host !== undefined) {
    httpServer.listen(port, config.host, onListening)
  } else {
    httpServer.listen(port, onListening)
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
