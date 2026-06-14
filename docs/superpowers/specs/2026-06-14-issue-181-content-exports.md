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

The export surface is a coherent standalone value unit. The import side carries its own unknowns (file-delivery mechanism especially) and belongs in a scoped follow-up issue.

### 4. Download delivery: pre-signed URL vs. streaming file content

**Decision: return the pre-signed `attachment.url`. No streaming.**

Canvas export attachments are served from a pre-signed S3/CDN URL valid without an additional Canvas token. Course export packages can be 10 MB – 500 MB; streaming binary content through a JSON MCP tool response (base64-encoded) is impractical at that scale and breaks standard deployment patterns.

The correct agent flow: `create_content_export` → loop `get_content_export` until exported → present `attachment.url` → user downloads directly. This mirrors how `files.ts` already surfaces `meta.url`.

**URL lifetime caveat**: Canvas pre-signed attachment URLs have a TTL (typically ~1 hour). The tool description warns to "download promptly"; if TTL is a recurring pain point, a `refresh_content_export_attachment` tool can be added later — the Canvas API allows re-fetching the export object to get a fresh URL.

## Tool contracts

### `create_content_export`

> Start a Canvas course content export. Exports are asynchronous — this tool returns immediately with an export ID and initial status. Call `get_content_export` to check progress and retrieve the download link when the export is done.

**Annotations**: `destructiveHint: true`, `openWorldHint: true` (POST; creates a server-side export job).

**Input** (Zod):

| Field | Type | Notes |
|-------|------|-------|
| `course_id` | `z.number()` required | The Canvas course ID |
| `export_type` | `z.enum(['common_cartridge', 'qti', 'zip'])` required | `common_cartridge` = IMS CC (widely portable); `qti` = assessments only; `zip` = Canvas-native |

**Canvas endpoint**: `POST /api/v1/courses/:course_id/content_exports`

**Request body**: `{ export_type: "common_cartridge" | "qti" | "zip" }`

**Output shape**:
```jsonc
{
  "id": 42,
  "export_type": "common_cartridge",
  "workflow_state": "created",
  "progress_url": "https://school.instructure.com/api/v1/progress/999",
  "attachment": null,
  "created_at": "2026-06-14T10:00:00Z",
  "updated_at": "2026-06-14T10:00:00Z"
}
```

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
  "created_at": "2026-06-14T10:00:00Z",
  "updated_at": "2026-06-14T10:00:45Z"
}
```

`attachment` is `null` when `workflow_state` is `"created"`, `"exporting"`, or `"failed"`.

### `list_content_exports`

> List all content exports for a course.

**Annotations**: `readOnlyHint: true`, `openWorldHint: true`.

**Input** (Zod):

| Field | Type | Notes |
|-------|------|-------|
| `course_id` | `z.number()` required | The Canvas course ID |

**Canvas endpoint**: `GET /api/v1/courses/:course_id/content_exports`

**Output**: Array of `CanvasContentExport` (same shape as `get_content_export`).

## Canvas client additions

### New types (`src/canvas/types.ts`)

```ts
export type ContentExportType = 'common_cartridge' | 'qti' | 'zip'
export type ContentExportWorkflowState = 'created' | 'exporting' | 'exported' | 'failed'

export interface CanvasContentExportAttachment {
  url: string
  filename: string
}

export interface CanvasContentExport {
  id: number
  export_type: ContentExportType
  workflow_state: ContentExportWorkflowState
  progress_url: string | null
  attachment: CanvasContentExportAttachment | null
  created_at: string
  updated_at: string
}
```

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

### `CanvasClient` wiring (`src/canvas/index.ts`)

```ts
// Import:
import { ContentExportsModule } from './content-exports'
// Class property:
contentExports: ContentExportsModule
// Constructor:
this.contentExports = new ContentExportsModule(this.client)
```

### Tool module (`src/tools/content-exports.ts`)

```ts
import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ContentExportType } from '../canvas/types'
import type { ToolDefinition } from './types'

export function contentExportsTools(canvas: CanvasClient): ToolDefinition[] {
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

### Catalog registration (`src/tools/catalog.ts`)

Add after the `attention` domain entry:

```ts
import { contentExportsTools } from './content-exports'
// in toolDomainCatalog:
{
  domain: 'content_exports',
  defaultPrimaryAudience: 'admin',
  getTools: contentExportsTools,
},
```

## Pseudonymizer coverage

`CanvasContentExport` carries no student PII: the fields are numeric IDs, export type, workflow state, progress URL, and an attachment filename/URL. No `user_name`, no `CanvasUser`, no `participants` array. The CLAUDE.md pseudonymizer rule does not apply; no entry in `PSEUDONYMIZER_WRAPPED_TOOLS` is needed and CI's `coverage.test.ts` will not fail.

## Test plan (`tests/content-exports.test.ts`)

All tests use mocked Canvas responses; no real Canvas instance is contacted.

### Canvas module tests (`ContentExportsModule`)

| # | Scenario | Mock | Assert |
|---|----------|------|--------|
| 1 | `create` — success | 200 `CanvasContentExport{ workflow_state: 'created', attachment: null }` | Correct shape returned |
| 2 | `get` — `workflow_state: 'exporting'` | 200 `{ workflow_state: 'exporting', attachment: null }` | `attachment` is null |
| 3 | `get` — `workflow_state: 'exported'` | 200 `{ workflow_state: 'exported', attachment: { url, filename } }` | `attachment.url` is present |
| 4 | `get` — `workflow_state: 'failed'` | 200 `{ workflow_state: 'failed', attachment: null }` | Returns without throwing |
| 5 | `list` — multiple items | 200 array (two exports, mixed states) | All items returned |
| 6 | `get` — 404 | 404 response | Throws `CanvasApiError` with `.status === 404` |
| 7 | `create` — 403 forbidden | 403 response | Throws `CanvasApiError` with `.status === 403` |

### Tool layer tests

| # | Scenario | Assert |
|---|----------|--------|
| 8 | `create_content_export` for each of the three `export_type` values | Returns `workflow_state: 'created'`, `attachment: null` |
| 9 | `get_content_export` — exported state | Response JSON contains `attachment.url` |
| 10 | `get_content_export` — failed state | Returns non-error response with `workflow_state: 'failed'` |
| 11 | `list_content_exports` | Returns array of exports |
| 12 | `get_content_export` when Canvas returns 404 | Tool response `isError: true`, text contains "not found" |
| 13 | `create_content_export` when Canvas returns 401 | Tool response contains "Canvas token is invalid or expired" |

## Ship order and implementation subtask

**Single implementation PR** on branch `scout/feat-181`, title: `feat: add content_exports tools (list_content_exports, create_content_export, get_content_export)`

Implementation steps (standard CLAUDE.md order — tests first):
1. Write `tests/content-exports.test.ts` with mocked fixtures
2. Add types to `src/canvas/types.ts`
3. Create `src/canvas/content-exports.ts`
4. Wire `contentExports` into `src/canvas/index.ts`
5. Create `src/tools/content-exports.ts`
6. Register in `src/tools/catalog.ts`
7. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

This adds 3 tools (1 write, 2 read) to the registered catalog.

## Out of scope

- Partial (`select[]`) content exports — course-level only for MVP
- `content_migrations` (import side) — separate follow-up issue
- Streaming or base64-encoding export binary content through the MCP response
- A blocking/polling convenience wrapper tool — additive follow-up if needed
- Exposing raw `progress_url` endpoint content — agent should poll `get_content_export` directly

## Risks and notes for the CTO decision

- **Attachment URL lifetime**: Canvas pre-signed URLs have a TTL (~1 hour typically). The tool description and spec both note this. If TTL is a recurring pain point, a `refresh_content_export_attachment` tool can be added later by re-fetching the export object.
- **`create_content_export` annotation**: `destructiveHint: true` because it initiates a server-side export job (POST). It does not delete or modify course content; this follows the same annotation convention as `create_conversation` and `post_discussion_entry`.
- **Rate limits / quotas**: Canvas does not publish a formal rate limit on content exports, but institutions can have quotas. A `422` from Canvas will surface through `CanvasApiError` with a descriptive message. No retry logic is added by the tool.
- **`workflow_state` typing**: The `ContentExportWorkflowState` union (`created | exporting | exported | failed`) is derived from Canvas API documentation. If Canvas emits an undocumented intermediate state, it will be returned as-is (the type annotation is a hint, not a runtime guard).
- **`getTools` signature**: `contentExportsTools` takes only `canvas: CanvasClient` (no `pseudonymizer` parameter), matching the pattern for domains that do not handle PII (e.g., `discussionTools`, `calendarTools`).
