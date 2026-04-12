# Canvas LMS MCP Server

[![CI](https://github.com/bruchris/canvas-lms-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/bruchris/canvas-lms-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for Canvas LMS. Read courses, assignments, submissions, rubrics, quizzes; grade and comment from any AI agent.

```bash
npx canvas-lms-mcp --token $CANVAS_API_TOKEN --base-url https://institution.instructure.com
```

## Status

**Under development.** See [design spec](docs/superpowers/specs/2026-04-12-canvas-lms-mcp-design.md) and [implementation plan](docs/superpowers/plans/2026-04-12-canvas-lms-mcp.md) for details.

## Features (planned)

- **41 MCP tools** across 15 Canvas domains (33 read, 8 write)
- **3 deployment modes**: stdio (CLI), HTTP/SSE (remote), npm library import
- **Selective writes**: grading, commenting, quiz scoring, discussion posting, messaging
- **Standalone Canvas client**: importable via `canvas-lms-mcp/canvas` without MCP overhead
- **Tool annotations**: `readOnlyHint`, `destructiveHint` for AI client safety decisions

## Quick Start

### Claude Desktop

```json
{
  "mcpServers": {
    "canvas-lms": {
      "command": "npx",
      "args": ["canvas-lms-mcp"],
      "env": {
        "CANVAS_API_TOKEN": "your-token",
        "CANVAS_BASE_URL": "https://institution.instructure.com"
      }
    }
  }
}
```

### HTTP Server

```bash
canvas-lms-mcp serve --port 3001
```

### Library Import

```typescript
import { createCanvasMCPServer } from 'canvas-lms-mcp'

const server = createCanvasMCPServer({
  token: userToken,
  baseUrl: canvasBaseUrl,
})
```

## Development

```bash
pnpm install       # Install dependencies
pnpm dev           # Watch mode build
pnpm build         # Production build
pnpm test          # Run tests
pnpm lint          # Lint check
pnpm typecheck     # Type check
```

## Architecture

Three layers:

- `src/canvas/` — Standalone Canvas API client (no MCP dependency)
- `src/tools/` — MCP tool definitions with Zod schemas
- `src/server.ts` — `createCanvasMCPServer()` factory wiring tools + resources

See [AGENTS.md](AGENTS.md) for the full tool inventory and contributor guide.

## License

MIT
