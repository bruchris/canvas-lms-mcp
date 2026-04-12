// stdio transport entry point — for Claude Desktop, Cursor, VS Code, etc.
// See implementation plan Task 13 for full implementation.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createCanvasMCPServer } from './server'
import { parseArgs } from './cli'

async function main() {
  const config = parseArgs(process.argv.slice(2))
  const { server } = createCanvasMCPServer({
    token: config.token,
    baseUrl: config.baseUrl,
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
