# Grading Standards Tools — MCP Tool Design

**Date**: 2026-06-15
**Issue**: [bruchris/canvas-lms-mcp#186](https://github.com/bruchris/canvas-lms-mcp/issues/186)
**Status**: Design — awaiting CTO review

---

## Purpose

Add three tools that let an AI assistant manage Canvas grading standards (letter-to-points grading schemes):

1. `list_grading_standards` — enumerate existing grading standards in a course or account context.
2. `create_grading_standard` — create a new grading standard from a natural-language description of a letter scale.
3. `apply_grading_standard_to_course` — wire a grading standard ID to a specific course so the gradebook uses it.

This removes the discoverability friction described in issue #186: an instructor states their grading intent in plain language; the agent creates the standard and applies it, without the instructor touching Canvas settings.

No student PII is involved — grading standards are course-level configuration objects.

---

## Design unknowns (retired)

### 1. Canvas REST API surface — list only, create only, or more?

**Decision: List + Create for grading standards; Apply is a course-update call. No get-by-ID, update, or delete in V1.**

The Canvas public REST API exposes four grading-standard endpoints:

```
GET  /api/v1/courses/:course_id/grading_standards
GET  /api/v1/accounts/:account_id/grading_standards
POST /api/v1/courses/:course_id/grading_standards
POST /api/v1/accounts/:account_id/grading_standards
```

There is no documented `GET /grading_standards/:id`, `PUT /grading_standards/:id`, or `DELETE /grading_standards/:id` endpoint. An attempt to call a non-existent endpoint would return 404 or 405; implementing it would require undocumented API paths, which the Canvas-only product rule forbids.

**V1 scope**: `list_grading_standards` (GET) and `create_grading_standard` (POST) against both course and account contexts.

**List endpoint response format**: The Canvas `GET /grading_standards` endpoints return a **plain JSON array** (not an envelope like `{ grading_standards: [...] }`). Use `client.paginate<CanvasGradingStandard>(path)` — not `client.paginateEnvelope()`. This matches the documented Canvas API response format.

**Create endpoint POST body**: Canvas grading standards use a **flat POST body** — no `grading_standard:` wrapper key. The correct body is:

```json
{ "title": "GPA 4.0 Scale", "grading_scheme_entry": [{ "name": "A", "value": 0.94 }] }
```

This differs from other Canvas resources that use a wrapper (e.g., courses use `{ course: { name } }`). The response key is `grading_scheme` (plural); the POST body key is `grading_scheme_entry` (singular) — a known Canvas API asymmetry. The Canvas client handles this transparently.

If Canvas later adds update/delete endpoints, a follow-up issue should extend this domain.

### 2. Apply-to-course: separate tool or embedded in create?

**Decision: A separate `apply_grading_standard_to_course` tool; it wraps the existing `canvas.courses.update()` method with `grading_standard_id` added to `UpdateCourseParams`.**

Reasoning:

- **Workflow clarity**: Create and apply are distinct user actions. The agent can confirm the created standard's ID before wiring it. Embedding apply in create would force a one-shot flow that can't be used when applying an already-existing standard.
- **Reuse**: Instructors who already have a standard can call `apply_grading_standard_to_course` directly with a known `grading_standard_id` from `list_grading_standards`.
- **Minimal footprint**: The apply operation is a single field on the existing `PUT /api/v1/courses/:id` endpoint. There is no new Canvas client method needed — `courses.update()` already calls this endpoint. We add `grading_standard_id?: number | null` to `UpdateCourseParams` in `types.ts`, and the tool calls `canvas.courses.update(courseId, { grading_standard_id })` directly. No new module method.

**Unset semantics**: Passing `grading_standard_id: null` removes the grading standard from the course. The tool accepts `null` to support unset; document this in the tool description.

**IMPORTANT — type prerequisite**: `grading_standard_id?: number | null` MUST be added to `UpdateCourseParams` (in `src/canvas/types.ts`) before the `apply_grading_standard_to_course` tool file will compile. TypeScript strict mode will reject passing `{ grading_standard_id }` to `canvas.courses.update()` without this change. This is a cross-cutting change to an existing shared type and must be treated as a prerequisite step.

### 3. `grading_scheme_entry` value semantics

**Decision: `value` is the minimum percentage (0.0–1.0 exclusive upper-bound-open) for that grade. Entries must be sorted descending by value. The tool validates and sorts the input.**

Canvas grading scheme entries have the shape `{ name: string, value: number }`:

- `name`: the letter grade label (e.g., `"A"`, `"A-"`, `"B+"`, `"F"`).
- `value`: the **lower-bound** as a fraction of 1.0 (e.g., `0.94` means "this grade applies to scores ≥ 94%").
- Canvas computes the upper bound of each band as the `value` of the next higher grade.
- The highest grade's lower bound is typically 0.9–0.97; the lowest grade's lower bound (e.g., "F") is `0.0`.
- Canvas accepts entries in any order but grades them by value descending — the tool **sorts entries by value descending** before posting to ensure deterministic Canvas behaviour.

**Zod schema** (`schemeEntrySchema`):
```ts
const schemeEntrySchema = z.object({
  name: z.string().min(1).describe('Letter grade name (e.g. "A", "B+", "F")'),
  value: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'Lower-bound threshold as a fraction 0–1 (e.g. 0.94 means this grade starts at 94%). ' +
        "Canvas computes the upper bound as the next higher grade's value.",
    ),
})
```

**Example** (a GPA-style 4-point letter scale):
```json
[
  { "name": "A",  "value": 0.94 },
  { "name": "A-", "value": 0.90 },
  { "name": "B+", "value": 0.87 },
  { "name": "B",  "value": 0.84 },
  { "name": "B-", "value": 0.80 },
  { "name": "C+", "value": 0.77 },
  { "name": "C",  "value": 0.74 },
  { "name": "C-", "value": 0.70 },
  { "name": "D",  "value": 0.60 },
  { "name": "F",  "value": 0.00 }
]
```

Duplicate `value` entries are not validated by the tool (Canvas enforces uniqueness server-side with a 422). A 422 from Canvas propagates through `formatError` with the standard "Invalid data sent to Canvas" message.

### 4. Account-context permission errors

**Decision: The `create_grading_standard` handler catches account-context 403 from Canvas and re-throws it as a plain `Error` with a specific "admin required" message. Course-level 403 propagates as `CanvasApiError` to `buildHandler` → `formatError()`.**

Rationale for re-throw-as-Error pattern:

- Tool handlers must never return an error payload as a "success" result (i.e., no `return { error: string }` from handlers). `buildHandler` in `src/tools/index.ts` serializes the handler's return value as `content[0].text` with `isError: undefined` — returning `{ error: string }` would produce a success-shaped MCP response, which is wrong.
- The correct pattern for user-actionable, non-fatal errors is to throw a plain `Error` with the message. `buildHandler` catches it, calls `formatError(error)`, which returns `error.message` for plain `Error` instances, and sets `isError: true`.
- Canvas 403 for course context already has a good `formatError` message ("You don't have permission to perform this action in this course"). Canvas 403 for account context needs a better message explaining admin requirements.

**Implementation** (in `create_grading_standard` handler):
```ts
try {
  if (courseId !== undefined) {
    return await canvas.gradingStandards.createForCourse(courseId, title, schemeEntries)
  }
  if (accountId !== undefined) {
    return await canvas.gradingStandards.createForAccount(accountId, title, schemeEntries)
  }
  throw new Error('Provide either course_id or account_id.')
} catch (error) {
  if (
    error instanceof CanvasApiError &&
    error.status === 403 &&
    accountId !== undefined
  ) {
    throw new Error(
      'Creating grading standards at the account level requires Canvas admin permissions. ' +
        'Try creating the standard in a course context instead (use course_id).',
    )
  }
  throw error
}
```

Import: `import { CanvasApiError } from '../canvas/client'` at the top of `src/tools/grading-standards.ts`.

For all other Canvas errors (401, 404, 422, 429, 5xx), `CanvasApiError` is re-thrown to `buildHandler` → `formatError()` as usual.

---

## Type additions (`src/canvas/types.ts`)

Add under a new `// --- Grading Standards ---` section after the existing `// --- Accounts ---` block:

```ts
// --- Grading Standards ---

export interface CanvasGradingSchemeEntry {
  name: string
  value: number
}

export type CanvasGradingStandardContextType = 'Course' | 'Account'

export interface CanvasGradingStandard {
  id: number
  title: string
  context_type: CanvasGradingStandardContextType
  context_id: number
  grading_scheme: CanvasGradingSchemeEntry[]
}
```

Also add `grading_standard_id?: number | null` to two existing interfaces:

**`UpdateCourseParams`** — append:
```ts
  grading_standard_id?: number | null
```

**`CanvasCourse`** — append (after `post_manually?`):
```ts
  grading_standard_id?: number | null
```

**Type notes**:
- `context_type` is `'Course' | 'Account'` (Canvas returns title-cased strings). This is a closed union per current Canvas docs; if Canvas adds new context types in the future, add to the union then.
- `grading_scheme` on the response is always present and non-null for valid standards.
- `grading_standard_id` on `CanvasCourse` and `UpdateCourseParams` is `number | null` to support both setting (number) and clearing (null).

---

## Canvas client module — `src/canvas/grading-standards.ts` (new file)

```ts
import type { CanvasHttpClient } from './client'
import type { CanvasGradingSchemeEntry, CanvasGradingStandard } from './types'

export class GradingStandardsModule {
  constructor(private client: CanvasHttpClient) {}

  async listForCourse(courseId: number): Promise<CanvasGradingStandard[]> {
    return this.client.paginate<CanvasGradingStandard>(
      `/api/v1/courses/${courseId}/grading_standards`,
    )
  }

  async listForAccount(accountId: number): Promise<CanvasGradingStandard[]> {
    return this.client.paginate<CanvasGradingStandard>(
      `/api/v1/accounts/${accountId}/grading_standards`,
    )
  }

  async createForCourse(
    courseId: number,
    title: string,
    schemeEntries: CanvasGradingSchemeEntry[],
  ): Promise<CanvasGradingStandard> {
    const sorted = [...schemeEntries].sort((a, b) => b.value - a.value)
    return this.client.request<CanvasGradingStandard>(
      `/api/v1/courses/${courseId}/grading_standards`,
      {
        method: 'POST',
        body: JSON.stringify({ title, grading_scheme_entry: sorted }),
      },
    )
  }

  async createForAccount(
    accountId: number,
    title: string,
    schemeEntries: CanvasGradingSchemeEntry[],
  ): Promise<CanvasGradingStandard> {
    const sorted = [...schemeEntries].sort((a, b) => b.value - a.value)
    return this.client.request<CanvasGradingStandard>(
      `/api/v1/accounts/${accountId}/grading_standards`,
      {
        method: 'POST',
        body: JSON.stringify({ title, grading_scheme_entry: sorted }),
      },
    )
  }
}
```

**POST body key note**: The body uses `grading_scheme_entry` (singular) — NOT `grading_scheme` (plural). This is a Canvas API asymmetry: POST input uses `grading_scheme_entry`, GET/response uses `grading_scheme`. The body is flat (no `grading_standard:` wrapper). This contrasts with e.g. course creation (`{ course: { ... } }`); Canvas grading standards have always used the flat form.

**Sort note**: `[...schemeEntries].sort(...)` creates a copy to avoid mutating the caller's array.

**No `paginateEnvelope`**: List endpoints return a plain JSON array. Use `client.paginate()` only.

### Wire into `CanvasClient` facade (`src/canvas/index.ts`)

Three changes:

1. **Import** (after the existing `NewQuizzesModule` import):
```ts
import { GradingStandardsModule } from './grading-standards'
```

2. **Property declaration** (after `newQuizzes: NewQuizzesModule`):
```ts
  gradingStandards: GradingStandardsModule
```

3. **Constructor assignment** (after `this.newQuizzes = new NewQuizzesModule(this.client)`):
```ts
    this.gradingStandards = new GradingStandardsModule(this.client)
```

---

## Tool module — `src/tools/grading-standards.ts` (new file)

```ts
import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import { CanvasApiError } from '../canvas/client'
import type { ToolDefinition } from './types'

const schemeEntrySchema = z.object({
  name: z.string().min(1).describe('Letter grade name (e.g. "A", "B+", "F")'),
  value: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'Lower-bound threshold as a fraction 0–1 (e.g. 0.94 means this grade starts at 94%). ' +
        "Canvas computes the upper bound as the next higher grade's value.",
    ),
})

export function gradingStandardsTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    // ... three ToolDefinition objects below
  ]
}
```

### Tool 1: `list_grading_standards`

```ts
{
  name: 'list_grading_standards',
  description:
    'List grading standards available in a course or account context. ' +
    'Provide either course_id (to see standards scoped to a course) or account_id ' +
    '(to see account-level standards, requires admin access). ' +
    'Returns an array of grading standard objects, each with an id, title, context, ' +
    'and grading_scheme array of { name, value } entries.',
  inputSchema: {
    course_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Course ID to list standards for (mutually exclusive with account_id)'),
    account_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Account ID to list standards for (mutually exclusive with course_id; requires admin)',
      ),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  handler: async (params) => {
    const courseId = params.course_id as number | undefined
    const accountId = params.account_id as number | undefined
    if (courseId !== undefined) {
      return canvas.gradingStandards.listForCourse(courseId)
    }
    if (accountId !== undefined) {
      return canvas.gradingStandards.listForAccount(accountId)
    }
    throw new Error('Provide either course_id or account_id.')
  },
}
```

Handler note: The final `throw new Error(...)` propagates to `buildHandler` → `formatError` → `isError: true` in the MCP response (same flow as the create handler). No try/catch needed in this handler.

### Tool 2: `create_grading_standard`

```ts
{
  name: 'create_grading_standard',
  description:
    'Create a new grading standard (letter-to-percentage scheme) in a course or account context. ' +
    'Provide either course_id or account_id (account requires admin). ' +
    'scheme_entries is an array of { name, value } objects where value is the lower-bound ' +
    'percentage as a fraction 0–1 (e.g. { name: "A", value: 0.94 } means A ≥ 94%). ' +
    'Entries will be sorted descending by value before sending to Canvas. ' +
    'Canvas POST body key is grading_scheme_entry (singular); the returned object uses grading_scheme (plural). ' +
    'Returns the created CanvasGradingStandard object including its id — use that id with ' +
    'apply_grading_standard_to_course to activate it on a course.',
  inputSchema: {
    course_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Course ID to create the standard in (mutually exclusive with account_id)'),
    account_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Account ID to create the standard in (requires admin; mutually exclusive with course_id)',
      ),
    title: z
      .string()
      .min(1)
      .describe('Display name for this grading standard (e.g. "GPA 4.0 Scale")'),
    scheme_entries: z
      .array(schemeEntrySchema)
      .min(1)
      .describe(
        'Grading scheme entries. Each entry: { name: string, value: number (0–1) }. ' +
          'The lowest grade should have value 0.0.',
      ),
  },
  annotations: {
    destructiveHint: true,
    openWorldHint: true,
  },
  handler: async (params) => {
    const courseId = params.course_id as number | undefined
    const accountId = params.account_id as number | undefined
    const title = params.title as string
    const schemeEntries = params.scheme_entries as Array<{ name: string; value: number }>
    try {
      if (courseId !== undefined) {
        return await canvas.gradingStandards.createForCourse(courseId, title, schemeEntries)
      }
      if (accountId !== undefined) {
        return await canvas.gradingStandards.createForAccount(accountId, title, schemeEntries)
      }
      throw new Error('Provide either course_id or account_id.')
    } catch (error) {
      if (
        error instanceof CanvasApiError &&
        error.status === 403 &&
        accountId !== undefined
      ) {
        throw new Error(
          'Creating grading standards at the account level requires Canvas admin permissions. ' +
            'Try creating the standard in a course context instead (use course_id).',
        )
      }
      throw error
    }
  },
}
```

**Error handling note**: The try/catch catches account-context 403 only. It re-throws everything else (including course-context 403, 404, 422, etc.) as-is. `buildHandler` catches all thrown values and calls `formatError()`:
- Account-context 403 → plain `Error` → `formatError` returns `error.message` → `isError: true` with the admin message.
- Course-context 403 → `CanvasApiError(403)` → `formatError` returns "You don't have permission to perform this action in this course" → `isError: true`.
- 422 → `CanvasApiError(422)` → `formatError` returns "Invalid data sent to Canvas: …" → `isError: true`.

### Tool 3: `apply_grading_standard_to_course`

```ts
{
  name: 'apply_grading_standard_to_course',
  description:
    'Apply an existing grading standard to a course so the gradebook uses it. ' +
    'Pass the grading_standard_id returned by create_grading_standard or list_grading_standards. ' +
    'Pass null for grading_standard_id to remove the current grading standard from the course. ' +
    'Returns the updated CanvasCourse object.',
  inputSchema: {
    course_id: z.number().int().positive().describe('The Canvas course ID to update'),
    grading_standard_id: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe(
        'The grading standard ID to apply, or null to remove the current standard',
      ),
  },
  annotations: {
    destructiveHint: true,
    openWorldHint: true,
  },
  handler: async (params) => {
    const courseId = params.course_id as number
    const gradingStandardId = params.grading_standard_id as number | null
    return canvas.courses.update(courseId, { grading_standard_id: gradingStandardId })
  },
}
```

No try/catch — all errors propagate to `buildHandler` → `formatError()`.

**Return value**: Returns the full `CanvasCourse` object from `canvas.courses.update()`. The response includes `grading_standard_id` if Canvas echoes it on the update response.

---

## Catalog registration (`src/tools/catalog.ts`)

Two changes:

1. **Import** (after the existing `import { quizTools } from './quizzes'` line):
```ts
import { gradingStandardsTools } from './grading-standards'
```

2. **Entry** (after the closing `}` of the `new_quizzes` entry in `toolDomainCatalog`):
```ts
  {
    domain: 'grading_standards',
    defaultPrimaryAudience: 'educator',
    getTools: gradingStandardsTools,
  },
```

---

## FERPA / pseudonymizer

**No pseudonymizer wrapping required.** Grading standards contain no student PII:

- `CanvasGradingStandard` fields: `id`, `title`, `context_type`, `context_id`, `grading_scheme`. None are a `CanvasUser` object, a `participants` array, or a `user_name` field. Grading standards are course-level config, not student records.
- `apply_grading_standard_to_course` returns `CanvasCourse`. The tool never passes `include[]=enrollments` to `canvas.courses.update()`, so the Canvas `PUT /api/v1/courses/:id` response does not include an `enrollments` array or student user objects. The `teachers` sub-field contains instructor display-name objects only.

Do NOT add any of the three new tool names to `PSEUDONYMIZER_WRAPPED_TOOLS`. The CI coverage test (`tests/pseudonym/coverage.test.ts`) must pass unchanged.

---

## Test plan

All tests use mocked Canvas responses. No live Canvas calls.

### Canvas client tests — `tests/canvas/grading-standards.test.ts` (new file)

**Imports and setup:**
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GradingStandardsModule } from '../../src/canvas/grading-standards'
import { CanvasHttpClient } from '../../src/canvas/client'
import { CanvasApiError } from '../../src/canvas/client'

// beforeEach:
const client = new CanvasHttpClient({ token: 'test-token', baseUrl: 'https://canvas.example.com' })
const module = new GradingStandardsModule(client)
// then vi.spyOn(client, 'paginate') / vi.spyOn(client, 'request')
// consistent with tests/canvas/courses.test.ts and tests/canvas/accounts.test.ts
```

**Fixture:**
```ts
const mockStandard = {
  id: 42,
  title: 'GPA 4.0 Scale',
  context_type: 'Course' as const,
  context_id: 100,
  grading_scheme: [
    { name: 'A', value: 0.94 },
    { name: 'B', value: 0.84 },
    { name: 'F', value: 0.00 },
  ],
}
const schemeEntries = [
  { name: 'A', value: 0.94 },
  { name: 'B', value: 0.84 },
  { name: 'F', value: 0.00 },
]
```

**Case 1 — `listForCourse` happy path**: `vi.spyOn(client, 'paginate').mockResolvedValueOnce([mockStandard])`. Assert:
- Returns array of length 1.
- `client.paginate` called with `'/api/v1/courses/100/grading_standards'` (no second arg).

**Case 2 — `listForCourse` empty**: mock returns `[]`. Assert method returns `[]`.

**Case 3 — `listForAccount` happy path**: mock `client.paginate` returns `[mockStandard]`. Assert:
- `client.paginate` called with `'/api/v1/accounts/1/grading_standards'`.

**Case 4 — `createForCourse` happy path**: `vi.spyOn(client, 'request').mockResolvedValueOnce(mockStandard)`. Assert:
- Returns `mockStandard`.
- `client.request` called with `'/api/v1/courses/100/grading_standards'` and `{ method: 'POST', body: ... }`.
- **Parsed body key is `grading_scheme_entry` (singular), NOT `grading_scheme` (plural)**: `JSON.parse(calledBody).grading_scheme_entry` equals `[{ name: 'A', value: 0.94 }, { name: 'B', value: 0.84 }, { name: 'F', value: 0.00 }]`.

**Case 5 — `createForCourse` sorts entries**: call with `[{ name: 'F', value: 0.0 }, { name: 'B', value: 0.84 }, { name: 'A', value: 0.94 }]` (ascending). Assert posted `grading_scheme_entry` is `[{ name: 'A', value: 0.94 }, { name: 'B', value: 0.84 }, { name: 'F', value: 0.0 }]` (descending).

**Case 6 — `createForCourse` does not mutate input**: capture the input array reference before the call. After the call, assert the array is still in the original (ascending) order.

**Case 7 — `createForAccount` happy path**: `vi.spyOn(client, 'request').mockResolvedValueOnce(mockStandard)`. Assert `client.request` called with `'/api/v1/accounts/1/grading_standards'` and `{ method: 'POST', body: ... }`.

**Case 8 — Error propagation**: `vi.spyOn(client, 'request').mockRejectedValueOnce(new CanvasApiError('Forbidden', 403, '/api/v1/accounts/1/grading_standards'))`. Assert the error propagates from `createForAccount` (not caught at client layer).

### Facade test — `tests/canvas/facade.test.ts`

Add `'gradingStandards'` to the checked module property names in the existing test. Inspect the current test to find the property array and append `'gradingStandards'`.

### Tool tests — `tests/tools/grading-standards.test.ts` (new file)

**`buildMockCanvas()` helper:**
```ts
function buildMockCanvas(): CanvasClient {
  return {
    gradingStandards: {
      listForCourse: vi.fn().mockResolvedValue([mockStandard]),
      listForAccount: vi.fn().mockResolvedValue([mockStandard]),
      createForCourse: vi.fn().mockResolvedValue(mockStandard),
      createForAccount: vi.fn().mockResolvedValue(mockStandard),
    },
    courses: {
      update: vi.fn().mockResolvedValue({ id: 100, grading_standard_id: 42 }),
    },
  } as unknown as CanvasClient
}
```

**Suite-level checks:**
- `gradingStandardsTools(buildMockCanvas())` returns exactly **3** tool definitions.
- Tool names: `['list_grading_standards', 'create_grading_standard', 'apply_grading_standard_to_course']`.

**`list_grading_standards`:**
1. Annotations: `{ readOnlyHint: true, openWorldHint: true }`.
2. With `course_id: 100`: calls `canvas.gradingStandards.listForCourse(100)`; returns mock array.
3. With `account_id: 1`: calls `canvas.gradingStandards.listForAccount(1)`; returns mock array.
4. With neither ID: `await tool.handler({})` rejects with a plain `Error` (not `CanvasApiError`). `buildHandler` catches it and returns `isError: true` with the "Provide either" message.
5. 404 propagation: mock `listForCourse` throws `new CanvasApiError('Not Found', 404, '...')`. Assert it propagates.

**`create_grading_standard`:**
1. Annotations: `{ destructiveHint: true, openWorldHint: true }`.
2. With `course_id`: calls `canvas.gradingStandards.createForCourse(100, 'GPA 4.0 Scale', schemeEntries)`.
3. With `account_id`: calls `canvas.gradingStandards.createForAccount(1, 'GPA 4.0 Scale', schemeEntries)`.
4. With neither ID: rejects with a plain `Error` ("Provide either course_id or account_id.").
5. Account-context 403: mock `createForAccount` throws `new CanvasApiError('Forbidden', 403, '...')`. Assert handler re-throws a **plain `Error`** (not `CanvasApiError`) with message containing "Canvas admin permissions".
6. Course-context 403: mock `createForCourse` throws `new CanvasApiError('Forbidden', 403, '...')`. Assert handler re-throws **`CanvasApiError`** unchanged — the plain Error wrapping does NOT apply to course context.
7. 422 from course create: mock throws `new CanvasApiError('Unprocessable', 422, '...')`. Assert `CanvasApiError` propagates unchanged.

**`apply_grading_standard_to_course`:**
1. Annotations: `{ destructiveHint: true, openWorldHint: true }`.
2. Apply with ID `42`: calls `canvas.courses.update(100, { grading_standard_id: 42 })`; returns `{ id: 100, grading_standard_id: 42 }`.
3. Remove (null): calls `canvas.courses.update(100, { grading_standard_id: null })`.
4. 404 propagation: mock `canvas.courses.update` throws `new CanvasApiError('Not Found', 404, '...')`. Assert it propagates.

### Registry test — `tests/tools/registry.test.ts`

**Four precise changes** (the existing file has `toHaveLength(121)` for total count and two `writeToolNames` collections):

**Change 1 — `buildFullMockCanvas()`**: Add a `gradingStandards` property alongside the existing domain stubs:
```ts
    gradingStandards: {
      listForCourse: async () => [],
      listForAccount: async () => [],
      createForCourse: async () => ({}),
      createForAccount: async () => ({}),
    },
```
Without this, `getAllTools(buildFullMockCanvas())` throws "Cannot read properties of undefined" when `gradingStandardsTools` is called.

**Change 2 — tool count**: Change `expect(tools).toHaveLength(121)` to `expect(tools).toHaveLength(124)`.

**Change 3 — `toContain` assertions**: Add three new `expect(names).toContain(...)` lines in the "returns all N tools" test (under a `// Grading Standards (3)` comment):
```ts
    // Grading Standards (3)
    expect(names).toContain('list_grading_standards')
    expect(names).toContain('create_grading_standard')
    expect(names).toContain('apply_grading_standard_to_course')
```

**Change 4 — `writeToolNames` arrays**: `create_grading_standard` and `apply_grading_standard_to_course` have `destructiveHint: true`. They must be added to **both** `writeToolNames` collections in the file:

In `'write tools have destructiveHint: true'`:
```ts
      'create_grading_standard',
      'apply_grading_standard_to_course',
```

In `'read tools have readOnlyHint: true'` (the `writeToolNames` Set):
```ts
      'create_grading_standard',
      'apply_grading_standard_to_course',
```

**Why Change 4 is critical**: The "read tools have readOnlyHint: true" test iterates every tool NOT in `writeToolNames` and asserts `readOnlyHint === true`. If `create_grading_standard` or `apply_grading_standard_to_course` are absent from `writeToolNames`, the test will assert they have `readOnlyHint: true` — but they have `destructiveHint: true` — and the test will **fail**. `list_grading_standards` has `readOnlyHint: true` so it does NOT need to be in `writeToolNames`.

### Pseudonymizer coverage test — `tests/pseudonym/coverage.test.ts`

No changes. Do NOT add any of the three new tool names to `PSEUDONYMIZER_WRAPPED_TOOLS`.

---

## Implementation checklist for the implementor

1. `src/canvas/types.ts` — add `CanvasGradingSchemeEntry`, `CanvasGradingStandardContextType`, `CanvasGradingStandard`; add `grading_standard_id?: number | null` to `UpdateCourseParams` and `CanvasCourse`.
2. `src/canvas/grading-standards.ts` — new file with `GradingStandardsModule` class.
3. `src/canvas/index.ts` — import `GradingStandardsModule`; add property + constructor line.
4. `src/tools/grading-standards.ts` — new file with `gradingStandardsTools()`.
5. `src/tools/catalog.ts` — import + entry for `grading_standards` domain.
6. `tests/canvas/grading-standards.test.ts` — new file (8 cases).
7. `tests/tools/grading-standards.test.ts` — new file (15 cases).
8. `tests/canvas/facade.test.ts` — add `'gradingStandards'` to checked properties.
9. `tests/tools/registry.test.ts` — 4 changes: `gradingStandards` stub in `buildFullMockCanvas()`; count 121→124; 3 new `toContain` assertions; add 2 write tool names to both `writeToolNames` collections.

---

## Acceptance check

- [x] `**design-first**` flag present in issue #186.
- [x] Design unknown §1 (API surface): retired — list + create only; `client.paginate()` (not envelope); flat POST body (no `grading_standard:` wrapper); `grading_scheme_entry` vs `grading_scheme` asymmetry documented.
- [x] Design unknown §2 (apply to course): retired — dedicated `apply_grading_standard_to_course` tool using `canvas.courses.update()` with `grading_standard_id` param; `UpdateCourseParams` change called out as prerequisite.
- [x] Design unknown §3 (value semantics): retired — lower-bound fraction 0–1, sorted descending, `schemeEntrySchema` defined with Zod constraints.
- [x] Design unknown §4 (account-context permission): retired — handler re-throws plain Error for account-403, `isError: true` in MCP response; course-403 propagates as `CanvasApiError`.
- [x] Error handling consistent with codebase: no `return { error }` from handlers; all errors thrown; `buildHandler` handles all catches.
- [x] Exact tool names, Zod schemas, Canvas endpoints, MCP annotations, and output shapes specified.
- [x] Type additions specified with rationale and exact target interfaces.
- [x] Client module: verbatim code including flat POST body and `grading_scheme_entry` key.
- [x] CanvasClient facade wiring: three verbatim lines.
- [x] Catalog: verbatim import + insertion point.
- [x] Registry test: all four changes specified precisely — stub, count (121→124), `toContain` lines, both `writeToolNames` collections updated.
- [x] Test plan: canvas client setup boilerplate, fixtures, 8 + 15 cases, body-key assertion for `grading_scheme_entry`.
- [x] No new package dependencies.
- [x] FERPA: no pseudonymizer wrapping required — `PUT /courses/:id` omits enrollments by default; no `CanvasUser`/`participants`/`user_name` in any response.
- [x] Pseudonymizer coverage test unaffected.
