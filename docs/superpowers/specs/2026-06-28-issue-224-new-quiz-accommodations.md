---
issue: 224
---

# New Quizzes Accommodations — MCP Tool Design

**Date**: 2026-06-28
**Issue**: [bruchris/canvas-lms-mcp#224](https://github.com/bruchris/canvas-lms-mcp/issues/224)
**Status**: Design — awaiting CTO review

---

## Purpose

Add two tools that let an AI assistant apply and audit per-student accommodations (extra time and/or extra attempts) across **New Quizzes** in a Canvas course:

1. `set_student_new_quiz_accommodation` — sets a course-level accommodation for a student across all New Quizzes in a course via a single Canvas API call, or fans out per-quiz when specific quiz `assignment_ids` are provided.
2. `list_student_new_quiz_accommodations` — reads back the current course-level accommodation for a student in a course (audit companion to the setter).

These tools close the gap left by `set_student_quiz_accommodation` (Classic Quizzes only, explicitly skipping `quizzes.next`). As institutions migrate to New Quizzes, a course that uses only New Quizzes currently gets every quiz skipped by the Classic tool. These sibling tools cover the missing engine.

---

## Design unknowns (retired)

### Unknown 1: Exact New Quizzes accommodation field names / types

**Decision: New Quizzes use `time_multiplier` (float ratio > 1.0, minimum 1.01) and `extra_attempts` (integer ≥ 1). There is no absolute-time field.**

**Why minimum 1.01 and not 1.0:** `time_multiplier: 1.0` means "100% of the original time limit" — zero extra time, a no-op accommodation. Accepting 1.0 would create a confusing record (accommodation set but no actual benefit). The Zod schema uses `.min(1.01)` to reject this case before Canvas is called; Canvas may or may not accept it, but the tool enforces > 1.0 as an invariant (consistent with the Classic tool's `time_multiplier` Zod minimum, which also uses 1.01).

The Canvas New Quizzes Accommodations API (`POST /api/quiz/v1/courses/{course_id}/accommodations`) accepts:

```json
{
  "user_id": 42,
  "time_multiplier": 1.5,
  "extra_attempts": 2
}
```

`time_multiplier` is the **native and only** time-accommodation field in New Quizzes. It is a float ratio (1.5 = 150% time = 1.5× the quiz's time limit), not an absolute-minute offset. This is materially different from Classic Quizzes (`extra_time` in minutes, optionally derived from a multiplier by the Classic tool's handler).

The tool therefore exposes `time_multiplier` directly — no conversion layer needed. The Classic tool's optional `extra_time_minutes` (absolute) is NOT applicable here.

The POST response returns the applied record:

```json
{
  "user_id": 42,
  "time_multiplier": 1.5,
  "extra_attempts": 2
}
```

The per-quiz endpoint (`POST /api/quiz/v1/courses/{course_id}/quizzes/{assignment_id}/accommodations`) accepts the same body shape and returns the same response.

**TypeScript type** (`CanvasNewQuizAccommodation`) to add to `src/canvas/types.ts`:

```ts
export interface CanvasNewQuizAccommodation {
  user_id: number
  time_multiplier: number | null
  extra_attempts: number | null
}
```

### Unknown 2: Extend existing tool (option A) vs new sibling tool (option B)

**Decision: Option B — two new sibling tools (`set_student_new_quiz_accommodation`, `list_student_new_quiz_accommodations`). The existing Classic tools are NOT modified.**

Rationale:

1. **Different API surfaces, different field shapes.** Classic Quizzes use `POST /courses/:id/quizzes/:id/extensions` with `extra_time` (absolute minutes). New Quizzes use `POST /api/quiz/v1/courses/:id/accommodations` with `time_multiplier` (ratio). Merging them in one tool would require the handler to branch on both input and endpoint, conflating two distinct Canvas subsystems.

2. **Different operation semantics.** Classic Quizzes fan out one POST per quiz (the tool must iterate the quiz list). New Quizzes support a single course-level POST that applies to all New Quizzes at once — a fundamentally different cardinality. The fan-out envelope of the Classic tool is not meaningful for the course-level case.

3. **Precedent in this codebase.** `create_quiz` and `create_new_quiz` are separate tools despite both creating quizzes. The engine split is surfaced explicitly to callers.

4. **Minimal change surface.** Adding new tools is non-breaking. Extending `set_student_quiz_accommodation` would change its output shape (previously all-New-Quizzes courses returned `applied: 0, skipped: N`; after the change they would return `applied: N+M, skipped: 0`), which is a behaviour change for existing callers.

5. **Classic tool description update.** A one-line description change on `set_student_quiz_accommodation` will tell callers that a sibling tool exists for New Quizzes. This is the only change to the Classic tool.

### Unknown 3: Whether a GET/read endpoint exists for auditing New Quizzes accommodations

**Decision: A per-student GET endpoint exists. `list_student_new_quiz_accommodations` uses it.**

The New Quizzes API exposes:

- `GET /api/quiz/v1/courses/{course_id}/accommodations/{user_id}` — returns the course-level accommodation for a specific student, or 404 if no accommodation is set.

The audit tool will call this endpoint and return the record (treating 404 as "no accommodation set" → `has_accommodation: false`).

There is also a list-all endpoint (`GET /api/quiz/v1/courses/{course_id}/accommodations`) but it is not needed for the per-student auditor; calling the per-student URL is simpler and more direct.

### Unknown 4: Course-level single call vs per-quiz application when `assignment_ids` is supplied

**Decision: Course-level by default (single POST to `/accommodations`); per-quiz fan-out when `assignment_ids` is provided (one POST per assignment to `/quizzes/{id}/accommodations`).**

The primary user story is "apply to all New Quizzes in a course in one call." The course-level endpoint satisfies this with a single Canvas API call regardless of how many New Quizzes exist — no quiz listing required.

The optional `assignment_ids` parameter supports the subset case (e.g., "grant accommodation only for the midterm and final"). When provided, the tool fans out to `POST /api/quiz/v1/courses/{course_id}/quizzes/{assignment_id}/accommodations` for each supplied ID.

- **No pre-listing:** In per-quiz mode, the tool does NOT pre-fetch the quiz list to compute `not_found`. Instead, 404 responses from individual per-quiz POSTs are captured as `failed` entries with a descriptive `error` string. This avoids an extra API round-trip and keeps the code simple.
- **No skip reasons:** Unlike Classic Quizzes (where `quiz_type` gates the call), all supplied `assignment_ids` are attempted. There is no skip bucket in the New Quizzes fan-out envelope.

---

## Output shape

A **uniform envelope** is returned regardless of whether the call is course-level or per-quiz:

```ts
interface NewQuizAccommodationResult {
  assignment_id: number | null  // null = course-level; quiz assignment ID = per-quiz
  time_multiplier: number | null
  extra_attempts: number | null
  error?: string                // only on failed entries
}

interface NewQuizAccommodationEnvelope {
  scope: 'course' | 'per_quiz'
  applied: NewQuizAccommodationResult[]
  failed: NewQuizAccommodationResult[]
  summary: {
    applied: number
    failed: number
  }
}
```

`scope` appears only at the top level of the envelope — NOT inside `summary`. Having it in both would be redundant and would require keeping them in sync.

Course-level example output:

```json
{
  "scope": "course",
  "applied": [{ "assignment_id": null, "time_multiplier": 1.5, "extra_attempts": 2 }],
  "failed": [],
  "summary": { "applied": 1, "failed": 0 }
}
```

Per-quiz example output (2 succeeded, 1 failed):

```json
{
  "scope": "per_quiz",
  "applied": [
    { "assignment_id": 101, "time_multiplier": 1.5, "extra_attempts": null },
    { "assignment_id": 102, "time_multiplier": 1.5, "extra_attempts": null }
  ],
  "failed": [
    { "assignment_id": 999, "time_multiplier": null, "extra_attempts": null, "error": "Not found" }
  ],
  "summary": { "applied": 2, "failed": 1 }
}
```

**Error behavior (course-level):** In the course-level path, `setAccommodation` is called without a try/catch. If Canvas returns an error (401, 403, 422, 500), it propagates to `buildHandler` → `isError: true` (no envelope). This is deliberate: the course-level call is atomic (covers all New Quizzes or none), so a Canvas error means nothing was applied, and a top-level error response accurately reflects that. Per-quiz partial failures are handled differently — they use a per-call try/catch so the envelope is always returned even when individual calls fail.

---

## FERPA / pseudonymization

**Neither tool requires pseudonymizer wrapping. Do NOT add either tool name to `PSEUDONYMIZER_WRAPPED_TOOLS`.**

Detailed rationale:

- **Input:** Both tools accept `user_id: number` (the real Canvas user ID). This is consistent with all existing write tools. The tool descriptions instruct the caller to use `resolve_pseudonym` if `CANVAS_PSEUDONYMIZE_STUDENTS` is enabled.
- **`set_student_new_quiz_accommodation` response:** Returns the `NewQuizAccommodationEnvelope` shape above. The `assignment_id` and numeric accommodation values appear; no `CanvasUser` object, no `participants` array, no `user_name` field.
- **`list_student_new_quiz_accommodations` response:** Returns `{ has_accommodation: boolean, time_multiplier: number|null, extra_attempts: number|null }`. The raw Canvas GET response contains `user_id: <number>`. The handler explicitly omits it by constructing a new object with only `has_accommodation`, `time_multiplier`, and `extra_attempts`. This explicit stripping — not pseudonymizer wrapping — is the FERPA mitigation for this tool.
- **CLAUDE.md trigger:** Pseudonymizer wrapping is required when a tool returns "a `CanvasUser`, a `participants` array, or a `user_name` field." None of the three triggers apply to either tool.

---

## Canvas client additions (`src/canvas/new-quizzes.ts`)

Add three new methods to the **existing** `NewQuizzesModule` class. Add `CanvasNewQuizAccommodation` to the import from `'./types'`.

### Method 1: `setAccommodation` (course-level)

```ts
async setAccommodation(
  courseId: number,
  userId: number,
  timeMultiplier?: number,
  extraAttempts?: number,
): Promise<CanvasNewQuizAccommodation> {
  const body: Record<string, unknown> = { user_id: userId }
  if (timeMultiplier !== undefined) body.time_multiplier = timeMultiplier
  if (extraAttempts !== undefined) body.extra_attempts = extraAttempts
  return this.client.request<CanvasNewQuizAccommodation>(
    `/api/quiz/v1/courses/${courseId}/accommodations`,
    { method: 'POST', body: JSON.stringify(body) },
  )
}
```

### Method 2: `setQuizAccommodation` (per-quiz)

```ts
async setQuizAccommodation(
  courseId: number,
  assignmentId: number,
  userId: number,
  timeMultiplier?: number,
  extraAttempts?: number,
): Promise<CanvasNewQuizAccommodation> {
  const body: Record<string, unknown> = { user_id: userId }
  if (timeMultiplier !== undefined) body.time_multiplier = timeMultiplier
  if (extraAttempts !== undefined) body.extra_attempts = extraAttempts
  return this.client.request<CanvasNewQuizAccommodation>(
    `/api/quiz/v1/courses/${courseId}/quizzes/${assignmentId}/accommodations`,
    { method: 'POST', body: JSON.stringify(body) },
  )
}
```

### Method 3: `getAccommodation` (read/audit)

```ts
async getAccommodation(
  courseId: number,
  userId: number,
): Promise<CanvasNewQuizAccommodation | null> {
  try {
    return await this.client.request<CanvasNewQuizAccommodation>(
      `/api/quiz/v1/courses/${courseId}/accommodations/${userId}`,
    )
  } catch (err) {
    if (err instanceof CanvasApiError && err.status === 404) return null
    throw err
  }
}
```

**Import change:** The existing line 1 of `new-quizzes.ts` is `import type { CanvasHttpClient } from './client'`. Replace it with a combined import to avoid duplicate-import linting issues:

```ts
import { CanvasApiError, type CanvasHttpClient } from './client'
```

Do NOT add a separate second `import` statement for `'./client'`.

**Note:** `getAccommodation` catches 404 internally and returns `null` (no accommodation set). All other errors propagate. This is the correct pattern for "record may not exist" reads — `CanvasApiError` 404 is a normal non-error state here, not a fault.

---

## Tool module — `src/tools/new-quiz-accommodations.ts` (new file)

```ts
import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import { CanvasApiError } from '../canvas/client'
import type { ToolDefinition } from './types'

interface NewQuizAccommodationResult {
  assignment_id: number | null
  time_multiplier: number | null
  extra_attempts: number | null
  error?: string
}

export function newQuizAccommodationTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    // set_student_new_quiz_accommodation
    // list_student_new_quiz_accommodations
  ]
}
```

**Function signature note:** `newQuizAccommodationTools` takes only `(canvas: CanvasClient)` — no `pseudonymizer` parameter. The `ToolDomainRegistration.getTools` type declares `(canvas, pseudonymizer?)` but TypeScript allows an implementation with fewer parameters (it's structurally compatible). This matches `quizAccommodationTools` (the Classic sibling), which also omits the optional pseudonymizer. Do NOT add a second `_pseudonymizer?: Pseudonymizer` parameter unless the tool later needs to call `pseudonymizer.anonymize*()`.

### Tool 1: `set_student_new_quiz_accommodation`

```ts
{
  name: 'set_student_new_quiz_accommodation',
  description:
    'Apply a time and/or attempts accommodation for a student across all New Quizzes in a course ' +
    '(course-level, single Canvas API call when no assignment_ids are given) or for a specified ' +
    'subset of New Quizzes (per-quiz fan-out when assignment_ids are given). ' +
    'New Quizzes use a time_multiplier (ratio, e.g. 1.5 for 1.5× time), not absolute minutes. ' +
    'For Classic Quizzes (quiz_type: assignment / practice_quiz / etc.) use ' +
    'set_student_quiz_accommodation instead. ' +
    'Partial per-quiz failures are tolerated — a failure on one quiz does not abort the rest. ' +
    'In per-quiz mode, fan-out is sequential (one Canvas API call per assignment ID, awaited in series). ' +
    'Canvas errors on the course-level path (no assignment_ids) propagate as a top-level error (no envelope). ' +
    'Returns a uniform envelope: scope ("course" or "per_quiz"), applied[], failed[], and summary. ' +
    'Provide user_id as the real Canvas user ID. If CANVAS_PSEUDONYMIZE_STUDENTS is enabled, ' +
    'call resolve_pseudonym first to obtain the real user_id from a pseudonym.',
  inputSchema: {
    course_id: z.number().int().positive().describe('Canvas course ID'),
    user_id: z
      .number()
      .int()
      .positive()
      .describe('Real Canvas user ID of the student to accommodate'),
    time_multiplier: z
      .number()
      .min(1.01)
      .optional()
      .describe(
        'Time multiplier for New Quizzes (e.g. 1.5 for 1.5× time, 2.0 for double time). ' +
          'This is the native New Quizzes field; Canvas applies it to each quiz\'s time limit. ' +
          'Must be > 1.0. Mutually exclusive with nothing — can be combined with extra_attempts.',
      ),
    extra_attempts: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Additional attempts to grant beyond each quiz\'s default attempt limit.'),
    assignment_ids: z
      .array(z.number().int().positive())
      .optional()
      .describe(
        'Limit accommodation to these specific New Quiz assignment IDs. ' +
          'Omit to apply a course-level accommodation (covers all New Quizzes in the course ' +
          'with a single Canvas API call). When provided, fans out one call per assignment ID.',
      ),
  },
  annotations: {
    destructiveHint: true,
    openWorldHint: true,
  },
  handler: async (params) => {
    const courseId = params.course_id as number
    const userId = params.user_id as number
    const timeMultiplier = params.time_multiplier as number | undefined
    const extraAttempts = params.extra_attempts as number | undefined
    const assignmentIds = params.assignment_ids as number[] | undefined

    if (timeMultiplier === undefined && extraAttempts === undefined) {
      throw new Error(
        'Provide at least one of time_multiplier or extra_attempts.',
      )
    }

    if (!assignmentIds || assignmentIds.length === 0) {
      // Course-level: single API call covers all New Quizzes
      const record = await canvas.newQuizzes.setAccommodation(
        courseId, userId, timeMultiplier, extraAttempts,
      )
      const result: NewQuizAccommodationResult = {
        assignment_id: null,
        time_multiplier: record.time_multiplier,
        extra_attempts: record.extra_attempts,
      }
      return {
        scope: 'course',
        applied: [result],
        failed: [],
        summary: { applied: 1, failed: 0 },
      }
    }

    // Per-quiz fan-out
    const applied: NewQuizAccommodationResult[] = []
    const failed: NewQuizAccommodationResult[] = []

    for (const assignmentId of assignmentIds) {
      try {
        const record = await canvas.newQuizzes.setQuizAccommodation(
          courseId, assignmentId, userId, timeMultiplier, extraAttempts,
        )
        applied.push({
          assignment_id: assignmentId,
          time_multiplier: record.time_multiplier,
          extra_attempts: record.extra_attempts,
        })
      } catch (err) {
        const message =
          err instanceof CanvasApiError ? err.message : 'Unknown error'
        failed.push({
          assignment_id: assignmentId,
          time_multiplier: null,
          extra_attempts: null,
          error: message,
        })
      }
    }

    return {
      scope: 'per_quiz',
      applied,
      failed,
      summary: { applied: applied.length, failed: failed.length },
    }
  },
}
```

### Tool 2: `list_student_new_quiz_accommodations`

```ts
{
  name: 'list_student_new_quiz_accommodations',
  description:
    'Read the current course-level New Quizzes accommodation (time multiplier and/or extra attempts) ' +
    'for a specific student in a course. Useful for auditing before or after calling ' +
    'set_student_new_quiz_accommodation. ' +
    'Returns has_accommodation: false when no accommodation is set (Canvas 404 is treated as ' +
    '"no record", not an error). ' +
    'New Quizzes store a single course-level accommodation record per student; this is not ' +
    'per-quiz. For Classic Quizzes, use list_student_quiz_accommodations instead. ' +
    'Provide user_id as the real Canvas user ID. If CANVAS_PSEUDONYMIZE_STUDENTS is enabled, ' +
    'call resolve_pseudonym first.',
  inputSchema: {
    course_id: z.number().int().positive().describe('Canvas course ID'),
    user_id: z.number().int().positive().describe('Real Canvas user ID of the student'),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  handler: async (params) => {
    const courseId = params.course_id as number
    const userId = params.user_id as number

    // getAccommodation returns null when Canvas responds 404 (no record set).
    // All other errors propagate to buildHandler → isError: true.
    const record = await canvas.newQuizzes.getAccommodation(courseId, userId)

    if (record === null) {
      return {
        has_accommodation: false,
        time_multiplier: null,
        extra_attempts: null,
      }
    }

    // Strip user_id — output contains only accommodation values, not the student identifier.
    return {
      has_accommodation: true,
      time_multiplier: record.time_multiplier,
      extra_attempts: record.extra_attempts,
    }
  },
}
```

**PII isolation note:** The raw Canvas response contains `user_id`. The handler constructs a new output object that omits `user_id`, so the student identifier never appears in tool output. This is the same pattern used by `list_student_quiz_accommodations`.

---

## Catalog registration (`src/tools/catalog.ts`)

Two changes:

**Import** — insert immediately after the existing line 28 (`import { quizAccommodationTools } from './quiz-accommodations'`):

```ts
import { newQuizAccommodationTools } from './new-quiz-accommodations'
```

**Entry** — insert between the `quiz_accommodations` entry (ends line 190) and the `assignment_overrides` entry (starts line 192), i.e. after:
```ts
  {
    domain: 'quiz_accommodations',
    defaultPrimaryAudience: 'educator',
    getTools: quizAccommodationTools,
  },
```
Add:
```ts
  {
    domain: 'new_quiz_accommodations',
    defaultPrimaryAudience: 'educator',
    getTools: newQuizAccommodationTools,
  },
```

---

## Classic tool description update (`src/tools/quiz-accommodations.ts`)

One change only — replace the existing New Quizzes skip sentence in `set_student_quiz_accommodation`'s `description` with a version that points to the sibling tool:

**Old string** (currently at line ~29 of `src/tools/quiz-accommodations.ts`):
```
'New Quizzes (quiz_type quizzes.next) are skipped — they use a different accommodation ' +
'mechanism not covered by this tool. ' +
```

**New string** (replace with):
```
'New Quizzes (quiz_type quizzes.next) are skipped — use set_student_new_quiz_accommodation instead. ' +
```

This replaces the existing sentence rather than adding a near-duplicate alongside it. No logic, schema, or output changes to the Classic tool.

---

## Test plan

All tests use mocked Canvas responses. No live Canvas calls.

### Canvas client tests — `tests/canvas/new-quizzes.test.ts` (modify existing file)

Add a `describe('setAccommodation')`, `describe('setQuizAccommodation')`, and `describe('getAccommodation')` block to the existing test file.

**Shared fixture:**
```ts
const mockAccommodation: CanvasNewQuizAccommodation = {
  user_id: 42,
  time_multiplier: 1.5,
  extra_attempts: 1,
}
```

**`setAccommodation` cases (3):**

1. **Both fields**: Mock `client.request` returns `mockAccommodation`. Assert `newQuizzes.setAccommodation(10, 42, 1.5, 1)` returns `mockAccommodation`. Assert called with `'/api/quiz/v1/courses/10/accommodations'`, `{ method: 'POST', body: '...' }`, and parsed body equals `{ user_id: 42, time_multiplier: 1.5, extra_attempts: 1 }`.

2. **`time_multiplier` only**: Call `setAccommodation(10, 42, 1.5, undefined)`. Assert parsed body is `{ user_id: 42, time_multiplier: 1.5 }` (no `extra_attempts` key).

3. **`extra_attempts` only**: Call `setAccommodation(10, 42, undefined, 2)`. Assert parsed body is `{ user_id: 42, extra_attempts: 2 }` (no `time_multiplier` key).

**`setQuizAccommodation` cases (2):**

4. **Happy path**: Mock returns `mockAccommodation`. Assert `setQuizAccommodation(10, 101, 42, 1.5, 1)` returns `mockAccommodation`. Assert called with `'/api/quiz/v1/courses/10/quizzes/101/accommodations'`.

5. **Error propagation**: Mock throws `new CanvasApiError('Not Found', 404, '...')`. Assert error propagates.

**`getAccommodation` cases (3):**

6. **Record exists**: Mock returns `mockAccommodation`. Assert `getAccommodation(10, 42)` returns `mockAccommodation`. Assert called with `'/api/quiz/v1/courses/10/accommodations/42'` (no method option → default GET).

7. **No record (404)**: Mock throws `new CanvasApiError('Not Found', 404, '...')`. Assert `getAccommodation(10, 42)` returns `null` (not thrown).

8. **Other error propagates**: Mock throws `new CanvasApiError('Forbidden', 403, '...')`. Assert the error propagates from `getAccommodation` unchanged.

### Tool tests — `tests/tools/new-quiz-accommodations.test.ts` (new file)

**`buildMockCanvas()` helper:**

```ts
function buildMockCanvas() {
  return {
    newQuizzes: {
      setAccommodation: vi.fn().mockResolvedValue({ user_id: 42, time_multiplier: 1.5, extra_attempts: 1 }),
      setQuizAccommodation: vi.fn().mockResolvedValue({ user_id: 42, time_multiplier: 1.5, extra_attempts: 1 }),
      getAccommodation: vi.fn().mockResolvedValue({ user_id: 42, time_multiplier: 1.5, extra_attempts: 1 }),
    },
  } as unknown as CanvasClient
}
```

**Suite-level checks:**
- `newQuizAccommodationTools(buildMockCanvas())` returns exactly **2** tool definitions.
- Tool names: `['set_student_new_quiz_accommodation', 'list_student_new_quiz_accommodations']`.

**`set_student_new_quiz_accommodation` cases:**

1. Annotations: `{ destructiveHint: true, openWorldHint: true }`.

2. **Course-level (no assignment_ids)**: Call with `{ course_id: 10, user_id: 42, time_multiplier: 1.5 }`. Assert:
   - `canvas.newQuizzes.setAccommodation` called with `(10, 42, 1.5, undefined)`.
   - `canvas.newQuizzes.setQuizAccommodation` NOT called.
   - Response `scope === 'course'`.
   - `applied[0].assignment_id === null`.
   - `applied[0].time_multiplier === 1.5`.
   - `summary.applied === 1, summary.failed === 0`.

3. **Course-level — extra_attempts only**: Call with `{ course_id: 10, user_id: 42, extra_attempts: 2 }`. Assert `setAccommodation` called with `(10, 42, undefined, 2)`.

4. **Per-quiz (assignment_ids provided)**: Call with `{ course_id: 10, user_id: 42, time_multiplier: 1.5, assignment_ids: [101, 102] }`. Assert:
   - `setQuizAccommodation` called twice: `(10, 101, 42, 1.5, undefined)` and `(10, 102, 42, 1.5, undefined)`.
   - `setAccommodation` NOT called.
   - Response `scope === 'per_quiz'`.
   - `applied.length === 2`.
   - `applied[0].assignment_id === 101`, `applied[1].assignment_id === 102`.
   - `summary.applied === 2, summary.failed === 0`.

5. **Per-quiz partial failure**: Configure the mock to resolve on the first call and reject on the second:
   ```ts
   canvas.newQuizzes.setQuizAccommodation
     .mockResolvedValueOnce({ user_id: 42, time_multiplier: 1.5, extra_attempts: 1 })
     .mockRejectedValueOnce(new CanvasApiError('Not Found', 404, '/api/quiz/v1/...'))
   ```
   Call with `{ course_id: 10, user_id: 42, time_multiplier: 1.5, assignment_ids: [101, 102] }`. Assert:
   - `applied.length === 1, applied[0].assignment_id === 101`.
   - `failed.length === 1, failed[0].assignment_id === 102`, `failed[0].error` contains "Not Found".
   - `summary.applied === 1, summary.failed === 1`.

6. **No accommodation provided**: Call with `{ course_id: 10, user_id: 42 }` (neither `time_multiplier` nor `extra_attempts`). Assert handler throws `Error` containing "at least one".

7. **Empty assignment_ids treated as course-level**: Call with `{ course_id: 10, user_id: 42, time_multiplier: 1.5, assignment_ids: [] }`. Assert `setAccommodation` is called (course-level path), `setQuizAccommodation` not called.

8. **PII: user_id not echoed in output**: Response `applied[0]` must NOT contain a `user_id` key. Assert `'user_id' in result.applied[0] === false`.

**`list_student_new_quiz_accommodations` cases:**

1. Annotations: `{ readOnlyHint: true, openWorldHint: true }`.

2. **Happy path — accommodation exists**: Mock `getAccommodation` returns `{ user_id: 42, time_multiplier: 1.5, extra_attempts: 1 }`. Call with `{ course_id: 10, user_id: 42 }`. Assert:
   - `canvas.newQuizzes.getAccommodation` called with `(10, 42)`.
   - Response: `{ has_accommodation: true, time_multiplier: 1.5, extra_attempts: 1 }`.
   - Response does NOT contain a `user_id` key.

3. **No accommodation (null from client)**: Mock `getAccommodation` returns `null`. Assert response: `{ has_accommodation: false, time_multiplier: null, extra_attempts: null }`.

4. **Other error propagates**: Mock `getAccommodation` throws `new CanvasApiError('Forbidden', 403, '...')`. Assert error propagates from the tool handler.

### Registry test — `tests/tools/registry.test.ts`

**Three changes:**

**Change 1 — extend `newQuizzes` mock in `buildFullMockCanvas()`:**

Add three methods to the existing `newQuizzes` property:

```ts
newQuizzes: {
  create: async () => ({}),
  update: async () => ({}),
  delete: async () => undefined,
  listItems: async () => [],
  getItem: async () => ({}),
  createItem: async () => ({}),
  updateItem: async () => ({}),
  deleteItem: async () => undefined,
  setAccommodation: async () => ({}),        // NEW
  setQuizAccommodation: async () => ({}),    // NEW
  getAccommodation: async () => null,        // NEW
},
```

**Change 2 — tool count:** Change `expect(tools).toHaveLength(139)` → `expect(tools).toHaveLength(141)`.

**Change 3 — `toContain` assertions:** Add after the existing `// New Quizzes (8)` block:

```ts
// New Quiz Accommodations (2)
expect(names).toContain('set_student_new_quiz_accommodation')
expect(names).toContain('list_student_new_quiz_accommodations')
```

**Change 4 — `writeToolNames` arrays:** `set_student_new_quiz_accommodation` has `destructiveHint: true`. In `tests/tools/registry.test.ts` there are exactly **two** places where write-tool names are listed. In both, insert `'set_student_new_quiz_accommodation'` immediately after the existing `'set_student_quiz_accommodation'` entry (the Classic sibling is already present in both collections — add the New Quiz sibling directly after it):

```ts
'set_student_quiz_accommodation',
'set_student_new_quiz_accommodation',  // ADD
```

The first collection is in the `'write tools have destructiveHint: true'` test; the second is the exclusion `Set` in the `'read tools have readOnlyHint: true'` test. If `set_student_new_quiz_accommodation` is absent from the second Set, the read-tools test will assert `readOnlyHint: true` on it and fail.

---

## Files to change (implementation pass)

| File | Change type |
|------|-------------|
| `src/canvas/types.ts` | Add `CanvasNewQuizAccommodation` interface under `// --- Quizzes ---` |
| `src/canvas/new-quizzes.ts` | Import `CanvasApiError` from `'./client'`; add `CanvasNewQuizAccommodation` to type import; add `setAccommodation`, `setQuizAccommodation`, `getAccommodation` methods to `NewQuizzesModule` |
| `src/tools/new-quiz-accommodations.ts` | **New file** — `newQuizAccommodationTools()` with 2 tools |
| `src/tools/catalog.ts` | Import `newQuizAccommodationTools`; add `new_quiz_accommodations` domain entry |
| `src/tools/quiz-accommodations.ts` | Update `set_student_quiz_accommodation` description to mention sibling tool |
| `tests/canvas/new-quizzes.test.ts` | Add 8 cases for `setAccommodation`, `setQuizAccommodation`, `getAccommodation` |
| `tests/tools/new-quiz-accommodations.test.ts` | **New file** — 12 tool test cases |
| `tests/tools/registry.test.ts` | 4 changes: 3 mock methods; count 139→141; 2 `toContain` lines; `set_student_new_quiz_accommodation` in both `writeToolNames` collections |

**Total: 8 files.** Well within the 15-file guard.

After all files are written, run `pnpm generate:manifests` and commit the updated `docs/generated/tool-manifest.json`. This script updates ONLY the manifest JSON — CI does not regenerate it automatically, and the committed file must reflect the new tool count. The tool count in `tests/tools/registry.test.ts` is a hand-maintained number updated via Change 2 above; `pnpm generate:manifests` does not touch it.

---

## Acceptance check

- [x] **design-first** flag present in issue #224.
- [x] **Unknown 1 (field names/types):** retired — New Quizzes use `time_multiplier` (float ratio > 1.0, Zod min 1.01 to reject no-op accommodations) and `extra_attempts` (integer ≥ 1); no absolute-time field exists; rationale for 1.01 documented; `CanvasNewQuizAccommodation` type specified with exact field names; Classic field shape (`extra_time` minutes) explicitly distinguished.
- [x] **Unknown 2 (option A vs B):** retired — Option B (new sibling tools); rationale covers API surface difference, operation cardinality difference, codebase precedent, and non-breaking change surface; Classic tool gets description-only update.
- [x] **Unknown 3 (GET endpoint):** retired — `GET /api/quiz/v1/courses/{course_id}/accommodations/{user_id}` exists; `getAccommodation` catches 404 internally (returns `null`) and propagates all other errors; `list_student_new_quiz_accommodations` uses this endpoint.
- [x] **Unknown 4 (course-level vs per-quiz):** retired — course-level by default (single API call when no `assignment_ids`); per-quiz fan-out when `assignment_ids` provided; no pre-listing; 404s from per-quiz POSTs become `failed` entries; empty `assignment_ids` treated as course-level.
- [x] Tool names, Zod schemas, Canvas endpoints, MCP annotations, and output shapes fully specified.
- [x] Uniform envelope output shape specified for both modes.
- [x] Canvas client method signatures and body construction specified with field-omission logic (undefined fields not sent).
- [x] `getAccommodation` 404-as-null pattern specified and distinguished from propagating errors.
- [x] FERPA: `user_id` stripped from output in both tools; no `CanvasUser`/`participants`/`user_name` in output; no `PSEUDONYMIZER_WRAPPED_TOOLS` registration; rationale documented.
- [x] Catalog: verbatim import and entry specified.
- [x] Classic tool description update: one-sentence addition, no logic change.
- [x] Registry test: all 4 changes specified precisely — 3 new mock methods; count 139→141; 2 `toContain` lines under `// New Quiz Accommodations (2)`; `set_student_new_quiz_accommodation` in both `writeToolNames` collections.
- [x] Test plan: 8 client cases + 12 tool cases covering course-level, per-quiz, partial failure, no-accommodation-provided error, empty-assignment_ids edge case, PII-stripped output, 404-as-null, 403-propagates.
- [x] `pnpm generate:manifests` step noted for manifest update.
- [x] No new package dependencies.
- [x] 8 files ≤ 15-file guard.
