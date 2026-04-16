# Integration Guide

Three patterns for integrating the Canvas LMS MCP server into your application.

## Pattern 1: stdio Transport (Local AI Client)

The simplest integration. The MCP server runs as a child process and communicates over stdin/stdout. This is the pattern used by Claude Desktop, Cursor, and VS Code.

### How It Works

```
AI Client  <--stdin/stdout-->  canvas-lms-mcp process
```

The AI client spawns `canvas-lms-mcp` as a subprocess. The MCP protocol messages flow over stdio. No network exposure, no ports, no CORS.

### Configuration

```json
{
  "mcpServers": {
    "canvas-lms": {
      "command": "npx",
      "args": ["-y", "@bruchris/canvas-lms-mcp"],
      "env": {
        "CANVAS_API_TOKEN": "token",
        "CANVAS_BASE_URL": "https://school.instructure.com"
      }
    }
  }
}
```

### When to Use

- Desktop AI clients (Claude Desktop, Cursor, VS Code)
- Single-user local setups
- Development and testing
- Maximum simplicity -- no server management

### Limitations

- One process per user (no shared server)
- Credentials baked into config (no multi-tenant)
- Only works with clients that support MCP stdio transport

## Pattern 2: HTTP Transport (Multi-Tenant Service)

Run the server as an HTTP service. Each request carries its own Canvas credentials via headers, enabling multi-user deployments.

### How It Works

```
Client A  --POST /mcp-->  canvas-lms-mcp HTTP server  --REST-->  Canvas API
Client B  --POST /mcp-->       (port 3001)            --REST-->  Canvas API
```

Each `POST /mcp` request creates a fresh MCP server instance with the credentials from that request's headers. No state is shared between requests.

### Running the Server

```bash
# CLI
npx @bruchris/canvas-lms-mcp serve \
  --port 3001 \
  --allowed-origin https://your-app.example.com

# Docker
docker compose up -d

# Docker with custom config
docker run -p 3001:3001 \
  -e CANVAS_API_TOKEN=fallback-token \
  -e CANVAS_BASE_URL=https://school.instructure.com \
  canvas-lms-mcp
```

### Client Request

```typescript
const response = await fetch('http://localhost:3001/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Canvas-Token': userToken,
    'X-Canvas-Base-URL': 'https://school.instructure.com',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'list_courses',
      arguments: { enrollment_state: 'active' },
    },
    id: 1,
  }),
})
```

### Per-Request vs Default Credentials

The HTTP handler supports two credential modes:

1. **Per-request headers**: `X-Canvas-Token` and `X-Canvas-Base-URL` override defaults
2. **Default config**: Falls back to `--token` and `--base-url` CLI args or env vars

If neither is provided, the server returns `400 Missing Canvas credentials`.

### Security

- **CORS**: Configured via `--allowed-origin` (default: `http://localhost:3000`). Set to your application's domain in production.
- **SSRF protection**: The server validates `X-Canvas-Base-URL` -- rejects private IPs (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, localhost) and requires HTTPS in production (`NODE_ENV !== development`).
- **No session state**: Each request is stateless. No tokens are stored server-side.

### Health Check

```bash
curl http://localhost:3001/health
# {"status":"ok"}
```

### When to Use

- Web applications with multiple users
- Hosted services (ChatGPT plugins, custom AI clients)
- Docker/Kubernetes deployments
- Multi-tenant setups where each user provides their own Canvas token

## Pattern 3: Library Import (Embedded Server)

Import the server factory or the standalone Canvas client directly into your Node.js application. No subprocess, no HTTP -- just function calls.

### MCP Server Factory

Create an MCP server instance and connect it to your own transport:

```typescript
import { createCanvasMCPServer } from '@bruchris/canvas-lms-mcp'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const { server, canvas } = createCanvasMCPServer({
  token: process.env.CANVAS_API_TOKEN!,
  baseUrl: process.env.CANVAS_BASE_URL!,
})

// Connect to any MCP transport
const transport = new StdioServerTransport()
await server.connect(transport)
```

The `server` is a standard `McpServer` instance with all 42 tools and 2 resources registered. The `canvas` is the underlying `CanvasClient` instance if you need direct API access.

### Standalone Canvas Client

Use the Canvas client without MCP for direct API access:

```typescript
import { CanvasClient } from '@bruchris/canvas-lms-mcp/canvas'

const canvas = new CanvasClient({
  token: process.env.CANVAS_API_TOKEN!,
  baseUrl: process.env.CANVAS_BASE_URL!,
})

// Typed, paginated API calls
const courses = await canvas.courses.list()
const assignment = await canvas.assignments.get(courseId, assignmentId)
const submissions = await canvas.submissions.list(courseId, assignmentId)

// Write operations
await canvas.submissions.grade(courseId, assignmentId, userId, 'A')
await canvas.submissions.comment(courseId, assignmentId, userId, 'Great work!')
```

### Available Canvas Client Modules

The `CanvasClient` facade exposes 14 domain modules:

| Module | Methods |
|--------|---------|
| `canvas.courses` | `list()`, `get(id)`, `getSyllabus(id)` |
| `canvas.assignments` | `list(courseId)`, `get(courseId, id)`, `listGroups(courseId)` |
| `canvas.submissions` | `list(courseId, assignmentId)`, `get(courseId, assignmentId, userId)`, `grade(...)`, `comment(...)` |
| `canvas.rubrics` | `list(courseId)`, `get(courseId, id)`, `getAssessment(...)`, `submitAssessment(...)` |
| `canvas.quizzes` | `list(courseId)`, `get(courseId, id)`, `listSubmissions(...)`, `listQuestions(...)`, `getSubmissionAnswers(id)`, `scoreQuestion(...)` |
| `canvas.files` | `listFiles(courseId)`, `listFolders(courseId)`, `get(courseId, id)` |
| `canvas.users` | `listStudents(courseId)`, `get(id)`, `getProfile()` |
| `canvas.groups` | `list(courseId)`, `listMembers(groupId)` |
| `canvas.enrollments` | `list()` |
| `canvas.discussions` | `list(courseId)`, `get(courseId, id)`, `listAnnouncements(courseId)`, `postEntry(...)` |
| `canvas.modules` | `list(courseId)`, `get(courseId, id)`, `listItems(courseId, moduleId)` |
| `canvas.pages` | `list(courseId)`, `get(courseId, pageUrl)` |
| `canvas.calendar` | `listEvents(courseId)` |
| `canvas.conversations` | `list()`, `send(recipients, subject, body)` |

### Error Handling

All Canvas client methods throw `CanvasApiError` on failure:

```typescript
import { CanvasApiError } from '@bruchris/canvas-lms-mcp/canvas'

try {
  const course = await canvas.courses.get(99999)
} catch (error) {
  if (error instanceof CanvasApiError) {
    console.log(error.status)    // 404
    console.log(error.endpoint)  // /api/v1/courses/99999
    console.log(error.message)   // Not Found
  }
}
```

### When to Use

- Building a custom MCP transport or proxy
- Embedding Canvas access in an existing Node.js service
- Creating batch scripts (e.g., export all grades for a course)
- Testing and development
- When you need the Canvas client without MCP overhead
