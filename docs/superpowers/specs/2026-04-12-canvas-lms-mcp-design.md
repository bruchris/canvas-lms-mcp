# Canvas LMS MCP Server — Design Spec

**Date**: 2026-04-12
**Repo**: `bruchris/canvas-lms-mcp`
**License**: MIT
**npm package**: `canvas-lms-mcp`

## Purpose

An open-source MCP (Model Context Protocol) server that exposes the Canvas LMS REST API as MCP tools, resources, and prompts. Designed to be used with Claude, ChatGPT, Cursor, VS Code, and any MCP-compatible AI agent — and also importable as an npm library into applications like the Fjordbyte Canvas Integration.

Read-heavy with selective writes: broad read access across all Canvas entities, write operations limited to grading, commenting, quiz scoring, discussion posting, and messaging.

## Architecture

### Approach: Modular Tool Registry

Three distinct layers with clear separation of concerns:

1. **Canvas API client** (`src/canvas/`) — standalone TypeScript HTTP client, zero MCP dependency, independently testable, reusable as a library
2. **MCP tool definitions** (`src/tools/`) — one file per domain, each exports tool definitions with Zod schemas and handlers
3. **Transport entry points** (`src/stdio.ts`, `src/http.ts`) — thin wrappers that create the server and attach a transport

A `createCanvasMCPServer(config)` factory in `src/server.ts` wires tools + resources together. Transport entry points and library consumers both call this factory.

### Directory Structure

```
canvas-lms-mcp/
├── src/
│   ├── canvas/                    # Standalone Canvas API client
│   │   ├── client.ts              # HTTP client, pagination, error handling
│   │   ├── types.ts               # Canvas API types
│   │   ├── courses.ts             # Course module
│   │   ├── assignments.ts         # Assignment module
│   │   ├── submissions.ts         # Submission module (read + write)
│   │   ├── rubrics.ts             # Rubric module (read + write)
│   │   ├── quizzes.ts             # Quiz module (read + write)
│   │   ├── files.ts               # File module
│   │   ├── users.ts               # User module
│   │   ├── groups.ts              # Group module
│   │   ├── enrollments.ts         # Enrollment module
│   │   ├── discussions.ts         # Discussions + announcements
│   │   ├── modules.ts             # Modules + module items
│   │   ├── pages.ts               # Course pages
│   │   ├── calendar.ts            # Calendar events
│   │   ├── conversations.ts       # Inbox messages
│   │   └── index.ts               # CanvasClient facade
│   ├── tools/                     # MCP tool definitions (one file per domain)
│   │   ├── types.ts               # ToolDefinition type
│   │   ├── courses.ts
│   │   ├── assignments.ts
│   │   ├── submissions.ts
│   │   ├── rubrics.ts
│   │   ├── quizzes.ts
│   │   ├── files.ts
│   │   ├── users.ts
│   │   ├── groups.ts
│   │   ├── enrollments.ts
│   │   ├── discussions.ts
│   │   ├── modules.ts
│   │   ├── pages.ts
│   │   ├── calendar.ts
│   │   ├── conversations.ts
│   │   ├── health.ts              # health_check tool
│   │   └── index.ts               # Tool registry (registers all tools)
│   ├── resources/                 # MCP resources (URI-addressable content)
│   │   ├── syllabus.ts
│   │   ├── assignment-description.ts
│   │   └── index.ts
│   ├── auth/                      # Authentication strategies
│   │   ├── token.ts               # Personal access token (v1.0)
│   │   └── oauth.ts               # OAuth 2.0 (v1.2)
│   ├── server.ts                  # MCP server factory
│   ├── cli.ts                     # CLI argument parsing
│   ├── stdio.ts                   # Entry: stdio transport
│   └── http.ts                    # Entry: HTTP/SSE transport
├── tests/
│   ├── canvas/                    # Canvas client unit tests
│   └── tools/                     # MCP tool handler tests
├── .claude/
│   ├── CLAUDE.md
│   ├── settings.json
│   ├── agents/
│   │   ├── team-lead.md
│   │   ├── architect.md
│   │   ├── fullstack-dev.md
│   │   ├── qa-engineer.md
│   │   └── devops-engineer.md
│   └── skills/                    # Dev team skills (mirrored in .agents/skills/)
│       ├── canvas-lms-api/        # Canvas REST API reference
│       └── mcp-sdk-patterns/      # MCP SDK usage patterns
├── .agents/
│   └── skills/                    # Canonical skill source
│       ├── canvas-lms-api/
│       └── mcp-sdk-patterns/
├── .github/
│   └── workflows/
│       ├── ci.yml                 # Lint, typecheck, test, build
│       ├── release-please.yml     # Automated releases via release-please
│       └── npm-publish.yml        # Publish to npm on release
├── docs/
│   ├── student-guide.md           # Getting started for students
│   ├── educator-guide.md          # Getting started for educators
│   └── integration-guide.md       # Integration patterns for applications
├── .mcp.json
├── AGENTS.md                      # AI agent guide for the repo
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── .eslintrc.json
├── .prettierrc
├── LICENSE
├── CHANGELOG.md
└── README.md
```

## Transport & Deployment Modes

### Mode 1: stdio (CLI)

For Claude Desktop, Cursor, VS Code, and other local MCP clients.

```bash
npx canvas-lms-mcp --token $CANVAS_API_TOKEN --base-url https://institution.instructure.com
```

- Entry point: `src/stdio.ts`
- Uses `StdioServerTransport` from `@modelcontextprotocol/sdk`
- Token and base URL via CLI args or env vars (`CANVAS_API_TOKEN`, `CANVAS_BASE_URL`)

Claude Desktop config example:

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

### Mode 2: HTTP/SSE (remote server)

For ChatGPT custom GPTs, shared team instances, and future hosted service.

```bash
canvas-lms-mcp serve --port 3001
```

- Entry point: `src/http.ts`
- Uses `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk` (primary)
- Falls back to `SSEServerTransport` for older MCP clients that don't support streamable HTTP
- Per-request auth via headers: `X-Canvas-Token`, `X-Canvas-Base-URL`
- Tokens are never stored server-side — passed through per request
- CORS configuration for allowed origins

### Mode 3: Library import (npm)

For applications that integrate Canvas LMS (LTI apps, grading platforms, AI teaching tools, etc.).

```typescript
import { createCanvasMCPServer } from 'canvas-lms-mcp'

const server = createCanvasMCPServer({
  token: userToken,       // from OAuth/LTI/personal token
  baseUrl: canvasBaseUrl, // user's Canvas instance
})
```

- Entry point: `src/server.ts` exports the factory
- Consumable via `@ai-sdk/mcp` or any MCP client library
- Runs in-process, no separate service needed
- Token comes from the host app's existing auth flow (OAuth, LTI, personal token)

### Mode 4: Hosted service (future — v2.0)

For non-technical users (students, educators) who cannot self-host.

- A publicly hosted instance where users just add a URL and their Canvas credentials
- Same HTTP transport as Mode 2, but managed and maintained
- Per-request auth via headers — tokens never stored
- Not in scope for v1.0 but the HTTP transport architecture supports it without changes
- Hosting domain TBD (e.g., `mcp.canvas-lms.dev` or similar)

### npm package exports

```json
{
  "exports": {
    ".": "./dist/server.js",
    "./stdio": "./dist/stdio.js",
    "./http": "./dist/http.js",
    "./canvas": "./dist/canvas/index.js"
  },
  "bin": {
    "canvas-lms-mcp": "./dist/cli.js"
  }
}
```

The `./canvas` export exposes the standalone Canvas client for direct library usage without MCP protocol overhead (see Integration Patterns section).

## Canvas API Client

### HTTP Client (`src/canvas/client.ts`)

- Bearer token auth via `Authorization` header
- Custom User-Agent: `canvas-lms-mcp/1.0`
- Automatic Link-header pagination following `rel="next"`
- Max pagination safety limit: 1000 pages (configurable via `CANVAS_MAX_PAGINATION_PAGES`)
- Error parsing from Canvas error format: `{ errors: [{ message }] }` and `{ message }`
- HTTP status attached to errors for MCP layer to return clear messages
- Envelope pagination support for quiz endpoints (`{ quiz_submissions: [...] }`)

### Client Facade (`src/canvas/index.ts`)

```typescript
export class CanvasClient {
  courses: CoursesModule
  assignments: AssignmentsModule
  submissions: SubmissionsModule
  rubrics: RubricsModule
  quizzes: QuizzesModule
  files: FilesModule
  users: UsersModule
  groups: GroupsModule
  enrollments: EnrollmentsModule
  discussions: DiscussionsModule
  modules: ModulesModule
  pages: PagesModule
  calendar: CalendarModule
  conversations: ConversationsModule

  constructor(config: { token: string; baseUrl: string })
}
```

14 modules, each receiving the HTTP client instance. Pure `fetch` — no external HTTP dependencies.

### Types (`src/canvas/types.ts`)

Built fresh referencing the Fjordbyte Canvas Integration's `src/types/canvas.ts` as the proven blueprint. Only fields each tool actually needs — no over-fetching type definitions. Shared pagination types and error types.

## MCP Tool Inventory

The tool set spans Canvas courses, assignments, submissions, gradebook history, rubrics, quizzes, New Quizzes (LTI), files, users, groups, enrollments, discussions, modules, pages, calendar, conversations, peer reviews, accounts, analytics, outcomes, student workflows, dashboard, health checks, attention/engagement signals, content exports, grading standards, quiz and assignment accommodations, course setup, grade explanation, grading policy, link auditing, and more. A conditional tool — `resolve_pseudonym` — is registered when **both** `CANVAS_PSEUDONYMIZE_STUDENTS=true` and `CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP=true` are set (see [FERPA Mode](#ferpa-mode) below).

> **Note:** The authoritative tool inventory is the generated manifest — run `pnpm generate:manifests` and check `manifest.json` or `tests/discovery/manifests.test.ts` for the always-current count. **Do not hand-maintain a number here.** The per-domain tables below are a point-in-time snapshot as of 2026-07-23; add new domains to this section when you add a new tool file, but let the manifest be the source of truth for counts.

### Tool Pattern

Each tool file exports a function that takes a `CanvasClient` and returns an array of `ToolDefinition`:

```typescript
export interface ToolDefinition {
  name: string
  description: string
  inputSchema: ZodSchema
  handler: (params: unknown) => Promise<unknown>
}

export function courseTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_courses',
      description: 'List all courses for the authenticated user.',
      inputSchema: z.object({
        enrollment_state: z.enum(['active', 'completed', 'all']).optional(),
      }),
      handler: async (params) => canvas.courses.list(params),
    },
  ]
}
```

### Tool Naming Convention

Plain verbs, no `canvas_` prefix: `list_`, `get_`, `grade_`, `comment_on_`, `post_`, `send_`, `score_`.

### Error Handling in Tools

All errors returned as structured MCP content, never thrown:

- 403 → `"You don't have permission to perform this action in this course"`
- 404 → `"Course/assignment/submission not found — check the ID"`
- 401 → `"Canvas token is invalid or expired"`
- Network → `"Failed to connect to Canvas — check your base URL"`

### Full Tool Inventory

#### Health (1 tool)

| Tool | Type | Description |
|------|------|-------------|
| `health_check` | read | Verify Canvas API connectivity and token validity |

#### Courses (5 tools)

| Tool | Type | Description |
|------|------|-------------|
| `list_courses` | read | User's courses with optional term/enrollment filtering |
| `get_course` | read | Single course details |
| `get_syllabus` | read | Course syllabus content |
| `create_course` | write | Create a course in a Canvas account |
| `update_course` | write | Update an existing course |

#### Assignments (6 tools)

| Tool | Type | Description |
|------|------|-------------|
| `list_assignments` | read | Assignments for a course |
| `get_assignment` | read | Single assignment with rubric settings |
| `list_assignment_groups` | read | Grouped assignments with weights/rules |
| `create_assignment` | write | Create a new assignment |
| `update_assignment` | write | Update an existing assignment |
| `delete_assignment` | write | Delete an assignment |

#### Submissions (4 tools)

| Tool | Type | Description |
|------|------|-------------|
| `list_submissions` | read | Submissions for an assignment (with comments, history) |
| `get_submission` | read | Single submission detail |
| `grade_submission` | write | Post a grade to a submission |
| `comment_on_submission` | write | Post a comment, optionally with a file attachment (uses Canvas's comment file upload workflow — not general file uploads) |

#### Rubrics (5 tools)

| Tool | Type | Description |
|------|------|-------------|
| `list_rubrics` | read | All rubrics in a course |
| `get_rubric` | read | Full rubric with criteria/ratings |
| `get_rubric_assessment` | read | Existing assessment for a submission |
| `submit_rubric_assessment` | write | Grade via rubric criteria |
| `create_rubric` | write | Create a new rubric in a course with criteria and rating levels |

#### Quizzes (7 tools)

| Tool | Type | Description |
|------|------|-------------|
| `list_quizzes` | read | List quizzes in a course |
| `get_quiz` | read | Quiz metadata |
| `list_quiz_submissions` | read | Submissions for a quiz |
| `list_quiz_questions` | read | Question definitions |
| `get_quiz_submission_answers` | read | Student's answered questions |
| `score_quiz_question` | write | Score an essay/open-ended question |
| `get_quiz_submission_events` | read | Chronological event log for a Classic Quiz submission (session_started, question_answered, page_blurred, etc.) |

#### Quiz Question Responses (1 tool)

| Tool | Type | Description |
|------|------|-------------|
| `get_quiz_question_responses` | read | Review every student's answer to one or all questions in a Classic Quiz, pivoted by question — for grading essay/short-answer/file-upload questions across the class |

#### Files (7 tools)

| Tool | Type | Description |
|------|------|-------------|
| `list_files` | read | Files in a course |
| `list_folders` | read | Folder structure |
| `get_file` | read | File metadata + download URL |
| `download_file` | read | Download file content by ID (text returned as-is; binary as base64) |
| `upload_file` | write | Upload a file to a course folder |
| `delete_file` | write | Delete a file |
| `find_duplicate_files` | read | Find duplicate files in a course's Files area — copies with the same name and size, typically left behind by repeated course copies |

#### Users (5 tools)

| Tool | Type | Description |
|------|------|-------------|
| `list_students` | read | Students enrolled in a course |
| `get_user` | read | User profile details |
| `get_profile` | read | Authenticated user's own profile |
| `search_users` | read | Search users in an account |
| `list_course_users` | read | List users in a course, optionally filtered by enrollment type |

#### Groups (2 tools)

| Tool | Type | Description |
|------|------|-------------|
| `list_groups` | read | Course groups |
| `list_group_members` | read | Members of a group |

#### Enrollments (4 tools)

| Tool | Type | Description |
|------|------|-------------|
| `list_enrollments` | read | User's enrollments across courses |
| `list_course_enrollments` | read | Enrollments within a specific course with role and grade filters |
| `enroll_user` | write | Enroll a user in a course |
| `remove_enrollment` | write | Remove or conclude an enrollment |

#### Modules (8 tools)

| Tool | Type | Description |
|------|------|-------------|
| `list_modules` | read | Course modules |
| `get_module` | read | Single module details |
| `list_module_items` | read | Items within a module |
| `get_course_structure` | read | Full course structure: all modules with their items in a single tree |
| `view_course_structure` | read | Interactive MCP Apps tree view of modules and items (falls back to JSON on non-MCP-Apps hosts) |
| `create_module` | write | Create a module |
| `update_module` | write | Update an existing module |
| `create_module_item` | write | Add an item to a module |

#### Pages (5 tools)

| Tool | Type | Description |
|------|------|-------------|
| `list_pages` | read | Course pages |
| `get_page` | read | Page content |
| `create_page` | write | Create a wiki page |
| `update_page` | write | Update a wiki page |
| `delete_page` | write | Delete a wiki page |

#### Discussions (7 tools)

| Tool | Type | Description |
|------|------|-------------|
| `list_discussions` | read | Discussion topics in a course |
| `get_discussion` | read | Discussion topic with entries |
| `list_announcements` | read | Course announcements |
| `post_discussion_entry` | write | Post to a discussion topic |
| `create_discussion` | write | Create a discussion topic |
| `update_discussion` | write | Update a discussion topic |
| `delete_discussion` | write | Delete a discussion topic |

#### Calendar (3 tools)

| Tool | Type | Description |
|------|------|-------------|
| `list_calendar_events` | read | Calendar events and due dates |
| `create_calendar_event` | write | Create a calendar event |
| `update_calendar_event` | write | Update a calendar event |

#### Conversations (4 tools)

| Tool | Type | Description |
|------|------|-------------|
| `list_conversations` | read | Inbox messages |
| `get_conversation` | read | Conversation message thread |
| `get_conversation_unread_count` | read | Count unread conversations |
| `send_conversation` | write | Send a message to students |

#### Peer Reviews (4 tools)

| Tool | Type | Description |
|------|------|-------------|
| `list_peer_reviews` | read | Peer reviews for an assignment |
| `get_submission_peer_reviews` | read | Peer reviews assigned to a submission |
| `create_peer_review` | write | Assign a peer review |
| `delete_peer_review` | write | Remove a peer review assignment |

#### Accounts (8 tools)

| Tool | Type | Description |
|------|------|-------------|
| `get_account` | read | Canvas account details |
| `list_accounts` | read | Accounts accessible to the authenticated user |
| `list_sub_accounts` | read | Sub-accounts under an account |
| `list_account_courses` | read | Courses in an account |
| `list_account_users` | read | Users in an account |
| `get_account_reports` | read | Available account report types |
| `list_account_notifications` | read | Active institution-wide announcements (maintenance windows, term deadlines, policy notices) |
| `view_account_notifications` | read | Interactive MCP Apps panel of institution-wide announcements (falls back to JSON on non-MCP-Apps hosts) |

#### Analytics (4 tools)

| Tool | Type | Description |
|------|------|-------------|
| `search_course_content` | read | Search Canvas course content |
| `get_course_analytics` | read | Course analytics activity |
| `get_student_analytics` | read | Student analytics in a course |
| `get_course_activity_stream` | read | Course activity stream |

#### Student (5 tools)

| Tool | Type | Description |
|------|------|-------------|
| `get_my_courses` | read | Authenticated student's courses |
| `get_my_grades` | read | Authenticated student's grades |
| `get_my_submissions` | read | Authenticated student's submissions |
| `get_my_upcoming_assignments` | read | Authenticated student's upcoming assignments |
| `get_my_submission_feedback` | read | Submissions that carry feedback comments from an instructor or peer reviewer |

#### Dashboard (4 tools)

| Tool | Type | Description |
|------|------|-------------|
| `get_dashboard_cards` | read | Current user's dashboard course cards |
| `get_todo_items` | read | Current user's Canvas todo items |
| `get_upcoming_events` | read | Current user's upcoming events |
| `get_missing_submissions` | read | Current user's missing submissions |

#### Gradebook History (4 tools)

| Tool | Type | Description |
|------|------|-------------|
| `list_gradebook_history_days` | read | Dates in a course gradebook history that contain grading activity |
| `get_gradebook_history_day` | read | Graders and assignment IDs that had activity on a specific date |
| `list_gradebook_history_submissions` | read | Versioned submission history for one grader and assignment on a date |
| `get_gradebook_history_feed` | read | Paginated gradebook history feed, optionally filtered by assignment or user |

#### Outcomes (12 tools)

| Tool | Type | Description |
|------|------|-------------|
| `get_root_outcome_group` | read | Root outcome group for an account or course context |
| `list_outcome_groups` | read | All outcome groups for an account or course context |
| `list_outcome_group_links` | read | All outcome links in an account or course context |
| `get_outcome_group` | read | Details for a specific outcome group |
| `list_outcome_group_outcomes` | read | Outcomes linked into a specific outcome group |
| `list_outcome_group_subgroups` | read | Subgroups of a specific outcome group |
| `get_outcome` | read | Single outcome definition |
| `get_outcome_alignments` | read | Alignments for an outcome in a course |
| `get_outcome_results` | read | Raw outcome results for a course |
| `get_outcome_rollups` | read | Outcome rollups (summary scores) for a course |
| `get_outcome_contributing_scores` | read | Scores contributing to an outcome rollup for a user |
| `get_outcome_mastery_distribution` | read | Distribution of mastery levels across students for an outcome |

#### New Quizzes — LTI (8 tools)

New Quizzes is the modern LTI-backed quiz engine in Canvas — distinct from Classic quizzes. See the detailed API spec at [2026-05-13-new-quizzes-tools.md](2026-05-13-new-quizzes-tools.md).

| Tool | Type | Description |
|------|------|-------------|
| `create_new_quiz` | write | Create a New Quiz (LTI) in a Canvas course |
| `update_new_quiz` | write | Update an existing New Quiz (LTI) |
| `delete_new_quiz` | write | Delete a New Quiz (LTI) from a Canvas course |
| `list_new_quiz_items` | read | List all items (questions) in a New Quiz |
| `get_new_quiz_item` | read | Get a single item (question) from a New Quiz by item ID |
| `create_new_quiz_item` | write | Create an item (question) in a New Quiz (supports choice, true-false, essay, matching, numeric) |
| `update_new_quiz_item` | write | Update an existing item (question) in a New Quiz |
| `delete_new_quiz_item` | write | Delete an item (question) from a New Quiz |

#### Attention (2 tools)

| Tool | Type | Description |
|------|------|-------------|
| `list_submission_comments_needing_attention` | read | Submissions where the latest comment is from the student and has not been addressed by grading or a reply — triage list, oldest-unaddressed first |
| `list_students_needing_attention` | read | Students flagged for inactivity, missing/late submissions, or low current score; includes the specific signals and thresholds that fired |

#### Content Exports (3 tools)

| Tool | Type | Description |
|------|------|-------------|
| `create_content_export` | write | Start a course content export (Common Cartridge / QTI / zip); returns immediately with export ID and initial state |
| `get_content_export` | read | Poll status of a content export; when complete, attachment.url holds a time-limited download link |
| `list_content_exports` | read | List all content exports for a course (most recent first) |

#### Grading Standards (3 tools)

| Tool | Type | Description |
|------|------|-------------|
| `list_grading_standards` | read | List grading standards available in a course or account context |
| `create_grading_standard` | write | Create a letter-to-percentage grading standard in a course or account context |
| `apply_grading_standard_to_course` | write | Apply an existing grading standard to a course gradebook (pass null to remove) |

#### Quiz Accommodations (2 tools)

| Tool | Type | Description |
|------|------|-------------|
| `set_student_quiz_accommodation` | write | Apply extra time and/or extra attempts to a student across all Classic Quizzes in a course |
| `list_student_quiz_accommodations` | read | Audit current quiz accommodations for a student across all Classic Quizzes in a course |

#### Assignment Overrides (3 tools)

| Tool | Type | Description |
|------|------|-------------|
| `list_assignment_overrides` | read | List all due-date / availability overrides for a specific assignment |
| `create_assignment_override` | write | Create a due-date / availability override targeting students, a section, or a group |
| `set_student_assignment_dates` | write | Fan a due-date / availability override for one student across all (or a subset of) assignments in a course |

#### New Quiz Accommodations (2 tools)

| Tool | Type | Description |
|------|------|-------------|
| `set_student_new_quiz_accommodation` | write | Apply a time and/or attempts accommodation for a student across all New Quizzes in a course or for specific assignments |
| `list_student_new_quiz_accommodations` | read | Read the current course-level New Quizzes accommodation (time multiplier and/or extra attempts) for a specific student |

#### Course Setup (1 tool)

| Tool | Type | Description |
|------|------|-------------|
| `check_course_setup` | read | Run a course-readiness report that surfaces common configuration problems — assignments missing due dates, unpublished items, unweighted groups, submissions open past due |

#### Grade Explanation (1 tool)

| Tool | Type | Description |
|------|------|-------------|
| `explain_grade` | read | Recompute and explain the weighted course grade for a student, including assignment-group weights, drop rules, per-group breakdowns, and final/current grade |

#### Grading Policy (1 tool)

| Tool | Type | Description |
|------|------|-------------|
| `explain_grading_policy` | read | Explain the grading automation rules configured for a Canvas course: missing-submission policy, late-submission penalty, and assignment-group weights |

#### Grade Projection (1 tool)

| Tool | Type | Description |
|------|------|-------------|
| `project_grade` | read | Project the minimum uniform score needed on remaining assignments to reach a target course grade (percentage or letter), accounting for group weights, drop rules, and the grading scheme |

#### Submissions Awaiting Grading (1 tool)

| Tool | Type | Description |
|------|------|-------------|
| `list_submissions_awaiting_grading` | read | List all submissions in a course that still need a human grade, sorted oldest-waiting first |

#### Course Submission Files (1 tool)

| Tool | Type | Description |
|------|------|-------------|
| `list_course_submission_files` | read | List every file attachment submitted by students across all assignments in a course — one entry per file, with original filename, file_id, and download URL |

#### Link Audit (1 tool)

| Tool | Type | Description |
|------|------|-------------|
| `audit_course_links` | read | Scan a course's pages, assignments, syllabus, and announcements for broken or outdated links and images — returns structured findings with location and reason |

**Totals: 147 tools (105 read, 42 write).** When both `CANVAS_PSEUDONYMIZE_STUDENTS=true` and `CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP=true` are set, `resolve_pseudonym` adds a 148th tool (read).

> **Maintenance reminder:** These counts are derived from `pnpm generate:manifests` (see `manifest.json`). When adding new tools, update the per-domain table above and re-run `pnpm generate:manifests` — do **not** update the count by hand.

## FERPA Mode

An opt-in server-side mode that pseudonymizes student personally identifiable information (PII) before it leaves the MCP server. Designed for US K-12 and higher-ed deployments where student names flowing into a third-party LLM pose compliance risk.

**Activation:** set `CANVAS_PSEUDONYMIZE_STUDENTS=true` in the environment before starting the server. The flag is evaluated once at startup and cannot be overridden by any tool argument, HTTP header, or session-level negotiation.

**What changes when enabled:**
- Every tool that returns a `CanvasUser`, an enrollment, a submission, a conversation, or an outcome result routes its output through the `Pseudonymizer` before the response is sent.
- Student names are replaced with stable, course-scoped labels (`Student 1`, `Student 2`, …). The same real Canvas `user_id` always maps to the same label within a course for the lifetime of the pseudonym map file.
- The pseudonym map is stored on the server operator's machine under XDG / `%APPDATA%` / `CANVAS_PSEUDONYM_DIR`. It never leaves the local machine.

**Conditional tool `resolve_pseudonym`:** when **both** `CANVAS_PSEUDONYMIZE_STUDENTS=true` and `CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP=true` are set, a 148th tool is registered. It accepts a pseudonym label (e.g., `Student 7`) and a course ID and returns the resolved Canvas `user_id` (not the real name). Instructors who need to act on a specific student can look up the ID without the AI agent ever seeing the PII. The tool is intentionally absent when FERPA mode is off.

**Coverage enforcement:** `tests/pseudonym/coverage.test.ts` fails CI if any tool returning student PII is not wrapped. New tools that add `CanvasUser` or `user_name` fields must update `src/pseudonym/coverage.ts` and route through the appropriate `Pseudonymizer.anonymize*` method.

Full design: [`docs/superpowers/specs/2026-05-25-ferpa-pseudonymization.md`](./2026-05-25-ferpa-pseudonymization.md).

## MCP Resources

URI-addressable content that AI agents can read without calling tools:

| Resource | URI Pattern | Description |
|----------|-------------|-------------|
| Course Syllabus | `canvas://course/{courseId}/syllabus` | Syllabus HTML content |
| Assignment Description | `canvas://course/{courseId}/assignment/{assignmentId}/description` | Assignment instructions |

## Authentication

### v1.0: Personal Access Token

Users provide their Canvas personal access token and institution base URL:

- **CLI**: `--token` and `--base-url` args, or `CANVAS_API_TOKEN` / `CANVAS_BASE_URL` env vars
- **HTTP**: `X-Canvas-Token` and `X-Canvas-Base-URL` request headers (per-request, never stored)
- **Library**: passed directly via `createCanvasMCPServer({ token, baseUrl })`

### v1.2: OAuth 2.0

Full OAuth 2.0 authorization code flow for integration with apps like Fjordbyte Canvas Integration:

- Token refresh with expiry buffer
- Stored tokens managed by host application
- Passed to MCP server factory at construction time

### No Role-Based Filtering

Canvas enforces permissions server-side. A student token trying to grade returns 403. The MCP server registers all tools regardless and returns clear error messages when Canvas denies access. This is correct because users have context-aware roles — a single user can be a student in one course and an instructor in another.

## Tech Stack

| Component | Choice |
|-----------|--------|
| Language | TypeScript 5.x |
| Runtime | Node.js >=22 |
| MCP SDK | `@modelcontextprotocol/sdk` |
| Validation | `zod` |
| Package manager | `pnpm` |
| Bundler | `tsup` (ESM + CJS dual output) |
| Tests | `vitest` |
| Linting | `eslint` + `prettier` |
| Type checking | TypeScript strict mode |
| CI | GitHub Actions |
| Releases | release-please + npm publish |

No runtime dependencies beyond the MCP SDK and Zod. The Canvas client uses native `fetch`.

## Release & CI/CD

### Conventional Commits

All commits follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new tools, resources, features → minor version bump
- `fix:` — bug fixes → patch version bump
- `feat!:` or `BREAKING CHANGE:` — breaking changes → major version bump
- `chore:`, `docs:`, `ci:` — no version bump

### release-please

Automated release management via [release-please](https://github.com/googleapis/release-please):

- Runs on push to `main`
- Maintains a release PR that accumulates changes
- On merge of release PR: creates GitHub release, tags version, updates CHANGELOG.md
- Release PR title format: `chore(main): release canvas-lms-mcp vX.Y.Z`

### GitHub Actions Workflows

**ci.yml** — runs on every PR and push to `main`:
- Lint (`eslint` + `prettier`)
- Type check (`tsc --noEmit`)
- Test (`vitest run`)
- Build (`tsup`)

**release-please.yml** — runs on push to `main`:
- Runs release-please to create/update release PR
- On release created: triggers npm-publish

**npm-publish.yml** — runs when release-please creates a release:
- Builds the package
- Publishes to npm as `canvas-lms-mcp`
- Uses npm Trusted Publishing (OIDC) for authentication

## Agent Team

Five roles configured in `.claude/agents/`, optimized for an MCP server project with no UI:

### team-lead (opus)
- Project coordination, GitHub issues/PRs, specs
- Has `Agent` tool to dispatch work to other roles
- Owns README, CHANGELOG, release process

### architect (opus)
- MCP protocol design, Canvas API patterns, transport architecture
- Reviews tool definitions for consistency and completeness
- Ensures MCP SDK usage follows latest spec

### fullstack-dev (opus)
- Core implementation: Canvas client modules, tool handlers, transports, server factory
- Writes tool definitions with proper Zod schemas
- References Fjordbyte Canvas Integration patterns as blueprint

### qa-engineer (sonnet)
- Unit tests for Canvas client modules (mocked Canvas API responses)
- Integration tests for MCP tool handlers
- Transport smoke tests

### devops-engineer (sonnet)
- GitHub Actions CI/CD pipeline
- release-please configuration
- npm publish workflow
- Docker support for HTTP server mode

### CLAUDE.md

The repo's CLAUDE.md will include:
- Commands: `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm lint`
- Architecture overview matching this spec
- Canvas API client patterns and conventions
- Tool naming and registration conventions
- Transport entry points and deployment modes
- Conventional commit requirements

## MCP Tool Annotations

All tools include MCP tool annotations to help clients (Claude, ChatGPT) make safety decisions:

| Annotation | Applied to | Effect |
|------------|-----------|--------|
| `readOnlyHint: true` | All 60 read tools | Clients may auto-execute without confirmation |
| `destructiveHint: true` | All 28 write tools | Clients should ask for user confirmation before executing |
| `idempotentHint: true` | `grade_submission`, `submit_rubric_assessment`, `score_quiz_question` | Safe to retry — re-grading with same value is a no-op |
| `openWorldHint: true` | All tools | Tools interact with external Canvas API |

## Testing Strategy

### Unit Tests (Canvas client)

Each `src/canvas/` module has corresponding tests in `tests/canvas/`. Tests mock Canvas API responses using `msw` (Mock Service Worker) or a lightweight fetch mock:

- Successful responses with realistic Canvas data shapes
- Pagination (multi-page responses with Link headers)
- Error responses (401, 403, 404, 500)
- Envelope pagination for quiz endpoints

### MCP Tool Handler Tests

Each `src/tools/` module has corresponding tests in `tests/tools/`. Tests use a mock `CanvasClient` to verify:

- Tool input validation (Zod schema enforcement)
- Correct delegation to Canvas client methods
- Error handling — Canvas errors mapped to structured MCP error content
- Tool annotations are correctly set

### Transport Smoke Tests

Lightweight tests that verify:

- stdio transport starts and responds to MCP `initialize` handshake
- HTTP transport starts a server and responds to health check
- Library export creates a functional server instance

### No Canvas Sandbox Required

All tests run against mocked responses — no live Canvas instance needed for CI. Integration tests against a real Canvas instance are optional and documented for local development only.

## AI Agent Documentation

### AGENTS.md

A single-file guide at the repo root for external AI agents consuming the codebase. Includes:

- Complete tool inventory with parameters and return types
- Example prompts for each tool category
- Architecture overview for agents making code changes
- Conventional commit requirements
- Testing and build commands

This mirrors what `vishalsachdev/canvas-mcp` does — agents that clone or access the repo get immediate context.

### Dev Team Skills

Skills installed in `.claude/skills/` and `.agents/skills/` to help the dev team work efficiently:

| Skill | Purpose |
|-------|---------|
| `canvas-lms-api` | Canvas REST API reference — copied from Fjordbyte repo as a blueprint |
| `mcp-sdk-patterns` | `@modelcontextprotocol/sdk` usage patterns — server creation, tool registration, transport setup, resource definitions |

These ensure agents spawned by the team-lead or architect immediately know Canvas API conventions and MCP SDK patterns without needing to search documentation.

### CLAUDE.md

Comprehensive project instructions (detailed in Agent Team section) that teach any Claude Code session how to:

- Run dev/build/test/lint commands
- Navigate the modular architecture
- Add new tools following the established pattern
- Follow conventional commit conventions
- Understand the transport and deployment modes

## End-User Documentation

### README.md

The primary entry point. Includes:

- One-line install (`npx canvas-lms-mcp`)
- Configuration examples for Claude Desktop, Cursor, VS Code, ChatGPT
- Quick start with 5 example prompts
- Complete tool inventory table
- Links to detailed guides

### docs/student-guide.md

Getting started for students:

- How to get a Canvas personal access token
- Configuration for their MCP client
- Example prompts: "What's due this week?", "Show my grades", "What peer reviews do I need?"
- What tools are available to students (read-only access to their own data)

### docs/educator-guide.md

Getting started for educators/TAs:

- Setup and token generation
- Grading workflows: single submission, rubric-based, quiz scoring
- Example prompts for common instructor tasks
- Write operations available and what they do
- Privacy considerations (tokens, data handling)

## Docker Support

A `Dockerfile` for HTTP server mode deployment:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY dist/ ./dist/
EXPOSE 3001
CMD ["node", "dist/http.js"]
```

- Multi-stage build for minimal image size
- Runs HTTP transport on configurable port
- Auth via request headers (no secrets baked into image)
- Health check endpoint for container orchestration
- `docker-compose.yml` included for local development

## Integration Patterns

The MCP server supports three integration patterns for applications that work with Canvas LMS:

### Pattern 1: Dev-time MCP (agent tooling)

Add the MCP server to your project's `.mcp.json` so AI agents working on your codebase can query Canvas directly during development — reading course structures, checking submission formats, verifying API responses.

```json
{
  "mcpServers": {
    "canvas": {
      "command": "npx",
      "args": ["canvas-lms-mcp"],
      "env": {
        "CANVAS_API_TOKEN": "dev-token",
        "CANVAS_BASE_URL": "https://institution.instructure.com"
      }
    }
  }
}
```

### Pattern 2: Shared Canvas client (library import)

Import the Canvas client layer directly as an npm dependency, bypassing the MCP protocol entirely. Useful for backend services, background jobs, or API routes that need Canvas data without MCP overhead.

```typescript
import { CanvasClient } from 'canvas-lms-mcp/canvas'

const canvas = new CanvasClient({ token, baseUrl })
const submissions = await canvas.submissions.list(courseId, assignmentId)
```

This exposes the same modular client (`courses`, `assignments`, `submissions`, etc.) as a standalone library with full TypeScript types, pagination, and error handling.

### Pattern 3: Runtime MCP (agentic features)

For applications with AI agents that need to autonomously interact with Canvas (e.g., AI teaching assistants, chatbots, grading agents), connect via `@ai-sdk/mcp` at runtime:

```typescript
import { createCanvasMCPServer } from 'canvas-lms-mcp'
import { experimental_createMCPClient } from '@ai-sdk/mcp'

const server = createCanvasMCPServer({ token, baseUrl })
const client = await experimental_createMCPClient({ server })
```

The AI agent uses MCP tools during conversation to read Canvas data and take actions (grade, comment, etc.).

### Which pattern to use

| Pattern | When | Overhead |
|---------|------|----------|
| Dev-time MCP | AI agents assisting with development | None (dev only) |
| Shared client | Backend services, API routes, background jobs | Minimal (direct function calls) |
| Runtime MCP | AI agents interacting with users about Canvas | MCP protocol layer |

These patterns are documented in `docs/integration-guide.md` in the repo.

## Repo Scaffolding

The repo (`bruchris/canvas-lms-mcp`) will be initialized with a complete foundation before any tool implementation begins:

- Spec files and design documentation
- `.claude/` with agent team definitions, CLAUDE.md, settings.json
- `.agents/skills/` with dev team skills
- `.github/workflows/` with CI, release-please, npm-publish
- `AGENTS.md`, `LICENSE` (MIT), base `README.md`
- `package.json`, TypeScript config, ESLint, Prettier, Vitest
- `Dockerfile`, `docker-compose.yml`

This repo is then linked to the Paperclip AI project board so the team can begin implementation immediately with full AI tooling pre-configured.

## Explicitly Out of Scope

### v1.0 exclusions
- Course/assignment/quiz/module creation or deletion
- Enrollment management (add/drop students)
- Course settings modification
- Account admin tools
- File uploads to Canvas (read-only file access)
- Code execution sandbox
- Accessibility auditing
- FERPA anonymization
- Role-based tool filtering (Canvas enforces permissions)
- Skills.sh skill definitions (v1.1)
- OAuth 2.0 flow (v1.2)

### Deliberate constraints
- No destructive write operations
- No account-level admin tools
- Canvas is the permission authority — MCP server never makes access control decisions

## Versioning Roadmap

| Version | Scope |
|---------|-------|
| **v1.0** | Core MCP tools (~41), resources, stdio + HTTP transports, personal token auth, npm package with library export, CI/CD with release-please |
| **v1.1** | Skills.sh skill definitions (grading workflows: rubric grading, essay grading, batch grading, pass/fail, quiz scoring) |
| **v1.2** | OAuth 2.0 authentication support |
| **v2.0** | Plugin architecture (enable/disable tool domains via config), hosted service mode |

## Competitive Landscape

Two existing Canvas MCP servers informed this design:

- [vishalsachdev/canvas-mcp](https://github.com/vishalsachdev/canvas-mcp) — Python, 87+ tools, 8 agent skills, FERPA anonymization, accessibility auditing, hosted at mcp.illinihunt.org
- [DMontgomery40/mcp-canvas-lms](https://github.com/DMontgomery40/mcp-canvas-lms) — TypeScript, 50+ tools, account admin, Docker/K8s ready

This project differentiates by:
1. **Library-importable** — use as npm package inside applications, not just standalone
2. **Three deployment modes** — stdio, HTTP, and in-process library
3. **Standalone Canvas client export** — `canvas-lms-mcp/canvas` usable without MCP protocol, as a pure TypeScript Canvas API client
4. **Clean modular architecture** — Canvas client fully independent of MCP, reusable
5. **Three integration patterns** — dev-time MCP, shared client library, runtime MCP for agentic features
6. **Grading-focused writes** — safer default than full CRUD
7. **Skills.sh integration** (v1.1) — pre-built grading workflows

## Subsequent Specs

| Spec | Topic |
|------|-------|
| [2026-05-13-new-quizzes-tools.md](./2026-05-13-new-quizzes-tools.md) | New Quizzes (LTI) domain design — 8 tools for creating and managing New Quizzes and quiz items |
8. **OAuth support** (v1.2) — for LTI/OAuth app integration
