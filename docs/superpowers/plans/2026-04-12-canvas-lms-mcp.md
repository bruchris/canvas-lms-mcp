# Canvas LMS MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an open-source MCP server (`bruchris/canvas-lms-mcp`) that exposes the Canvas LMS REST API as 88 MCP tools across Canvas courses, assignments, grading, content, communication, admin, analytics, student, and dashboard workflows, with stdio and HTTP transports, publishable to npm as `canvas-lms-mcp`.

**Architecture:** Three layers — standalone Canvas API client (`src/canvas/`), MCP tool definitions with Zod schemas (`src/tools/`), and thin transport entry points. A `createCanvasMCPServer()` factory wires everything together. The Canvas client is independently usable as a library via the `canvas-lms-mcp/canvas` export.

**Tech Stack:** TypeScript 5.x, Node.js >=22, `@modelcontextprotocol/sdk`, Zod, pnpm, tsup, Vitest, ESLint + Prettier, release-please

**Spec:** `docs/superpowers/specs/2026-04-12-canvas-lms-mcp-design.md` (in the Fjordbyte Canvas Integration repo)

**Important:** This plan creates a NEW repo at `bruchris/canvas-lms-mcp`. All file paths are relative to that repo root.

---

## Task 1: Create GitHub Repo and Initialize Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Create: `.eslintrc.json`
- Create: `.prettierrc`
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `.env.example`

- [ ] **Step 1: Create the GitHub repo**

```bash
gh repo create bruchris/canvas-lms-mcp --public --description "Canvas LMS MCP server — read courses, assignments, submissions, rubrics, quizzes; grade and comment from any AI agent" --license MIT --clone
cd canvas-lms-mcp
```

- [ ] **Step 2: Initialize pnpm and install dependencies**

```bash
pnpm init
pnpm add @modelcontextprotocol/sdk zod
pnpm add -D typescript tsup vitest eslint prettier @types/node eslint-config-prettier eslint-plugin-prettier @typescript-eslint/eslint-plugin @typescript-eslint/parser
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create `tsup.config.ts`**

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    stdio: 'src/stdio.ts',
    http: 'src/http.ts',
    cli: 'src/cli.ts',
    'canvas/index': 'src/canvas/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: true,
  sourcemap: true,
  target: 'node22',
})
```

- [ ] **Step 5: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/types.ts'],
    },
  },
})
```

- [ ] **Step 6: Create `.eslintrc.json`**

```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": 2022,
    "sourceType": "module"
  },
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier"
  ],
  "rules": {
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/no-explicit-any": "warn"
  },
  "ignorePatterns": ["dist/", "node_modules/"]
}
```

- [ ] **Step 7: Create `.prettierrc`**

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 8: Create `.gitignore`**

```
node_modules/
dist/
.env
*.tsbuildinfo
coverage/
.DS_Store
```

- [ ] **Step 9: Create `.env.example`**

```bash
# Canvas API credentials
CANVAS_API_TOKEN=your-canvas-personal-access-token
CANVAS_BASE_URL=https://your-institution.instructure.com

# Optional: pagination safety limit (default: 1000)
# CANVAS_MAX_PAGINATION_PAGES=1000
```

- [ ] **Step 10: Update `package.json` with scripts and exports**

```json
{
  "name": "canvas-lms-mcp",
  "version": "0.0.1",
  "description": "Canvas LMS MCP server — read courses, assignments, submissions, rubrics, quizzes; grade and comment from any AI agent",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/server.js",
      "require": "./dist/server.cjs"
    },
    "./stdio": {
      "import": "./dist/stdio.js",
      "require": "./dist/stdio.cjs"
    },
    "./http": {
      "import": "./dist/http.js",
      "require": "./dist/http.cjs"
    },
    "./canvas": {
      "import": "./dist/canvas/index.js",
      "require": "./dist/canvas/index.cjs"
    }
  },
  "bin": {
    "canvas-lms-mcp": "./dist/cli.js"
  },
  "files": ["dist/"],
  "scripts": {
    "dev": "tsup --watch",
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/ tests/ && prettier --check src/ tests/",
    "lint:fix": "eslint src/ tests/ --fix && prettier --write src/ tests/",
    "typecheck": "tsc --noEmit"
  },
  "keywords": ["canvas", "lms", "mcp", "model-context-protocol", "education", "grading"],
  "author": "Christian Bru",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/bruchris/canvas-lms-mcp.git"
  },
  "engines": {
    "node": ">=22"
  }
}
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: initialize project with TypeScript, tsup, vitest, eslint, prettier"
```

---

## Task 2: Agent Team and AI Configuration

**Files:**
- Create: `.claude/CLAUDE.md`
- Create: `.claude/settings.json`
- Create: `.claude/agents/team-lead.md`
- Create: `.claude/agents/architect.md`
- Create: `.claude/agents/fullstack-dev.md`
- Create: `.claude/agents/qa-engineer.md`
- Create: `.claude/agents/devops-engineer.md`
- Create: `AGENTS.md`

- [ ] **Step 1: Create `.claude/CLAUDE.md`**

```markdown
# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Commands

Requires Node >=22 and pnpm.

\`\`\`bash
pnpm dev          # Watch mode build with tsup
pnpm build        # Production build (ESM + CJS)
pnpm test         # Run Vitest tests
pnpm test:watch   # Run tests in watch mode
pnpm lint         # ESLint + Prettier check
pnpm lint:fix     # Auto-fix lint issues
pnpm typecheck    # TypeScript strict mode check
\`\`\`

## Architecture Overview

Canvas LMS MCP server with three layers:

\`\`\`
src/canvas/    → Standalone Canvas API client (no MCP dependency)
src/tools/     → MCP tool definitions (Zod schemas + handlers)
src/resources/ → MCP resources (URI-addressable content)
src/server.ts  → Factory: createCanvasMCPServer(config)
src/stdio.ts   → stdio transport entry point
src/http.ts    → HTTP/SSE transport entry point
src/cli.ts     → CLI argument parsing
\`\`\`

### Canvas Client (`src/canvas/`)

14 modular classes, each receiving a shared HTTP client:
- `client.ts` — HTTP client with Bearer auth, Link-header pagination, error parsing
- One file per domain: courses, assignments, submissions, rubrics, quizzes, files, users, groups, enrollments, discussions, modules, pages, calendar, conversations
- `types.ts` — All Canvas API types
- `index.ts` — `CanvasClient` facade aggregating all modules

Pattern for adding a new Canvas module:
1. Add types to `types.ts`
2. Create `src/canvas/<domain>.ts` with a class that takes the HTTP client
3. Add the module to the `CanvasClient` facade in `index.ts`
4. Write tests in `tests/canvas/<domain>.test.ts`

### MCP Tools (`src/tools/`)

Each domain file exports a function: `(canvas: CanvasClient) => ToolDefinition[]`

Tool naming: plain verbs, no `canvas_` prefix — `list_`, `get_`, `grade_`, `comment_on_`, `post_`, `send_`, `score_`

All read tools: `readOnlyHint: true`
All write tools: `destructiveHint: true`
All tools: `openWorldHint: true`

Pattern for adding a new tool:
1. Add the tool definition to the appropriate `src/tools/<domain>.ts`
2. Register it in `src/tools/index.ts`
3. Write tests in `tests/tools/<domain>.test.ts`

### Error Handling

Canvas client throws errors with `.status` attached. Tool handlers catch these and return structured MCP error content:
- 403 → "You don't have permission to perform this action in this course"
- 404 → "Course/assignment/submission not found — check the ID"
- 401 → "Canvas token is invalid or expired"
- Network → "Failed to connect to Canvas — check your base URL"

### Transports

- `src/stdio.ts` — `StdioServerTransport` for Claude Desktop, Cursor, VS Code
- `src/http.ts` — `StreamableHTTPServerTransport` (primary) with `SSEServerTransport` fallback
- `src/server.ts` — `createCanvasMCPServer()` factory for library import

### Conventional Commits

All commits must follow Conventional Commits:
- `feat:` — new tools, resources, features
- `fix:` — bug fixes
- `chore:` — config, CI, non-functional
- `docs:` — documentation
- `test:` — tests only
- `ci:` — CI/CD changes

### Key Constraints

- No destructive write operations (no create/delete courses, assignments, quizzes)
- Canvas enforces permissions — no role-based tool filtering
- All tools return errors as structured content, never throw
- Canvas client uses native `fetch` — no external HTTP dependencies
- Tests mock Canvas API responses — no live Canvas instance required for CI
```

- [ ] **Step 2: Create `.claude/settings.json`**

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  },
  "permissions": {
    "allow": [
      "Bash(pnpm dev:*)",
      "Bash(pnpm build:*)",
      "Bash(pnpm test:*)",
      "Bash(pnpm lint:*)",
      "Bash(npx tsc:*)",
      "Bash(pnpm vitest:*)",
      "Bash(pnpm list:*)",
      "Bash(pnpm add:*)"
    ]
  }
}
```

- [ ] **Step 3: Create `.claude/agents/team-lead.md`**

```markdown
---
model: opus
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - Agent
memory: project
---

# Team Lead — Canvas LMS MCP Server

You are the project coordinator for the canvas-lms-mcp project.

## Responsibilities
- Coordinate GitHub issues, PRs, and specs
- Dispatch work to other agent roles (architect, fullstack-dev, qa-engineer, devops-engineer)
- Own README, CHANGELOG, and release process
- Ensure conventional commit conventions are followed
- Review cross-cutting concerns before merge

## Key Files
- `README.md` — primary project documentation
- `CHANGELOG.md` — release notes (managed by release-please)
- `AGENTS.md` — AI agent guide
- `docs/` — user guides

## Project Context
This is an open-source MCP server exposing Canvas LMS API as 88 tools. Three deployment modes: stdio, HTTP, npm library. Read-heavy with selective writes for grading, content management, course administration, and messaging.
```

- [ ] **Step 4: Create `.claude/agents/architect.md`**

```markdown
---
model: opus
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
memory: project
---

# Architect — Canvas LMS MCP Server

You are the software architect for the canvas-lms-mcp project.

## Responsibilities
- MCP protocol design and SDK usage patterns
- Canvas API client architecture and module boundaries
- Transport architecture (stdio, HTTP, library)
- Review tool definitions for consistency and completeness
- Ensure tool annotations (readOnlyHint, destructiveHint) are correct
- API design for the `createCanvasMCPServer()` factory

## Key Patterns
- Canvas client: standalone in `src/canvas/`, zero MCP dependency
- Tool definitions: `(canvas: CanvasClient) => ToolDefinition[]`
- Tool naming: plain verbs, no `canvas_` prefix
- Errors: structured MCP content, never thrown
- All tools: `openWorldHint: true`
- Read tools: `readOnlyHint: true`
- Write tools: `destructiveHint: true`

## Reference
- MCP SDK: `@modelcontextprotocol/sdk` — StdioServerTransport, StreamableHTTPServerTransport, SSEServerTransport
- Canvas API: see `.agents/skills/canvas-lms-api/` for endpoint reference
```

- [ ] **Step 5: Create `.claude/agents/fullstack-dev.md`**

```markdown
---
model: opus
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
memory: project
---

# Fullstack Developer — Canvas LMS MCP Server

You are the core implementer for the canvas-lms-mcp project.

## Responsibilities
- Canvas API client modules (`src/canvas/`)
- MCP tool handler implementations (`src/tools/`)
- MCP resource implementations (`src/resources/`)
- Server factory and transport entry points
- Zod input schemas for all tools

## Implementation Patterns

### Canvas Module Pattern
Each module is a class receiving the HTTP client:
```typescript
export class CoursesModule {
  constructor(private client: CanvasHttpClient) {}
  async list(params?: { enrollment_state?: string }): Promise<CanvasCourse[]> {
    return this.client.paginate('/api/v1/courses', { params })
  }
}
```

### Tool Definition Pattern
```typescript
export function courseTools(canvas: CanvasClient): ToolDefinition[] {
  return [{
    name: 'list_courses',
    description: 'List all courses for the authenticated user.',
    inputSchema: z.object({ enrollment_state: z.enum(['active', 'completed', 'all']).optional() }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: async (params) => canvas.courses.list(params),
  }]
}
```

### Error Handling
Canvas client throws with `.status`. Tool handlers catch and return structured content.

## Key Files
- `src/canvas/client.ts` — HTTP client with pagination
- `src/canvas/types.ts` — all Canvas types
- `src/tools/types.ts` — ToolDefinition interface
- `src/server.ts` — createCanvasMCPServer factory
```

- [ ] **Step 6: Create `.claude/agents/qa-engineer.md`**

```markdown
---
model: sonnet
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
memory: project
---

# QA Engineer — Canvas LMS MCP Server

You are the quality assurance engineer for the canvas-lms-mcp project.

## Responsibilities
- Unit tests for Canvas client modules (`tests/canvas/`)
- MCP tool handler tests (`tests/tools/`)
- Transport smoke tests
- Test coverage monitoring

## Testing Patterns

### Canvas Client Tests
Mock Canvas API responses, verify:
- Successful responses with correct data shapes
- Pagination (multi-page Link headers)
- Error responses (401, 403, 404, 500)
- Envelope pagination for quiz endpoints

### Tool Handler Tests
Mock CanvasClient, verify:
- Zod schema validation (reject bad input)
- Correct delegation to canvas client methods
- Error mapping (Canvas HTTP errors → structured MCP content)
- Tool annotations set correctly

### Transport Smoke Tests
- stdio: starts, responds to MCP `initialize`
- HTTP: starts server, responds to health check
- Library: `createCanvasMCPServer()` returns functional instance

## Commands
```bash
pnpm test           # Run all tests
pnpm test:watch     # Watch mode
pnpm vitest run tests/canvas/  # Canvas client tests only
pnpm vitest run tests/tools/   # Tool tests only
```
```

- [ ] **Step 7: Create `.claude/agents/devops-engineer.md`**

```markdown
---
model: sonnet
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
memory: project
---

# DevOps Engineer — Canvas LMS MCP Server

You are the DevOps and infrastructure engineer for the canvas-lms-mcp project.

## Responsibilities
- GitHub Actions CI/CD pipeline (`.github/workflows/`)
- release-please configuration for automated releases
- npm publish workflow
- Docker support for HTTP server mode
- Dependency updates and security audits

## Key Workflows
- `ci.yml` — lint, typecheck, test, build on every PR
- `release-please.yml` — automated release PR on push to main
- `npm-publish.yml` — publish to npm when release is created

## Release Flow
1. Conventional commits on `main`
2. release-please creates/updates release PR
3. On merge: GitHub release + tag + CHANGELOG update
4. npm-publish triggers on release creation

## Docker
- `Dockerfile` — node:22-alpine, HTTP transport on port 3001
- `docker-compose.yml` — local development setup
- Auth via request headers, never baked into image
```

- [ ] **Step 8: Create `AGENTS.md`**

```markdown
# Canvas LMS MCP Server — Agent Guide

This is an MCP server exposing Canvas LMS REST API as tools for AI agents.

## Quick Start

```bash
npx canvas-lms-mcp --token YOUR_TOKEN --base-url https://institution.instructure.com
```

## Architecture

Three layers:
- `src/canvas/` — Standalone Canvas API client (no MCP dependency)
- `src/tools/` — MCP tool definitions with Zod schemas
- `src/server.ts` — Factory wiring tools + resources

## Tools (88 total — 60 read, 28 write)

| Domain | Tools |
|--------|-------|
| health | `health_check` |
| courses | `list_courses`, `get_course`, `get_syllabus`, `create_course`, `update_course` |
| assignments | `list_assignments`, `get_assignment`, `list_assignment_groups`, `create_assignment`, `update_assignment`, `delete_assignment` |
| submissions | `list_submissions`, `get_submission`, `grade_submission`, `comment_on_submission` |
| rubrics | `list_rubrics`, `get_rubric`, `get_rubric_assessment`, `submit_rubric_assessment` |
| quizzes | `list_quizzes`, `get_quiz`, `list_quiz_submissions`, `list_quiz_questions`, `get_quiz_submission_answers`, `score_quiz_question` |
| files | `list_files`, `list_folders`, `get_file`, `upload_file`, `delete_file` |
| users | `list_students`, `get_user`, `get_profile`, `search_users`, `list_course_users` |
| groups | `list_groups`, `list_group_members` |
| enrollments | `list_enrollments`, `enroll_user`, `remove_enrollment` |
| discussions | `list_discussions`, `get_discussion`, `list_announcements`, `post_discussion_entry`, `create_discussion`, `update_discussion`, `delete_discussion` |
| modules | `list_modules`, `get_module`, `list_module_items`, `create_module`, `update_module`, `create_module_item` |
| pages | `list_pages`, `get_page`, `create_page`, `update_page`, `delete_page` |
| calendar | `list_calendar_events`, `create_calendar_event`, `update_calendar_event` |
| conversations | `list_conversations`, `get_conversation`, `get_conversation_unread_count`, `send_conversation` |
| peer-reviews | `list_peer_reviews`, `get_submission_peer_reviews`, `create_peer_review`, `delete_peer_review` |
| accounts | `get_account`, `list_accounts`, `list_sub_accounts`, `list_account_courses`, `list_account_users`, `get_account_reports` |
| analytics | `search_course_content`, `get_course_analytics`, `get_student_analytics`, `get_course_activity_stream` |
| student | `get_my_courses`, `get_my_grades`, `get_my_submissions`, `get_my_upcoming_assignments` |
| dashboard | `get_dashboard_cards`, `get_todo_items`, `get_upcoming_events`, `get_missing_submissions` |

## Development

```bash
pnpm install        # Install dependencies
pnpm dev            # Watch mode build
pnpm build          # Production build
pnpm test           # Run tests
pnpm lint           # Lint check
pnpm typecheck      # Type check
```

## Conventional Commits Required
- `feat:` new tools/features → minor bump
- `fix:` bug fixes → patch bump
- `chore:` / `docs:` / `ci:` → no bump

## Adding a Tool
1. Add Canvas types to `src/canvas/types.ts`
2. Add Canvas module method in `src/canvas/<domain>.ts`
3. Add tool definition in `src/tools/<domain>.ts`
4. Register in `src/tools/index.ts`
5. Write tests in `tests/canvas/<domain>.test.ts` and `tests/tools/<domain>.test.ts`
```

- [ ] **Step 9: Create dev team skills**

Create `.agents/skills/canvas-lms-api/SKILL.md` — Canvas REST API reference skill. Copy the content from the Fjordbyte Canvas Integration repo's `.agents/skills/canvas-lms-api/` as a starting point and adapt for this project.

Create `.agents/skills/mcp-sdk-patterns/SKILL.md` — MCP SDK usage patterns skill. Include: `McpServer` construction, `server.tool()` registration, `StdioServerTransport`, `StreamableHTTPServerTransport`, `server.resource()`, tool annotations. Reference the `@modelcontextprotocol/sdk` npm package and use `context7` MCP or web search for current API surface.

Mirror both into `.claude/skills/` for Claude Code compatibility.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: add agent team definitions, CLAUDE.md, AGENTS.md, and dev team skills"
```

---

## Task 3: CI/CD and Release Configuration

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release-please.yml`
- Create: `.release-please-manifest.json`
- Create: `release-please-config.json`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 2: Create `.github/workflows/release-please.yml`**

```yaml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      release_created: ${{ steps.release.outputs.release_created }}
      tag_name: ${{ steps.release.outputs.tag_name }}
    steps:
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

  npm-publish:
    needs: release-please
    if: ${{ needs.release-please.outputs.release_created }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          registry-url: 'https://registry.npmjs.org'
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm publish --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 3: Create `release-please-config.json`**

```json
{
  "packages": {
    ".": {
      "release-type": "node",
      "changelog-sections": [
        { "type": "feat", "section": "Features" },
        { "type": "fix", "section": "Bug Fixes" },
        { "type": "chore", "section": "Miscellaneous" },
        { "type": "docs", "section": "Documentation" },
        { "type": "ci", "section": "CI/CD" }
      ]
    }
  }
}
```

- [ ] **Step 4: Create `.release-please-manifest.json`**

```json
{
  ".": "0.0.1"
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "ci: add GitHub Actions CI, release-please, and npm publish workflows"
```

---

## Task 4: Canvas API Client Foundation

**Files:**
- Create: `src/canvas/client.ts`
- Create: `src/canvas/types.ts`
- Create: `src/canvas/index.ts`
- Create: `tests/canvas/client.test.ts`

This task establishes the HTTP client with pagination and error handling — the foundation every module depends on.

- [ ] **Step 1: Write failing test for basic Canvas HTTP request**

```typescript
// tests/canvas/client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CanvasHttpClient, CanvasApiError } from '../../src/canvas/client'

describe('CanvasHttpClient', () => {
  let client: CanvasHttpClient

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
  })

  describe('request', () => {
    it('sends GET with auth header and user-agent', async () => {
      const mockResponse = { id: 1, name: 'Test Course' }
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const result = await client.request<{ id: number; name: string }>('/api/v1/courses/1')

      expect(fetch).toHaveBeenCalledWith(
        'https://canvas.example.com/api/v1/courses/1',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'User-Agent': 'canvas-lms-mcp/1.0',
          }),
        }),
      )
      expect(result).toEqual(mockResponse)
    })

    it('throws CanvasApiError on 403', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ message: 'Forbidden' }] }), {
          status: 403,
        }),
      )

      await expect(client.request('/api/v1/courses/1')).rejects.toThrow(CanvasApiError)
      await expect(client.request('/api/v1/courses/1')).rejects.toMatchObject({
        status: 403,
      })
    })

    it('throws CanvasApiError on 404', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'The specified resource does not exist' }), {
          status: 404,
        }),
      )

      await expect(client.request('/api/v1/courses/999')).rejects.toThrow(CanvasApiError)
    })
  })

  describe('paginate', () => {
    it('follows Link header rel="next" and merges results', async () => {
      const page1 = [{ id: 1 }, { id: 2 }]
      const page2 = [{ id: 3 }]

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify(page1), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              Link: '<https://canvas.example.com/api/v1/courses?page=2&per_page=2>; rel="next"',
            },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(page2), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )

      const result = await client.paginate<{ id: number }>('/api/v1/courses')
      expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('respects max pagination pages limit', async () => {
      const limitedClient = new CanvasHttpClient({
        token: 'test-token',
        baseUrl: 'https://canvas.example.com',
        maxPaginationPages: 1,
      })

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 1 }]), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            Link: '<https://canvas.example.com/api/v1/courses?page=2>; rel="next"',
          },
        }),
      )

      const result = await limitedClient.paginate<{ id: number }>('/api/v1/courses')
      expect(result).toEqual([{ id: 1 }])
      expect(fetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('paginateEnvelope', () => {
    it('extracts array from envelope key', async () => {
      const response = { quiz_submissions: [{ id: 1 }, { id: 2 }] }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const result = await client.paginateEnvelope<{ id: number }>(
        '/api/v1/quizzes/1/submissions',
        'quiz_submissions',
      )
      expect(result).toEqual([{ id: 1 }, { id: 2 }])
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/canvas/client.test.ts
```

Expected: FAIL — `Cannot find module '../../src/canvas/client'`

- [ ] **Step 3: Create `src/canvas/types.ts` with core types**

```typescript
// src/canvas/types.ts

// --- Config ---

export interface CanvasClientConfig {
  token: string
  baseUrl: string
  maxPaginationPages?: number
}

// --- Error ---

export interface CanvasErrorResponse {
  errors?: Array<{ message: string }>
  message?: string
}

// --- Courses ---

export interface CanvasCourse {
  id: number
  name: string
  course_code: string
  workflow_state: string
  enrollment_term_id?: number
  total_students?: number
  syllabus_body?: string
  term?: CanvasTerm
  enrollments?: CanvasEnrollment[]
}

export interface CanvasTerm {
  id: number
  name: string
  start_at: string | null
  end_at: string | null
}

export interface CanvasEnrollment {
  id: number
  course_id: number
  user_id: number
  type: string
  role: string
  enrollment_state: string
}

// --- Assignments ---

export interface CanvasAssignment {
  id: number
  name: string
  description: string | null
  due_at: string | null
  points_possible: number
  grading_type: string
  submission_types: string[]
  course_id: number
  rubric_settings?: { id: number }
  group_category_id?: number | null
  quiz_id?: number | null
  allowed_attempts: number
}

export interface CanvasAssignmentGroup {
  id: number
  name: string
  position: number
  group_weight: number
  assignments?: CanvasAssignment[]
}

// --- Submissions ---

export interface CanvasSubmission {
  id: number
  assignment_id: number
  user_id: number
  submitted_at: string | null
  score: number | null
  grade: string | null
  body: string | null
  url: string | null
  attempt: number | null
  workflow_state: string
  attachments?: CanvasAttachment[]
  submission_comments?: CanvasSubmissionComment[]
}

export interface CanvasAttachment {
  id: number
  filename: string
  display_name: string
  url: string
  content_type: string
  size: number
}

export interface CanvasSubmissionComment {
  id: number
  author_id: number
  author_name: string
  comment: string
  created_at: string
}

// --- Rubrics ---

export interface CanvasRubric {
  id: number
  title: string
  points_possible: number
  data: CanvasRubricCriterion[]
}

export interface CanvasRubricCriterion {
  id: string
  description: string
  points: number
  ratings: CanvasRubricRating[]
}

export interface CanvasRubricRating {
  id: string
  description: string
  points: number
}

export interface CanvasRubricAssessment {
  id: number
  rubric_id: number
  score: number
  data: Array<{
    criterion_id: string
    points: number
    comments: string
  }>
}

// --- Quizzes ---

export interface CanvasQuiz {
  id: number
  title: string
  quiz_type: string
  points_possible: number
  question_count: number
  due_at: string | null
  published: boolean
}

export interface CanvasQuizSubmission {
  id: number
  quiz_id: number
  user_id: number
  submission_id: number
  attempt: number
  score: number | null
  kept_score: number | null
  workflow_state: string
}

export interface CanvasQuizQuestion {
  id: number
  quiz_id: number
  position: number
  question_text: string
  question_type: string
  points_possible: number
  answers?: Array<{ id: number; text: string; weight: number }>
}

export interface CanvasQuizSubmissionQuestion {
  id: number
  quiz_id: number
  answer: string | number | null
  flagged: boolean
}

// --- Files ---

export interface CanvasFile {
  id: number
  display_name: string
  content_type: string
  url: string
  size: number
  folder_id: number
}

export interface CanvasFolder {
  id: number
  name: string
  full_name: string
  parent_folder_id: number | null
}

// --- Users ---

export interface CanvasUser {
  id: number
  name: string
  login_id?: string
  email?: string
  avatar_url?: string
}

export interface CanvasUserProfile {
  id: number
  name: string
  primary_email: string
  login_id: string
  avatar_url: string
  time_zone: string
  locale: string
}

// --- Groups ---

export interface CanvasGroup {
  id: number
  name: string
  group_category_id: number
  members_count: number
}

// --- Modules ---

export interface CanvasModule {
  id: number
  name: string
  position: number
  items_count: number
  state?: string
  published?: boolean
}

export interface CanvasModuleItem {
  id: number
  module_id: number
  title: string
  position: number
  type: string
  content_id?: number
  html_url?: string
}

// --- Pages ---

export interface CanvasPage {
  page_id: number
  url: string
  title: string
  body?: string
  published: boolean
  updated_at: string
}

// --- Discussions ---

export interface CanvasDiscussionTopic {
  id: number
  title: string
  message: string | null
  posted_at: string
  discussion_type: string
  published: boolean
}

export interface CanvasDiscussionEntry {
  id: number
  user_id: number
  message: string
  created_at: string
}

export interface CanvasAnnouncement {
  id: number
  title: string
  message: string
  posted_at: string
}

// --- Calendar ---

export interface CanvasCalendarEvent {
  id: number
  title: string
  start_at: string
  end_at: string | null
  type: string
  context_code: string
}

// --- Conversations ---

export interface CanvasConversation {
  id: number
  subject: string
  last_message: string
  last_message_at: string
  message_count: number
  participants: Array<{ id: number; name: string }>
}
```

- [ ] **Step 4: Create `src/canvas/client.ts`**

```typescript
// src/canvas/client.ts
import type { CanvasClientConfig, CanvasErrorResponse } from './types'

export class CanvasApiError extends Error {
  status: number
  endpoint: string

  constructor(message: string, status: number, endpoint: string) {
    super(message)
    this.name = 'CanvasApiError'
    this.status = status
    this.endpoint = endpoint
  }
}

const DEFAULT_MAX_PAGINATION_PAGES = 1000
const USER_AGENT = 'canvas-lms-mcp/1.0'

export class CanvasHttpClient {
  private token: string
  private baseUrl: string
  private maxPaginationPages: number

  constructor(config: CanvasClientConfig) {
    this.token = config.token
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.maxPaginationPages = config.maxPaginationPages ?? DEFAULT_MAX_PAGINATION_PAGES
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as CanvasErrorResponse
      const message =
        body.errors?.[0]?.message ?? body.message ?? `Canvas API error: ${response.status}`
      throw new CanvasApiError(message, response.status, endpoint)
    }

    return response.json() as Promise<T>
  }

  async paginate<T>(endpoint: string, params?: Record<string, string>): Promise<T[]> {
    const url = new URL(`${this.baseUrl}${endpoint}`)
    url.searchParams.set('per_page', '100')
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value)
      }
    }

    const results: T[] = []
    let nextUrl: string | null = url.toString()
    let pages = 0

    while (nextUrl && pages < this.maxPaginationPages) {
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'User-Agent': USER_AGENT,
        },
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as CanvasErrorResponse
        const message =
          body.errors?.[0]?.message ?? body.message ?? `Canvas API error: ${response.status}`
        throw new CanvasApiError(message, response.status, endpoint)
      }

      const data = (await response.json()) as T[]
      results.push(...data)
      pages++

      nextUrl = this.parseNextLink(response.headers.get('Link'))
    }

    return results
  }

  async paginateEnvelope<T>(
    endpoint: string,
    envelopeKey: string,
    params?: Record<string, string>,
  ): Promise<T[]> {
    const url = new URL(`${this.baseUrl}${endpoint}`)
    url.searchParams.set('per_page', '100')
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value)
      }
    }

    const results: T[] = []
    let nextUrl: string | null = url.toString()
    let pages = 0

    while (nextUrl && pages < this.maxPaginationPages) {
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'User-Agent': USER_AGENT,
        },
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as CanvasErrorResponse
        const message =
          body.errors?.[0]?.message ?? body.message ?? `Canvas API error: ${response.status}`
        throw new CanvasApiError(message, response.status, endpoint)
      }

      const body = (await response.json()) as Record<string, T[]>
      const data = body[envelopeKey] ?? []
      results.push(...data)
      pages++

      nextUrl = this.parseNextLink(response.headers.get('Link'))
    }

    return results
  }

  private parseNextLink(linkHeader: string | null): string | null {
    if (!linkHeader) return null
    const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
    return match?.[1] ?? null
  }
}
```

- [ ] **Step 5: Create minimal `src/canvas/index.ts` (just re-exports for now)**

```typescript
// src/canvas/index.ts
export { CanvasHttpClient, CanvasApiError } from './client'
export type * from './types'
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm vitest run tests/canvas/client.test.ts
```

Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add Canvas HTTP client with pagination and error handling"
```

---

## Task 5: First Canvas Module (Courses) + CanvasClient Facade

**Files:**
- Create: `src/canvas/courses.ts`
- Modify: `src/canvas/index.ts`
- Create: `tests/canvas/courses.test.ts`

This task establishes the module pattern that all subsequent modules follow.

- [ ] **Step 1: Write failing test for courses module**

```typescript
// tests/canvas/courses.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CoursesModule } from '../../src/canvas/courses'
import { CanvasHttpClient } from '../../src/canvas/client'
import type { CanvasCourse } from '../../src/canvas/types'

describe('CoursesModule', () => {
  let client: CanvasHttpClient
  let courses: CoursesModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    courses = new CoursesModule(client)
  })

  it('lists courses with pagination', async () => {
    const mockCourses: CanvasCourse[] = [
      { id: 1, name: 'CS 101', course_code: 'CS101', workflow_state: 'available' },
      { id: 2, name: 'Math 201', course_code: 'MATH201', workflow_state: 'available' },
    ]

    vi.spyOn(client, 'paginate').mockResolvedValueOnce(mockCourses)

    const result = await courses.list()
    expect(result).toEqual(mockCourses)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses', {
      include: ['term', 'total_students'],
    })
  })

  it('lists courses with enrollment_state filter', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([])

    await courses.list({ enrollment_state: 'completed' })
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses', {
      include: ['term', 'total_students'],
      enrollment_state: 'completed',
    })
  })

  it('gets a single course', async () => {
    const mockCourse: CanvasCourse = {
      id: 1,
      name: 'CS 101',
      course_code: 'CS101',
      workflow_state: 'available',
    }

    vi.spyOn(client, 'request').mockResolvedValueOnce(mockCourse)

    const result = await courses.get(1)
    expect(result).toEqual(mockCourse)
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/1?include[]=term&include[]=total_students')
  })

  it('gets course syllabus', async () => {
    const mockCourse: CanvasCourse = {
      id: 1,
      name: 'CS 101',
      course_code: 'CS101',
      workflow_state: 'available',
      syllabus_body: '<p>Welcome to CS 101</p>',
    }

    vi.spyOn(client, 'request').mockResolvedValueOnce(mockCourse)

    const result = await courses.getSyllabus(1)
    expect(result).toBe('<p>Welcome to CS 101</p>')
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/1?include[]=syllabus_body')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/canvas/courses.test.ts
```

Expected: FAIL — `Cannot find module '../../src/canvas/courses'`

- [ ] **Step 3: Create `src/canvas/courses.ts`**

```typescript
// src/canvas/courses.ts
import type { CanvasHttpClient } from './client'
import type { CanvasCourse } from './types'

export class CoursesModule {
  constructor(private client: CanvasHttpClient) {}

  async list(params?: { enrollment_state?: string }): Promise<CanvasCourse[]> {
    const queryParams: Record<string, string> = {
      include: ['term', 'total_students'].join(','),
    }
    if (params?.enrollment_state) {
      queryParams.enrollment_state = params.enrollment_state
    }
    // Canvas expects include[]=term&include[]=total_students but paginate uses flat params
    // We pass them through and let paginate build the URL
    return this.client.paginate<CanvasCourse>('/api/v1/courses', queryParams)
  }

  async get(courseId: number): Promise<CanvasCourse> {
    return this.client.request<CanvasCourse>(
      `/api/v1/courses/${courseId}?include[]=term&include[]=total_students`,
    )
  }

  async getSyllabus(courseId: number): Promise<string | null> {
    const course = await this.client.request<CanvasCourse>(
      `/api/v1/courses/${courseId}?include[]=syllabus_body`,
    )
    return course.syllabus_body ?? null
  }
}
```

- [ ] **Step 4: Update `src/canvas/index.ts` with CanvasClient facade**

```typescript
// src/canvas/index.ts
import { CanvasHttpClient } from './client'
import type { CanvasClientConfig } from './types'
import { CoursesModule } from './courses'

export class CanvasClient {
  private client: CanvasHttpClient
  courses: CoursesModule

  constructor(config: CanvasClientConfig) {
    this.client = new CanvasHttpClient(config)
    this.courses = new CoursesModule(this.client)
  }
}

export { CanvasHttpClient, CanvasApiError } from './client'
export type * from './types'
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm vitest run tests/canvas/
```

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add courses module and CanvasClient facade"
```

---

## Task 6: MCP Server Factory and Tool Types

**Files:**
- Create: `src/tools/types.ts`
- Create: `src/tools/index.ts`
- Create: `src/server.ts`
- Create: `tests/server.test.ts`

- [ ] **Step 1: Write failing test for server factory**

```typescript
// tests/server.test.ts
import { describe, it, expect } from 'vitest'
import { createCanvasMCPServer } from '../src/server'

describe('createCanvasMCPServer', () => {
  it('creates an MCP server instance', () => {
    const server = createCanvasMCPServer({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })

    expect(server).toBeDefined()
    expect(server.server).toBeDefined()
    expect(server.canvas).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/server.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create `src/tools/types.ts`**

```typescript
// src/tools/types.ts
import type { z } from 'zod'

export interface ToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: z.ZodType
  annotations: ToolAnnotations
  handler: (params: Record<string, unknown>) => Promise<unknown>
}
```

- [ ] **Step 4: Create `src/tools/index.ts` (empty registry for now)**

```typescript
// src/tools/index.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function getAllTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    // Tool domain modules will be added here as they are implemented
  ]
}

export function registerAllTools(server: McpServer, canvas: CanvasClient): void {
  const tools = getAllTools(canvas)
  for (const tool of tools) {
    server.tool(
      tool.name,
      tool.description,
      { ...tool.inputSchema },
      tool.annotations,
      async (params) => {
        try {
          const result = await tool.handler(params as Record<string, unknown>)
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          }
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: formatError(error) }],
            isError: true,
          }
        }
      },
    )
  }
}

function formatError(error: unknown): string {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status
    const message = (error as { message: string }).message
    switch (status) {
      case 401:
        return 'Canvas token is invalid or expired'
      case 403:
        return "You don't have permission to perform this action in this course"
      case 404:
        return 'Course/assignment/submission not found — check the ID'
      default:
        return `Canvas API error (${status}): ${message}`
    }
  }
  if (error instanceof Error) {
    if (error.message.includes('fetch')) {
      return 'Failed to connect to Canvas — check your base URL'
    }
    return error.message
  }
  return 'An unexpected error occurred'
}
```

- [ ] **Step 5: Create `src/server.ts`**

```typescript
// src/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CanvasClient } from './canvas'
import type { CanvasClientConfig } from './canvas'
import { registerAllTools } from './tools'

export interface CanvasMCPServerConfig {
  token: string
  baseUrl: string
}

export interface CanvasMCPServer {
  server: McpServer
  canvas: CanvasClient
}

export function createCanvasMCPServer(config: CanvasMCPServerConfig): CanvasMCPServer {
  const canvas = new CanvasClient({
    token: config.token,
    baseUrl: config.baseUrl,
  })

  const server = new McpServer({
    name: 'canvas-lms-mcp',
    version: '1.0.0',
  })

  registerAllTools(server, canvas)

  return { server, canvas }
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm vitest run tests/server.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add MCP server factory, tool types, and tool registry"
```

---

## Task 7: First MCP Tools (Health + Courses)

**Files:**
- Create: `src/tools/health.ts`
- Create: `src/tools/courses.ts`
- Modify: `src/tools/index.ts`
- Create: `tests/tools/health.test.ts`
- Create: `tests/tools/courses.test.ts`

This establishes the tool definition pattern.

- [ ] **Step 1: Write failing test for health check tool**

```typescript
// tests/tools/health.test.ts
import { describe, it, expect, vi } from 'vitest'
import { healthTools } from '../../src/tools/health'
import type { CanvasClient } from '../../src/canvas'

describe('healthTools', () => {
  it('returns a health_check tool', () => {
    const mockCanvas = { courses: { list: vi.fn() } } as unknown as CanvasClient
    const tools = healthTools(mockCanvas)
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('health_check')
    expect(tools[0].annotations.readOnlyHint).toBe(true)
    expect(tools[0].annotations.openWorldHint).toBe(true)
  })

  it('health_check returns ok when Canvas API is reachable', async () => {
    const mockCanvas = {
      courses: { list: vi.fn().mockResolvedValueOnce([{ id: 1, name: 'Test' }]) },
    } as unknown as CanvasClient
    const tools = healthTools(mockCanvas)

    const result = await tools[0].handler({})
    expect(result).toMatchObject({ status: 'ok' })
  })

  it('health_check returns error when Canvas API fails', async () => {
    const mockCanvas = {
      courses: { list: vi.fn().mockRejectedValueOnce(new Error('Connection refused')) },
    } as unknown as CanvasClient
    const tools = healthTools(mockCanvas)

    const result = await tools[0].handler({})
    expect(result).toMatchObject({ status: 'error' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/tools/health.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create `src/tools/health.ts`**

```typescript
// src/tools/health.ts
import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function healthTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'health_check',
      description:
        'Verify Canvas API connectivity and token validity. Returns ok if the server can reach Canvas and the token is valid.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async () => {
        try {
          const courses = await canvas.courses.list()
          return {
            status: 'ok',
            message: `Connected to Canvas. Found ${courses.length} courses.`,
          }
        } catch (error) {
          return {
            status: 'error',
            message: error instanceof Error ? error.message : 'Unknown error',
          }
        }
      },
    },
  ]
}
```

- [ ] **Step 4: Write failing test for course tools**

```typescript
// tests/tools/courses.test.ts
import { describe, it, expect, vi } from 'vitest'
import { courseTools } from '../../src/tools/courses'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasCourse } from '../../src/canvas'

describe('courseTools', () => {
  const mockCourses: CanvasCourse[] = [
    { id: 1, name: 'CS 101', course_code: 'CS101', workflow_state: 'available' },
  ]

  const mockCanvas = {
    courses: {
      list: vi.fn().mockResolvedValue(mockCourses),
      get: vi.fn().mockResolvedValue(mockCourses[0]),
      getSyllabus: vi.fn().mockResolvedValue('<p>Welcome</p>'),
    },
  } as unknown as CanvasClient

  it('returns 3 tools', () => {
    const tools = courseTools(mockCanvas)
    expect(tools).toHaveLength(3)
    expect(tools.map((t) => t.name)).toEqual(['list_courses', 'get_course', 'get_syllabus'])
  })

  it('all course tools are readOnly', () => {
    const tools = courseTools(mockCanvas)
    for (const tool of tools) {
      expect(tool.annotations.readOnlyHint).toBe(true)
    }
  })

  it('list_courses calls canvas.courses.list', async () => {
    const tools = courseTools(mockCanvas)
    const listTool = tools.find((t) => t.name === 'list_courses')!

    const result = await listTool.handler({})
    expect(result).toEqual(mockCourses)
    expect(mockCanvas.courses.list).toHaveBeenCalled()
  })

  it('get_course calls canvas.courses.get with courseId', async () => {
    const tools = courseTools(mockCanvas)
    const getTool = tools.find((t) => t.name === 'get_course')!

    const result = await getTool.handler({ course_id: 1 })
    expect(result).toEqual(mockCourses[0])
    expect(mockCanvas.courses.get).toHaveBeenCalledWith(1)
  })

  it('get_syllabus calls canvas.courses.getSyllabus with courseId', async () => {
    const tools = courseTools(mockCanvas)
    const syllabusTool = tools.find((t) => t.name === 'get_syllabus')!

    const result = await syllabusTool.handler({ course_id: 1 })
    expect(result).toBe('<p>Welcome</p>')
    expect(mockCanvas.courses.getSyllabus).toHaveBeenCalledWith(1)
  })
})
```

- [ ] **Step 5: Create `src/tools/courses.ts`**

```typescript
// src/tools/courses.ts
import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function courseTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_courses',
      description:
        'List all courses for the authenticated user. Returns course names, IDs, enrollment status, and term info.',
      inputSchema: z.object({
        enrollment_state: z
          .enum(['active', 'completed', 'all'])
          .optional()
          .describe('Filter by enrollment state. Defaults to all active courses.'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) => {
        return canvas.courses.list(params as { enrollment_state?: string })
      },
    },
    {
      name: 'get_course',
      description: 'Get detailed information about a single course by its Canvas ID.',
      inputSchema: z.object({
        course_id: z.number().describe('The Canvas course ID'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) => {
        return canvas.courses.get(params.course_id as number)
      },
    },
    {
      name: 'get_syllabus',
      description:
        'Get the syllabus content for a course. Returns the HTML body of the syllabus.',
      inputSchema: z.object({
        course_id: z.number().describe('The Canvas course ID'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) => {
        return canvas.courses.getSyllabus(params.course_id as number)
      },
    },
  ]
}
```

- [ ] **Step 6: Update `src/tools/index.ts` to register course and health tools**

```typescript
// src/tools/index.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'
import { healthTools } from './health'
import { courseTools } from './courses'

export function getAllTools(canvas: CanvasClient): ToolDefinition[] {
  return [...healthTools(canvas), ...courseTools(canvas)]
}

export function registerAllTools(server: McpServer, canvas: CanvasClient): void {
  const tools = getAllTools(canvas)
  for (const tool of tools) {
    server.tool(
      tool.name,
      tool.description,
      { ...tool.inputSchema },
      tool.annotations,
      async (params) => {
        try {
          const result = await tool.handler(params as Record<string, unknown>)
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          }
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: formatError(error) }],
            isError: true,
          }
        }
      },
    )
  }
}

function formatError(error: unknown): string {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status
    const message = (error as { message: string }).message
    switch (status) {
      case 401:
        return 'Canvas token is invalid or expired'
      case 403:
        return "You don't have permission to perform this action in this course"
      case 404:
        return 'Course/assignment/submission not found — check the ID'
      default:
        return `Canvas API error (${status}): ${message}`
    }
  }
  if (error instanceof Error) {
    if (error.message.includes('fetch')) {
      return 'Failed to connect to Canvas — check your base URL'
    }
    return error.message
  }
  return 'An unexpected error occurred'
}
```

- [ ] **Step 7: Run all tests**

```bash
pnpm vitest run
```

Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add health_check and course tools (list_courses, get_course, get_syllabus)"
```

---

## Task 8: Canvas Modules — Assignments and Submissions

**Files:**
- Create: `src/canvas/assignments.ts`
- Create: `src/canvas/submissions.ts`
- Modify: `src/canvas/index.ts`
- Create: `tests/canvas/assignments.test.ts`
- Create: `tests/canvas/submissions.test.ts`

Following the established module pattern from Task 5. The submissions module includes write operations (grading, commenting).

- [ ] **Step 1: Create `src/canvas/assignments.ts`**

```typescript
// src/canvas/assignments.ts
import type { CanvasHttpClient } from './client'
import type { CanvasAssignment, CanvasAssignmentGroup } from './types'

export class AssignmentsModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: number): Promise<CanvasAssignment[]> {
    return this.client.paginate<CanvasAssignment>(
      `/api/v1/courses/${courseId}/assignments`,
    )
  }

  async get(courseId: number, assignmentId: number): Promise<CanvasAssignment> {
    return this.client.request<CanvasAssignment>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}`,
    )
  }

  async listGroups(courseId: number): Promise<CanvasAssignmentGroup[]> {
    return this.client.paginate<CanvasAssignmentGroup>(
      `/api/v1/courses/${courseId}/assignment_groups`,
    )
  }
}
```

- [ ] **Step 2: Create `src/canvas/submissions.ts`**

```typescript
// src/canvas/submissions.ts
import type { CanvasHttpClient } from './client'
import type { CanvasSubmission } from './types'

export class SubmissionsModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: number, assignmentId: number): Promise<CanvasSubmission[]> {
    return this.client.paginate<CanvasSubmission>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions`,
      { 'include[]': 'submission_comments' },
    )
  }

  async get(
    courseId: number,
    assignmentId: number,
    userId: number,
  ): Promise<CanvasSubmission> {
    return this.client.request<CanvasSubmission>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}?include[]=submission_comments`,
    )
  }

  async grade(
    courseId: number,
    assignmentId: number,
    userId: number,
    grade: string,
  ): Promise<CanvasSubmission> {
    return this.client.request<CanvasSubmission>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}`,
      {
        method: 'PUT',
        body: JSON.stringify({ submission: { posted_grade: grade } }),
      },
    )
  }

  async comment(
    courseId: number,
    assignmentId: number,
    userId: number,
    comment: string,
  ): Promise<CanvasSubmission> {
    return this.client.request<CanvasSubmission>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          comment: { text_comment: comment },
        }),
      },
    )
  }
}
```

- [ ] **Step 3: Update `src/canvas/index.ts` to add new modules**

```typescript
// src/canvas/index.ts
import { CanvasHttpClient } from './client'
import type { CanvasClientConfig } from './types'
import { CoursesModule } from './courses'
import { AssignmentsModule } from './assignments'
import { SubmissionsModule } from './submissions'

export class CanvasClient {
  private client: CanvasHttpClient
  courses: CoursesModule
  assignments: AssignmentsModule
  submissions: SubmissionsModule

  constructor(config: CanvasClientConfig) {
    this.client = new CanvasHttpClient(config)
    this.courses = new CoursesModule(this.client)
    this.assignments = new AssignmentsModule(this.client)
    this.submissions = new SubmissionsModule(this.client)
  }
}

export { CanvasHttpClient, CanvasApiError } from './client'
export type * from './types'
```

- [ ] **Step 4: Write tests for assignments and submissions modules**

```typescript
// tests/canvas/assignments.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AssignmentsModule } from '../../src/canvas/assignments'
import { CanvasHttpClient } from '../../src/canvas/client'

describe('AssignmentsModule', () => {
  let client: CanvasHttpClient
  let assignments: AssignmentsModule

  beforeEach(() => {
    client = new CanvasHttpClient({ token: 'test', baseUrl: 'https://canvas.example.com' })
    assignments = new AssignmentsModule(client)
  })

  it('lists assignments for a course', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 1, name: 'HW1' }])
    const result = await assignments.list(100)
    expect(result).toEqual([{ id: 1, name: 'HW1' }])
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/assignments')
  })

  it('gets a single assignment', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ id: 1, name: 'HW1' })
    const result = await assignments.get(100, 1)
    expect(result).toEqual({ id: 1, name: 'HW1' })
  })

  it('lists assignment groups', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 1, name: 'Homework' }])
    const result = await assignments.listGroups(100)
    expect(result).toEqual([{ id: 1, name: 'Homework' }])
  })
})
```

```typescript
// tests/canvas/submissions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SubmissionsModule } from '../../src/canvas/submissions'
import { CanvasHttpClient } from '../../src/canvas/client'

describe('SubmissionsModule', () => {
  let client: CanvasHttpClient
  let submissions: SubmissionsModule

  beforeEach(() => {
    client = new CanvasHttpClient({ token: 'test', baseUrl: 'https://canvas.example.com' })
    submissions = new SubmissionsModule(client)
  })

  it('lists submissions', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 1, user_id: 10 }])
    const result = await submissions.list(100, 1)
    expect(result).toEqual([{ id: 1, user_id: 10 }])
  })

  it('gets a single submission', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ id: 1, score: 95 })
    const result = await submissions.get(100, 1, 10)
    expect(result).toEqual({ id: 1, score: 95 })
  })

  it('grades a submission', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ id: 1, score: 95, grade: '95' })
    const result = await submissions.grade(100, 1, 10, '95')
    expect(result).toMatchObject({ score: 95 })
    expect(client.request).toHaveBeenCalledWith(
      '/api/v1/courses/100/assignments/1/submissions/10',
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it('posts a comment on a submission', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ id: 1 })
    await submissions.comment(100, 1, 10, 'Great work!')
    expect(client.request).toHaveBeenCalledWith(
      '/api/v1/courses/100/assignments/1/submissions/10',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('Great work!'),
      }),
    )
  })
})
```

- [ ] **Step 5: Run all tests**

```bash
pnpm vitest run
```

Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add assignments and submissions canvas modules (with grading + commenting)"
```

---

## Task 9: MCP Tools — Assignments and Submissions

**Files:**
- Create: `src/tools/assignments.ts`
- Create: `src/tools/submissions.ts`
- Modify: `src/tools/index.ts`
- Create: `tests/tools/assignments.test.ts`
- Create: `tests/tools/submissions.test.ts`

- [ ] **Step 1: Create `src/tools/assignments.ts`**

```typescript
// src/tools/assignments.ts
import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function assignmentTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_assignments',
      description: 'List all assignments for a course.',
      inputSchema: z.object({
        course_id: z.number().describe('The Canvas course ID'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) => canvas.assignments.list(params.course_id as number),
    },
    {
      name: 'get_assignment',
      description: 'Get detailed information about a single assignment, including rubric settings.',
      inputSchema: z.object({
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.assignments.get(params.course_id as number, params.assignment_id as number),
    },
    {
      name: 'list_assignment_groups',
      description: 'List assignment groups for a course with weights and rules.',
      inputSchema: z.object({
        course_id: z.number().describe('The Canvas course ID'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) => canvas.assignments.listGroups(params.course_id as number),
    },
  ]
}
```

- [ ] **Step 2: Create `src/tools/submissions.ts`**

```typescript
// src/tools/submissions.ts
import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function submissionTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_submissions',
      description:
        'List all submissions for an assignment, including comments and submission history.',
      inputSchema: z.object({
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.submissions.list(params.course_id as number, params.assignment_id as number),
    },
    {
      name: 'get_submission',
      description: 'Get detailed information about a single submission.',
      inputSchema: z.object({
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID'),
        user_id: z.number().describe('The Canvas user ID of the student'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.submissions.get(
          params.course_id as number,
          params.assignment_id as number,
          params.user_id as number,
        ),
    },
    {
      name: 'grade_submission',
      description:
        'Post a grade to a submission. The grade value depends on the assignment grading type (points, percentage, letter grade, pass/fail).',
      inputSchema: z.object({
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID'),
        user_id: z.number().describe('The Canvas user ID of the student'),
        grade: z.string().describe('The grade value (e.g., "95", "A", "pass", "85%")'),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (params) =>
        canvas.submissions.grade(
          params.course_id as number,
          params.assignment_id as number,
          params.user_id as number,
          params.grade as string,
        ),
    },
    {
      name: 'comment_on_submission',
      description:
        'Post a comment on a submission. Comments are visible to the student.',
      inputSchema: z.object({
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID'),
        user_id: z.number().describe('The Canvas user ID of the student'),
        comment: z.string().describe('The comment text'),
      }),
      annotations: { destructiveHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.submissions.comment(
          params.course_id as number,
          params.assignment_id as number,
          params.user_id as number,
          params.comment as string,
        ),
    },
  ]
}
```

- [ ] **Step 3: Update `src/tools/index.ts` to register new tools**

Add imports and spread into `getAllTools`:

```typescript
import { assignmentTools } from './assignments'
import { submissionTools } from './submissions'

export function getAllTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    ...healthTools(canvas),
    ...courseTools(canvas),
    ...assignmentTools(canvas),
    ...submissionTools(canvas),
  ]
}
```

- [ ] **Step 4: Write tests for assignment and submission tools**

Follow same pattern as `tests/tools/courses.test.ts`: mock CanvasClient, verify tool count, names, annotations, delegation.

- [ ] **Step 5: Run all tests**

```bash
pnpm vitest run
```

Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add assignment and submission tools (list, get, grade, comment)"
```

---

## Task 10: Remaining Canvas Modules (Rubrics, Quizzes, Files, Users, Groups, Enrollments, Discussions, Modules, Pages, Calendar, Conversations)

**Files:**
- Create: `src/canvas/rubrics.ts`
- Create: `src/canvas/quizzes.ts`
- Create: `src/canvas/files.ts`
- Create: `src/canvas/users.ts`
- Create: `src/canvas/groups.ts`
- Create: `src/canvas/enrollments.ts`
- Create: `src/canvas/discussions.ts`
- Create: `src/canvas/modules.ts`
- Create: `src/canvas/pages.ts`
- Create: `src/canvas/calendar.ts`
- Create: `src/canvas/conversations.ts`
- Modify: `src/canvas/index.ts`
- Create: tests for each module

Each module follows the established pattern from Tasks 5 and 8. The Canvas API endpoints for each module:

**Rubrics:**
- `GET /api/v1/courses/:courseId/rubrics` → `list(courseId)`
- `GET /api/v1/courses/:courseId/rubrics/:rubricId` → `get(courseId, rubricId)`
- `GET /api/v1/courses/:courseId/assignments/:assignmentId/submissions/:userId?include[]=rubric_assessment` → `getAssessment(courseId, assignmentId, userId)`
- `POST /api/v1/courses/:courseId/rubric_associations/:associationId/rubric_assessments` → `submitAssessment(courseId, associationId, data)`

**Quizzes:**
- `GET /api/v1/courses/:courseId/quizzes/:quizId` → `get(courseId, quizId)`
- `GET /api/v1/courses/:courseId/quizzes/:quizId/submissions` → `listSubmissions(courseId, quizId)` (envelope: `quiz_submissions`)
- `GET /api/v1/courses/:courseId/quizzes/:quizId/questions` → `listQuestions(courseId, quizId)`
- `GET /api/v1/quiz_submissions/:quizSubmissionId/questions?include[]=quiz_question` → `getSubmissionAnswers(quizSubmissionId)` (envelope: `quiz_submission_questions`)
- `PUT /api/v1/courses/:courseId/quizzes/:quizId/submissions/:submissionId` → `scoreQuestion(courseId, quizId, submissionId, questionId, score, comment)`

**Files:**
- `GET /api/v1/courses/:courseId/files` → `list(courseId)`
- `GET /api/v1/courses/:courseId/folders` → `listFolders(courseId)`
- `GET /api/v1/courses/:courseId/files/:fileId` → `get(courseId, fileId)`

**Users:**
- `GET /api/v1/courses/:courseId/users?enrollment_type[]=student` → `listStudents(courseId)`
- `GET /api/v1/users/:userId` → `get(userId)`
- `GET /api/v1/users/self/profile` → `getProfile()`

**Groups:**
- `GET /api/v1/courses/:courseId/groups` → `list(courseId)`
- `GET /api/v1/groups/:groupId/users` → `listMembers(groupId)`

**Enrollments:**
- `GET /api/v1/users/self/enrollments` → `list()`

**Discussions:**
- `GET /api/v1/courses/:courseId/discussion_topics` → `list(courseId)`
- `GET /api/v1/courses/:courseId/discussion_topics/:topicId?include[]=all_dates` → `get(courseId, topicId)`
- `GET /api/v1/courses/:courseId/discussion_topics?only_announcements=true` → `listAnnouncements(courseId)`
- `POST /api/v1/courses/:courseId/discussion_topics/:topicId/entries` → `postEntry(courseId, topicId, message)`

**Modules:**
- `GET /api/v1/courses/:courseId/modules` → `list(courseId)`
- `GET /api/v1/courses/:courseId/modules/:moduleId` → `get(courseId, moduleId)`
- `GET /api/v1/courses/:courseId/modules/:moduleId/items` → `listItems(courseId, moduleId)`

**Pages:**
- `GET /api/v1/courses/:courseId/pages` → `list(courseId)`
- `GET /api/v1/courses/:courseId/pages/:pageUrl` → `get(courseId, pageUrl)`

**Calendar:**
- `GET /api/v1/calendar_events?context_codes[]=course_:courseId` → `list(courseId)`

**Conversations:**
- `GET /api/v1/conversations` → `list()`
- `POST /api/v1/conversations` → `send(recipients, subject, body)`

- [ ] **Step 1: Create all 11 module files following the established pattern**

Each module is a class with constructor taking `CanvasHttpClient`, using `client.paginate()` for lists, `client.request()` for single items, and `client.request()` with `method: 'PUT'` or `method: 'POST'` for writes. Use the endpoint mappings above.

- [ ] **Step 2: Update `src/canvas/index.ts` to add all modules to the facade**

Add all 11 new modules to the `CanvasClient` class, following the same pattern as courses/assignments/submissions.

- [ ] **Step 3: Write tests for each module**

One test file per module in `tests/canvas/`. Each test mocks `client.paginate` or `client.request` and verifies the correct endpoint is called with correct parameters.

- [ ] **Step 4: Run all tests**

```bash
pnpm vitest run
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add remaining canvas modules (rubrics, quizzes, files, users, groups, enrollments, discussions, modules, pages, calendar, conversations)"
```

---

## Task 11: Remaining MCP Tools (All 15 Domains)

**Files:**
- Create: `src/tools/rubrics.ts`
- Create: `src/tools/quizzes.ts`
- Create: `src/tools/files.ts`
- Create: `src/tools/users.ts`
- Create: `src/tools/groups.ts`
- Create: `src/tools/enrollments.ts`
- Create: `src/tools/discussions.ts`
- Create: `src/tools/modules.ts`
- Create: `src/tools/pages.ts`
- Create: `src/tools/calendar.ts`
- Create: `src/tools/conversations.ts`
- Modify: `src/tools/index.ts`
- Create: tests for each tool domain

Each tool file follows the pattern from Tasks 7 and 9. Key annotations:

**Read tools** (all): `{ readOnlyHint: true, openWorldHint: true }`
**Write tools:**
- `submit_rubric_assessment`: `{ destructiveHint: true, idempotentHint: true, openWorldHint: true }`
- `score_quiz_question`: `{ destructiveHint: true, idempotentHint: true, openWorldHint: true }`
- `post_discussion_entry`: `{ destructiveHint: true, openWorldHint: true }`
- `send_conversation`: `{ destructiveHint: true, openWorldHint: true }`

- [ ] **Step 1: Create all 11 tool files following the established pattern**

Each tool file exports a function `(canvas: CanvasClient) => ToolDefinition[]` with Zod input schemas and handlers that delegate to the corresponding canvas module.

- [ ] **Step 2: Update `src/tools/index.ts` to register all tool domains**

```typescript
export function getAllTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    ...healthTools(canvas),
    ...courseTools(canvas),
    ...assignmentTools(canvas),
    ...submissionTools(canvas),
    ...rubricTools(canvas),
    ...quizTools(canvas),
    ...fileTools(canvas),
    ...userTools(canvas),
    ...groupTools(canvas),
    ...enrollmentTools(canvas),
    ...discussionTools(canvas),
    ...moduleTools(canvas),
    ...pageTools(canvas),
    ...calendarTools(canvas),
    ...conversationTools(canvas),
  ]
}
```

- [ ] **Step 3: Write tests for each tool domain**

- [ ] **Step 4: Verify total tool count**

```bash
pnpm vitest run
```

Add a test in `tests/server.test.ts`:

```typescript
it('registers all 88 tools', () => {
  const { canvas } = createCanvasMCPServer({
    token: 'test',
    baseUrl: 'https://canvas.example.com',
  })
  const tools = getAllTools(canvas)
  expect(tools).toHaveLength(88)
})
```

Expected: All PASS, 88 tools registered

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add all remaining MCP tools (rubrics, quizzes, files, users, groups, enrollments, discussions, modules, pages, calendar, conversations)"
```

---

## Task 12: MCP Resources

**Files:**
- Create: `src/resources/syllabus.ts`
- Create: `src/resources/assignment-description.ts`
- Create: `src/resources/index.ts`
- Modify: `src/server.ts`
- Create: `tests/resources/syllabus.test.ts`

- [ ] **Step 1: Create `src/resources/syllabus.ts`**

```typescript
// src/resources/syllabus.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../canvas'

export function registerSyllabusResource(server: McpServer, canvas: CanvasClient): void {
  server.resource(
    'course-syllabus',
    'canvas://course/{courseId}/syllabus',
    { description: 'Get the syllabus content for a Canvas course' },
    async (uri) => {
      const courseId = Number(uri.pathname.split('/')[2])
      const syllabus = await canvas.courses.getSyllabus(courseId)
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/html',
            text: syllabus ?? 'No syllabus content available.',
          },
        ],
      }
    },
  )
}
```

- [ ] **Step 2: Create `src/resources/assignment-description.ts`**

```typescript
// src/resources/assignment-description.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../canvas'

export function registerAssignmentDescriptionResource(
  server: McpServer,
  canvas: CanvasClient,
): void {
  server.resource(
    'assignment-description',
    'canvas://course/{courseId}/assignment/{assignmentId}/description',
    { description: 'Get the description/instructions for a Canvas assignment' },
    async (uri) => {
      const parts = uri.pathname.split('/')
      const courseId = Number(parts[2])
      const assignmentId = Number(parts[4])
      const assignment = await canvas.assignments.get(courseId, assignmentId)
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/html',
            text: assignment.description ?? 'No description available.',
          },
        ],
      }
    },
  )
}
```

- [ ] **Step 3: Create `src/resources/index.ts`**

```typescript
// src/resources/index.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../canvas'
import { registerSyllabusResource } from './syllabus'
import { registerAssignmentDescriptionResource } from './assignment-description'

export function registerAllResources(server: McpServer, canvas: CanvasClient): void {
  registerSyllabusResource(server, canvas)
  registerAssignmentDescriptionResource(server, canvas)
}
```

- [ ] **Step 4: Update `src/server.ts` to register resources**

Add `import { registerAllResources } from './resources'` and call `registerAllResources(server, canvas)` after `registerAllTools`.

- [ ] **Step 5: Write tests, run all tests**

```bash
pnpm vitest run
```

Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add MCP resources (course syllabus, assignment description)"
```

---

## Task 13: CLI and stdio Transport

**Files:**
- Create: `src/cli.ts`
- Create: `src/stdio.ts`

- [ ] **Step 1: Create `src/cli.ts`**

```typescript
// src/cli.ts
export interface CliConfig {
  token: string
  baseUrl: string
  mode: 'stdio' | 'http'
  port: number
}

export function parseArgs(args: string[]): CliConfig {
  const config: CliConfig = {
    token: process.env.CANVAS_API_TOKEN ?? '',
    baseUrl: process.env.CANVAS_BASE_URL ?? '',
    mode: 'stdio',
    port: 3001,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--token':
        config.token = args[++i] ?? ''
        break
      case '--base-url':
        config.baseUrl = args[++i] ?? ''
        break
      case 'serve':
        config.mode = 'http'
        break
      case '--port':
        config.port = Number(args[++i]) || 3001
        break
    }
  }

  if (!config.token) {
    console.error('Error: Canvas API token required. Use --token or set CANVAS_API_TOKEN')
    process.exit(1)
  }
  if (!config.baseUrl) {
    console.error('Error: Canvas base URL required. Use --base-url or set CANVAS_BASE_URL')
    process.exit(1)
  }

  return config
}
```

- [ ] **Step 2: Create `src/stdio.ts`**

```typescript
// src/stdio.ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createCanvasMCPServer } from './server'
import { parseArgs } from './cli'

async function main() {
  const config = parseArgs(process.argv.slice(2))
  const { server } = createCanvasMCPServer({
    token: config.token,
    baseUrl: config.baseUrl,
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
```

- [ ] **Step 3: Build and verify CLI starts**

```bash
pnpm build
echo '{}' | node dist/cli.js --token test --base-url https://example.com 2>&1 || true
```

Expected: No crash (may show MCP protocol errors since stdin isn't a real MCP client, but the process starts)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add CLI argument parsing and stdio transport entry point"
```

---

## Task 14: HTTP Transport

**Files:**
- Create: `src/http.ts`

- [ ] **Step 1: Create `src/http.ts`**

```typescript
// src/http.ts
import { createServer } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createCanvasMCPServer } from './server'
import { parseArgs } from './cli'

async function main() {
  const config = parseArgs(process.argv.slice(2))
  const port = config.port

  const httpServer = createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Canvas-Token, X-Canvas-Base-URL')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // Health check endpoint
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }

    // Extract per-request Canvas credentials from headers
    const token = (req.headers['x-canvas-token'] as string) ?? config.token
    const baseUrl = (req.headers['x-canvas-base-url'] as string) ?? config.baseUrl

    if (!token || !baseUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          error: 'Missing Canvas credentials. Provide X-Canvas-Token and X-Canvas-Base-URL headers.',
        }),
      )
      return
    }

    // Create a fresh MCP server per request (per-request credentials)
    const { server } = createCanvasMCPServer({ token, baseUrl })
    const transport = new StreamableHTTPServerTransport('/mcp')

    await server.connect(transport)
    await transport.handleRequest(req, res)
  })

  httpServer.listen(port, () => {
    console.log(`Canvas LMS MCP server listening on http://localhost:${port}`)
    console.log(`MCP endpoint: http://localhost:${port}/mcp`)
    console.log(`Health check: http://localhost:${port}/health`)
  })
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
```

> **Note for implementer:** The exact `StreamableHTTPServerTransport` API may differ from this sketch. Consult the `@modelcontextprotocol/sdk` documentation and use the `context7` MCP server or web search to get the current API surface. The key requirements are: (1) per-request credentials from headers, (2) CORS support, (3) `/health` endpoint, (4) MCP protocol on `/mcp`.

- [ ] **Step 2: Build and verify HTTP server starts**

```bash
pnpm build
CANVAS_API_TOKEN=test CANVAS_BASE_URL=https://example.com node dist/http.js serve --port 3001 &
sleep 1
curl http://localhost:3001/health
kill %1
```

Expected: `{"status":"ok"}`

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add HTTP transport with per-request auth and CORS"
```

---

## Task 15: Docker Support

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`

- [ ] **Step 1: Create `Dockerfile`**

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/dist ./dist
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q --spider http://localhost:3001/health || exit 1
CMD ["node", "dist/http.js", "serve", "--port", "3001"]
```

- [ ] **Step 2: Create `docker-compose.yml`**

```yaml
version: '3.8'
services:
  canvas-mcp:
    build: .
    ports:
      - '3001:3001'
    environment:
      - CANVAS_API_TOKEN=${CANVAS_API_TOKEN}
      - CANVAS_BASE_URL=${CANVAS_BASE_URL}
    healthcheck:
      test: ['CMD', 'wget', '-q', '--spider', 'http://localhost:3001/health']
      interval: 30s
      timeout: 5s
      retries: 3
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "chore: add Dockerfile and docker-compose for HTTP server mode"
```

---

## Task 16: End-User Documentation

**Files:**
- Create: `README.md`
- Create: `docs/student-guide.md`
- Create: `docs/educator-guide.md`
- Create: `docs/integration-guide.md`

- [ ] **Step 1: Create `README.md`**

Include:
- Project description and badges
- One-line install: `npx canvas-lms-mcp --token $TOKEN --base-url $URL`
- Configuration examples for Claude Desktop, Cursor, VS Code, ChatGPT (HTTP mode)
- 5 example prompts ("What courses am I enrolled in?", "Show my grades", "List submissions for Assignment 3", "Grade student 12345 on Assignment 2", "What's due this week?")
- Complete tool inventory table (copy from AGENTS.md)
- Three deployment modes explained
- Links to guides
- Contributing section
- License (MIT)

- [ ] **Step 2: Create `docs/student-guide.md`**

Include:
- How to get a Canvas personal access token (Canvas → Account → Settings → New Access Token)
- Note about institutional restrictions on token creation
- Claude Desktop config example
- 10 example prompts for students
- List of read-only tools available

- [ ] **Step 3: Create `docs/educator-guide.md`**

Include:
- Setup instructions
- Grading workflows: single submission, rubric-based, quiz essay scoring
- 10 example prompts for educators
- Write operations and their effects
- Privacy: tokens per-request, never stored in HTTP mode

- [ ] **Step 4: Create `docs/integration-guide.md`**

Include the three integration patterns from the spec (dev-time MCP, shared client, runtime MCP) with code examples.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: add README, student guide, educator guide, and integration guide"
```

---

## Task 17: Final Verification and Build

- [ ] **Step 1: Run full CI-equivalent locally**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: All pass, dist/ contains server.js, stdio.js, http.js, cli.js, canvas/index.js

- [ ] **Step 2: Verify npm package exports**

```bash
node -e "import('canvas-lms-mcp').then(m => console.log(Object.keys(m)))" --input-type=module 2>&1 || echo "Will work after npm publish"
ls dist/
```

Expected: All entry points present in dist/

- [ ] **Step 3: Verify tool count**

```bash
pnpm vitest run tests/server.test.ts
```

Expected: 88 tools registered

- [ ] **Step 4: Push to GitHub**

```bash
git push -u origin main
```

- [ ] **Step 5: Verify CI passes on GitHub**

Check `https://github.com/bruchris/canvas-lms-mcp/actions` — CI workflow should pass.

- [ ] **Step 6: Tag initial release candidate**

```bash
git tag v0.1.0-rc.1
git push origin v0.1.0-rc.1
```

---

## Summary

| Task | What | Tools Added |
|------|------|-------------|
| 1 | Repo + project init | — |
| 2 | Agent team + AI config | — |
| 3 | CI/CD + release-please | — |
| 4 | Canvas HTTP client + types | — |
| 5 | Courses module + facade | — |
| 6 | MCP server factory + tool types | — |
| 7 | Health + course tools | 6 tools |
| 8 | Assignments + submissions modules | — |
| 9 | Assignment + submission tools | 10 tools |
| 10 | All remaining canvas modules | — |
| 11 | All remaining MCP tools | 72 tools |
| 12 | MCP resources | 2 resources |
| 13 | CLI + stdio transport | — |
| 14 | HTTP transport | — |
| 15 | Docker | — |
| 16 | Documentation | — |
| 17 | Final verification | — |

**Total: 88 tools, 2 resources, 3 transports, 17 tasks**
