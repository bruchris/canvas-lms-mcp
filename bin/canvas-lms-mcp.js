#!/usr/bin/env node

const sub = process.argv[2]

// Handled before any import so help works without Canvas credentials and never
// starts the stdio or HTTP transport.
const USAGE = `Usage: canvas-lms-mcp [command] [options]

Canvas LMS MCP server. With no command, starts the stdio transport.

Commands:
  (none)              Start the stdio MCP server (Claude Desktop, Cursor, VS Code)
  serve               Start the HTTP MCP server (--port <n>, default 3001; --host <addr>)
  init                Configure MCP clients (run \`canvas-lms-mcp init --help\` for options)
  doctor              Check setup without starting the server
  auth status         Same as doctor

Credentials (serve needs them at startup; stdio starts without them so MCP
directories can read its tool list, but then every tool call fails):
  --token <t>         Canvas API token (or CANVAS_API_TOKEN)
  --base-url <u>      Canvas base URL, origin only (or CANVAS_BASE_URL)

Tool surface (all opt-in; with none set, every tool and prompt is registered):
  --toolsets <list>   Comma-separated Canvas areas (or CANVAS_TOOLSETS):
                      core, grading, quizzes, people, communication,
                      outcomes, course_ops, account, student. "all" = no filter
  --read-only         Register only read-only tools (or CANVAS_READ_ONLY)
  --role <r>          student | teacher | admin (or CANVAS_ROLE)
  --destructive-tools=<mode>
                      allow (default) or block (or CANVAS_DESTRUCTIVE_TOOLS)

Options:
  -h, --help          Show this help and exit
`

if (sub === '--help' || sub === '-h') {
  console.log(USAGE)
} else if (sub === 'init') {
  await import('../dist/init.js')
} else if (sub === 'serve') {
  await import('../dist/http.js')
} else if (sub === 'doctor' || (sub === 'auth' && process.argv[3] === 'status')) {
  await import('../dist/doctor.js')
} else {
  await import('../dist/stdio.js')
}
