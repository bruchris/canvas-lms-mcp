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

The Canvas public REST API (as documented and historically stable) exposes four grading-standard endpoints:

```
GET  /api/v1/courses/:course_id/grading_standards
GET  /api/v1/accounts/:account_id/grading_standards
POST /api/v1/courses/:course_id/grading_standards
POST /api/v1/accounts/:account_id/grading_standards
```

There is no documented `GET /grading_standards/:id`, `PUT /grading_standards/:id`, or `DELETE /grading_standards/:id` endpoint. Canvas does not expose single-standard retrieval or mutation via the public REST API. An attempt to call a non-existent endpoint would return 404 or 405; implementing it would require undocumented API paths, which the Canvas-only product rule forbids.

**V1 scope**: `list_grading_standards` (GET) and `create_grading_standard` (POST) against both course and account contexts. The list endpoint is paginated; use `client.paginate()`.

If Canvas adds update/delete endpoints in a future API version, a follow-up issue should add those tools. The `CanvasGradingStandard` type will need no changes — it already captures the stable fields.

### 2. Apply-to-course: separate tool or embedded in create?

**Decision: A separate `apply_grading_standard_to_course` tool; it wraps the existing `canvas.courses.update()` method with `grading_standard_id` added to `UpdateCourseParams`.**

Reasoning:

- **Workflow clarity**: Create and apply are distinct user actions. The agent can confirm the created standard's ID before wiring it. Embedding apply in create would force a one-shot flow that can't be used when applying an already-existing standard.
- **Reuse**: Instructors who already have a standard can call `apply_grading_standard_to_course` directly with a known `grading_standard_id` from `list_grading_standards`.
- **Minimal footprint**: The apply operation is a single field on the existing `PUT /api/v1/courses/:id` endpoint. There is no new Canvas client method needed — `courses.update()` already calls this endpoint. We add `grading_standard_id?: number | null` to `UpdateCourseParams` and `CanvasCourse` in `types.ts`, and the tool calls `canvas.courses.update(courseId, { grading_standard_id })` directly. No new module method.

**Unset semantics**: Passing `grading_standard_id: null` removes the grading standard from the course (Canvas accepts null to clear the field). The tool accepts `null` to support unset; document this in the tool description.

### 3. `grading_scheme_entry` value semantics

**Decision: `value` is the minimum percentage (0.0–1.0 exclusive upper-bound-open) for that grade. Entries must be sorted descending by value. The tool validates and sorts the input.**

Canvas grading scheme entries have the shape `{ name: string, value: number }`:

- `name`: the letter grade label (e.g., `"A"`, `"A-"`, `"B+"`, `"F"`).
- `value`: the **lower-bound** as a fraction of 1.0 (e.g., `0.94` means "this grade applies to scores ≥ 94%").
- Canvas computes the upper bound of each band as the `value` of the next higher grade.
- The highest grade's lower bound is typically 0.9–0.97; the lowest grade's lower bound (e.g., "F") is `0.0`.
- Canvas accepts entries in any order but grades them by value descending — the tool **sorts entries by value descending** before posting to ensure deterministic Canvas behaviour.

**Zod validation**:
- `name`: `z.string().min(1)` — grade name cannot be empty.
- `value`: `z.number().min(0).max(1)` — must be a valid fraction.
- Array: `z.array(...).min(1)` — at least one entry required.

**Example** (a GPA-style 4-point letter scale, passed to the tool):
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

Canvas returns `grading_scheme` (plural, different key name) on the created object — document in the tool description that input key is `scheme_entries` and the Canvas response key is `grading_scheme`.

### 4. Account-context permission errors

**Decision: Map account-level 403 to a specific "admin required" message via a custom error handler in each tool's handler; course-level 403 falls through to the standard `formatError` message.**

When calling `POST /api/v1/accounts/:id/grading_standards`, Canvas returns 403 if the caller lacks account admin permissions. The standard `formatError` 403 message is "You don't have permission to perform this action in this course", which is misleading for account-level operations.

**Per-tool custom 403 handler**: Each grading-standards tool handler catches `CanvasApiError` with `status === 403`, checks whether an `account_id` was provided (indicating account context), and returns a context-aware message:

- Account context 403: `"Creating grading standards at the account level requires Canvas admin permissions. Try creating the standard in a course context instead (use course_id)."`
- All other errors (including course-context 403): fall through to standard `formatError()`.

This check is in the tool handler, not the client layer.

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
- `context_type` is `'Course' | 'Account'` (Canvas returns title-cased strings).
- `grading_scheme` on the response is always present and non-null for valid standards; typed as a plain array (not nullable) because Canvas never omits it on a valid object.
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

**Notes**:
- Canvas POST body key is `grading_scheme_entry` (singular), not `grading_scheme` — this is a known Canvas API asymmetry (list/get returns `grading_scheme`, create body uses `grading_scheme_entry`). Document in the tool description; the client handles this transparently.
- Sort before POST: `[...schemeEntries].sort(...)` creates a copy to avoid mutating the caller's array.
- No `paginate` options needed — the grading standards lists are small (rarely >20 entries); default pagination is sufficient.

### Wire into `CanvasClient` facade (`src/canvas/index.ts`)

Add import:
```ts
import { GradingStandardsModule } from './grading-standards'
```

Add property declaration and constructor line (after `newQuizzes` entries):
```ts
  gradingStandards: GradingStandardsModule
  // ...
  this.gradingStandards = new GradingStandardsModule(this.client)
```

---

## Tool module — `src/tools/grading-standards.ts` (new file)

```ts
import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import { CanvasApiError } from '../canvas/client'
import type { ToolDefinition } from './types'
import { formatError } from './errors'

const schemeEntrySchema = z.object({
  name: z.string().min(1).describe('Letter grade name (e.g. "A", "B+", "F")'),
  value: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'Lower-bound threshold as a fraction 0–1 (e.g. 0.94 means this grade starts at 94%). ' +
        'Canvas computes the upper bound as the next higher grade\'s value.',
    ),
})

export function gradingStandardsTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    // list_grading_standards
    // create_grading_standard
    // apply_grading_standard_to_course
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
      .describe('Account ID to list standards for (mutually exclusive with course_id; requires admin)'),
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
    'Canvas POST key is grading_scheme_entry (singular); the returned object uses grading_scheme (plural). ' +
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
      .describe('Account ID to create the standard in (requires admin; mutually exclusive with course_id)'),
    title: z.string().min(1).describe('Display name for this grading standard (e.g. "GPA 4.0 Scale")'),
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
        return {
          error:
            'Creating grading standards at the account level requires Canvas admin permissions. ' +
            'Try creating the standard in a course context instead (use course_id).',
        }
      }
      throw error
    }
  },
}
```

**Error handling note**: The handler returns a structured error object `{ error: string }` rather than throwing for the account-context 403, so the outer `buildHandler` in `src/tools/index.ts` wraps it as `isError: true` content. All other errors are re-thrown and caught by `buildHandler` which calls `formatError()`. This is consistent with how other tools surface non-fatal, user-actionable errors.

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
      .describe('The grading standard ID to apply, or null to remove the current standard'),
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

---

## Catalog registration (`src/tools/catalog.ts`)

Add import:
```ts
import { gradingStandardsTools } from './grading-standards'
```

Add entry after the `new_quizzes` entry (educator domain, primary audience `educator`):
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

- `CanvasGradingStandard` fields: `id`, `title`, `context_type`, `context_id`, `grading_scheme`. None are `CanvasUser`, `participants`, or `user_name`.
- `apply_grading_standard_to_course` returns `CanvasCourse`, which has a `teachers` array of display-name objects — but no student data.
- The pseudonymizer rule triggers only on `CanvasUser` objects, `participants` arrays, or `user_name` fields. None of the three tools touch student identity fields.

Do NOT add any of the three new tool names to `PSEUDONYMIZER_WRAPPED_TOOLS`. The CI coverage test (`tests/pseudonym/coverage.test.ts`) must continue to pass unchanged. Implementation must not add these tools to the coverage list.

---

## Test plan

All tests use mocked Canvas responses. No live Canvas calls.

### Canvas client tests — `tests/canvas/grading-standards.test.ts` (new file)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GradingStandardsModule } from '../../src/canvas/grading-standards'
import { CanvasHttpClient } from '../../src/canvas/client'
```

Mock fixture:
```ts
const mockStandard = {
  id: 42,
  title: 'GPA 4.0 Scale',
  context_type: 'Course',
  context_id: 100,
  grading_scheme: [
    { name: 'A',  value: 0.94 },
    { name: 'B',  value: 0.84 },
    { name: 'F',  value: 0.00 },
  ],
}
```

**Case 1 — `listForCourse` happy path**: mock `client.paginate` to return `[mockStandard]`. Assert:
- Returns array of length 1.
- `client.paginate` called with `'/api/v1/courses/100/grading_standards'`.

**Case 2 — `listForCourse` empty**: mock returns `[]`. Assert method returns `[]`.

**Case 3 — `listForAccount` happy path**: mock `client.paginate` to return `[mockStandard]`. Assert:
- `client.paginate` called with `'/api/v1/accounts/1/grading_standards'`.

**Case 4 — `createForCourse` happy path**: mock `client.request` to return `mockStandard`. Assert:
- Returns the created standard object.
- `client.request` called with `'/api/v1/courses/100/grading_standards'` and `{ method: 'POST', body: ... }`.
- The parsed body contains `title: 'GPA 4.0 Scale'` and `grading_scheme_entry` sorted descending by value.

**Case 5 — `createForCourse` sorts entries**: call with entries in ascending value order (`F: 0.0`, `B: 0.84`, `A: 0.94`). Assert the posted `grading_scheme_entry` is `[{ name: 'A', value: 0.94 }, { name: 'B', value: 0.84 }, { name: 'F', value: 0.00 }]`. Verify the caller's original array is **not** mutated.

**Case 6 — `createForCourse` does not mutate input**: pass a sorted array, capture reference before call, assert it equals the reference after call.

**Case 7 — `createForAccount` happy path**: mock `client.request` to return `mockStandard`. Assert `client.request` called with `'/api/v1/accounts/1/grading_standards'`.

**Case 8 — Error propagation**: mock `client.request` to throw `new CanvasApiError('Forbidden', 403, '/api/v1/accounts/1/grading_standards')`. Assert the error propagates from `createForAccount` (not caught at client layer).

### Tool tests — `tests/tools/grading-standards.test.ts` (new file)

```ts
import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { CanvasApiError } from '../../src/canvas/client'
import { gradingStandardsTools } from '../../src/tools/grading-standards'
```

**`buildMockCanvas()` helper**:

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

**Suite-level check**:
- `gradingStandardsTools` exports exactly 3 tool definitions.
- Tool names are `['list_grading_standards', 'create_grading_standard', 'apply_grading_standard_to_course']`.

**`list_grading_standards`**:
1. Annotations: `{ readOnlyHint: true, openWorldHint: true }`.
2. With `course_id`: calls `canvas.gradingStandards.listForCourse(100)`.
3. With `account_id`: calls `canvas.gradingStandards.listForAccount(1)`.
4. Missing both IDs: handler throws an `Error` (not a `CanvasApiError`).
5. Error propagation — 404: mock `listForCourse` throws `CanvasApiError(404)`. Assert it propagates.

**`create_grading_standard`**:
1. Annotations: `{ destructiveHint: true, openWorldHint: true }`.
2. With `course_id`: calls `canvas.gradingStandards.createForCourse(100, 'GPA 4.0 Scale', schemeEntries)`.
3. With `account_id`: calls `canvas.gradingStandards.createForAccount(1, 'GPA 4.0 Scale', schemeEntries)`.
4. Missing both IDs: handler throws an `Error`.
5. Account-context 403: mock `createForAccount` throws `CanvasApiError('Forbidden', 403, ...)`. Assert handler **returns** `{ error: 'Creating grading standards at the account level requires Canvas admin permissions...' }` (does not throw).
6. Course-context 403: mock `createForCourse` throws `CanvasApiError('Forbidden', 403, ...)`. Assert it **re-throws** (not the custom message).
7. 422 (invalid data): mock `createForCourse` throws `CanvasApiError('Unprocessable', 422, ...)`. Assert it re-throws.

**`apply_grading_standard_to_course`**:
1. Annotations: `{ destructiveHint: true, openWorldHint: true }`.
2. Apply with valid ID: calls `canvas.courses.update(100, { grading_standard_id: 42 })`.
3. Remove (null): calls `canvas.courses.update(100, { grading_standard_id: null })`.
4. Returns the updated course object from `canvas.courses.update`.
5. Error propagation — 404: mock `canvas.courses.update` throws `CanvasApiError(404)`. Assert it propagates.

### Facade test — `tests/canvas/facade.test.ts`

The existing `facade.test.ts` validates that `CanvasClient` exposes all expected modules. After this implementation, add `gradingStandards` to the checked properties list. The expected delta is one added assertion (or one added element to the property array, depending on how the test is structured).

### Registry test — `tests/tools/registry.test.ts`

The existing registry test likely counts total tool definitions or checks domain names. After this implementation:
- 3 new tools added → update the total-tool-count assertion.
- `'grading_standards'` domain added to catalog → update the domain list assertion if one exists.

Check `tests/tools/registry.test.ts` for the exact count assertion before implementing; do not guess the line number.

### Pseudonymizer coverage test — `tests/pseudonym/coverage.test.ts`

No changes. Do NOT add any of the three new tool names to `PSEUDONYMIZER_WRAPPED_TOOLS`. The coverage test must pass unchanged, confirming that these tools are correctly identified as non-PII tools.

---

## Implementation notes for the implementor

1. **Mutual exclusion (`course_id` XOR `account_id`)**: Canvas has no single combined endpoint. The tool layer handles the routing; the client layer has separate methods. This is explicit rather than relying on Canvas to reject invalid combos.

2. **`grading_scheme_entry` vs `grading_scheme` asymmetry**: Canvas's POST body key (`grading_scheme_entry`, singular) differs from the response key (`grading_scheme`, plural). This is a known Canvas API quirk. Document it in the tool description; no special type gymnastics are needed — `body: JSON.stringify({ title, grading_scheme_entry: sorted })` is sufficient.

3. **`apply_grading_standard_to_course` uses `canvas.courses.update`**: The implementor must add `grading_standard_id?: number | null` to `UpdateCourseParams` in `types.ts`. The `CoursesModule.update()` method already serialises `params` as `JSON.stringify({ course: params })`, so no method change is needed — just the type update.

4. **Sorting in the client**: `[...schemeEntries].sort((a, b) => b.value - a.value)` creates a shallow copy before sort to avoid mutating the caller's array. The canvas client test (Case 6) verifies immutability.

5. **New module count**: This adds 1 new Canvas client module and 1 new tool module. The implementation adds ~5–6 source files total (canvas module, tool module, 2 test files, type additions, catalog/index wiring). This is well within the 15-file cap.

---

## Acceptance check

- [x] `**design-first**` flag present in issue #186.
- [x] Design unknown §1 (API surface): retired — list + create only; no get-by-ID, update, or delete.
- [x] Design unknown §2 (apply to course): retired — dedicated `apply_grading_standard_to_course` tool using `courses.update()` with `grading_standard_id` param.
- [x] Design unknown §3 (value semantics): retired — lower-bound fraction 0–1, sorted descending, `grading_scheme_entry` POST key documented.
- [x] Design unknown §4 (account-context permission): retired — custom 403 message for account-context `create_grading_standard`.
- [x] Exact tool names, Zod schemas, Canvas endpoints, MCP annotations, and output shapes specified.
- [x] Type additions specified with rationale.
- [x] Client module structure and method signatures specified.
- [x] `apply_grading_standard_to_course` routes through `canvas.courses.update()` — no new HTTP call needed.
- [x] Test plan covers happy path, empty list, sorting, immutability, error propagation, and the account-context 403 branch.
- [x] No new package dependencies.
- [x] No FERPA pseudonymizer wrapping required — confirmed and documented.
- [x] Pseudonymizer coverage test unaffected — no additions to `PSEUDONYMIZER_WRAPPED_TOOLS`.
- [x] Façade test and registry test update requirements noted for implementor.
