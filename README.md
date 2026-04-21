# Canvas LMS MCP Server

> The TypeScript MCP server for Canvas LMS.

[![CI](https://github.com/bruchris/canvas-lms-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/bruchris/canvas-lms-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/canvas-lms-mcp)](https://www.npmjs.com/package/canvas-lms-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![npm downloads](https://img.shields.io/npm/dw/canvas-lms-mcp)](https://www.npmjs.com/package/canvas-lms-mcp)

MCP server for [Canvas LMS](https://www.instructure.com/canvas). Read courses, assignments, submissions, rubrics, quizzes; grade, comment, manage course content, and handle Canvas admin workflows from any AI agent.

100 tools across Canvas courses, assignments, submissions, rubrics, quizzes, files, users, groups, enrollments, discussions, modules, pages, calendar, conversations, peer reviews, accounts, analytics, outcomes, student workflows, dashboard, and health checks. Three deployment modes: stdio, HTTP, and library import.

## Comparison

| | canvas-lms-mcp | [vishalsachdev/canvas-mcp](https://github.com/vishalsachdev/canvas-mcp) | [DMontgomery40/mcp-canvas-lms](https://github.com/DMontgomery40/mcp-canvas-lms) |
|---|---|---|---|
| Language | TypeScript | Python | TypeScript |
| Tools | 88 | 80+ | 54 |
| License | [![License: MIT](https://img.shields.io/github/license/bruchris/canvas-lms-mcp)](https://github.com/bruchris/canvas-lms-mcp/blob/main/LICENSE) | [![License](https://img.shields.io/github/license/vishalsachdev/canvas-mcp)](https://github.com/vishalsachdev/canvas-mcp/blob/main/LICENSE) | [![License](https://img.shields.io/github/license/DMontgomery40/mcp-canvas-lms)](https://github.com/DMontgomery40/mcp-canvas-lms/blob/main/LICENSE) |
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
npx add-mcp canvas-lms-mcp
```

This auto-detects your installed AI clients (Claude Code, Cursor, VS Code, etc.) and configures them. You will be prompted for your Canvas API token and base URL.

### Client-Specific Commands

**Claude Code**

```bash
claude mcp add canvas-lms --env CANVAS_API_TOKEN=your-token --env CANVAS_BASE_URL=https://school.instructure.com -- npx -y canvas-lms-mcp
```

**VS Code**

```bash
code --add-mcp '{"name":"canvas-lms","command":"npx","args":["-y","canvas-lms-mcp"],"env":{"CANVAS_API_TOKEN":"your-token","CANVAS_BASE_URL":"https://school.instructure.com"}}'
```

**Gemini CLI**

```bash
gemini mcp add canvas-lms npx canvas-lms-mcp
```

**Codex CLI**

```bash
codex mcp add canvas-lms -- npx canvas-lms-mcp
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
      "args": ["-y", "canvas-lms-mcp"],
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
      "args": ["-y", "canvas-lms-mcp"],
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
      "args": ["-y", "canvas-lms-mcp"],
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
      "args": ["-y", "canvas-lms-mcp"],
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
npx canvas-lms-mcp serve --port 3001 \
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

### All Registered Tools (100)

| Category | Tools |
|----------|-------|
| Health | `health_check` |
| Courses | `list_courses`, `get_course`, `get_syllabus`, `create_course`, `update_course` |
| Assignments | `list_assignments`, `get_assignment`, `list_assignment_groups`, `create_assignment`, `update_assignment`, `delete_assignment` |
| Submissions | `list_submissions`, `get_submission`, `grade_submission`, `comment_on_submission` |
| Rubrics | `list_rubrics`, `get_rubric`, `get_rubric_assessment`, `submit_rubric_assessment` |
| Quizzes | `list_quizzes`, `get_quiz`, `list_quiz_submissions`, `list_quiz_questions`, `get_quiz_submission_answers`, `score_quiz_question` |
| Files | `list_files`, `list_folders`, `get_file`, `upload_file`, `delete_file` |
| Users | `list_students`, `get_user`, `get_profile`, `search_users`, `list_course_users` |
| Groups | `list_groups`, `list_group_members` |
| Enrollments | `list_enrollments`, `enroll_user`, `remove_enrollment` |
| Discussions | `list_discussions`, `get_discussion`, `list_announcements`, `post_discussion_entry`, `create_discussion`, `update_discussion`, `delete_discussion` |
| Modules | `list_modules`, `get_module`, `list_module_items`, `create_module`, `update_module`, `create_module_item` |
| Pages | `list_pages`, `get_page`, `create_page`, `update_page`, `delete_page` |
| Calendar | `list_calendar_events`, `create_calendar_event`, `update_calendar_event` |
| Conversations | `list_conversations`, `get_conversation`, `get_conversation_unread_count`, `send_conversation` |
| Peer Reviews | `list_peer_reviews`, `get_submission_peer_reviews`, `create_peer_review`, `delete_peer_review` |
| Accounts | `get_account`, `list_accounts`, `list_sub_accounts`, `list_account_courses`, `list_account_users`, `get_account_reports` |
| Analytics | `search_course_content`, `get_course_analytics`, `get_student_analytics`, `get_course_activity_stream` |
| Outcomes | `get_root_outcome_group`, `list_outcome_groups`, `list_outcome_group_links`, `get_outcome_group`, `list_outcome_group_outcomes`, `list_outcome_group_subgroups`, `get_outcome`, `get_outcome_alignments`, `get_outcome_results`, `get_outcome_rollups`, `get_outcome_contributing_scores`, `get_outcome_mastery_distribution` |
| Student | `get_my_courses`, `get_my_grades`, `get_my_submissions`, `get_my_upcoming_assignments` |
| Dashboard | `get_dashboard_cards`, `get_todo_items`, `get_upcoming_events`, `get_missing_submissions` |

72 tools are read-only and 28 tools perform Canvas write operations.

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
npx canvas-lms-mcp --token $CANVAS_API_TOKEN --base-url $CANVAS_BASE_URL
```

### HTTP

For web-based clients or hosted services. Starts an HTTP server with Streamable HTTP transport.

```bash
npx canvas-lms-mcp serve \
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
import { createCanvasMCPServer } from 'canvas-lms-mcp'

const { server, canvas } = createCanvasMCPServer({
  token: userToken,
  baseUrl: canvasBaseUrl,
})
```

Or use the Canvas client standalone (no MCP dependency):

```typescript
import { CanvasClient } from 'canvas-lms-mcp/canvas'

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

### Dependency audit

The `pnpm.overrides.hono` entry pins `hono` to `4.12.14` because
`@modelcontextprotocol/sdk@1.29.0` allows vulnerable `hono <4.12.14`
versions. Remove the override when the MCP SDK publishes a release that
depends on a patched `hono` range.

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

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full contribution and validation workflow.

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Use conventional commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`)
4. Ensure `pnpm lint && pnpm typecheck && pnpm test` pass
5. Open a pull request

## Guides

- [Getting Started](docs/getting-started.md) -- Step-by-step setup for non-developers: token, config, first query, troubleshooting
- [Student Guide](docs/student-guide.md) -- Token setup, AI client configuration, 10 example prompts
- [Educator Guide](docs/educator-guide.md) -- Grading workflows, write operations, privacy considerations
- [Integration Guide](docs/integration-guide.md) -- Three integration patterns with code examples
- [Agent Discovery](docs/agent-discovery.md) -- Generated tool/workflow manifests and workflow-pack index
- [Educator Assignment Review Workflow](docs/workflows/educator-assignment-review.md) -- Read-first grading flow with write-safety guidance
- [Student Weekly Planning Workflow](docs/workflows/student-weekly-planning.md) -- Read-only weekly planning sequence for students

## License

MIT
