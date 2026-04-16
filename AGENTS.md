# AGENTS.md — Canvas LMS MCP Server

Guide for AI agents consuming or contributing to `canvas-lms-mcp`.

## Quick Start

```bash
# Run with npx (no install needed)
npx @bruchris/canvas-lms-mcp --token $CANVAS_API_TOKEN --base-url https://school.instructure.com/api/v1

# Or install globally
npm install -g @bruchris/canvas-lms-mcp
canvas-lms-mcp --token $CANVAS_API_TOKEN --base-url $CANVAS_BASE_URL
```

Environment variables are also supported:

```bash
export CANVAS_API_TOKEN=your_token_here
export CANVAS_BASE_URL=https://school.instructure.com/api/v1
npx @bruchris/canvas-lms-mcp
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

41 tools total: 33 read-only, 8 write operations.

### Courses (3 tools)

| Tool | Type | Description |
| --- | --- | --- |
| `list_courses` | read | List courses for the authenticated user |
| `get_course` | read | Get a single course by ID |
| `list_course_students` | read | List students enrolled in a course |

### Assignments (3 tools)

| Tool | Type | Description |
| --- | --- | --- |
| `list_assignments` | read | List all assignments in a course |
| `get_assignment` | read | Get a single assignment by ID |
| `create_assignment` | write | Create a new assignment in a course |

### Submissions (5 tools)

| Tool | Type | Description |
| --- | --- | --- |
| `list_submissions` | read | List submissions for an assignment |
| `get_submission` | read | Get a single submission by user and assignment |
| `get_submission_comments` | read | Get comments on a submission |
| `grade_submission` | write | Post a grade for a submission |
| `comment_on_submission` | write | Add a comment to a submission |

### Rubrics (3 tools)

| Tool | Type | Description |
| --- | --- | --- |
| `list_rubrics` | read | List rubrics in a course |
| `get_rubric` | read | Get a single rubric with full criteria |
| `assess_with_rubric` | write | Submit a rubric assessment for a submission |

### Quizzes (3 tools)

| Tool | Type | Description |
| --- | --- | --- |
| `list_quizzes` | read | List quizzes in a course |
| `get_quiz` | read | Get a single quiz by ID |
| `get_quiz_submissions` | read | List submissions for a quiz |

### Files (3 tools)

| Tool | Type | Description |
| --- | --- | --- |
| `list_files` | read | List files in a course or folder |
| `get_file` | read | Get file metadata and download URL |
| `list_folders` | read | List folders in a course |

### Users (3 tools)

| Tool | Type | Description |
| --- | --- | --- |
| `get_user` | read | Get a user profile by ID |
| `get_user_profile` | read | Get detailed profile for a user |
| `list_user_courses` | read | List courses a user is enrolled in |

### Groups (2 tools)

| Tool | Type | Description |
| --- | --- | --- |
| `list_groups` | read | List groups in a course |
| `get_group_members` | read | List members of a group |

### Enrollments (2 tools)

| Tool | Type | Description |
| --- | --- | --- |
| `list_enrollments` | read | List enrollments in a course |
| `enroll_user` | write | Enroll a user in a course |

### Discussions (3 tools)

| Tool | Type | Description |
| --- | --- | --- |
| `list_discussions` | read | List discussion topics in a course |
| `get_discussion` | read | Get a discussion topic with entries |
| `post_discussion_entry` | write | Post a reply to a discussion topic |

### Modules (3 tools)

| Tool | Type | Description |
| --- | --- | --- |
| `list_modules` | read | List modules in a course |
| `get_module` | read | Get a single module by ID |
| `list_module_items` | read | List items within a module |

### Pages (3 tools)

| Tool | Type | Description |
| --- | --- | --- |
| `list_pages` | read | List wiki pages in a course |
| `get_page` | read | Get a single wiki page by URL slug |
| `update_page` | write | Update a wiki page's content |

### Calendar (2 tools)

| Tool | Type | Description |
| --- | --- | --- |
| `list_calendar_events` | read | List calendar events for a course or user |
| `create_calendar_event` | write | Create a new calendar event |

### Conversations (3 tools)

| Tool | Type | Description |
| --- | --- | --- |
| `list_conversations` | read | List inbox conversations |
| `get_conversation` | read | Get a single conversation with messages |
| `send_message` | read | Get message details (read-only preview) |

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
import { CanvasClient } from '@bruchris/canvas-lms-mcp/canvas'

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
