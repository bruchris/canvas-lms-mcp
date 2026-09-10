#!/usr/bin/env node
// stdio transport entry point — for Claude Desktop, Cursor, VS Code, etc.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createCanvasMCPServer } from './server'
import { parseArgs } from './cli'

async function main() {
  const config = parseArgs(process.argv.slice(2))
  const { server } = createCanvasMCPServer({
    token: config.token,
    baseUrl: config.baseUrl,
    role: config.role,
    enableAssignmentSubmission: config.enableAssignmentSubmission,
    destructiveTools: config.destructiveTools,
    // One process, one user, one token: the pseudonym map belongs to the same
    // person who can read the roster anyway, so reverse lookup stays available
    // here. Stated explicitly because the factory refuses to guess (BRU-2515).
    sharedAcrossCallers: false,
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
