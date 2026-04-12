import { createServer } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createCanvasMCPServer } from './server'
import { parseArgs } from './cli'

async function main() {
  const config = parseArgs(process.argv.slice(2))
  const port = config.port

  const httpServer = createServer(async (req, res) => {
    // CORS headers on all responses
    res.setHeader('Access-Control-Allow-Origin', '*')
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
    const token = (req.headers['x-canvas-token'] as string) ?? config.token
    const baseUrl = (req.headers['x-canvas-base-url'] as string) ?? config.baseUrl

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

    // Fresh MCP server per request (per-request credentials)
    const { server } = createCanvasMCPServer({ token, baseUrl })

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      })
      await server.connect(transport)
      await transport.handleRequest(req, res)
      res.on('close', () => {
        transport.close()
        server.close()
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
  })

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
