---
issue: 191
---

# Per-Student Quiz Accommodations — MCP Tool Design

**Date**: 2026-06-16
**Issue**: [bruchris/canvas-lms-mcp#191](https://github.com/bruchris/canvas-lms-mcp/issues/191)
**Status**: Design — awaiting CTO review

---

## Purpose

Add two tools that let an AI assistant apply and audit per-student quiz accommodations (extra time and/or extra attempts) across all Classic Quizzes in a Canvas course in a single operation:

1. `set_student_quiz_accommodation` — fan a student's accommodation across every Classic Quiz in a course (or a specified subset), calling `POST /courses/:id/quizzes/:id/extensions` for each.
2. `list_student_quiz_accommodations` — audit what accommodation is currently set for a student across all Classic Quizzes in a course.

This removes the worst per-instructor Canvas workflow: applying approved accommodations quiz-by-quiz through the moderation page.

New Quizzes (`quiz_type: 'quizzes.next'`) are **explicitly out of scope in V1** — they use a different accommodation mechanism — and are skipped with a documented reason in the result.

No student PII is present in either tool's response. Both tools act on a specific known student (by real Canvas `user_id`); the caller is responsible for resolving a pseudonym to a real `user_id` via `resolve_pseudonym` before calling.

---

## Design unknowns (retired)

### 1. Classic vs New Quizzes

**Decision: Classic-only in V1. New Quizzes are detected by `quiz_type === 'quizzes.next'` and skipped with `skip_reason: 'new_quiz_not_supported'`.**

Rationale:

- The Canvas REST extension endpoint `POST /courses/:id/quizzes/:id/extensions` applies ONLY to Classic Quizzes. Calling it on a New Quiz (which is backed by a Canvas assignment with `is_quiz_lti_assignment: true`) returns a 422 or 404 in practice.
- New Quizzes accommodations are managed through Canvas's account/course-level accommodation settings (a different API surface, LTI-level). That surface is undocumented as a standard REST API; implementing it would violate the Canvas-only product rule.
- The filter is deterministic: `quizzes.list()` already returns `quiz_type`. Any `quiz_type === 'quizzes.next'` entry is skipped before the POST.
- The tool description and per-quiz result both surface this clearly so the model can tell the instructor which quizzes were skipped and why.

Classic quiz types included in the fan-out: `'assignment'`, `'practice_quiz'`, `'graded_survey'`, `'survey'`.

V2 may add New Quizzes support once the Canvas accommodation API for LTI quizzes is documented.

### 2. Scope of accommodation

**Decision: Quiz extra-time and extra-attempts only in V1. Assignment due-date overrides are a separate fast-follow.**

The issue body recommends this phasing and the two concerns are distinct Canvas API surfaces (`/quizzes/:id/extensions` vs `/assignments/:id/overrides`). The V1 tool description explicitly notes the limitation so the model can proactively inform instructors.

### 3. Time input: absolute minutes vs multiplier

**Decision: V1 supports BOTH `extra_time_minutes` (absolute) and `time_multiplier` (relative) as mutually exclusive inputs. The `time_multiplier` path requires adding `time_limit?: number | null` to `CanvasQuiz`.**

When `time_multiplier` is provided:

- `extra_minutes = Math.round(quiz.time_limit * (time_multiplier - 1))` for each quiz.
- If `quiz.time_limit` is `null` (no time limit), `extra_time` is omitted from the POST body for that quiz (the multiplier has nothing to multiply). `extra_attempts` is still applied if also provided.
- If neither `extra_time` nor `extra_attempts` can be applied for a quiz (e.g., `time_multiplier` only + `time_limit: null` + no `extra_attempts`), the quiz's POST is skipped and recorded as `{ applied: false, skip_reason: 'no_time_limit_for_multiplier' }`.
- Minimum computed `extra_time`: if the rounded value is `< 1`, clamp to `1` (Canvas does not accept zero or negative extension values). For example, a 1-minute quiz with `time_multiplier: 1.01` yields `Math.round(0.01) = 0`, clamped to 1.

`time_multiplier` must be `> 1.0`. The Zod schema enforces `.min(1.01)`. Passing `≤ 1.0` is caught by Zod before any Canvas call.

The `time_limit` field is already returned by Canvas's `GET /quizzes` response — it was simply absent from the TypeScript interface. Adding it is a non-breaking type extension.

### 4. Future quizzes

**Decision: V1 documents the limitation clearly. No auto-apply affordance. The tool description explicitly states: "applies only to quizzes that exist at call time; re-run after creating new quizzes."**

There is no Canvas webhook or event-subscription mechanism for auto-applying extensions to newly created quizzes within the Canvas REST API scope. Adding such a mechanism would require a persistent background process outside the MCP server's stateless design.

### 5. FERPA / pseudonymization

**Decision: Both tools accept a real Canvas `user_id` as input. Under `CANVAS_PSEUDONYMIZE_STUDENTS=true`, the caller must first call `resolve_pseudonym` to map a pseudonym → real `user_id`. Neither tool's response contains student PII. No pseudonymizer wrapping is needed.**

Detailed rationale:

- **Input**: Both tools accept `user_id: number` (real Canvas user ID). This is consistent with all existing write tools (`grade_submission`, `enroll_user`, etc.) — they accept real IDs, not pseudonyms. The tool descriptions instruct the caller to use `resolve_pseudonym` if pseudonymization is enabled.
- **Response of `set_student_quiz_accommodation`**: Returns `{ results: [{quiz_id, quiz_title, applied, extra_time_minutes, extra_attempts, ...}], summary: {...} }`. No `CanvasUser` object, no `participants` array, no `user_name` field. The `user_id` input is NOT echoed in the response.
- **Response of `list_student_quiz_accommodations`**: Returns `{ results: [{quiz_id, quiz_title, has_accommodation, extra_time_minutes, extra_attempts}], summary: {...} }`. The raw Canvas GET response (`quiz_extensions` envelope) contains `user_id` for each student who has an extension; the tool filters client-side to the requested `user_id`, strips `user_id` from the result entry (returning only accommodation values), and discards all other students' records. The `user_id` field never appears in tool output.
- **PII note on `CanvasQuizExtension`**: This type carries `user_id` as an internal field used only for filtering within the tool handler layer. It is never forwarded to the MCP caller. Because the output contains no `CanvasUser`, no `participants` array, and no `user_name` field, PSEUDONYMIZER_WRAPPED_TOOLS registration is correctly not required.
- **No `PSEUDONYMIZER_WRAPPED_TOOLS` registration**: Neither tool name is added to `src/pseudonym/coverage.ts`. The CI coverage test (`tests/pseudonym/coverage.test.ts`) passes unchanged.

---

## Type additions (`src/canvas/types.ts`)

### 1. Add `time_limit` to `CanvasQuiz`

Append `time_limit?: number | null` to the existing `CanvasQuiz` interface:

```ts
export interface CanvasQuiz {
  id: number
  title: string
  quiz_type: string
  points_possible: number
  question_count: number
  due_at: string | null
  published: boolean
  time_limit?: number | null  // quiz duration in minutes; null if untimed
}
```

### 2. Add `CanvasQuizExtension` (new, under `// --- Quizzes ---`)

Add after the existing `CanvasQuizSubmissionQuestion` interface:

```ts
export interface CanvasQuizExtension {
  user_id: number
  extra_time: number | null   // Canvas field name (minutes); tool output renames this to extra_time_minutes
  extra_attempts: number | null
}
```

**Field name note**: Canvas uses `extra_time` (in minutes) in both the POST body and the GET response. The tool output renames this to `extra_time_minutes` for caller clarity. The `CanvasQuizExtension` type preserves Canvas's naming; the mapping happens in the tool handler when constructing the result objects.

Canvas may also return `manually_unlocked`, `end_at`, `extend_from_now` — those are not modeled in V1.

---

## Canvas client additions (`src/canvas/quizzes.ts`)

Add two new methods to the **existing** `QuizzesModule` class. Do NOT create a new module file.

Add `CanvasQuizExtension` to the import from `'./types'` at the top of `quizzes.ts`.

### Method 1: `setExtension`

```ts
async setExtension(
  courseId: number,
  quizId: number,
  userId: number,
  extra_time?: number,
  extra_attempts?: number,
): Promise<CanvasQuizExtension[]> {
  const extension: Record<string, number> = { user_id: userId }
  if (extra_time !== undefined) extension.extra_time = extra_time
  if (extra_attempts !== undefined) extension.extra_attempts = extra_attempts
  const response = await this.client.request<{ quiz_extensions: CanvasQuizExtension[] }>(
    `/api/v1/courses/${courseId}/quizzes/${quizId}/extensions`,
    {
      method: 'POST',
      body: JSON.stringify({ quiz_extensions: [extension] }),
    },
  )
  return response.quiz_extensions
}
```

**POST body key**: `quiz_extensions` (plural array). The single-element array is intentional — Canvas accepts a batch but the tool always operates per-student-per-quiz.

**Zero guard**: Do not pass `extra_time: 0` to Canvas. The tool handler ensures `extra_time` is a positive integer before calling this method. If the computed value rounds to zero, it is clamped to 1 (`Math.max(1, Math.round(...))`). An `undefined` `extra_time` is simply omitted from the POST body.

### Method 2: `listExtensions`

```ts
async listExtensions(
  courseId: number,
  quizId: number,
): Promise<CanvasQuizExtension[]> {
  const response = await this.client.request<{ quiz_extensions: CanvasQuizExtension[] }>(
    `/api/v1/courses/${courseId}/quizzes/${quizId}/extensions`,
  )
  return response.quiz_extensions
}
```

**Why `client.request` not `paginateEnvelope`**: Canvas `GET /courses/:id/quizzes/:id/extensions` is a documented endpoint (Canvas Quiz Extensions API) that returns a single-page envelope `{ quiz_extensions: [...all extensions for this quiz...] }` without Link-header pagination. Using `paginateEnvelope` here would be incorrect — `paginateEnvelope` is designed for paginated responses with Link headers (used for `quiz_submissions`, which can span many pages). Since the extensions list for one quiz is bounded (at most one entry per enrolled student), a single `client.request` is correct and simpler.

---

## Tool module — `src/tools/quiz-accommodations.ts` (new file)

```ts
import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import { CanvasApiError } from '../canvas/client'
import type { ToolDefinition } from './types'

const CLASSIC_QUIZ_TYPES = new Set(['assignment', 'practice_quiz', 'graded_survey', 'survey'])

interface QuizAccommodationResult {
  quiz_id: number
  quiz_title: string
  applied: boolean
  skipped?: boolean
  skip_reason?: 'new_quiz_not_supported' | 'no_time_limit_for_multiplier'
  extra_time_minutes: number | null
  extra_attempts: number | null
  error?: string
}

export function quizAccommodationTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    // set_student_quiz_accommodation and list_student_quiz_accommodations below
  ]
}
```

### Tool 1: `set_student_quiz_accommodation`

```ts
{
  name: 'set_student_quiz_accommodation',
  description:
    'Apply extra time and/or extra attempts to a specific student across all Classic Quizzes ' +
    'in a course (or a specified subset). Fans out to the Canvas quiz extensions API for each quiz. ' +
    'New Quizzes (quiz_type quizzes.next) are skipped — they use a different accommodation ' +
    'mechanism not covered by this tool. ' +
    'Only applies to quizzes that exist at call time; re-run after creating new quizzes. ' +
    'Assignment due-date overrides are not handled here (separate fast-follow feature). ' +
    'Note: for courses with many quizzes this makes one Canvas API call per quiz. ' +
    'Provide user_id as the real Canvas user ID. If CANVAS_PSEUDONYMIZE_STUDENTS is enabled, ' +
    'call resolve_pseudonym first to obtain the real user_id from a pseudonym.',
  inputSchema: {
    course_id: z.number().int().positive().describe('Canvas course ID'),
    user_id: z
      .number()
      .int()
      .positive()
      .describe('Real Canvas user ID of the student to accommodate'),
    extra_time_minutes: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Absolute extra time in minutes to add to each quiz. ' +
          'Mutually exclusive with time_multiplier.',
      ),
    time_multiplier: z
      .number()
      .min(1.01)
      .optional()
      .describe(
        'Relative time multiplier (e.g. 1.5 for 1.5× time). ' +
          'extra_minutes = round(quiz.time_limit * (multiplier - 1)), minimum 1 minute. ' +
          'Quizzes with no time limit are skipped for extra_time ' +
          '(extra_attempts is still applied if provided). ' +
          'Mutually exclusive with extra_time_minutes.',
      ),
    extra_attempts: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Additional attempts to grant beyond the quiz default.'),
    quiz_ids: z
      .array(z.number().int().positive())
      .optional()
      .describe(
        'Limit accommodation to these specific quiz IDs. ' +
          'Omit to target all Classic Quizzes in the course.',
      ),
  },
  annotations: {
    destructiveHint: true,
    openWorldHint: true,
  },
  handler: async (params) => {
    const courseId = params.course_id as number
    const userId = params.user_id as number
    const extraTimeMinutes = params.extra_time_minutes as number | undefined
    const timeMultiplier = params.time_multiplier as number | undefined
    const extraAttempts = params.extra_attempts as number | undefined
    const quizIds = params.quiz_ids as number[] | undefined

    if (extraTimeMinutes !== undefined && timeMultiplier !== undefined) {
      throw new Error('Provide either extra_time_minutes or time_multiplier, not both.')
    }
    if (extraTimeMinutes === undefined && timeMultiplier === undefined && extraAttempts === undefined) {
      throw new Error(
        'Provide at least one of extra_time_minutes, time_multiplier, or extra_attempts.',
      )
    }

    let quizzes = await canvas.quizzes.list(courseId)
    if (quizIds && quizIds.length > 0) {
      const idSet = new Set(quizIds)
      quizzes = quizzes.filter((q) => idSet.has(q.id))
    }

    const results: QuizAccommodationResult[] = []
    let appliedCount = 0
    let skippedCount = 0
    let failedCount = 0

    for (const quiz of quizzes) {
      if (!CLASSIC_QUIZ_TYPES.has(quiz.quiz_type)) {
        results.push({
          quiz_id: quiz.id,
          quiz_title: quiz.title,
          applied: false,
          skipped: true,
          skip_reason: 'new_quiz_not_supported',
          extra_time_minutes: null,
          extra_attempts: null,
        })
        skippedCount++
        continue
      }

      let extraTime: number | undefined
      if (extraTimeMinutes !== undefined) {
        extraTime = extraTimeMinutes
      } else if (timeMultiplier !== undefined) {
        if (quiz.time_limit != null && quiz.time_limit > 0) {
          extraTime = Math.max(1, Math.round(quiz.time_limit * (timeMultiplier - 1)))
        }
      }

      if (extraTime === undefined && extraAttempts === undefined) {
        results.push({
          quiz_id: quiz.id,
          quiz_title: quiz.title,
          applied: false,
          skipped: true,
          skip_reason: 'no_time_limit_for_multiplier',
          extra_time_minutes: null,
          extra_attempts: null,
        })
        skippedCount++
        continue
      }

      try {
        await canvas.quizzes.setExtension(courseId, quiz.id, userId, extraTime, extraAttempts)
        results.push({
          quiz_id: quiz.id,
          quiz_title: quiz.title,
          applied: true,
          extra_time_minutes: extraTime ?? null,
          extra_attempts: extraAttempts ?? null,
        })
        appliedCount++
      } catch (err) {
        const message = err instanceof CanvasApiError ? err.message : 'Unknown error'
        results.push({
          quiz_id: quiz.id,
          quiz_title: quiz.title,
          applied: false,
          error: message,
          extra_time_minutes: null,
          extra_attempts: null,
        })
        failedCount++
      }
    }

    return {
      results,
      summary: {
        total_quizzes: quizzes.length,
        applied: appliedCount,
        skipped: skippedCount,
        failed: failedCount,
      },
    }
  },
}
```

**Error handling rationale**: The per-quiz try/catch is deliberate. A partial failure (one quiz returns 403 or 404) must NOT abort the fan-out. The error is recorded per-quiz so the caller sees a complete picture of which quizzes succeeded and which failed.

### Tool 2: `list_student_quiz_accommodations`

```ts
{
  name: 'list_student_quiz_accommodations',
  description:
    'List the current quiz accommodation (extra time and/or extra attempts) for a specific ' +
    'student across all Classic Quizzes in a course. Useful for auditing before or after ' +
    'calling set_student_quiz_accommodation. ' +
    'New Quizzes (quiz_type quizzes.next) are excluded. ' +
    'Makes one Canvas API call per Classic Quiz to read extensions — may be slow for courses with many quizzes. ' +
    'Errors from any quiz\'s GET request propagate immediately (no per-quiz error catching). ' +
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

    const quizzes = await canvas.quizzes.list(courseId)
    const classicQuizzes = quizzes.filter((q) => CLASSIC_QUIZ_TYPES.has(q.quiz_type))

    const results: Array<{
      quiz_id: number
      quiz_title: string
      has_accommodation: boolean
      extra_time_minutes: number | null
      extra_attempts: number | null
    }> = []

    for (const quiz of classicQuizzes) {
      // No try/catch: errors from listExtensions propagate to buildHandler → isError: true.
      // This differs from set_student_quiz_accommodation which catches per-quiz errors.
      const extensions = await canvas.quizzes.listExtensions(courseId, quiz.id)
      const myExt = extensions.find((e) => e.user_id === userId)
      // Strip user_id: output only contains accommodation values, not student identifiers.
      results.push({
        quiz_id: quiz.id,
        quiz_title: quiz.title,
        has_accommodation: myExt !== undefined,
        extra_time_minutes: myExt?.extra_time ?? null,  // Canvas field 'extra_time' → output 'extra_time_minutes'
        extra_attempts: myExt?.extra_attempts ?? null,
      })
    }

    const withAccommodation = results.filter((r) => r.has_accommodation).length
    return {
      results,
      summary: {
        total_classic_quizzes: classicQuizzes.length,
        with_accommodation: withAccommodation,
        without_accommodation: classicQuizzes.length - withAccommodation,
      },
    }
  },
}
```

**PII isolation**: `listExtensions` returns all students' extensions for each quiz. The tool discards all entries where `user_id !== userId` before building the result. The returned `results` array contains only `{ quiz_id, quiz_title, has_accommodation, extra_time_minutes, extra_attempts }` — no `user_id` field appears in the output.

**Error propagation**: `listExtensions` errors are NOT caught in this handler. They propagate to `buildHandler` → `formatError()` → `isError: true` in the MCP response. This is correct for the audit tool — a GET failure for any one quiz means the audit is incomplete, so it is better to surface the error immediately rather than silently skip the quiz.

---

## Catalog registration (`src/tools/catalog.ts`)

Two changes:

1. **Import** (after `import { contentExportsTools } from './content-exports'`):

```ts
import { quizAccommodationTools } from './quiz-accommodations'
```

2. **Entry** (after the `content_exports` entry in `toolDomainCatalog`):

```ts
  {
    domain: 'quiz_accommodations',
    defaultPrimaryAudience: 'educator',
    getTools: quizAccommodationTools,
  },
```

---

## FERPA / pseudonymizer coverage

No changes to `src/pseudonym/coverage.ts`. Do NOT add either tool name to `PSEUDONYMIZER_WRAPPED_TOOLS`.

**Rationale** (for CI audit): Neither `set_student_quiz_accommodation` nor `list_student_quiz_accommodations` returns a `CanvasUser` object, a `participants` array, or a `user_name` field. The `user_id` field in `CanvasQuizExtension` (from `listExtensions`'s raw Canvas response) is used only for client-side filtering and is never surfaced in tool output — the handler explicitly constructs output objects without the `user_id` key. The PSEUDONYMIZER_WRAPPED_TOOLS invariant is satisfied because neither tool's output shape matches any of the three triggering patterns.

---

## Test plan

All tests use mocked Canvas responses. No live Canvas calls.

### Canvas client tests — `tests/canvas/quizzes.test.ts` (modify existing file)

Add a `describe('setExtension')` block and `describe('listExtensions')` block to the existing quiz client test file.

**Fixture:**
```ts
const mockExtension = { user_id: 42, extra_time: 20, extra_attempts: 1 }
```

**`setExtension` cases:**

1. **Happy path — both fields**: Mock `client.request` returns `{ quiz_extensions: [mockExtension] }`. Assert `quizzes.setExtension(100, 7, 42, 20, 1)` returns `[mockExtension]`. Assert `client.request` was called with `'/api/v1/courses/100/quizzes/7/extensions'`, `{ method: 'POST', body: '...' }`, and the parsed body equals `{ quiz_extensions: [{ user_id: 42, extra_time: 20, extra_attempts: 1 }] }`.

2. **`extra_time` only**: Call `setExtension(100, 7, 42, 30, undefined)`. Assert parsed POST body is `{ quiz_extensions: [{ user_id: 42, extra_time: 30 }] }` (no `extra_attempts` key).

3. **`extra_attempts` only**: Call `setExtension(100, 7, 42, undefined, 2)`. Assert parsed POST body is `{ quiz_extensions: [{ user_id: 42, extra_attempts: 2 }] }` (no `extra_time` key).

4. **Error propagation**: Mock `client.request` throws `new CanvasApiError('Forbidden', 403, '...')`. Assert the error propagates from `setExtension` unchanged.

**`listExtensions` cases:**

5. **Happy path**: Mock `client.request` returns `{ quiz_extensions: [mockExtension] }`. Assert `quizzes.listExtensions(100, 7)` returns `[mockExtension]`. Assert `client.request` called with `'/api/v1/courses/100/quizzes/7/extensions'` and no method/body options (default GET).

6. **Empty (no accommodations)**: Mock `client.request` returns `{ quiz_extensions: [] }`. Assert method returns `[]`.

### Tool tests — `tests/tools/quiz-accommodations.test.ts` (new file)

**`buildMockCanvas()` helper:**

```ts
function buildMockCanvas() {
  return {
    quizzes: {
      list: vi.fn().mockResolvedValue([
        { id: 1, title: 'Classic Quiz 1', quiz_type: 'assignment', time_limit: 60, published: true,
          points_possible: 10, question_count: 5, due_at: null },
        { id: 2, title: 'Classic Quiz 2', quiz_type: 'practice_quiz', time_limit: null, published: true,
          points_possible: 0, question_count: 3, due_at: null },
        { id: 3, title: 'New Quiz', quiz_type: 'quizzes.next', time_limit: null, published: true,
          points_possible: 10, question_count: 4, due_at: null },
      ]),
      setExtension: vi.fn().mockResolvedValue([{ user_id: 42, extra_time: 20, extra_attempts: 1 }]),
      listExtensions: vi.fn().mockResolvedValue([{ user_id: 42, extra_time: 20, extra_attempts: 1 }]),
    },
  } as unknown as CanvasClient
}
```

**Suite-level checks:**
- `quizAccommodationTools(buildMockCanvas())` returns exactly **2** tool definitions.
- Tool names in order: `['set_student_quiz_accommodation', 'list_student_quiz_accommodations']`.

**`set_student_quiz_accommodation` cases:**

1. Annotations: `{ destructiveHint: true, openWorldHint: true }`.

2. **Happy path — `extra_time_minutes`**: Call with `{ course_id: 10, user_id: 42, extra_time_minutes: 20 }`. Assert:
   - `canvas.quizzes.setExtension` called with `(10, 1, 42, 20, undefined)` for Classic Quiz 1.
   - `canvas.quizzes.setExtension` called with `(10, 2, 42, 20, undefined)` for Classic Quiz 2.
   - `canvas.quizzes.setExtension` NOT called for New Quiz (id: 3).
   - `summary.total_quizzes === 3`, `summary.applied === 2`, `summary.skipped === 1`, `summary.failed === 0`.
   - `results[2].skip_reason === 'new_quiz_not_supported'`.

3. **`time_multiplier` — quiz with `time_limit`**: Call with `{ course_id: 10, user_id: 42, time_multiplier: 1.5 }`. Assert `setExtension` called with `(10, 1, 42, 30, undefined)` (60 × 0.5 = 30 minutes) for quiz id 1.

4. **`time_multiplier` — quiz without `time_limit`**: Quiz id 2 has `time_limit: null`. Assert `setExtension` NOT called for quiz 2. Result: `results[1].applied === false`, `results[1].skip_reason === 'no_time_limit_for_multiplier'`.

5. **`quiz_ids` filter**: Call with `{ course_id: 10, user_id: 42, extra_time_minutes: 20, quiz_ids: [1] }`. Assert `setExtension` called exactly once (only for quiz id 1). `summary.total_quizzes === 1`.

6. **Partial failure**: Mock `setExtension` resolves for quiz 1 but throws `new CanvasApiError('Forbidden', 403, '...')` for quiz 2. Assert:
   - `results[0].applied === true`.
   - `results[1].applied === false` with `error` field set.
   - `summary.applied === 1`, `summary.failed === 1`.

7. **Empty course** (no quizzes): Mock `list` returns `[]`. Assert `summary.total_quizzes === 0`, `results === []`.

8. **Mutual exclusion error**: Call with both `extra_time_minutes: 20` and `time_multiplier: 1.5`. Assert handler throws a plain `Error` containing "not both".

9. **No accommodation provided**: Call with neither extra_time nor extra_attempts. Assert handler throws a plain `Error` containing "at least one".

**`list_student_quiz_accommodations` cases:**

1. Annotations: `{ readOnlyHint: true, openWorldHint: true }`.

2. **Happy path**: Call with `{ course_id: 10, user_id: 42 }`. Mock `listExtensions` returns `[{ user_id: 42, extra_time: 20, extra_attempts: 1 }]` for quizzes 1 and 2. Assert:
   - `canvas.quizzes.listExtensions` called with `(10, 1)` and `(10, 2)` but NOT `(10, 3)` (New Quiz skipped).
   - `results[0].has_accommodation === true`, `results[0].extra_time_minutes === 20`.
   - Result entries do NOT contain a `user_id` key (assert `'user_id' in results[0] === false`).
   - `summary.with_accommodation === 2`, `summary.without_accommodation === 0`.

3. **No accommodation**: Mock `listExtensions` returns `[]` for all quizzes. Assert `results[0].has_accommodation === false`, `summary.with_accommodation === 0`.

4. **Other student present**: Mock `listExtensions` returns `[{ user_id: 99, extra_time: 30, extra_attempts: null }]` (a different student). Assert the entry for the target user has `has_accommodation: false` (user 42 is not in the list).

5. **GET error propagation**: Mock `listExtensions` throws `new CanvasApiError('Not Found', 404, '...')`. Assert the error propagates from the tool handler (no try/catch wrapping `listExtensions` calls).

### Registry test — `tests/tools/registry.test.ts`

**Four changes (precise):**

**Change 1 — extend existing `quizzes` mock in `buildFullMockCanvas()`**

Add `setExtension` and `listExtensions` to the existing `quizzes` property (the tool calls these via `canvas.quizzes`, not a separate module):

```ts
    quizzes: {
      list: async () => [],
      get: async () => ({}),
      listSubmissions: async () => [],
      listQuestions: async () => [],
      getSubmissionAnswers: async () => [],
      scoreQuestion: async () => {},
      setExtension: async () => [],      // NEW
      listExtensions: async () => [],    // NEW
    },
```

Without this, `quizAccommodationTools` calls `canvas.quizzes.setExtension` / `canvas.quizzes.listExtensions` which are `undefined` → runtime error in `getAllTools`.

**Change 2 — tool count**: Change `expect(tools).toHaveLength(124)` → `expect(tools).toHaveLength(126)` and the describe string `// returns all 124 tools` → `// returns all 126 tools`.

**Change 3 — `toContain` assertions**: Add after the `// Content Exports (3)` block (NOT under `// Quizzes (6)` — these are a separate domain):

```ts
    // Quiz Accommodations (2)
    expect(names).toContain('set_student_quiz_accommodation')
    expect(names).toContain('list_student_quiz_accommodations')
```

**Change 4 — `writeToolNames` arrays**: `set_student_quiz_accommodation` has `destructiveHint: true`. Add it to **both** `writeToolNames` collections in the file:

In `'write tools have destructiveHint: true'` (the array of expected write tool names):
```ts
      'set_student_quiz_accommodation',
```

In `'read tools have readOnlyHint: true'` (the `writeToolNames` Set used as an exclusion list):
```ts
      'set_student_quiz_accommodation',
```

`list_student_quiz_accommodations` has `readOnlyHint: true` and does NOT need to appear in `writeToolNames`.

**Why Change 4 is critical**: The "read tools have readOnlyHint: true" test iterates every tool NOT in `writeToolNames` and asserts `readOnlyHint === true`. If `set_student_quiz_accommodation` is absent from `writeToolNames`, the test asserts it has `readOnlyHint: true` — but it has `destructiveHint: true` — and the test fails.

### Pseudonymizer coverage test — `tests/pseudonym/coverage.test.ts`

No changes.

---

## Implementation checklist for the implementor

1. `src/canvas/types.ts` — add `time_limit?: number | null` to `CanvasQuiz`; add `CanvasQuizExtension` interface under `// --- Quizzes ---`.
2. `src/canvas/quizzes.ts` — import `CanvasQuizExtension`; add `setExtension()` and `listExtensions()` methods to `QuizzesModule`.
3. `src/tools/quiz-accommodations.ts` — new file with `quizAccommodationTools()` function, `QuizAccommodationResult` inline interface, and `CLASSIC_QUIZ_TYPES` set.
4. `src/tools/catalog.ts` — import `quizAccommodationTools`; add `quiz_accommodations` domain entry.
5. `tests/canvas/quizzes.test.ts` — add `setExtension` (4 cases) and `listExtensions` (2 cases) blocks to the existing file.
6. `tests/tools/quiz-accommodations.test.ts` — new file (9 + 5 = 14 cases).
7. `tests/tools/registry.test.ts` — 4 changes: `setExtension`/`listExtensions` on existing `quizzes` stub; count 124→126; 2 new `toContain` assertions under `// Quiz Accommodations (2)`; `set_student_quiz_accommodation` in both `writeToolNames` collections.

---

## Acceptance check

- [x] `**design-first**` flag present in issue #191.
- [x] Design unknown §1 (Classic vs New Quizzes): retired — V1 Classic-only; `quiz_type === 'quizzes.next'` skipped; `skip_reason: 'new_quiz_not_supported'` surfaced to caller; V2 path noted.
- [x] Design unknown §2 (Scope of accommodation): retired — quiz extra-time/attempts only in V1; due-date overrides are a separate fast-follow.
- [x] Design unknown §3 (Time input): retired — both `extra_time_minutes` (absolute) and `time_multiplier` (relative) supported, mutually exclusive; `time_limit` field added to `CanvasQuiz`; null `time_limit` + multiplier → `skip_reason: 'no_time_limit_for_multiplier'`; minimum 1-minute clamp documented; clamping edge case (1-minute quiz × 1.01× = 0 → 1) documented.
- [x] Design unknown §4 (Future quizzes): retired — limitation documented in tool description; re-run recommended; no auto-apply mechanism.
- [x] Design unknown §5 (FERPA/pseudonymization): retired — tools take real `user_id`; caller uses `resolve_pseudonym` if needed; tool descriptions instruct this; response has no PII fields; `user_id` from `listExtensions` raw response discarded before output; no `PSEUDONYMIZER_WRAPPED_TOOLS` registration.
- [x] Exact tool names, Zod schemas, Canvas endpoints, MCP annotations, and output shapes specified.
- [x] Type additions specified with exact target interfaces and insertion points.
- [x] Canvas client additions: `setExtension` (POST with `quiz_extensions` envelope, conditional field inclusion, zero-guard) and `listExtensions` (`client.request` single-page GET with `quiz_extensions` key — not `paginateEnvelope`, with rationale).
- [x] `extra_time` (Canvas field name) → `extra_time_minutes` (tool output field name) mapping documented in both the type comment and the handler comments.
- [x] Error propagation difference documented: `set_student_quiz_accommodation` catches per-quiz errors (fan-out continues); `list_student_quiz_accommodations` does NOT catch per-quiz errors (propagates to buildHandler).
- [x] Catalog: verbatim import and insertion point.
- [x] Registry test: all 4 changes specified precisely — 2 new mock methods on existing `quizzes` stub; count 124→126; 2 `toContain` lines under new `// Quiz Accommodations (2)` comment (NOT under `// Quizzes (6)`); `set_student_quiz_accommodation` in both `writeToolNames` collections.
- [x] Test plan: 6 client cases + 14 tool cases; fan-out verification, partial-failure path, empty-course path, New Quiz skipped, time_multiplier with and without time_limit, quiz_ids filter, mutual exclusion error, PII-stripped output assertion (`'user_id' in results[0] === false`), error propagation for list tool.
- [x] No new package dependencies.
- [x] FERPA: no pseudonymizer wrapping required; no student PII in output; caller resolution workflow documented in tool descriptions.
- [x] Pseudonymizer coverage test unaffected.
