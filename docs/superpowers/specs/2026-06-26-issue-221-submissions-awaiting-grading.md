---
issue: 221
---

# Submissions Awaiting Manual Grading — `list_submissions_awaiting_grading` MCP Tool Design

**Date**: 2026-06-26
**Issue**: [bruchris/canvas-lms-mcp#221](https://github.com/bruchris/canvas-lms-mcp/issues/221)
**Status**: Design — awaiting CTO review

---

## Purpose

Add a single read-only tool, `list_submissions_awaiting_grading`, that answers: *"which submissions in this course still need a human grade?"* It produces a course-wide triage list grouped by assignment or Classic Quiz, surfacing submissions with `workflow_state === 'submitted'` (not yet graded at all) or `workflow_state === 'pending_review'` (Canvas auto-graded a quiz but left essays or manually-scored questions for the instructor). Items are sorted oldest-submitted-at first so the instructor sees the most overdue work first.

The tool composes the existing `assignments` and `submissions` Canvas client modules. No new Canvas module is required.

---

## Design unknowns (retired)

### 1. New Quizzes vs Classic Quizzes

**Decision: V1 ships Classic-quiz + assignment coverage only. New Quizzes are documented as a known limitation.**

Classic Quizzes are backed by the standard assignment + quiz submission REST API:
- The assignment record has `is_quiz_assignment: true` and a non-null `quiz_id`.
- The corresponding assignment submission has `workflow_state: 'pending_review'` when one or more quiz questions require manual scoring (essay, file-upload, or subjectively-graded fill-in-the-blank questions not in the answer key).

New Quizzes are backed by the Quizzes.Next / Quizzes Engine API and do **not** expose a `pending_review` state via the standard assignment submission record. New Quiz assignment records have `submission_types: ['external_tool']` and `is_quiz_assignment` either absent or `false`.

**Detection helpers:**
```ts
function isClassicQuiz(a: CanvasAssignment): boolean {
  return a.is_quiz_assignment === true && a.quiz_id != null
}

function isNewQuiz(a: CanvasAssignment): boolean {
  return !isClassicQuiz(a) && (a.submission_types ?? []).includes('external_tool')
}
```

New Quiz assignments are silently excluded from the scan and counted in `new_quizzes_excluded_count`. When `new_quizzes_excluded_count > 0`, a caveat is appended: *"X assignment(s) backed by New Quizzes were excluded — New Quizzes do not expose pending-review workflow states via the standard Canvas REST API. Check SpeedGrader for New Quiz grading queues."*

**Why not use the quiz-submissions endpoint directly?**
`GET /courses/:id/quizzes/:id/submissions` returns `CanvasQuizSubmission` objects and requires one call per quiz (O(N) serial or parallel fan-out). The standard assignment submission endpoint (`GET /courses/:id/students/submissions`) returns the same `pending_review` signal via `CanvasSubmission` objects, covers all relevant assignment IDs in a single paginated call, and already has full client support including `user` includes. Using it avoids a per-quiz fan-out and keeps implementation simple.

### 2. Submission-level vs per-question detail

**Decision: V1 surfaces submission-level state only.**

The output field `has_pending_manual_questions: boolean` is `true` when `workflow_state === 'pending_review'`, indicating that the submission has one or more questions requiring manual scoring. Surfacing which specific questions need grading would require an additional API call per quiz submission to `GET /quiz_submissions/:id/questions` — an N-per-submission fan-out that could mean dozens or hundreds of extra requests in a large course. The submission-level signal is sufficient for the primary triage use case.

V2 can add a `include_question_detail: boolean` parameter that, when set, fetches question-level state via the quiz submission questions endpoint.

### 3. Fill-in-the-blank false negatives

**Out of scope for V1.** Canvas may auto-mark a fill-in-the-blank answer as `graded` when the student's phrasing didn't match any answer-key variant. Such submissions are invisible to this tool — they appear correctly graded to Canvas even though the instructor may disagree. This is a content-quality audit problem distinct from the manual-grading queue; the issue explicitly marks it out of scope. A fixed caveat is always appended: *"Fill-in-the-blank submissions that Canvas auto-marked as graded are not included, even if the answer-key variant was incomplete."*

### 4. Scope of `assignment_ids` parameter

**Decision: when `assignment_ids` is provided, limit the scan to exactly those assignment IDs. When omitted, scan all non-excluded assignments in the course.**

The `assignment_ids` filter is applied before the `needs_grading_count > 0` pre-filter and before the New Quiz exclusion. If the caller supplies an ID that turns out to be a New Quiz, that ID is still excluded and counted in `new_quizzes_excluded_count`.

### 5. The `include_quizzes` / `include_assignments` toggles

**Decision: both default to `true`. When `include_quizzes: false`, Classic Quiz assignments (`isClassicQuiz()`) are excluded. When `include_assignments: false`, non-quiz assignments are excluded. If both are `false`, the tool returns an error rather than an empty list.**

### 6. The `only_pending_review` toggle

**Decision: when `true`, narrow the result to `workflow_state === 'pending_review'` only — quiz essays and manually-scored questions that Canvas auto-graded but flagged for human review. Regular `submitted` assignments (awaiting any grading) are excluded. When `false` (default), both states are included.**

### 7. PII / pseudonymizer handling

**Decision: fetch `user` objects via `include: ['user']` on the submissions call. Each submission's `user.name` is student PII. Route every submission through `pseudonymizer.anonymizeSubmission(courseId, submission)` when the pseudonymizer is enabled.**

`CanvasSubmission.user` (populated when `include: ['user']` is requested) is student PII. The output's `user_name` field is read from `submission.user?.name`. Add `'list_submissions_awaiting_grading'` to `PSEUDONYMIZER_WRAPPED_TOOLS` in `src/pseudonym/coverage.ts`.

### 8. Sorting

**Decision: the top-level `items` array is sorted by the minimum (oldest) `submitted_at` across each item's submissions. Within each item, the `submissions` array is also sorted oldest-first. Null `submitted_at` values sort after non-null values.**

### 9. Audience

**Decision: `educator`.** This is an instructor/teacher triage tool. Students cannot view other students' submission queues.

---

## Canvas API calls

| # | Endpoint | Purpose | Client method |
|---|----------|---------|---------------|
| 1 | `GET /api/v1/courses/:id/assignments` | Assignment list with grading counts; scoped by `assignment_ids` if provided | `canvas.assignments.list(courseId, opts)` |
| 2 | `GET /api/v1/courses/:id/students/submissions?student_ids[]=all&assignment_ids[]=[filtered]&include[]=user` | All submissions for filtered assignment IDs; tool layer filters to `submitted` \| `pending_review` | `canvas.submissions.listForStudents(courseId, { student_ids: ['all'], assignment_ids: [...], include: ['user'] })` |

**Only 2 paginated calls** regardless of course size. No per-assignment or per-quiz fan-out.

**Dependency:** Call 2's `assignment_ids` argument is derived from Call 1's filtered results. Call 2 runs after Call 1.

**Early return:** If Call 1 produces an empty filtered list after applying all exclusions and the `needs_grading_count > 0` filter, Call 2 is skipped and the tool returns `items: []` with the appropriate caveats.

**Client notes:**
- `CanvasAssignment.needs_grading_count?: number` is already declared in `src/canvas/types.ts`. Canvas populates it automatically in assignment responses for users with grading permissions — no special `include` parameter is required.
- `SubmissionListInclude` already includes `'user'` in `src/canvas/submissions.ts`.
- `ListAssignmentsOptions.assignment_ids` already exists on `AssignmentsModule.list()` in `src/canvas/assignments.ts` and accepts `ReadonlyArray<number>` — no client changes needed.

---

## Tool contract

### File location
`src/tools/submissions-awaiting-grading.ts`

### Export signature
```ts
export function submissionsAwaitingGradingTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[]
```

### Tool name
`list_submissions_awaiting_grading`

### Zod input schema
```ts
inputSchema: {
  course_id: z.number().int().positive()
    .describe('Canvas course ID to scan for submissions awaiting grading.'),
  assignment_ids: z.array(z.number().int().positive()).optional()
    .describe(
      'Limit the scan to these specific assignment IDs (numeric Canvas IDs). '
      + 'When omitted, all assignments in the course are scanned.',
    ),
  include_quizzes: z.boolean().default(true)
    .describe(
      'Include Classic Quiz assignments in the scan. '
      + 'New Quizzes are always excluded (see caveats in the response). Default: true.',
    ),
  include_assignments: z.boolean().default(true)
    .describe('Include non-quiz assignments in the scan. Default: true.'),
  only_pending_review: z.boolean().default(false)
    .describe(
      'When true, return only submissions with workflow_state=pending_review — '
      + 'quiz essays and manually-scored questions that Canvas auto-graded but left for human review. '
      + 'When false (default), return both submitted (ungraded) and pending_review submissions.',
    ),
}
```

**Input validation** (before any Canvas calls):
```ts
if (params.include_quizzes === false && params.include_assignments === false) {
  throw new Error('At least one of include_quizzes or include_assignments must be true.')
}
```
This throws a plain `Error` caught by `buildHandler`'s catch block, returning `isError: true` via `formatError`.

### Annotations
```ts
{
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
}
```

### Output shape
```ts
{
  course_id: number,
  total_submissions_awaiting: number,         // Σ submissions across all items
  items: Array<{
    assignment_id: number,
    assignment_name: string,
    type: 'classic_quiz' | 'assignment',      // 'classic_quiz' when is_quiz_assignment: true
    due_at: string | null,
    submissions_awaiting_count: number,       // === submissions.length
    submissions: Array<{
      submission_id: number,
      user_id: number,
      user_name: string,                      // pseudonymized when CANVAS_PSEUDONYMIZE_STUDENTS=true
      workflow_state: 'submitted' | 'pending_review',
      submitted_at: string | null,
      has_pending_manual_questions: boolean,  // true iff workflow_state === 'pending_review'
    }>
  }>,
  new_quizzes_excluded_count: number,
  caveats: string[],
}
```

### Algorithm (annotated pseudocode)

```ts
// Step 1: fetch assignment list (optionally scoped)
const assignmentListOpts = params.assignment_ids?.length
  ? { assignment_ids: params.assignment_ids }
  : {}
const allAssignments = await canvas.assignments.list(courseId, assignmentListOpts)

// Step 2: partition by type
const newQuizAssignments = allAssignments.filter(isNewQuiz)
const classicQuizAssignments = allAssignments.filter(isClassicQuiz)
const regularAssignments = allAssignments.filter(a => !isClassicQuiz(a) && !isNewQuiz(a))

// Step 3: apply include_quizzes / include_assignments toggles
const eligibleAssignments = [
  ...(params.include_quizzes !== false ? classicQuizAssignments : []),
  ...(params.include_assignments !== false ? regularAssignments : []),
]

// Step 4: pre-filter by needs_grading_count (Canvas populates this for grader tokens)
const toFetch = eligibleAssignments.filter(a => (a.needs_grading_count ?? 0) > 0)

// Step 5: build caveats (accumulated throughout)
const caveats: string[] = []
if (newQuizAssignments.length > 0) {
  caveats.push(
    `${newQuizAssignments.length} assignment(s) backed by New Quizzes were excluded — `
    + `New Quizzes do not expose pending-review workflow states via the standard Canvas REST API. `
    + `Check SpeedGrader for New Quiz grading queues.`,
  )
}
if (params.only_pending_review !== true) {
  caveats.push(
    'Fill-in-the-blank submissions that Canvas auto-marked as graded are not included, '
    + 'even if the answer-key variant was incomplete.',
  )
}

// Step 6: early-return if nothing to fetch
if (toFetch.length === 0) {
  return {
    course_id: courseId,
    total_submissions_awaiting: 0,
    items: [],
    new_quizzes_excluded_count: newQuizAssignments.length,
    caveats,
  }
}

// Step 7: bulk fetch submissions for the filtered assignments
const rawSubmissions = await canvas.submissions.listForStudents(courseId, {
  student_ids: ['all'],
  assignment_ids: toFetch.map(a => a.id),
  include: ['user'],
})

// Step 8: filter to awaiting-grading workflow states
const targetStates = params.only_pending_review
  ? new Set(['pending_review'])
  : new Set(['submitted', 'pending_review'])
const awaitingSubmissions = rawSubmissions.filter(s => targetStates.has(s.workflow_state))

// Step 9: pseudonymize if enabled
const processedSubmissions = await Promise.all(
  awaitingSubmissions.map(s =>
    pseudonymizer?.isEnabled() && s.user
      ? pseudonymizer.anonymizeSubmission(courseId, s)
      : Promise.resolve(s),
  ),
)

// Step 10: group by assignment_id
const byAssignment = new Map<number, typeof processedSubmissions>()
for (const sub of processedSubmissions) {
  const group = byAssignment.get(sub.assignment_id) ?? []
  group.push(sub)
  byAssignment.set(sub.assignment_id, group)
}

// Step 11: build assignment lookup map
const assignmentById = new Map(toFetch.map(a => [a.id, a]))

// Step 12: assemble items, sort oldest-first within each item
const items = [...byAssignment.entries()]
  .map(([assignmentId, subs]) => {
    const assignment = assignmentById.get(assignmentId)!
    const sortedSubs = [...subs].sort((a, b) => {
      if (!a.submitted_at) return 1
      if (!b.submitted_at) return -1
      return a.submitted_at < b.submitted_at ? -1 : 1
    })
    return {
      assignment_id: assignmentId,
      assignment_name: assignment.name,
      type: isClassicQuiz(assignment) ? 'classic_quiz' as const : 'assignment' as const,
      due_at: assignment.due_at,
      submissions_awaiting_count: sortedSubs.length,
      submissions: sortedSubs.map(s => ({
        submission_id: s.id,
        user_id: s.user_id,
        user_name: s.user?.name ?? `User ${s.user_id}`,
        workflow_state: s.workflow_state as 'submitted' | 'pending_review',
        submitted_at: s.submitted_at,
        has_pending_manual_questions: s.workflow_state === 'pending_review',
      })),
    }
  })
  // Sort items by oldest submitted_at across their submissions (ascending)
  .sort((a, b) => {
    const aOldest = a.submissions[0]?.submitted_at ?? null
    const bOldest = b.submissions[0]?.submitted_at ?? null
    if (!aOldest) return 1
    if (!bOldest) return -1
    return aOldest < bOldest ? -1 : 1
  })

return {
  course_id: courseId,
  total_submissions_awaiting: items.reduce((s, i) => s + i.submissions_awaiting_count, 0),
  items,
  new_quizzes_excluded_count: newQuizAssignments.length,
  caveats,
}
```

---

## Pseudonymizer integration

Every awaiting submission in the output includes `user_id` and `user_name` derived from `submission.user` — student PII.

**Wrap each submission through `pseudonymizer.anonymizeSubmission(courseId, submission)`** when the pseudonymizer is enabled. This replaces `submission.user.name` with a pseudonym (e.g. `"Student 0"`). The output's `user_name` field reads `s.user?.name` after anonymization. The `user_id` is not replaced — it is a stable identifier the instructor can resolve via `resolve_pseudonym` if needed.

Add `'list_submissions_awaiting_grading'` to `PSEUDONYMIZER_WRAPPED_TOOLS` in `src/pseudonym/coverage.ts`.

---

## Catalog registration (`src/tools/catalog.ts`)

```ts
import { submissionsAwaitingGradingTools } from './submissions-awaiting-grading'

// Add after the 'submission_files' entry (educator tools cluster):
{
  domain: 'submissions_awaiting_grading',
  defaultPrimaryAudience: 'educator',
  getTools: submissionsAwaitingGradingTools,
},
```

---

## Error handling

| Scenario | Handling |
|----------|----------|
| `include_quizzes: false` AND `include_assignments: false` | `throw new Error(...)` before Canvas calls → `formatError()` returns `isError: true` |
| All assignments have `needs_grading_count === 0` after filtering | Return empty `items: []`, `total_submissions_awaiting: 0`; no error |
| `assignment_ids` contains IDs not in the course | Canvas silently excludes unknown IDs from the assignments and submissions responses; tool returns normally with no items for those IDs |
| 401 / 403 / 404 on Canvas calls | `formatError()` maps to user-friendly message (`401` → token invalid, `403` → permission denied, `404` → course not found) |
| Submission returned with `assignment_id` not in `assignmentById` (defensive) | Skip that submission; append caveat `'Some submissions could not be matched to an assignment and were excluded.'` |
| Network failure | Propagated via `formatError()` |
| `pseudonymizer.anonymizeSubmission` throws | Propagate — do NOT swallow pseudonymizer errors, as that could inadvertently surface PII |

---

## Test plan (`tests/submissions-awaiting-grading.test.ts`)

All tests use `vi.spyOn` on `canvas.*` methods (same pattern as `tests/grade-explanation.test.ts`). No real Canvas instance.

### Fixture A — Happy path: mixed submitted + pending_review

**Mocks:**
- `canvas.assignments.list(courseId)` → 3 assignments:
  - A1: regular assignment (`is_quiz_assignment: false`), `needs_grading_count: 2`
  - A2: Classic Quiz (`is_quiz_assignment: true`, `quiz_id: 10`), `needs_grading_count: 1`
  - A3: regular assignment, `needs_grading_count: 0` (should be excluded)
- `canvas.submissions.listForStudents(courseId, { assignment_ids: [A1.id, A2.id], ... })` → 3 submissions:
  - S1: A1, user: `{ id: 101, name: 'Alice' }`, `workflow_state: 'submitted'`, `submitted_at: '2026-06-20T10:00:00Z'`
  - S2: A1, user: `{ id: 102, name: 'Bob' }`, `workflow_state: 'submitted'`, `submitted_at: '2026-06-21T10:00:00Z'`
  - S3: A2, user: `{ id: 103, name: 'Carol' }`, `workflow_state: 'pending_review'`, `submitted_at: '2026-06-19T10:00:00Z'`

**Call**: `{ course_id: courseId }`

**Assertions:**
1. `result.total_submissions_awaiting === 3`
2. `result.items.length === 2`
3. `result.items[0].assignment_id === A2.id` (oldest `submitted_at: 2026-06-19`)
4. `result.items[0].type === 'classic_quiz'`
5. `result.items[0].submissions[0].has_pending_manual_questions === true`
6. `result.items[1].assignment_id === A1.id`
7. `result.items[1].submissions[0].submitted_at === '2026-06-20T10:00:00Z'` (S1 before S2)
8. `result.items[1].submissions[0].has_pending_manual_questions === false`
9. `canvas.submissions.listForStudents` called with `assignment_ids` containing `A1.id` and `A2.id` but NOT `A3.id`

### Fixture B — `only_pending_review: true`

**Same mocks as Fixture A.**

**Call**: `{ course_id: courseId, only_pending_review: true }`

**Assertions:**
1. `result.total_submissions_awaiting === 1` (only S3)
2. `result.items.length === 1`
3. `result.items[0].assignment_id === A2.id`
4. `result.items[0].submissions[0].workflow_state === 'pending_review'`

### Fixture C — `assignment_ids` scope

**Same mocks as Fixture A.**

**Call**: `{ course_id: courseId, assignment_ids: [A2.id] }`

**Assertions:**
1. `result.total_submissions_awaiting === 1`
2. `result.items.length === 1`
3. `result.items[0].assignment_id === A2.id`
4. `canvas.assignments.list` called with `assignment_ids: [A2.id]`

### Fixture D — New Quiz exclusion

**Mocks:**
- A1: regular assignment, `needs_grading_count: 1`
- A_NQ: `submission_types: ['external_tool']`, `is_quiz_assignment: false`, `needs_grading_count: 5`

**Call**: `{ course_id: courseId }`

**Assertions:**
1. `result.new_quizzes_excluded_count === 1`
2. `result.caveats.some(c => c.includes('New Quizzes'))`
3. `canvas.submissions.listForStudents` called with `assignment_ids` NOT containing `A_NQ.id`

### Fixture E — `include_quizzes: false`

**Same mocks as Fixture A.**

**Call**: `{ course_id: courseId, include_quizzes: false }`

**Assertions:**
1. `result.items.every(i => i.type === 'assignment')`
2. No item with `assignment_id === A2.id`

### Fixture F — `include_assignments: false`

**Same mocks as Fixture A.**

**Call**: `{ course_id: courseId, include_assignments: false }`

**Assertions:**
1. `result.items.every(i => i.type === 'classic_quiz')`
2. Only A2 in `result.items`

### Fixture G — Both toggles `false` → error

**Call**: `{ course_id: courseId, include_quizzes: false, include_assignments: false }`

**Assertions:**
1. Response has `isError: true`
2. Message contains `'At least one of include_quizzes or include_assignments must be true'`

### Fixture H — No submissions awaiting (all graded)

**Mocks:** All assignments have `needs_grading_count: 0`.

**Call**: `{ course_id: courseId }`

**Assertions:**
1. `result.items.length === 0`
2. `result.total_submissions_awaiting === 0`
3. `canvas.submissions.listForStudents` was **not** called (early-return path)

### Fixture I — FERPA pseudonymization

**Setup:** pseudonymizer enabled.
- S1 has `user: { id: 101, name: 'Alice Student' }`
- `pseudonymizer.anonymizeSubmission(courseId, S1)` → S1 with `user.name: 'Student 0'`

**Assertions:**
1. `result.items[...].submissions[0].user_name === 'Student 0'`
2. `result.items[...].submissions[0].user_id === 101` (id not replaced)

### Fixture J — `assignment_ids` includes a New Quiz ID

**Mocks:** A_NQ is a New Quiz, `needs_grading_count: 3`.

**Call**: `{ course_id: courseId, assignment_ids: [A_NQ.id] }`

**Assertions:**
1. `result.items.length === 0`
2. `result.new_quizzes_excluded_count === 1`

### Fixture K — Sorting: oldest `submitted_at` wins

**Mocks:**
- A1: `needs_grading_count: 1`, submission `submitted_at: '2026-06-25T10:00:00Z'`
- A2: `needs_grading_count: 1`, submission `submitted_at: '2026-06-23T10:00:00Z'` (older)

**Call**: `{ course_id: courseId }`

**Assertions:**
1. `result.items[0].assignment_id === A2.id` (older submission first)
2. `result.items[1].assignment_id === A1.id`

---

## Tool description (MCP `tool.description`)

```
Lists all submissions in a course that still need a human grade, sorted oldest-waiting first.

Surfaces two categories:
- workflow_state=submitted: assignments submitted by students but not yet graded at all.
- workflow_state=pending_review: Classic Quiz submissions where Canvas auto-graded the
  objective questions but left essays or manually-scored questions for the instructor.

Returns a triage list grouped by assignment or Classic Quiz, with per-submission details:
student identity, workflow state, submitted_at, and whether the submission has pending
manual-grading questions.

Parameters:
- course_id (required): Canvas course ID to scan.
- assignment_ids (optional): limit the scan to specific assignment IDs.
- include_quizzes (default true): include Classic Quiz assignments in the scan.
- include_assignments (default true): include non-quiz assignments.
- only_pending_review (default false): when true, return only pending_review submissions
  (quiz essays awaiting manual scoring), omitting regular ungraded assignments.

Known limitations:
- New Quizzes are excluded — they do not expose pending-review states via the standard
  Canvas REST API. Check SpeedGrader for New Quiz grading queues.
- Fill-in-the-blank answers that Canvas auto-marked as correct/incorrect are not surfaced.
- V1 returns submission-level state only; per-question detail is not included.
- When CANVAS_PSEUDONYMIZE_STUDENTS is enabled, student names are replaced with pseudonyms.
  Use resolve_pseudonym to look up the real identity.
```

---

## File changes summary

| File | Change |
|------|--------|
| `src/tools/submissions-awaiting-grading.ts` | **New** — `submissionsAwaitingGradingTools(canvas, pseudonymizer?)` exporting `list_submissions_awaiting_grading`; Zod schema, annotations, algorithm, output shape as specified above |
| `src/tools/catalog.ts` | **Modify** — import `submissionsAwaitingGradingTools`; add `submissions_awaiting_grading` domain entry (`defaultPrimaryAudience: 'educator'`) after the `submission_files` entry |
| `src/pseudonym/coverage.ts` | **Modify** — add `'list_submissions_awaiting_grading'` to `PSEUDONYMIZER_WRAPPED_TOOLS` |
| `tests/submissions-awaiting-grading.test.ts` | **New** — Fixtures A–K as specified above |

**4 files total. No new Canvas module. No new package dependencies.**

All Canvas calls reuse existing `CanvasClient` facade methods (`assignments.list`, `submissions.listForStudents`). The `src/canvas/` layer is untouched. `CanvasAssignment.needs_grading_count?: number` is already declared in `src/canvas/types.ts` and Canvas populates it automatically for users with grading permissions.

If `pnpm generate:manifests` is present in `package.json`, run it after catalog registration to update manifest counts and ensure registry/discovery tests pass (per acceptance criteria).

---

## Open questions for CTO review

None — all design unknowns are retired above. The spec is implementation-ready.
