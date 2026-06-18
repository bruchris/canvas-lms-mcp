---
issue: 197
---

# Per-Student and Per-Section Assignment Due-Date / Availability Overrides — MCP Tool Design

**Date**: 2026-06-18
**Issue**: [bruchris/canvas-lms-mcp#197](https://github.com/bruchris/canvas-lms-mcp/issues/197)
**Status**: Design — awaiting CTO review

---

## Purpose

Add three tools that let an AI assistant create and audit assignment due-date / availability
overrides across a Canvas course:

1. `list_assignment_overrides` — read overrides for one assignment (`GET /courses/:id/assignments/:id/overrides`).
2. `create_assignment_override` — primitive write to create a single override targeting a student set, section, or group (`POST /courses/:id/assignments/:id/overrides`).
3. `set_student_assignment_dates` — fan-out workflow that creates a per-student override across all (or a filtered subset of) assignments in a course in one operation, with partial-failure handling.

This completes the accommodation story deferred from #191: quiz extra-time/attempts are handled by `set_student_quiz_accommodation`; assignment due-date / availability overrides are handled by these tools.

The `CanvasAssignmentOverride` type already exists in `src/canvas/types.ts`. No new canvas module file is needed; the new methods are added to the existing `AssignmentsModule`.

Assignment override responses contain only numeric IDs and dates — no `CanvasUser` object, no `user_name`, no `participants` array. No pseudonymizer wrapping is required. Callers who pass real `student_ids` or `user_id` under `CANVAS_PSEUDONYMIZE_STUDENTS=true` must first call `resolve_pseudonym` to obtain real IDs; tool descriptions instruct this.

---

## Design unknowns (retired)

### 1. Single-assignment primitive vs course-wide fan-out vs both

**Decision: both, mirroring #191's two-tool shape.**

The issue recommends both. The primitive (`create_assignment_override`) is the low-level building block that handles single-assignment, multi-target (student set, section, group) use cases. The fan-out (`set_student_assignment_dates`) is the high-value workflow tool that eliminates the per-assignment repetition complained about in the community threads. Both are needed because:

- A section-wide override covers all students in one call at the API level; no fan-out needed.
- The student accommodation use case always fans across many assignments; the primitive alone requires the model to enumerate assignments and call it N times.

### 2. Target validation: create-vs-update semantics when an override already exists

**Decision: V1 is create-only. Canvas returns a `422 Unprocessable Entity` when a student-set override already exists for the same students on the same assignment; this surfaces as `CanvasApiError` in the fan-out's `failed[]` array.**

Rationale:

- Canvas does not silently overwrite existing overrides. Attempting to create a duplicate student-set override returns a 422 with a message like "assignment already has an override for these students."
- V1 keeps the contract simple: call `list_assignment_overrides` first to audit, then call `create_assignment_override` or `set_student_assignment_dates` for assignments that don't yet have an override.
- V2 can add upsert semantics (`PUT /courses/:id/assignments/:id/overrides/:id` for existing overrides) once the common pattern is confirmed in practice.
- The tool descriptions document this limitation explicitly so the model can advise instructors to use the audit tool first.

For the fan-out, when Canvas returns a 422 for one assignment (existing override), the result lands in `failed[]` with the Canvas error message. The fan-out continues to all remaining assignments (partial-failure model, same as #191).

### 3. Whether to accept a relative shift (+3 days) in addition to absolute timestamps

**Decision: V1 supports only absolute ISO 8601 timestamps (e.g. `"2026-09-15T23:59:00Z"`). Relative offsets are V2.**

Rationale:

- Relative offsets require fetching the current due date per assignment before creating the override. For the fan-out this means an extra Canvas API call per assignment (doubling the call count for large courses).
- The implementation complexity is nontrivial: you must handle assignments with no due date (`due_at: null`), decide the base for `unlock_at` / `lock_at` relative to `due_at` vs their own current values, and propagate per-assignment shift results to the output.
- The simpler pattern (`list_assignments`, inspect current dates, compute new absolute dates, call this tool) covers the same use case without server-side complexity. The model can perform this arithmetic.
- The tool descriptions advise: "to shift dates by a relative amount, first call `list_assignments` with `include=overrides` to retrieve current dates, compute the desired absolute timestamps, then call this tool."

### 4. Batch endpoint (`PUT /courses/:id/assignments/overrides`) vs per-assignment POST for the fan-out

**Decision: per-assignment `POST /courses/:course_id/assignments/:assignment_id/overrides` for the fan-out in V1.**

Rationale:

- The Canvas batch `PUT /courses/:id/assignments/overrides` endpoint operates on *existing* overrides only — it requires `id` for each override object. It cannot create new overrides; it updates/deletes existing ones. Since V1 is create-only, this endpoint is inapplicable.
- Per-assignment POST is correct for creation and keeps the implementation consistent with `create_assignment_override`.
- The per-call overhead is acceptable for the accommodation use case (typically 5–40 assignments per course). The tool description notes the call count to set expectations.
- V2 (with upsert semantics) can use the batch endpoint for update operations.

### 5. FERPA / pseudonymization

**Decision: no pseudonymizer wrapping required for any of the three tools. Callers must resolve pseudonyms to real IDs before calling.**

Detailed rationale:

- **`list_assignment_overrides`**: Returns `CanvasAssignmentOverride[]`. Canvas returns ALL overrides for an assignment — including overrides created by other instructors for other students not known to the caller. Each object contains `student_ids?: number[]` (numeric Canvas user IDs), `group_id?: number`, `course_section_id?: number` — no `CanvasUser` object, no `user_name` string, no `participants` array. Integer IDs are not within the three pseudonymizer trigger patterns (`CanvasUser` object, `user_name` string, `participants` array), so no wrapping is needed regardless of how the IDs originated.
- **`create_assignment_override`**: Returns a single `CanvasAssignmentOverride` (same shape as above). Same reasoning.
- **`set_student_assignment_dates`**: Returns `{ applied, skipped, failed, summary }`. Each result entry contains `{ assignment_id, assignment_name, override_id?, applied, error? }` — no student identifiers appear in the output. The `user_id` input is consumed but never echoed in the response.
- **Caller responsibility**: All three tools accept real Canvas user IDs (`student_ids` / `user_id`). Under `CANVAS_PSEUDONYMIZE_STUDENTS=true`, the caller must first call `resolve_pseudonym` to map a pseudonym → real `user_id`. Tool descriptions instruct this.
- **No `PSEUDONYMIZER_WRAPPED_TOOLS` registration**: None of the three tool names are added to `src/pseudonym/coverage.ts`. The CI coverage test passes unchanged.

---

## Type additions (`src/canvas/types.ts`)

### 1. Add `CreateAssignmentOverrideParams` (new, under `// --- Assignments (params) ---`)

Insert after `UpdateAssignmentParams` (at the end of the `// --- Assignments (params) ---` section):

```ts
export interface CreateAssignmentOverrideParams {
  title?: string
  student_ids?: number[]
  group_id?: number
  course_section_id?: number
  due_at?: string | null
  unlock_at?: string | null
  lock_at?: string | null
}
```

**Note**: `CanvasAssignmentOverride` already exists in `types.ts` (under `// --- Assignments ---`). No changes to that interface are needed.

---

## Canvas client additions (`src/canvas/assignments.ts`)

Add two new methods to the **existing** `AssignmentsModule` class. Add `CreateAssignmentOverrideParams` and `CanvasAssignmentOverride` to the import from `'./types'` at the top of `assignments.ts`. (`CanvasAssignmentOverride` is already defined in types.ts but not currently imported in assignments.ts.)

### Method 1: `listOverrides`

```ts
async listOverrides(courseId: number, assignmentId: number): Promise<CanvasAssignmentOverride[]> {
  return this.client.paginate<CanvasAssignmentOverride>(
    `/api/v1/courses/${courseId}/assignments/${assignmentId}/overrides`,
  )
}
```

**Why `paginate`**: Canvas paginates the overrides list via Link headers (one page per request, same as assignments). Using `paginate()` handles courses with many overrides correctly.

### Method 2: `createOverride`

```ts
async createOverride(
  courseId: number,
  assignmentId: number,
  params: CreateAssignmentOverrideParams,
): Promise<CanvasAssignmentOverride> {
  return this.client.request<CanvasAssignmentOverride>(
    `/api/v1/courses/${courseId}/assignments/${assignmentId}/overrides`,
    {
      method: 'POST',
      body: JSON.stringify({ assignment_override: params }),
    },
  )
}
```

**POST body key**: `assignment_override` (singular, Canvas convention for single-resource creates) — note this diverges from the existing `create()` method in `AssignmentsModule`, which wraps its payload as `{ assignment: params }`. The override endpoint uses a different envelope. Canvas returns the created override as a single object (not wrapped in an envelope).

**Duplicate guard**: Canvas returns a `422` if a student-set override already exists for the same students. `createOverride` does not catch this — it propagates as `CanvasApiError`. The tool handler layer handles it per the decided semantics (fail entry in the fan-out, or surface directly for the primitive).

---

## Tool module — `src/tools/assignment-overrides.ts` (new file)

```ts
import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import { CanvasApiError } from '../canvas/client'
import type { ToolDefinition } from './types'

interface AssignmentOverrideResult {
  assignment_id: number
  assignment_name: string
  override_id?: number
  applied: boolean
  error?: string
}

export function assignmentOverrideTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    /* list_assignment_overrides, create_assignment_override, set_student_assignment_dates below */
  ]
}
```

### Tool 1: `list_assignment_overrides`

```ts
{
  name: 'list_assignment_overrides',
  description:
    'List all due-date / availability overrides for a specific assignment in a course. ' +
    'Returns overrides targeting individual students, sections, or groups. ' +
    'Useful for auditing before creating a new override — Canvas returns a 422 if a ' +
    'student-set override already exists for the same students on the same assignment.',
  inputSchema: {
    course_id: z.number().int().positive().describe('Canvas course ID'),
    assignment_id: z.number().int().positive().describe('Canvas assignment ID'),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  handler: async (params) => {
    const courseId = params.course_id as number
    const assignmentId = params.assignment_id as number
    return canvas.assignments.listOverrides(courseId, assignmentId)
  },
}
```

### Tool 2: `create_assignment_override`

```ts
{
  name: 'create_assignment_override',
  description:
    'Create a due-date / availability override for a specific assignment, targeting a set of ' +
    'students, a course section, or a group. Exactly one of student_ids, course_section_id, ' +
    'or group_id must be provided. At least one date field (due_at, unlock_at, lock_at) should ' +
    'be provided; omit a date field to leave the corresponding date unchanged for the override target. ' +
    'Dates must be ISO 8601 strings (e.g. "2026-09-15T23:59:00Z"). ' +
    'Canvas returns a 422 if a student-set override already exists for the same students on this ' +
    'assignment — use list_assignment_overrides to audit first. ' +
    'Provide student_ids as real Canvas user IDs. If CANVAS_PSEUDONYMIZE_STUDENTS is enabled, ' +
    'call resolve_pseudonym first to resolve pseudonyms to real user IDs.',
  inputSchema: {
    course_id: z.number().int().positive().describe('Canvas course ID'),
    assignment_id: z.number().int().positive().describe('Canvas assignment ID'),
    student_ids: z
      .array(z.number().int().positive())
      .min(1)
      .optional()
      .describe(
        'Real Canvas user IDs to grant the override to. ' +
          'Mutually exclusive with course_section_id and group_id.',
      ),
    course_section_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'ID of the course section to override. ' +
          'Mutually exclusive with student_ids and group_id.',
      ),
    group_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'ID of the group to override. ' +
          'Mutually exclusive with student_ids and course_section_id.',
      ),
    title: z
      .string()
      .optional()
      .describe('Human-readable label for this override (e.g. "Disability accommodation — Jane D").'),
    due_at: z
      .string()
      .optional()
      .nullable()
      .describe('New due date in ISO 8601 format. Pass null to remove the due date for this target.'),
    unlock_at: z
      .string()
      .optional()
      .nullable()
      .describe('Availability open date in ISO 8601 format. Pass null to remove.'),
    lock_at: z
      .string()
      .optional()
      .nullable()
      .describe('Availability close date in ISO 8601 format. Pass null to remove.'),
  },
  annotations: {
    destructiveHint: true,
    openWorldHint: true,
  },
  handler: async (params) => {
    const courseId = params.course_id as number
    const assignmentId = params.assignment_id as number
    const studentIds = params.student_ids as number[] | undefined
    const sectionId = params.course_section_id as number | undefined
    const groupId = params.group_id as number | undefined

    const targetCount = [studentIds, sectionId, groupId].filter((v) => v !== undefined).length
    if (targetCount === 0) {
      throw new Error('Provide exactly one of student_ids, course_section_id, or group_id.')
    }
    if (targetCount > 1) {
      throw new Error(
        'Provide exactly one of student_ids, course_section_id, or group_id — they are mutually exclusive.',
      )
    }

    const overrideParams: Record<string, unknown> = {}
    if (studentIds !== undefined) overrideParams.student_ids = studentIds
    if (sectionId !== undefined) overrideParams.course_section_id = sectionId
    if (groupId !== undefined) overrideParams.group_id = groupId
    if (params.title !== undefined) overrideParams.title = params.title
    if (params.due_at !== undefined) overrideParams.due_at = params.due_at
    if (params.unlock_at !== undefined) overrideParams.unlock_at = params.unlock_at
    if (params.lock_at !== undefined) overrideParams.lock_at = params.lock_at

    return canvas.assignments.createOverride(
      courseId,
      assignmentId,
      overrideParams as import('../canvas/types').CreateAssignmentOverrideParams,
    )
  },
}
```

**Target mutual-exclusion rationale**: Canvas enforces one target type per override at the API level. The Zod schema leaves all three optional (Zod cannot express XOR natively). The handler performs the XOR check and throws a plain `Error` before any Canvas call — `buildHandler` maps this to an `isError: true` MCP response.

### Tool 3: `set_student_assignment_dates`

```ts
{
  name: 'set_student_assignment_dates',
  description:
    'Fan a due-date / availability override for a specific student across all (or a filtered subset of) ' +
    'assignments in a course. Creates one student-set override per assignment via the Canvas assignment ' +
    'overrides API. Partial failures are tolerated — a failure on one assignment does not abort the rest. ' +
    'Note: for courses with many assignments this makes one Canvas API call per assignment. ' +
    'V1 is create-only: if an override for this student already exists on an assignment, Canvas returns ' +
    'a 422 and that assignment appears in the failed[] list. Use list_assignment_overrides to audit first. ' +
    'Dates must be ISO 8601 strings. To shift dates by a relative amount, first call list_assignments ' +
    'with include=overrides to retrieve current dates, compute absolute timestamps, then call this tool. ' +
    'Provide user_id as the real Canvas user ID. If CANVAS_PSEUDONYMIZE_STUDENTS is enabled, ' +
    'call resolve_pseudonym first to obtain the real user_id from a pseudonym.',
  inputSchema: {
    course_id: z.number().int().positive().describe('Canvas course ID'),
    user_id: z
      .number()
      .int()
      .positive()
      .describe('Real Canvas user ID of the student to accommodate'),
    assignment_ids: z
      .array(z.number().int().positive())
      .optional()
      .describe(
        'Limit the fan-out to these specific assignment IDs. ' +
          'Omit to target all assignments in the course.',
      ),
    title: z
      .string()
      .optional()
      .describe('Label for each override (e.g. "Disability accommodation"). Defaults to "Student accommodation".'),
    due_at: z
      .string()
      .optional()
      .nullable()
      .describe('New due date in ISO 8601 format. Pass null to remove the due date.'),
    unlock_at: z
      .string()
      .optional()
      .nullable()
      .describe('Availability open date in ISO 8601 format. Pass null to remove.'),
    lock_at: z
      .string()
      .optional()
      .nullable()
      .describe('Availability close date in ISO 8601 format. Pass null to remove.'),
  },
  annotations: {
    destructiveHint: true,
    openWorldHint: true,
  },
  handler: async (params) => {
    const courseId = params.course_id as number
    const userId = params.user_id as number
    const assignmentIds = params.assignment_ids as number[] | undefined
    const dueAt = params.due_at as string | null | undefined
    const unlockAt = params.unlock_at as string | null | undefined
    const lockAt = params.lock_at as string | null | undefined
    const title = (params.title as string | undefined) ?? 'Student accommodation'

    if (dueAt === undefined && unlockAt === undefined && lockAt === undefined) {
      throw new Error('Provide at least one of due_at, unlock_at, or lock_at.')
    }

    let assignments = await canvas.assignments.list(courseId)
    if (assignmentIds && assignmentIds.length > 0) {
      const idSet = new Set(assignmentIds)
      assignments = assignments.filter((a) => idSet.has(a.id))
    }

    const applied: AssignmentOverrideResult[] = []
    const skipped: AssignmentOverrideResult[] = []
    const failed: AssignmentOverrideResult[] = []

    for (const assignment of assignments) {
      const overrideParams: import('../canvas/types').CreateAssignmentOverrideParams = {
        student_ids: [userId],
        title,
      }
      if (dueAt !== undefined) overrideParams.due_at = dueAt
      if (unlockAt !== undefined) overrideParams.unlock_at = unlockAt
      if (lockAt !== undefined) overrideParams.lock_at = lockAt

      try {
        const override = await canvas.assignments.createOverride(
          courseId,
          assignment.id,
          overrideParams,
        )
        applied.push({
          assignment_id: assignment.id,
          assignment_name: assignment.name,
          override_id: override.id,
          applied: true,
        })
      } catch (err) {
        const message = err instanceof CanvasApiError ? err.message : 'Unknown error'
        failed.push({
          assignment_id: assignment.id,
          assignment_name: assignment.name,
          applied: false,
          error: message,
        })
      }
    }

    return {
      applied,
      skipped,
      failed,
      summary: {
        total_assignments: assignments.length,
        applied: applied.length,
        skipped: skipped.length,
        failed: failed.length,
      },
    }
  },
}
```

**Skipped array**: Always empty in V1. Included in the output for forward compatibility (V2 may populate it for assignments already having an override when upsert detection is added). The `summary.skipped` count is always 0 in V1.

**Per-assignment try/catch**: Deliberate. A 422 (duplicate override) or 403 (permission) on one assignment must NOT abort the fan-out. The error is recorded in `failed[]` so the caller sees a complete picture.

**No student PII in output**: `applied[]` and `failed[]` entries contain `{ assignment_id, assignment_name, override_id?, applied, error? }`. The `user_id` input is NOT echoed in any output field.

**Unpublished assignments**: `canvas.assignments.list()` returns all assignments visible to the caller. Instructors see both published and unpublished assignments. The fan-out does NOT filter by published status — overrides may be created on unpublished assignments. This is valid Canvas behavior: the override is ready when the assignment is published.

**`assignment_ids` filter — silent drop**: When `assignment_ids` is provided, the handler filters the list returned by `canvas.assignments.list()` using a `Set`. Assignment IDs in `assignment_ids` that do not exist in the course (i.e., absent from `list()`) are silently ignored — they produce no `failed[]` entry. Callers should not rely on `summary.total_assignments` matching `assignment_ids.length`.

---

## Catalog registration (`src/tools/catalog.ts`)

Two changes:

1. **Import** (after `import { contentExportsTools } from './content-exports'`):

```ts
import { assignmentOverrideTools } from './assignment-overrides'
```

2. **Entry** (after the `grading_standards` entry at the end of `toolDomainCatalog`):

```ts
  {
    domain: 'assignment_overrides',
    defaultPrimaryAudience: 'educator',
    getTools: assignmentOverrideTools,
  },
```

---

## FERPA / pseudonymizer coverage

No changes to `src/pseudonym/coverage.ts`. Do NOT add any of the three tool names to `PSEUDONYMIZER_WRAPPED_TOOLS`.

**Rationale** (for CI audit): `list_assignment_overrides`, `create_assignment_override`, and `set_student_assignment_dates` return only `CanvasAssignmentOverride` objects (or derivative result shapes). These contain `student_ids?: number[]` (numeric IDs), `group_id?: number`, and `course_section_id?: number` — none of which are a `CanvasUser` object, a `participants` array, or a `user_name` field. The three triggering patterns for `PSEUDONYMIZER_WRAPPED_TOOLS` registration are not present. CI passes unchanged.

---

## Test plan

All tests use mocked Canvas responses. No live Canvas calls.

### Canvas client tests — `tests/canvas/assignments.test.ts` (modify existing file)

Add `describe('listOverrides')` and `describe('createOverride')` blocks to the existing assignment client test file.

**`listOverrides` cases:**

1. **Happy path**: Mock `client.paginate` returns `[{ id: 1, assignment_id: 10, title: 'Override 1', student_ids: [42, 43], due_at: '2026-09-15T23:59:00Z', unlock_at: null, lock_at: null }]`. Assert `assignments.listOverrides(100, 10)` returns that array. Assert `client.paginate` called with `'/api/v1/courses/100/assignments/10/overrides'`.

2. **Empty (no overrides)**: Mock `client.paginate` returns `[]`. Assert method returns `[]`.

3. **Error propagation**: Mock `client.paginate` throws `new CanvasApiError('Not Found', 404, '...')`. Assert the error propagates from `listOverrides` unchanged.

**`createOverride` cases:**

4. **Happy path — student_ids**: Mock `client.request` returns `{ id: 1, assignment_id: 10, title: 'Acc', student_ids: [42], due_at: '2026-09-15T23:59:00Z' }`. Assert `assignments.createOverride(100, 10, { student_ids: [42], title: 'Acc', due_at: '2026-09-15T23:59:00Z' })` returns the object. Assert `client.request` was called with `'/api/v1/courses/100/assignments/10/overrides'`, `{ method: 'POST', body: '...' }`, and the parsed body equals `{ assignment_override: { student_ids: [42], title: 'Acc', due_at: '2026-09-15T23:59:00Z' } }`.

5. **Happy path — course_section_id**: Call `createOverride(100, 10, { course_section_id: 5, due_at: '...' })`. Assert parsed POST body is `{ assignment_override: { course_section_id: 5, due_at: '...' } }` (no `student_ids` or `group_id` key).

6. **Null date — removes due date**: Call `createOverride(100, 10, { student_ids: [42], due_at: null })`. Assert parsed body includes `{ due_at: null }`.

7. **422 duplicate propagation**: Mock `client.request` throws `new CanvasApiError('Unprocessable', 422, '...')`. Assert the error propagates unchanged.

### Tool tests — `tests/tools/assignment-overrides.test.ts` (new file)

**`buildMockCanvas()` helper:**

```ts
function buildMockCanvas() {
  return {
    assignments: {
      list: vi.fn().mockResolvedValue([
        { id: 1, name: 'Assignment 1', due_at: '2026-08-01T23:59:00Z',
          points_possible: 10, grading_type: 'points', submission_types: ['online_text_entry'],
          course_id: 10, allowed_attempts: -1 },
        { id: 2, name: 'Assignment 2', due_at: null,
          points_possible: 20, grading_type: 'points', submission_types: ['online_upload'],
          course_id: 10, allowed_attempts: -1 },
      ]),
      listOverrides: vi.fn().mockResolvedValue([
        { id: 5, assignment_id: 1, title: 'Existing Override',
          student_ids: [42], due_at: '2026-09-10T23:59:00Z' },
      ]),
      createOverride: vi.fn().mockResolvedValue({
        id: 99, assignment_id: 1, title: 'Student accommodation',
        student_ids: [42], due_at: '2026-09-15T23:59:00Z',
      }),
    },
  } as unknown as CanvasClient
}
```

**Suite-level checks:**
- `assignmentOverrideTools(buildMockCanvas())` returns exactly **3** tool definitions.
- Tool names in order: `['list_assignment_overrides', 'create_assignment_override', 'set_student_assignment_dates']`.

**`list_assignment_overrides` cases:**

1. Annotations: `{ readOnlyHint: true, openWorldHint: true }`.

2. **Happy path**: Call with `{ course_id: 10, assignment_id: 1 }`. Assert `canvas.assignments.listOverrides` called with `(10, 1)`. Assert result equals the mock array (2 entries).

3. **Empty course**: Mock `listOverrides` returns `[]`. Assert result is `[]`.

**`create_assignment_override` cases:**

4. Annotations: `{ destructiveHint: true, openWorldHint: true }`.

5. **Happy path — student_ids**: Call with `{ course_id: 10, assignment_id: 1, student_ids: [42], due_at: '2026-09-15T23:59:00Z' }`. Assert `canvas.assignments.createOverride` called with `(10, 1, expect.objectContaining({ student_ids: [42], due_at: '2026-09-15T23:59:00Z' }))`. Also assert the params object does NOT contain a `title` key (the handler only includes fields with non-undefined values — `title` is omitted when not provided). Assert result is the mock override object.

6. **Happy path — course_section_id**: Call with `{ course_id: 10, assignment_id: 1, course_section_id: 5, due_at: '...' }`. Assert `createOverride` called with params containing `{ course_section_id: 5 }` and NOT `student_ids` or `group_id`.

7. **No target error**: Call with `{ course_id: 10, assignment_id: 1, due_at: '...' }` (no target). Assert handler throws a plain `Error` containing "exactly one of".

8. **Multiple targets error**: Call with `{ course_id: 10, assignment_id: 1, student_ids: [42], course_section_id: 5, due_at: '...' }`. Assert handler throws a plain `Error` containing "mutually exclusive".

9. **Null due_at**: Call with `{ course_id: 10, assignment_id: 1, student_ids: [42], due_at: null }`. Assert `createOverride` called with params containing `{ due_at: null }`.

**`set_student_assignment_dates` cases:**

10. Annotations: `{ destructiveHint: true, openWorldHint: true }`.

11. **Happy path**: Call with `{ course_id: 10, user_id: 42, due_at: '2026-09-15T23:59:00Z' }`. Assert:
    - `canvas.assignments.list` called with `(10)`.
    - `canvas.assignments.createOverride` called exactly twice (once per assignment).
    - `createOverride` first call: `(10, 1, expect.objectContaining({ student_ids: [42], due_at: '2026-09-15T23:59:00Z', title: 'Student accommodation' }))`.
    - Result: `applied.length === 2`, `failed.length === 0`, `skipped.length === 0`.
    - `applied[0].assignment_id === 1`, `applied[0].override_id === 99`.
    - No `user_id` key in any `applied[]` entry (assert `'user_id' in result.applied[0] === false`).

12. **`assignment_ids` filter**: Call with `{ course_id: 10, user_id: 42, assignment_ids: [1], due_at: '...' }`. Assert `createOverride` called exactly once (only for assignment id 1). `summary.total_assignments === 1`.

13. **Custom title**: Call with `{ course_id: 10, user_id: 42, due_at: '...', title: 'Excused absence makeup' }`. Assert `createOverride` called with title `'Excused absence makeup'`.

14. **Partial failure**: Mock `createOverride` resolves for assignment 1 but throws `new CanvasApiError('Unprocessable Entity', 422, '...')` for assignment 2. Assert:
    - `applied.length === 1`, `failed.length === 1`.
    - `failed[0].assignment_id === 2`, `failed[0].error` is defined.
    - `applied[0].applied === true`.

15. **Empty course**: Mock `list` returns `[]`. Assert `summary.total_assignments === 0`, `applied === []`, `failed === []`.

16. **No date provided error**: Call with `{ course_id: 10, user_id: 42 }` (no dates). Assert handler throws a plain `Error` containing "at least one".

17. **unlock_at and lock_at only (no due_at)**: Call with `{ course_id: 10, user_id: 42, unlock_at: '2026-09-01T00:00:00Z', lock_at: '2026-09-20T23:59:00Z' }`. Assert `createOverride` called with params containing `{ unlock_at: '2026-09-01T00:00:00Z', lock_at: '2026-09-20T23:59:00Z' }` and NOT a `due_at` key.

### Registry test — `tests/tools/registry.test.ts`

**Four changes (precise):**

**Change 1 — extend existing `assignments` mock in `buildFullMockCanvas()`**

Add `listOverrides` and `createOverride` to the existing `assignments` property:

```ts
    assignments: {
      list: async () => [],
      get: async () => ({}),
      listGroups: async () => [],
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => undefined,
      listOverrides: async () => [],          // NEW
      createOverride: async () => ({}),       // NEW
    },
```

Without this, `assignmentOverrideTools` calls `canvas.assignments.listOverrides` and `canvas.assignments.createOverride` which are `undefined` → runtime error in `getAllTools`.

**Change 2 — tool count**: Change `expect(tools).toHaveLength(128)` → `expect(tools).toHaveLength(131)` and the describe string `// returns all 128 tools` → `// returns all 131 tools`.

**Change 3 — `toContain` assertions**: Add after the `// Grading Standards (3)` block (as a new domain section, NOT under `// Assignments (6)`):

```ts
    // Assignment Overrides (3)
    expect(names).toContain('list_assignment_overrides')
    expect(names).toContain('create_assignment_override')
    expect(names).toContain('set_student_assignment_dates')
```

**Change 4 — `writeToolNames` arrays**: `create_assignment_override` and `set_student_assignment_dates` have `destructiveHint: true`. Add both to **both** `writeToolNames` collections in the file:

In `'write tools have destructiveHint: true'` array:
```ts
      'create_assignment_override',
      'set_student_assignment_dates',
```

In `'read tools have readOnlyHint: true'` Set:
```ts
      'create_assignment_override',
      'set_student_assignment_dates',
```

`list_assignment_overrides` has `readOnlyHint: true` and does NOT appear in `writeToolNames`.

**Why Change 4 is critical**: The "read tools have readOnlyHint: true" test iterates every tool NOT in `writeToolNames` and asserts `readOnlyHint === true`. If `create_assignment_override` or `set_student_assignment_dates` are absent from `writeToolNames`, the test asserts they have `readOnlyHint: true` — but they have `destructiveHint: true` — and the test fails.

### Pseudonymizer coverage test — `tests/pseudonym/coverage.test.ts`

No changes. The minimal `buildFullMockCanvas()` mock (stubs that return empty arrays / empty objects) is safe to extend with `listOverrides` and `createOverride` because tool handlers are closures: they are not invoked at registration time (`getAllTools` only constructs the `ToolDefinition[]` array). The pseudonymizer coverage test never calls any tool handler — it only inspects `PSEUDONYMIZER_WRAPPED_TOOLS` membership — so the mock methods are never executed by this test.

### Audience coverage test — `tests/tools/audience-coverage.test.ts`

No changes needed. The domain `assignment_overrides` registers with `defaultPrimaryAudience: 'educator'`. None of the three tools diverge from their domain default, so no `audience` override is needed on any tool definition. The CI test (`audience-coverage.test.ts`) verifies all tools resolve to a non-empty audience; the catalog registration satisfies this.

---

## Implementation checklist for the implementor

1. `src/canvas/types.ts` — add `CreateAssignmentOverrideParams` interface after `UpdateAssignmentParams` in the `// --- Assignments (params) ---` section.
2. `src/canvas/assignments.ts` — add `CanvasAssignmentOverride` and `CreateAssignmentOverrideParams` to the import from `'./types'`; add `listOverrides()` and `createOverride()` methods to `AssignmentsModule`.
3. `src/tools/assignment-overrides.ts` — new file with `assignmentOverrideTools()` function, `AssignmentOverrideResult` inline interface, three tool definitions.
4. `src/tools/catalog.ts` — import `assignmentOverrideTools`; add `assignment_overrides` domain entry after `grading_standards`.
5. `tests/canvas/assignments.test.ts` — add `listOverrides` (3 cases) and `createOverride` (4 cases) blocks to the existing file.
6. `tests/tools/assignment-overrides.test.ts` — new file (3 + 5 + 8 = 16 cases).
7. `tests/tools/registry.test.ts` — 4 changes: `listOverrides`/`createOverride` on existing `assignments` stub; count 128→131; 3 new `toContain` lines under `// Assignment Overrides (3)` comment; `create_assignment_override` and `set_student_assignment_dates` in both `writeToolNames` collections.

---

## Acceptance check

- [x] `**design-first**` flag present in issue #197.
- [x] Design unknown §1 (primitive vs fan-out vs both): retired — both implemented; primitive handles single-assignment multi-target (student set, section, group); fan-out handles course-wide per-student use case.
- [x] Design unknown §2 (create-vs-update semantics for duplicates): retired — V1 is create-only; Canvas 422 on duplicate surfaces in `failed[]`; caller uses `list_assignment_overrides` to audit first; V2 path (upsert via PUT) documented.
- [x] Design unknown §3 (relative shift vs absolute timestamps): retired — V1 absolute ISO 8601 only; relative shift guidance in tool description; model performs arithmetic via `list_assignments` + `include=overrides`.
- [x] Design unknown §4 (batch endpoint vs per-assignment POST): retired — per-assignment POST for all creation; batch `PUT` requires existing override IDs (not applicable for new creates); V2 may use batch for updates.
- [x] Design unknown §5 (FERPA/pseudonymization): retired — no `CanvasUser`/`user_name`/`participants` in output; `student_ids` in override output are the same numeric IDs the caller passed in; caller uses `resolve_pseudonym` if pseudonymization enabled; no `PSEUDONYMIZER_WRAPPED_TOOLS` registration.
- [x] `CanvasAssignmentOverride` already exists in types.ts; only `CreateAssignmentOverrideParams` is new.
- [x] Exact tool names, Zod schemas, Canvas endpoints, MCP annotations, and output shapes specified.
- [x] Type addition: `CreateAssignmentOverrideParams` with exact insertion point.
- [x] Canvas client additions: `listOverrides` (`paginate`, Link-header paginated list) and `createOverride` (`request`, POST with `assignment_override` envelope, Canvas returns single object).
- [x] Tool mutual-exclusion check: handler throws before any Canvas call; `buildHandler` maps to `isError: true`.
- [x] Fan-out error handling: per-assignment try/catch; continues past failures; `failed[]` entries record Canvas error message; no `user_id` in output.
- [x] Skipped array: always empty in V1; included in output shape for V2 forward compatibility.
- [x] Catalog: verbatim import and insertion point after `grading_standards`.
- [x] Registry test: all 4 changes specified precisely — 2 new mock methods on existing `assignments` stub; count 128→131; 3 `toContain` lines under `// Assignment Overrides (3)` comment (separate from `// Assignments (6)`); both write tool names in both `writeToolNames` collections.
- [x] Test plan: 7 client cases + 16 tool cases; including mutual-exclusion validation, null date handling, partial failure, empty course, assignment_ids filter, PII-absence assertion, no-date error, unlock_at+lock_at-only case.
- [x] No new package dependencies.
- [x] FERPA: no pseudonymizer wrapping required; all three tool names excluded from `PSEUDONYMIZER_WRAPPED_TOOLS`; tool descriptions instruct `resolve_pseudonym` use.
- [x] Audience coverage test unaffected (domain default `educator` covers all three tools; no `audience` field override needed).
- [x] Pseudonymizer coverage test unaffected.
