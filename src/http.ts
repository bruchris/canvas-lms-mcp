import { createServer } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createCanvasMCPServer } from './server'
import { parseArgs } from './cli'

const PRIVATE_IP_RANGES = [
  /^127\./,               // loopback
  /^10\./,                // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./,          // 192.168.0.0/16
  /^169\.254\./,          // link-local
  /^0\./,                 // current network
]

function isPrivateHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '::1' || hostname === '[::1]') return true
  return PRIVATE_IP_RANGES.some((re) => re.test(hostname))
}

function isValidCanvasUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
    if (!isDev && url.protocol !== 'https:') return false
    if (isDev && url.protocol !== 'https:' && url.protocol !== 'http:') return false
    if (isPrivateHost(url.hostname)) return false
    return true
  } catch {
    return false
  }
}

export function createHttpHandler(defaultConfig: { token?: string; baseUrl?: string; allowedOrigin?: string }) {
  return async (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) => {
    // CORS headers on all responses
    res.setHeader('Access-Control-Allow-Origin', defaultConfig.allowedOrigin ?? 'http://localhost:3000')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, X-Canvas-Token, X-Canvas-Base-URL, Mcp-Session-Id, Mcp-Protocol-Version',
    )
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Mcp-Session-Id, Mcp-Protocol-Version',
    )

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

    // Extract per-request Canvas credentials from headers
    const token = (req.headers['x-canvas-token'] as string) ?? defaultConfig.token
    const baseUrl = (req.headers['x-canvas-base-url'] as string) ?? defaultConfig.baseUrl

    if (!token || !baseUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          error:
            'Missing Canvas credentials. Provide X-Canvas-Token and X-Canvas-Base-URL headers.',
        }),
      )
      return
    }

    // Validate base URL to prevent SSRF
    if (!isValidCanvasUrl(baseUrl)) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          error: 'Invalid X-Canvas-Base-URL: must be a valid HTTP or HTTPS URL.',
        }),
      )
      return
    }

    // Fresh MCP server per request (per-request credentials)
    const { server } = createCanvasMCPServer({ token, baseUrl })

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

  const httpServer = createServer(createHttpHandler({ token: config.token, baseUrl: config.baseUrl, allowedOrigin: config.allowedOrigin }))

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
