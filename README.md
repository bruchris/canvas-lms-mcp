# Canvas LMS MCP Server

> The TypeScript MCP server for Canvas LMS.

[![CI](https://github.com/bruchris/canvas-lms-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/bruchris/canvas-lms-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40bruchris%2Fcanvas-lms-mcp)](https://www.npmjs.com/package/@bruchris/canvas-lms-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![npm downloads](https://img.shields.io/npm/dw/@bruchris/canvas-lms-mcp)](https://www.npmjs.com/package/@bruchris/canvas-lms-mcp)

MCP server for [Canvas LMS](https://www.instructure.com/canvas). Read courses, assignments, submissions, rubrics, quizzes; grade and comment from any AI agent.

42 tools across 15 Canvas domains. Three deployment modes: stdio, HTTP, and library import.

## Comparison

| | @bruchris/canvas-lms-mcp | [vishalsachdev/canvas-mcp](https://github.com/vishalsachdev/canvas-mcp) | [DMontgomery40/mcp-canvas-lms](https://github.com/DMontgomery40/mcp-canvas-lms) |
|---|---|---|---|
| Language | TypeScript | Python | TypeScript |
| Tools | 42 | 80+ | 54 |
| License | MIT | [![License](https://img.shields.io/github/license/vishalsachdev/canvas-mcp)](https://github.com/vishalsachdev/canvas-mcp/blob/main/LICENSE) | [![License](https://img.shields.io/github/license/DMontgomery40/mcp-canvas-lms)](https://github.com/DMontgomery40/mcp-canvas-lms/blob/main/LICENSE) |
| Last commit | [![Last commit](https://img.shields.io/github/last-commit/bruchris/canvas-lms-mcp)](https://github.com/bruchris/canvas-lms-mcp) | [![Last commit](https://img.shields.io/github/last-commit/vishalsachdev/canvas-mcp)](https://github.com/vishalsachdev/canvas-mcp) | [![Last commit](https://img.shields.io/github/last-commit/DMontgomery40/mcp-canvas-lms)](https://github.com/DMontgomery40/mcp-canvas-lms) |

## Quick Start

### 1. Get a Canvas API Token

1. Log in to your Canvas instance
2. Go to **Account > Settings**
3. Scroll to **Approved Integrations** and click **+ New Access Token**
4. Give it a name (e.g., "MCP Server") and click **Generate Token**
5. Copy the token immediately -- you won't see it again

### 2. One Command Setup

```bash
npx add-mcp @bruchris/canvas-lms-mcp
```

This auto-detects your installed AI clients (Claude Code, Cursor, VS Code, etc.) and configures them. You will be prompted for your Canvas API token and base URL.

### Client-Specific Commands

**Claude Code**

```bash
claude mcp add canvas-lms --env CANVAS_API_TOKEN=your-token --env CANVAS_BASE_URL=https://school.instructure.com -- npx -y @bruchris/canvas-lms-mcp
```

**VS Code**

```bash
code --add-mcp '{"name":"canvas-lms","command":"npx","args":["-y","@bruchris/canvas-lms-mcp"],"env":{"CANVAS_API_TOKEN":"your-token","CANVAS_BASE_URL":"https://school.instructure.com"}}'
```

**Gemini CLI**

```bash
gemini mcp add canvas-lms npx @bruchris/canvas-lms-mcp
```

**Codex CLI**

```bash
codex mcp add canvas-lms -- npx @bruchris/canvas-lms-mcp
```

<details>
<summary>Manual Configuration</summary>

#### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "canvas-lms": {
      "command": "npx",
      "args": ["-y", "@bruchris/canvas-lms-mcp"],
      "env": {
        "CANVAS_API_TOKEN": "your-token-here",
        "CANVAS_BASE_URL": "https://your-institution.instructure.com"
      }
    }
  }
}
```

#### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "canvas-lms": {
      "command": "npx",
      "args": ["-y", "@bruchris/canvas-lms-mcp"],
      "env": {
        "CANVAS_API_TOKEN": "your-token-here",
        "CANVAS_BASE_URL": "https://your-institution.instructure.com"
      }
    }
  }
}
```

#### VS Code

Add to your VS Code settings (`settings.json`):

```json
{
  "mcp.servers": {
    "canvas-lms": {
      "command": "npx",
      "args": ["-y", "@bruchris/canvas-lms-mcp"],
      "env": {
        "CANVAS_API_TOKEN": "your-token-here",
        "CANVAS_BASE_URL": "https://your-institution.instructure.com"
      }
    }
  }
}
```

#### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "canvas-lms": {
      "command": "npx",
      "args": ["-y", "@bruchris/canvas-lms-mcp"],
      "env": {
        "CANVAS_API_TOKEN": "your-token-here",
        "CANVAS_BASE_URL": "https://your-institution.instructure.com"
      }
    }
  }
}
```

#### ChatGPT / HTTP Clients

Run the server in HTTP mode, then point your client at the endpoint:

```bash
npx @bruchris/canvas-lms-mcp serve --port 3001 \
  --token your-token-here \
  --base-url https://your-institution.instructure.com
```

The MCP endpoint is `http://localhost:3001/mcp`. Per-request credentials can be passed via `X-Canvas-Token` and `X-Canvas-Base-URL` headers.

</details>

## Example Prompts

Once configured, try these prompts with your AI client:

- "List all my active courses"
- "Show me the assignments for course 12345"
- "What's the average grade on the midterm exam?"
- "Grade Alice's essay submission with a B+ and add feedback"
- "Show me the rubric for the final project"
- "What discussions are happening in my Biology course?"
- "List all upcoming calendar events for course 12345"
- "Send a message to student 67890 about their missing assignment"

## Tool Inventory

### Read-Only Tools (36)

| Category | Tool | Description |
|----------|------|-------------|
| Health | `health_check` | Check if the Canvas API is reachable and token is valid |
| Courses | `list_courses` | List courses (optionally filter by enrollment state) |
| Courses | `get_course` | Get course details including term and student count |
| Courses | `get_syllabus` | Get the syllabus HTML for a course |
| Assignments | `list_assignments` | List all assignments in a course |
| Assignments | `get_assignment` | Get details for a single assignment |
| Assignments | `list_assignment_groups` | List assignment groups (Homework, Exams, etc.) |
| Submissions | `list_submissions` | List all submissions for an assignment |
| Submissions | `get_submission` | Get a specific student's submission with comments |
| Rubrics | `list_rubrics` | List all rubrics in a course |
| Rubrics | `get_rubric` | Get rubric details including criteria |
| Rubrics | `get_rubric_assessment` | Get rubric assessment for a student submission |
| Quizzes | `list_quizzes` | List all quizzes in a course |
| Quizzes | `get_quiz` | Get details for a single quiz |
| Quizzes | `list_quiz_submissions` | List all submissions for a quiz |
| Quizzes | `list_quiz_questions` | List all questions in a quiz |
| Quizzes | `get_quiz_submission_answers` | Get a student's quiz answers |
| Files | `list_files` | List all files in a course |
| Files | `list_folders` | List all folders in a course |
| Files | `get_file` | Get file metadata including download URL |
| Users | `list_students` | List all students enrolled in a course |
| Users | `get_user` | Get details for a single user |
| Users | `get_profile` | Get the authenticated user's profile |
| Groups | `list_groups` | List all groups in a course |
| Groups | `list_group_members` | List all members of a group |
| Enrollments | `list_enrollments` | List enrollments for the authenticated user |
| Discussions | `list_discussions` | List all discussion topics in a course |
| Discussions | `get_discussion` | Get details for a discussion topic |
| Discussions | `list_announcements` | List all announcements in a course |
| Modules | `list_modules` | List all modules in a course |
| Modules | `get_module` | Get details for a single module |
| Modules | `list_module_items` | List all items within a module |
| Pages | `list_pages` | List all wiki pages in a course |
| Pages | `get_page` | Get a wiki page by its URL slug |
| Calendar | `list_calendar_events` | List calendar events for a course |
| Conversations | `list_conversations` | List inbox messages for the authenticated user |

### Write Tools (6)

| Tool | Description | Idempotent |
|------|-------------|------------|
| `grade_submission` | Post or update a grade for a submission | Yes |
| `comment_on_submission` | Add a text comment to a submission | No |
| `submit_rubric_assessment` | Submit rubric scores and comments per criterion | Yes |
| `score_quiz_question` | Score a specific quiz question | Yes |
| `post_discussion_entry` | Post a reply to a discussion topic | No |
| `send_conversation` | Send a message to one or more recipients | No |

All write tools require appropriate Canvas permissions. Canvas enforces its own permission model -- the MCP server does not bypass it.

### MCP Resources (2)

| Resource | URI Template | Type |
|----------|-------------|------|
| Course Syllabus | `canvas://course/{courseId}/syllabus` | text/html |
| Assignment Description | `canvas://course/{courseId}/assignment/{assignmentId}/description` | text/html |

## Deployment Modes

### stdio (Default)

For local AI clients like Claude Desktop, Cursor, and VS Code. The server communicates over stdin/stdout.

```bash
npx @bruchris/canvas-lms-mcp --token $CANVAS_API_TOKEN --base-url $CANVAS_BASE_URL
```

### HTTP

For web-based clients or hosted services. Starts an HTTP server with Streamable HTTP transport.

```bash
npx @bruchris/canvas-lms-mcp serve \
  --token $CANVAS_API_TOKEN \
  --base-url $CANVAS_BASE_URL \
  --port 3001 \
  --allowed-origin https://your-app.example.com
```

Endpoints:
- `POST /mcp` -- MCP protocol endpoint
- `GET /health` -- Health check (returns `{"status":"ok"}`)

### Docker

```bash
docker compose up -d
```

Requires `CANVAS_API_TOKEN` and `CANVAS_BASE_URL` environment variables. See `docker-compose.yml`.

```yaml
services:
  canvas-lms-mcp:
    build: .
    ports:
      - "3001:3001"
    environment:
      - CANVAS_API_TOKEN=${CANVAS_API_TOKEN}
      - CANVAS_BASE_URL=${CANVAS_BASE_URL}
```

### Library Import

Use the server factory directly in your own Node.js application:

```typescript
import { createCanvasMCPServer } from '@bruchris/canvas-lms-mcp'

const { server, canvas } = createCanvasMCPServer({
  token: userToken,
  baseUrl: canvasBaseUrl,
})
```

Or use the Canvas client standalone (no MCP dependency):

```typescript
import { CanvasClient } from '@bruchris/canvas-lms-mcp/canvas'

const canvas = new CanvasClient({
  token: userToken,
  baseUrl: canvasBaseUrl,
})

const courses = await canvas.courses.list()
```

## CLI Reference

| Flag | Env Variable | Default | Description |
|------|-------------|---------|-------------|
| `--token` | `CANVAS_API_TOKEN` | (required) | Canvas personal access token |
| `--base-url` | `CANVAS_BASE_URL` | (required) | Canvas instance URL |
| `serve` | -- | stdio mode | Switch to HTTP mode |
| `--port` | -- | `3001` | HTTP server port |
| `--allowed-origin` | `CANVAS_ALLOWED_ORIGIN` | `http://localhost:3000` | CORS allowed origin |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CANVAS_API_TOKEN` | Yes | Canvas personal access token |
| `CANVAS_BASE_URL` | Yes | Canvas instance URL (e.g., `https://school.instructure.com`) |
| `CANVAS_ALLOWED_ORIGIN` | No | CORS origin for HTTP mode (default: `http://localhost:3000`) |


## Development

```bash
pnpm install       # Install dependencies
pnpm dev           # Watch mode build
pnpm build         # Production build
pnpm test          # Run tests (294 tests)
pnpm lint          # ESLint + Prettier check
pnpm lint:fix      # Auto-fix lint issues
pnpm typecheck     # TypeScript strict type check
```

### Architecture

```
src/canvas/       Standalone Canvas REST API client (pure fetch, no MCP dependency)
src/tools/        MCP tool definitions with Zod input schemas
src/resources/    MCP resource templates (syllabus, assignment description)
src/server.ts     Factory: createCanvasMCPServer(config)
src/stdio.ts      stdio transport entry point
src/http.ts       HTTP transport entry point
src/cli.ts        CLI argument parser
```

### Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Use conventional commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`)
4. Ensure `pnpm lint && pnpm typecheck && pnpm test` pass
5. Open a pull request

## Guides

- [Student Guide](docs/student-guide.md) -- Token setup, AI client configuration, 10 example prompts
- [Educator Guide](docs/educator-guide.md) -- Grading workflows, write operations, privacy considerations
- [Integration Guide](docs/integration-guide.md) -- Three integration patterns with code examples

## License

MIT
