# AGENTS.md — Canvas LMS MCP Server

Guide for AI agents consuming or contributing to `canvas-lms-mcp`.

## Quick Start

```bash
# Run with npx (no install needed)
npx canvas-lms-mcp --token $CANVAS_API_TOKEN --base-url https://school.instructure.com/api/v1

# Or install globally
npm install -g canvas-lms-mcp
canvas-lms-mcp --token $CANVAS_API_TOKEN --base-url $CANVAS_BASE_URL
```

Environment variables are also supported:

```bash
export CANVAS_API_TOKEN=your_token_here
export CANVAS_BASE_URL=https://school.instructure.com/api/v1
npx canvas-lms-mcp
```

## Architecture

Three-layer design with strict separation of concerns:

```
Layer 1: src/canvas/       Standalone Canvas REST API client
                           Pure fetch, no MCP dependency, independently importable
                           14 modular classes composed into CanvasClient facade

Layer 2: src/tools/        MCP tool definitions
                           Each domain exports (canvas: CanvasClient) => ToolDefinition[]
                           Zod input schemas, annotations, error formatting

Layer 3: src/server.ts     MCP server factory
         src/stdio.ts      stdio transport (Claude Desktop, Cursor, VS Code)
         src/http.ts       HTTP transport (ChatGPT, hosted service)
```

### Data Flow

```
AI Agent  -->  MCP Transport (stdio/HTTP)
                    |
               McpServer (tool dispatch)
                    |
               ToolDefinition.handler (Zod validation + error catch)
                    |
               CanvasClient.module.method (typed API call)
                    |
               CanvasHttpClient (fetch + auth + pagination)
                    |
               Canvas LMS REST API
```

## Tool Inventory

100 tools total: 72 read-only, 28 write operations.

| Domain | Tools |
| --- | --- |
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

## Tool Annotations

Every tool declares MCP annotations for agent safety:

- **`readOnlyHint: true`** — Tool only reads data (GET requests). Safe to call without confirmation.
- **`destructiveHint: true`** — Tool modifies data (POST/PUT/DELETE). Agent should confirm with user.
- **`openWorldHint: true`** — All tools access an external Canvas instance. Results depend on network and permissions.

## Error Responses

Tools return structured error messages instead of throwing:

| Condition | Error Message |
| --- | --- |
| Invalid/expired token | "Canvas token is invalid or expired" |
| No permission | "You don't have permission to perform this action in this course" |
| Resource not found | "Course/assignment/submission not found — check the ID" |
| Network failure | "Failed to connect to Canvas — check your base URL" |
| Other Canvas error | "Canvas API error (STATUS): MESSAGE" |

## Development

### Commands

```bash
pnpm dev          # Build with watch mode
pnpm build        # Production build
pnpm test         # Run tests once
pnpm test:watch   # Run tests in watch mode
pnpm lint         # ESLint + Prettier check
pnpm lint:fix     # ESLint + Prettier auto-fix
pnpm typecheck    # TypeScript strict type check
```

### Conventional Commits

All commits must follow the conventional commit format:

```
feat: add rubric assessment tool
fix: handle pagination edge case for empty courses
chore: update dependencies
docs: add tool inventory to AGENTS.md
test: add unit tests for submissions module
ci: add Node 24 to CI matrix
```

### How to Add a New Tool

1. **Canvas module** — If the Canvas API domain does not yet have a module, create `src/canvas/<domain>.ts` with a class that receives `CanvasHttpClient` and implements typed methods for each endpoint.

2. **Register module** — Add the module to the `CanvasClient` facade in `src/canvas/index.ts`.

3. **Tool definitions** — Create `src/tools/<domain>.ts` exporting a function `(canvas: CanvasClient) => ToolDefinition[]`. Each tool needs:
   - A plain-verb `name` (no `canvas_` prefix)
   - A clear `description` for AI agents
   - A Zod `inputSchema` for parameter validation
   - Correct `annotations` (`readOnlyHint`, `destructiveHint`, `openWorldHint`)
   - A `handler` that calls the canvas module and returns data

4. **Register tools** — Import and spread into `getAllTools()` in `src/tools/index.ts`.

5. **Tests** — Write unit tests in `tests/<domain>.test.ts` using mocked Canvas API responses. Cover happy path, error cases, and pagination.

### Canvas Client (Standalone Usage)

The Canvas client can be used independently of MCP:

```typescript
import { CanvasClient } from 'canvas-lms-mcp/canvas'

const canvas = new CanvasClient({
  token: process.env.CANVAS_API_TOKEN!,
  baseUrl: 'https://school.instructure.com/api/v1',
})

const courses = await canvas.courses.list()
```

### Key Constraints

- **No destructive writes** — Canvas enforces its own permissions. The MCP server does not bypass Canvas authorization.
- **Tests use mocked responses** — Never hit a real Canvas instance in tests.
- **Pure fetch** — The Canvas client uses native `fetch`. No HTTP client libraries.
- **Node >=22** — Required for native fetch and modern JS features.
