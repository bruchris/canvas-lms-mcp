import { createServer } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { Pseudonymizer } from './pseudonym/pseudonymizer'
import { createCanvasMCPServer } from './server'
import { parseArgs } from './cli'
import { isEnvTruthy } from './env'
import { parseRole } from './tools/roles'
import type { DestructiveToolsMode } from './tools/destructive-policy'
import type { CanvasRole } from './tools/types'

export function createHttpHandler(defaultConfig: {
  token?: string
  baseUrl?: string
  allowedOrigin?: string
  role?: CanvasRole
  enableAssignmentSubmission?: boolean
  destructiveTools?: DestructiveToolsMode
}) {
  // Process-wide pseudonymizer keyed on the configured base URL. Pseudonyms
  // are stable across requests because every fresh MCP server reuses this
  // instance and its on-disk map.
  //
  // `sharedAcrossCallers: true` is the security-relevant part (BRU-2511). This
  // one instance serves every caller regardless of the `X-Canvas-Token` they
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
  const pseudonymizer = defaultConfig.baseUrl
    ? new Pseudonymizer({ baseUrl: defaultConfig.baseUrl, sharedAcrossCallers: true })
    : undefined

  if (pseudonymizer?.isEnabled() && isEnvTruthy(process.env.CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP)) {
    console.warn(
      'CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP is set, but resolve_pseudonym is not registered on the ' +
        'HTTP transport: one pseudonym map is shared by every caller, so reverse lookup would let ' +
        'an unrelated token resolve a student it was never shown. Run the stdio transport if you need it.',
    )
  }

  return async (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) => {
    // CORS headers on all responses
    res.setHeader(
      'Access-Control-Allow-Origin',
      defaultConfig.allowedOrigin ?? 'http://localhost:3000',
    )
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, X-Canvas-Token, X-Canvas-Role, Mcp-Protocol-Version',
    )
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Protocol-Version')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // Health check endpoint
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }

    // Only handle /mcp path
    if (req.url !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
      return
    }

    // Only POST is supported for stateless MCP
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method not allowed.' },
          id: null,
        }),
      )
      return
    }

    // Per-request token from header; base URL must come from server config (SSRF protection)
    const token = (req.headers['x-canvas-token'] as string) ?? defaultConfig.token
    const baseUrl = defaultConfig.baseUrl

    // Per-request role: X-Canvas-Role header takes precedence over the configured
    // env/CLI role. A valid header (or `all`) overrides; an unrecognised value is
    // ignored with a warning so a misconfigured client can't wipe the server's
    // configured default. The role only narrows which tools are listed — Canvas
    // still enforces real permissions server-side.
    let role = defaultConfig.role
    const roleHeader = req.headers['x-canvas-role']
    const rawRole = Array.isArray(roleHeader) ? roleHeader[0] : roleHeader
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
}

async function main() {
  const config = parseArgs(process.argv.slice(2))
  const port = config.port

  const httpServer = createServer(
    createHttpHandler({
      token: config.token,
      baseUrl: config.baseUrl,
      allowedOrigin: config.allowedOrigin,
      role: config.role,
      enableAssignmentSubmission: config.enableAssignmentSubmission,
      destructiveTools: config.destructiveTools,
    }),
  )

  httpServer.listen(port, () => {
    console.log(`Canvas LMS MCP server listening on http://localhost:${port}`)
    console.log(`MCP endpoint: http://localhost:${port}/mcp`)
    console.log(`Health check: http://localhost:${port}/health`)
  })
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
