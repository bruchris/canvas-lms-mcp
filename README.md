# Canvas LMS MCP Server

> The TypeScript MCP server for Canvas LMS.

[![CI](https://github.com/bruchris/canvas-lms-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/bruchris/canvas-lms-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/canvas-lms-mcp)](https://www.npmjs.com/package/canvas-lms-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![npm downloads](https://img.shields.io/npm/dw/canvas-lms-mcp)](https://www.npmjs.com/package/canvas-lms-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.bruchris%2Fcanvas--lms--mcp-blue)](https://registry.modelcontextprotocol.io/v0/servers/io.github.bruchris%2Fcanvas-lms-mcp)

MCP server for [Canvas LMS](https://www.instructure.com/canvas). Read courses, assignments, submissions, rubrics, quizzes; grade, comment, manage course content, and handle Canvas admin workflows from any AI agent.

118 tools across Canvas courses, assignments, submissions, gradebook history, rubrics, quizzes, New Quizzes (LTI), files, users, groups, enrollments, discussions, modules, pages, calendar, conversations, peer reviews, accounts, analytics, outcomes, student workflows, dashboard, instructor attention workflows, and health checks. Three deployment modes: stdio, HTTP, and library import.

## One-click install (Claude Desktop)

1. **[Download `canvas-lms-mcp.mcpb`](https://github.com/bruchris/canvas-lms-mcp/releases/latest/download/canvas-lms-mcp.mcpb)** from the latest release.
2. Double-click the file (or drag it into Claude Desktop's Extensions settings).
3. When prompted, paste your Canvas API token and Canvas API base URL (e.g. `https://school.instructure.com/api/v1`). Teachers and staff handling student data can also flip **FERPA mode — pseudonymize students** on in the same dialog ([what it does](#ferpa-mode-student-pseudonymization)).

No terminal, no Node.js install, no config-file editing — Claude Desktop bundles the runtime and handles config for you. The same `.mcpb` works in Claude Code and MCP for Windows.

Prefer the terminal? Use the [Quick Start](#quick-start) below.

## Comparison

| | canvas-lms-mcp | [vishalsachdev/canvas-mcp](https://github.com/vishalsachdev/canvas-mcp) | [DMontgomery40/mcp-canvas-lms](https://github.com/DMontgomery40/mcp-canvas-lms) |
|---|---|---|---|
| Language | TypeScript | Python | TypeScript |
| Tools | 118 | 80+ | 54 |
| License | [![License: MIT](https://img.shields.io/github/license/bruchris/canvas-lms-mcp)](https://github.com/bruchris/canvas-lms-mcp/blob/main/LICENSE) | [![License](https://img.shields.io/github/license/vishalsachdev/canvas-mcp)](https://github.com/vishalsachdev/canvas-mcp/blob/main/LICENSE) | [![License](https://img.shields.io/github/license/DMontgomery40/mcp-canvas-lms)](https://github.com/DMontgomery40/mcp-canvas-lms/blob/main/LICENSE) |
| Last commit | [![Last commit](https://img.shields.io/github/last-commit/bruchris/canvas-lms-mcp)](https://github.com/bruchris/canvas-lms-mcp) | [![Last commit](https://img.shields.io/github/last-commit/vishalsachdev/canvas-mcp)](https://github.com/vishalsachdev/canvas-mcp) | [![Last commit](https://img.shields.io/github/last-commit/DMontgomery40/mcp-canvas-lms)](https://github.com/DMontgomery40/mcp-canvas-lms) |

## Quick Start

### 1. Get a Canvas API Token

1. Log in to your Canvas instance
2. Go to **Account > Settings**
3. Scroll to **Approved Integrations** and click **+ New Access Token**
4. Give it a name (e.g., "MCP Server") and click **Generate Token**
5. Copy the token immediately -- you won't see it again

### 2. Run the Setup Wizard

```bash
npx canvas-lms-mcp init
```

The wizard detects your installed AI clients (Claude Desktop, Cursor, VS Code, Windsurf, Codex, Continue, Claude Code), prompts for your Canvas token and base URL, validates the credentials against your Canvas instance, and writes the config for every client you select.

`add-mcp` is also supported as a generic alternative: `npx add-mcp canvas-lms-mcp`.

For clients not yet supported by the wizard, or if you prefer editing config files by hand, see [docs/manual-setup.md](./docs/manual-setup.md).

## Agent Skills

Install reusable Canvas workflows into Claude Code, Cursor, GitHub Copilot, Cline, and 40+ other AI agents:

```bash
npx skills add bruchris/canvas-lms-mcp
```

| Skill | Description |
|-------|-------------|
| `canvas-at-risk-students` | Surface students with missing assignments or declining grades and send targeted outreach |
| `canvas-gradebook-audit` | Inspect the full grade-change audit trail — who changed what grade, when, and by how much |
| `canvas-outcome-tracker` | Track learning outcome mastery and class-wide proficiency for accreditation and program review |

Skills are markdown workflow files (no extra dependencies). They work with the MCP server you already have installed. See the [`skills/` directory](./skills/) for the full list.

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

### All Registered Tools (118)

| Category | Tools |
|----------|-------|
| Health | `health_check` |
| Courses | `list_courses`, `get_course`, `get_syllabus`, `create_course`, `update_course` |
| Assignments | `list_assignments`, `get_assignment`, `list_assignment_groups`, `create_assignment`, `update_assignment`, `delete_assignment` |
| Submissions | `list_submissions`, `get_submission`, `grade_submission`, `comment_on_submission` |
| Rubrics | `list_rubrics`, `get_rubric`, `get_rubric_assessment`, `submit_rubric_assessment` |
| Quizzes | `list_quizzes`, `get_quiz`, `list_quiz_submissions`, `list_quiz_questions`, `get_quiz_submission_answers`, `score_quiz_question` |
| New Quizzes (LTI) | `create_new_quiz`, `update_new_quiz`, `delete_new_quiz`, `list_new_quiz_items`, `get_new_quiz_item`, `create_new_quiz_item`, `update_new_quiz_item`, `delete_new_quiz_item` |
| Files | `list_files`, `list_folders`, `get_file`, `upload_file`, `delete_file` |
| Gradebook History | `list_gradebook_history_days`, `get_gradebook_history_day`, `list_gradebook_history_submissions`, `get_gradebook_history_feed` |
| Users | `list_students`, `get_user`, `get_profile`, `search_users`, `list_course_users` |
| Groups | `list_groups`, `list_group_members` |
| Enrollments | `list_enrollments`, `enroll_user`, `remove_enrollment` |
| Discussions | `list_discussions`, `get_discussion`, `list_announcements`, `post_discussion_entry`, `create_discussion`, `update_discussion`, `delete_discussion` |
| Modules | `list_modules`, `get_module`, `list_module_items`, `get_course_structure`, `view_course_structure`, `create_module`, `update_module`, `create_module_item` |
| Pages | `list_pages`, `get_page`, `create_page`, `update_page`, `delete_page` |
| Calendar | `list_calendar_events`, `create_calendar_event`, `update_calendar_event` |
| Conversations | `list_conversations`, `get_conversation`, `get_conversation_unread_count`, `send_conversation` |
| Peer Reviews | `list_peer_reviews`, `get_submission_peer_reviews`, `create_peer_review`, `delete_peer_review` |
| Accounts | `get_account`, `list_accounts`, `list_sub_accounts`, `list_account_courses`, `list_account_users`, `get_account_reports` |
| Analytics | `search_course_content`, `get_course_analytics`, `get_student_analytics`, `get_course_activity_stream` |
| Outcomes | `get_root_outcome_group`, `list_outcome_groups`, `list_outcome_group_links`, `get_outcome_group`, `list_outcome_group_outcomes`, `list_outcome_group_subgroups`, `get_outcome`, `get_outcome_alignments`, `get_outcome_results`, `get_outcome_rollups`, `get_outcome_contributing_scores`, `get_outcome_mastery_distribution` |
| Student | `get_my_courses`, `get_my_grades`, `get_my_submissions`, `get_my_upcoming_assignments` |
| Dashboard | `get_dashboard_cards`, `get_todo_items`, `get_upcoming_events`, `get_missing_submissions` |
| Attention | `list_submission_comments_needing_attention` |
| FERPA (conditional) | `resolve_pseudonym` — registered only when `CANVAS_PSEUDONYMIZE_STUDENTS=true` |

83 tools are read-only and 35 tools perform Canvas write operations. When FERPA mode is enabled, `resolve_pseudonym` adds a 119th read tool.

All write tools require appropriate Canvas permissions. Canvas enforces its own permission model -- the MCP server does not bypass it.

### Bulk operations

Canvas applies rate limits per-user. When creating many New Quizzes items (e.g., RAG-generated quizzes), call the tools serially rather than in parallel. For >50 items, chunk and pause between batches. If you hit a rate-limit error, wait a few seconds and retry.

### MCP Resources (2)

| Resource | URI Template | Type |
|----------|-------------|------|
| Course Syllabus | `canvas://course/{courseId}/syllabus` | text/html |
| Assignment Description | `canvas://course/{courseId}/assignment/{assignmentId}/description` | text/html |

### Interactive widgets

`view_course_structure` is an [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) tool: hosts that support the spec render an interactive tree explorer (collapsible modules, type-filter chips, title search, published/unpublished badges, links open in a new tab); hosts that don't fall back transparently to the same JSON payload that `get_course_structure` returns. The widget is self-contained — no external scripts, fonts, or network calls — and is shipped inline with the tool definition.

| Tool | UI resource URI | Fallback |
|------|----------------|----------|
| `view_course_structure` | `ui://canvas-lms-mcp/course-structure.html` | Same JSON payload as `get_course_structure` |

Host verification (Claude Desktop, ChatGPT, Codex fallback) is performed manually after each release, since it requires real Canvas credentials. A screenshot will be added once the first verified host pass lands.

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
| `CANVAS_PSEUDONYMIZE_STUDENTS` | No | Set to `true` to enable [FERPA mode](#ferpa-mode-student-pseudonymization) |
| `CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP` | No | Set to `true` (with `CANVAS_PSEUDONYMIZE_STUDENTS=true`) to register the `resolve_pseudonym` audit tool |
| `CANVAS_PSEUDONYM_DIR` | No | Absolute path that overrides the default pseudonym map directory |
| `CANVAS_PSEUDONYM_AUDIT_LOG` | No | Path to an append-only file that mirrors `resolve_pseudonym` audit lines (stderr is always written) |

## FERPA mode (student pseudonymization)

Opt-in, server-side mode that replaces student names and contact info in tool output with stable pseudonyms (`Student 1`, `Student 2`, …) so structured PII never reaches the LLM. Designed for teacher / staff tokens — students running their own MCP should leave the flag off, otherwise their own data is replaced too.

```bash
CANVAS_PSEUDONYMIZE_STUDENTS=true canvas-lms-mcp serve --base-url https://school.instructure.com
```

What it does:

- Replaces `name`, `short_name`, `sortable_name`, `email`, `login_id`, `sis_user_id`, `integration_id`, `avatar_url`, `bio`, `pronouns`, and `last_login` on student users.
- Maps are stable per `(canvas-base-url, course_id)` and persisted to disk under `${XDG_DATA_HOME:-~/.local/share}/canvas-lms-mcp/pseudonyms` (Linux), `~/Library/Application Support/canvas-lms-mcp/pseudonyms` (macOS), or `%APPDATA%\canvas-lms-mcp\pseudonyms` (Windows). Override the location with `CANVAS_PSEUDONYM_DIR`.
- `Student 7` in March is still `Student 7` in October. Dropped students are marked historical; their slot is never reused.
- Tool responses carry `_meta.pseudonymized: true` so the agent can mention it in summaries.
- Cannot be toggled per tool call, per HTTP header, or per session. The env flag is the only switch.

What it does NOT do:

- It does not scrub free text inside submission bodies, discussion messages, or page bodies — a student writing "Hi, I'm Alice" in their submission still says so. Document this for your end users.
- It cannot re-anonymize the LLM's working memory. If the agent saw real names in a prior turn, they remain in its context.
- It does not protect the bare `canvas-lms-mcp/canvas` library import — pseudonymization is a tool-layer concern. Embedders that use the raw Canvas client get raw data.
- HTTP transports are process-wide: to run both modes side by side, run two server instances.

Conversation participants are pseudonymized as `Person N` from a cross-course pool. If you chat with a colleague, they appear as `Person 1` rather than their name — conservative because conversations span courses and we cannot infer their role.

Optional `resolve_pseudonym` reverse-lookup tool: register it only by also setting `CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP=true`. Every call is audit-logged to stderr (and to `CANVAS_PSEUDONYM_AUDIT_LOG` if set). When the flag is off the tool is absent from `tools/list` — a prompt-injection attempt to call it fails at the protocol layer.

Threat model and design rationale in [docs/superpowers/specs/2026-05-25-ferpa-pseudonymization.md](docs/superpowers/specs/2026-05-25-ferpa-pseudonymization.md).

## Development

```bash
pnpm install       # Install dependencies
pnpm dev           # Watch mode build
pnpm build         # Production build
pnpm test          # Run tests (768 tests)
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

- [Manual Setup](docs/manual-setup.md) -- Per-client JSON/TOML config snippets for Claude Desktop, Cursor, VS Code, Windsurf, Codex, Continue, Claude Code, and HTTP clients
- [Getting Started](docs/getting-started.md) -- Step-by-step setup for non-developers: token, config, first query, troubleshooting
- [Student Guide](docs/student-guide.md) -- Token setup, AI client configuration, 10 example prompts
- [Educator Guide](docs/educator-guide.md) -- Grading workflows, write operations, privacy considerations
- [Integration Guide](docs/integration-guide.md) -- Three integration patterns with code examples
- [Agent Discovery](docs/agent-discovery.md) -- Generated tool/workflow manifests and workflow-pack index
- [Educator Assignment Review Workflow](docs/workflows/educator-assignment-review.md) -- Read-first grading flow with write-safety guidance
- [Student Weekly Planning Workflow](docs/workflows/student-weekly-planning.md) -- Read-only weekly planning sequence for students

## License

MIT
