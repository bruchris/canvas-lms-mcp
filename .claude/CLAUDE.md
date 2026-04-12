# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important Workflow Rule

**Do not run `git commit` or `git push`**. Make code changes as requested and let the user handle committing manually.

## Commands

Requires Node >=22 and pnpm.

```bash
pnpm dev          # Build with watch mode (tsup --watch)
pnpm build        # Production build (tsup)
pnpm test         # Run tests once (vitest run)
pnpm test:watch   # Run tests in watch mode (vitest)
pnpm lint         # ESLint + Prettier check
pnpm lint:fix     # ESLint + Prettier auto-fix
pnpm typecheck    # TypeScript strict type check (tsc --noEmit)
```

## Architecture Overview

Canvas LMS MCP server — no UI, pure TypeScript. Three layers:

```
src/canvas/       Standalone Canvas REST API client (pure fetch, no MCP dependency)
src/tools/        MCP tool definitions — each domain returns ToolDefinition[]
src/server.ts     Factory: createCanvasMCPServer(config) wires canvas + tools into McpServer
src/stdio.ts      stdio transport entry — Claude Desktop, Cursor, VS Code
src/http.ts       HTTP transport entry — ChatGPT, hosted service (per-request auth)
```

### Canvas Client Pattern

`src/canvas/` contains 14 modular classes (courses, assignments, submissions, rubrics, quizzes, files, users, groups, enrollments, discussions, modules, pages, calendar, conversations). Each module:

- Receives a `CanvasHttpClient` instance via constructor injection
- Uses pure `fetch` (via `client.request()`, `client.paginate()`, `client.paginateEnvelope()`)
- Throws `CanvasApiError` with `.status`, `.endpoint`, `.message` on failure
- Is composed into the `CanvasClient` facade in `src/canvas/index.ts`
- Types live in `src/canvas/types.ts`

### Tool Pattern

Each tool domain module exports a function: `(canvas: CanvasClient) => ToolDefinition[]`

- Input validation uses Zod schemas
- Tool names use plain verbs (e.g., `list_courses`, `get_assignment`) — **no `canvas_` prefix**
- All tools are registered in `src/tools/index.ts` via `getAllTools(canvas)`

### Tool Annotations

Every tool must declare MCP annotations:

- `readOnlyHint: true` for read operations (GET requests)
- `destructiveHint: true` for write operations (POST/PUT/DELETE)
- `openWorldHint: true` for all tools (Canvas is an external system)

### Error Handling

**Canvas client layer**: Throws `CanvasApiError` with `.status`, `.endpoint`, `.message`. Never catches its own errors.

**Tool layer**: Catches `CanvasApiError` and returns structured MCP error content. `formatError()` in `src/tools/index.ts` maps common status codes:

- 401 → "Canvas token is invalid or expired"
- 403 → "You don't have permission to perform this action in this course"
- 404 → "Course/assignment/submission not found — check the ID"
- Network errors → "Failed to connect to Canvas — check your base URL"

### Key Constraints

- **No destructive writes**: Canvas enforces its own permissions; the MCP server does not bypass them
- **Conventional commits required**: `feat`, `fix`, `chore`, `docs`, `test`, `ci`
- **Tests use mocked responses**: Never hit a real Canvas instance in tests

### Key Source Locations

| What                     | Where                         |
| ------------------------ | ----------------------------- |
| Canvas HTTP client       | `src/canvas/client.ts`        |
| Canvas client facade     | `src/canvas/index.ts`         |
| Canvas types             | `src/canvas/types.ts`         |
| Tool type definitions    | `src/tools/types.ts`          |
| Tool registry            | `src/tools/index.ts`          |
| MCP server factory       | `src/server.ts`               |
| stdio transport          | `src/stdio.ts`                |
| HTTP transport           | `src/http.ts`                 |
| CLI argument parser      | `src/cli.ts`                  |
| Tests                    | `tests/`                      |

### Required Environment Variables

- `CANVAS_API_TOKEN` — Canvas personal access token (or passed via `--token` CLI flag)
- `CANVAS_BASE_URL` — Canvas instance URL, e.g., `https://school.instructure.com/api/v1` (or passed via `--base-url` CLI flag)

### How to Add a New Tool

1. If the Canvas module does not exist, create `src/canvas/<domain>.ts` with a class receiving `CanvasHttpClient`
2. Add the module to `CanvasClient` in `src/canvas/index.ts`
3. Create `src/tools/<domain>.ts` exporting `(canvas: CanvasClient) => ToolDefinition[]` with Zod input schemas and annotations
4. Register the domain in `getAllTools()` in `src/tools/index.ts`
5. Write tests in `tests/<domain>.test.ts` using mocked Canvas responses
