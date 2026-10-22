#!/usr/bin/env node
// stdio transport entry point — for Claude Desktop, Cursor, VS Code, etc.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createCanvasMCPServer } from './server'
import { parseArgs } from './cli'
import { CREDENTIALLESS_STDIO_WARNING, canvasCredentialGate } from './auth/credential-gate'

async function main() {
  const config = parseArgs(process.argv.slice(2))

  // Credentialless discovery (GH #442, BRU-3043). One line, once, on
  // stderr: stdout is the MCP protocol channel on this transport, so a
  // single stray byte there breaks the session for every client.
  const gated = config.credentials === 'absent'
  if (gated) console.error(CREDENTIALLESS_STDIO_WARNING)

  const { server } = createCanvasMCPServer({
    token: config.token,
    baseUrl: config.baseUrl,
    role: config.role,
    enableAssignmentSubmission: config.enableAssignmentSubmission,
    destructiveTools: config.destructiveTools,
    toolsets: config.toolsets,
    readOnly: config.readOnly,
    // One process, one user, one token: the pseudonym map belongs to the same
    // person who can read the roster anyway, so reverse lookup stays available
    // here. Stated explicitly because the factory refuses to guess (BRU-2515).
    sharedAcrossCallers: false,
    // Spread, not a boolean field: a configured server is byte-for-byte
    // what it always was, with no gate object in its config at all.
    ...(gated ? { toolCallGate: canvasCredentialGate() } : {}),
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
