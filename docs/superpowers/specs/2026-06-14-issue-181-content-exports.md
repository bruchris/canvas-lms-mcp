---
issue: 181
---

# Content Exports via Canvas `content_exports` API (spec for #181)

**Date**: 2026-06-14  
**Issue**: #181 — Export course content (Common Cartridge / QTI / zip) via content exports  
**Status**: Design proposal, awaiting CTO decision

## TL;DR — Recommendation

**Ship three tools in one implementation PR as a clean new domain.** The create→poll→download workflow is the core complexity; no dependencies on existing tool modules.

| Tool | Contract |
|------|----------|
| `create_content_export` | POST `/courses/:course_id/content_exports` — initiates async export job |
| `get_content_export` | GET `/courses/:course_id/content_exports/:export_id` — polls status; surfaces `attachment.url` when done |
| `list_content_exports` | GET `/courses/:course_id/content_exports` — lists all exports for a course |

- **New domain**: `src/canvas/content-exports.ts` (`ContentExportsModule`) + `src/tools/content-exports.ts` + `contentExports` property on `CanvasClient`
- **Pseudonymization**: Not required. Content export payloads contain course metadata only (export type, status, attachment URL/filename) — no student PII.
- **Dependencies**: None new. Uses existing `CanvasHttpClient.request()` and `client.paginate()`.
- **Tool count**: 120 → 123 (+3: 1 write, 2 read).

## The four unknowns, retired

### 1. Async handling: separate tools vs. blocking-poll

**Decision: two tools — `create_content_export` and `get_content_export`.**

Canvas exports are async jobs that take 10–300 seconds depending on course size. A single blocking tool would:
1. Risk MCP timeout on any course larger than trivial.
2. Conceal progress — the agent cannot report "still exporting" to the user mid-wait.
3. Make error recovery ambiguous: a timeout on a blocking tool is indistinguishable from Canvas failure, and re-calling would kick off a *second* export rather than resuming the first.

The create→poll pattern is idiomatic for MCP agent loops: `create_content_export` returns immediately with `export_id` + `workflow_state: "created"`. The agent then calls `get_content_export` on a loop (or after a delay) until `workflow_state` is `"exported"` or `"failed"`. The issue itself recommends this split.

No bundled polling shim in v1. A convenience `await_content_export` wrapper tool (blocking, bounded) could be additive in a follow-up — it does not change the underlying API shape.

### 2. Scope: full-course only vs. partial export with `select[]`

**Decision: full-course export only for MVP.**

Partial exports (`select[assignments][]=<id>` etc.) require a typed selection schema with arrays of IDs per content type. The set of valid selectable types differs by `export_type` (CC vs. QTI vs. zip). This roughly doubles the input schema complexity and test surface with no benefit for the primary use case (bulk backup/migration).

`create_content_export` takes only `course_id` and `export_type`. Partial-scope export can be added in a follow-up once the base API is stable.

### 3. Content migrations (import side): now vs. follow-up

**Decision: follow-up issue only.**

Import (`content_migrations`) involves:
- Accepting a file (zip/CC) as input — which requires either a local file path (environment-specific), base64 binary (impractical for hundreds-of-MB packages), or a pre-existing Canvas file ID (requires a separate upload step).
- A separate migration progress endpoint with its own job lifecycle.
- Post-migration selective import configuration.

The export surface is a coherent standalone value unit. The import side carries its own unknowns and belongs in a scoped follow-up issue.

### 4. Download delivery: pre-signed URL vs. streaming file content

**Decision: return the pre-signed `attachment.url`. No streaming.**

Canvas export attachments are served from a pre-signed S3/CDN URL valid without an additional Canvas token. Course export packages can be 10 MB – 500 MB; streaming binary content through a JSON MCP tool response (base64-encoded) is impractical at that scale.

The correct agent flow: `create_content_export` → loop `get_content_export` until exported → present `attachment.url` → user downloads directly. This mirrors how `files.ts` already surfaces `meta.url`.

**URL lifetime caveat**: Canvas pre-signed attachment URLs have a TTL (typically ~1 hour). The tool description warns to "download promptly"; re-fetching the export object yields a fresh URL if needed.

## Tool contracts

### `create_content_export`

> Start a Canvas course content export. Exports are asynchronous — this tool returns immediately with an export ID and initial status. Call `get_content_export` to check progress and retrieve the download link when the export is done.

**Annotations**: `destructiveHint: true`, `openWorldHint: true`.

`destructiveHint: true` is correct for this POST: it initiates a server-side export job, consistent with the project convention of marking all write (POST) operations as `destructiveHint: true` regardless of whether they destroy content (see `create_discussion`, `send_conversation`, `create_calendar_event`).

**Input** (Zod):

| Field | Type | Notes |
|-------|------|-------|
| `course_id` | `z.number()` required | The Canvas course ID |
| `export_type` | `z.enum(['common_cartridge', 'qti', 'zip'])` required | `common_cartridge` = IMS CC (widely portable); `qti` = assessments only; `zip` = Canvas-native |

**Canvas endpoint**: `POST /api/v1/courses/:course_id/content_exports`

**Request body**: `{ export_type: "common_cartridge" | "qti" | "zip" }` (flat JSON, NOT wrapped in a `content_export:` envelope). The Canvas content exports endpoint accepts top-level parameters — unlike assignment/quiz CRUD which wraps in `{ assignment: { ... } }`. Send `JSON.stringify({ export_type: exportType })`.

**Output shape**:
```jsonc
{
  "id": 42,
  "export_type": "common_cartridge",
  "workflow_state": "created",
  "progress_url": null,
  "attachment": null,
  "user_id": 99,
  "created_at": "2026-06-14T10:00:00Z",
  "updated_at": "2026-06-14T10:00:00Z"
}
```

`progress_url` is `null` in the `"created"` state; it becomes a non-null URL once the export is actually running (`"exporting"`).

### `get_content_export`

> Get the status of a content export. When `workflow_state` is `"exported"`, `attachment.url` contains a time-limited download link — download it promptly. Returns `attachment: null` while in progress or on failure.

**Annotations**: `readOnlyHint: true`, `openWorldHint: true`.

**Input** (Zod):

| Field | Type | Notes |
|-------|------|-------|
| `course_id` | `z.number()` required | The Canvas course ID |
| `export_id` | `z.number()` required | The export ID returned by `create_content_export` |

**Canvas endpoint**: `GET /api/v1/courses/:course_id/content_exports/:export_id`

**Output shape (exported)**:
```jsonc
{
  "id": 42,
  "export_type": "common_cartridge",
  "workflow_state": "exported",
  "progress_url": "https://school.instructure.com/api/v1/progress/999",
  "attachment": {
    "url": "https://instructure-uploads.s3.amazonaws.com/...",
    "filename": "course_42_export.imscc"
  },
  "user_id": 99,
  "created_at": "2026-06-14T10:00:00Z",
  "updated_at": "2026-06-14T10:00:45Z"
}
```

`attachment` is `null` when `workflow_state` is `"created"`, `"exporting"`, or `"failed"`. `progress_url` is non-null during `"exporting"` and `"exported"` states; may be null for `"failed"`.

### `list_content_exports`

> List all content exports for a course.

**Annotations**: `readOnlyHint: true`, `openWorldHint: true`.

**Input** (Zod):

| Field | Type | Notes |
|-------|------|-------|
| `course_id` | `z.number()` required | The Canvas course ID |

**Canvas endpoint**: `GET /api/v1/courses/:course_id/content_exports`

Uses `client.paginate()` as a safety net; in practice this endpoint returns all exports in one page for typical course histories.

**Output**: Array of `CanvasContentExport`.

## Canvas client additions

### New types (`src/canvas/types.ts`)

Append a new `// --- Content Exports ---` section at the end of the file:

```ts
// --- Content Exports ---

export type ContentExportType = 'common_cartridge' | 'qti' | 'zip'

export type ContentExportWorkflowState =
  | 'created'
  | 'exporting'
  | 'exported'
  | 'failed'
  | (string & {})  // Canvas may emit undocumented states (e.g., 'waiting_for_external_tool')

export interface CanvasContentExportAttachment {
  url: string
  filename: string
}

export interface CanvasContentExport {
  id: number
  export_type: ContentExportType
  workflow_state: ContentExportWorkflowState
  progress_url: string | null  // null when 'created'; non-null when 'exporting'/'exported'
  attachment: CanvasContentExportAttachment | null  // non-null only when workflow_state === 'exported'
  user_id?: number  // opaque integer — the initiating user; not PII that triggers pseudonymizer
  created_at: string
  updated_at: string
}
```

New types are automatically re-exported by the existing `export type * from './types'` in `src/canvas/index.ts` — no additional export statement needed.

### New module (`src/canvas/content-exports.ts`)

```ts
import type { CanvasHttpClient } from './client'
import type { CanvasContentExport, ContentExportType } from './types'

export class ContentExportsModule {
  constructor(private client: CanvasHttpClient) {}

  async create(courseId: number, exportType: ContentExportType): Promise<CanvasContentExport> {
    return this.client.request<CanvasContentExport>(
      `/api/v1/courses/${courseId}/content_exports`,
      { method: 'POST', body: JSON.stringify({ export_type: exportType }) },
    )
  }

  async get(courseId: number, exportId: number): Promise<CanvasContentExport> {
    return this.client.request<CanvasContentExport>(
      `/api/v1/courses/${courseId}/content_exports/${exportId}`,
    )
  }

  async list(courseId: number): Promise<CanvasContentExport[]> {
    return this.client.paginate<CanvasContentExport>(
      `/api/v1/courses/${courseId}/content_exports`,
    )
  }
}
```

No explicit `Content-Type: application/json` header is needed — `CanvasHttpClient.request()` sets it automatically when `body` is provided.

### `CanvasClient` wiring (`src/canvas/index.ts`)

1. Add import (alphabetically after `ConversationsModule`):
   ```ts
   import { ContentExportsModule } from './content-exports'
   ```
2. Add class property after `newQuizzes: NewQuizzesModule`:
   ```ts
   contentExports: ContentExportsModule
   ```
3. Add constructor initialisation after `this.newQuizzes = new NewQuizzesModule(this.client)`:
   ```ts
   this.contentExports = new ContentExportsModule(this.client)
   ```

### Tool module (`src/tools/content-exports.ts`)

```ts
import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ContentExportType } from '../canvas/types'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'

export function contentExportsTools(
  canvas: CanvasClient,
  _pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
  return [
    {
      name: 'create_content_export',
      description:
        'Start a Canvas course content export. Exports are asynchronous — this tool returns immediately with an export ID and initial workflow_state. Call get_content_export to check progress and retrieve the time-limited download link when the export finishes.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        export_type: z
          .enum(['common_cartridge', 'qti', 'zip'])
          .describe(
            'Export format: common_cartridge (IMS CC, widely portable), qti (assessments only), zip (Canvas-native)',
          ),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.contentExports.create(
          params.course_id as number,
          params.export_type as ContentExportType,
        ),
    },
    {
      name: 'get_content_export',
      description:
        'Get the status of a content export. When workflow_state is "exported", attachment.url contains a time-limited download link — download it promptly as the URL expires. Returns attachment: null while in progress or on failure.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        export_id: z.number().describe('The export ID returned by create_content_export'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.contentExports.get(params.course_id as number, params.export_id as number),
    },
    {
      name: 'list_content_exports',
      description: 'List all content exports for a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) => canvas.contentExports.list(params.course_id as number),
    },
  ]
}
```

The `_pseudonymizer?: Pseudonymizer` parameter (unused, underscore-prefixed) matches the `ToolDomainRegistration.getTools` interface signature and is consistent with all other tool modules.

### Catalog registration (`src/tools/catalog.ts`)

Append as the **last entry** in `toolDomainCatalog` (currently `attention` is last):

```ts
import { contentExportsTools } from './content-exports'
// in toolDomainCatalog:
{
  domain: 'content_exports',
  defaultPrimaryAudience: 'educator',
  getTools: contentExportsTools,
},
```

`defaultPrimaryAudience: 'educator'` is correct: any instructor can export their own course; this is not admin-only functionality.

## Pseudonymizer coverage

`CanvasContentExport` carries no student PII. Fields are: numeric IDs, export type, workflow state, progress URL, attachment filename/URL, and `user_id` (an opaque integer — the teacher/admin who initiated the export, not a student identifier). No `user_name`, no `CanvasUser`, no `participants` array. The CLAUDE.md pseudonymizer rule does not apply; no `PSEUDONYMIZER_WRAPPED_TOOLS` entry is needed and CI's `coverage.test.ts` will not fail.

## Registry test updates (`tests/tools/registry.test.ts`)

This file has hard-coded assertions that **must** be updated as part of the implementation task:

### 1. `buildFullMockCanvas()` — add `contentExports` stub

```ts
contentExports: {
  create: async () => ({}),
  get: async () => ({}),
  list: async () => [],
},
```

### 2. Tool count assertion

```ts
// Before:
expect(tools).toHaveLength(120)
// After:
expect(tools).toHaveLength(123)
```

Also add to the names expectations:
```ts
// Content Exports (3)
expect(names).toContain('create_content_export')
expect(names).toContain('get_content_export')
expect(names).toContain('list_content_exports')
```

### 3. `write tools have destructiveHint: true` test

Add `'create_content_export'` to the `writeToolNames` array.

### 4. `read tools have readOnlyHint: true` test

Add `'create_content_export'` to the `writeToolNames` Set (so it is excluded from the read-only check).

## Test plan (`tests/tools/content-exports.test.ts`)

All tests use mocked Canvas responses via `vi.spyOn(global, 'fetch')` or equivalent vitest mocking; no real Canvas instance is contacted. See `tests/tools/discussions.test.ts` for the mock pattern.

### Shared fixture

```ts
const BASE_EXPORT: CanvasContentExport = {
  id: 42,
  export_type: 'common_cartridge',
  workflow_state: 'created',
  progress_url: null,
  attachment: null,
  user_id: 99,
  created_at: '2026-06-14T10:00:00Z',
  updated_at: '2026-06-14T10:00:00Z',
}

const EXPORTING_EXPORT = {
  ...BASE_EXPORT,
  workflow_state: 'exporting' as const,
  progress_url: 'https://school.instructure.com/api/v1/progress/999',
}

const EXPORTED_EXPORT = {
  ...BASE_EXPORT,
  workflow_state: 'exported' as const,
  progress_url: 'https://school.instructure.com/api/v1/progress/999',
  attachment: {
    url: 'https://s3.example.com/course_42.imscc',
    filename: 'course_42_export.imscc',
  },
}

const FAILED_EXPORT = {
  ...BASE_EXPORT,
  workflow_state: 'failed' as const,
  progress_url: null,
}
```

### Canvas module tests (`ContentExportsModule`)

| # | Scenario | Mock | Assert |
|---|----------|------|--------|
| 1 | `create` — success | 200 `BASE_EXPORT` | Returns `workflow_state: 'created'`, `attachment: null` |
| 2 | `get` — exporting | 200 `EXPORTING_EXPORT` | `attachment` is null, `progress_url` is non-null |
| 3 | `get` — exported | 200 `EXPORTED_EXPORT` | `attachment.url` is present |
| 4 | `get` — failed | 200 `FAILED_EXPORT` | Returns without throwing; `attachment` is null |
| 5 | `list` — two items | 200 `[EXPORTED_EXPORT, BASE_EXPORT]` | Array with 2 items |
| 6 | `get` — 404 | 404 JSON | Throws `CanvasApiError` with `.status === 404` |
| 7 | `create` — 403 | 403 JSON | Throws `CanvasApiError` with `.status === 403` |

### Tool layer tests

| # | Scenario | Assert |
|---|----------|--------|
| 8 | `create_content_export` for each of the 3 export types (`it.each`) | Returns `workflow_state: 'created'`, `attachment: null` |
| 9 | `get_content_export` — exported state | Response JSON contains `attachment.url` |
| 10 | `get_content_export` — failed state | `isError` is falsy; response contains `workflow_state: 'failed'` |
| 11 | `list_content_exports` | Returns array (non-error) |
| 12 | `get_content_export` when Canvas returns 404 | `isError: true`, text contains "not found" |
| 13 | `create_content_export` when Canvas returns 401 | Text contains "Canvas token is invalid or expired" |

## Ship order and implementation subtask

**Single implementation PR** on branch `scout/feat-181`, conventional title: `feat: add content_exports tools (list_content_exports, create_content_export, get_content_export)`

Implementation steps (tests first per CLAUDE.md):
1. Write `tests/tools/content-exports.test.ts` with fixtures above
2. Update `tests/tools/registry.test.ts` (see Registry test updates section)
3. Add types to `src/canvas/types.ts`
4. Create `src/canvas/content-exports.ts`
5. Wire `contentExports` into `src/canvas/index.ts`
6. Create `src/tools/content-exports.ts`
7. Register in `src/tools/catalog.ts`
8. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

## Out of scope

- Partial (`select[]`) content exports — course-level only for MVP
- `content_migrations` (import side) — separate follow-up issue
- Streaming or base64-encoding export binary content through the MCP response
- A blocking/polling convenience wrapper tool — additive follow-up if needed

## Risks and notes for the CTO decision

- **Attachment URL lifetime**: Canvas pre-signed URLs have a TTL (~1 hour typically). The tool description warns about this. Re-fetching the export object with `get_content_export` yields a fresh URL.
- **`create_content_export` annotation**: `destructiveHint: true` because it initiates a server-side export job (POST). This follows the project convention for all POST operations (see `create_discussion`, `send_conversation`) — it does not delete or modify course content.
- **Rate limits / quotas**: Canvas does not publish a formal rate limit on content exports. A `422` will surface through `CanvasApiError` if a quota is exceeded.
- **`workflow_state` typing**: The union includes `(string & {})` as an open fallback for undocumented states Canvas may emit (e.g., `'waiting_for_external_tool'` if LTI tools are involved in an export). This is a hint type, not a runtime guard.
- **`getTools` function signature**: `contentExportsTools` accepts `(canvas, _pseudonymizer?)` matching `ToolDomainRegistration.getTools`. The underscore prefix signals intentional non-use, consistent with all other tool modules.
