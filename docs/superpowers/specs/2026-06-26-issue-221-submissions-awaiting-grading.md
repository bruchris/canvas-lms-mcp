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

**Decision: V1 ships Classic-quiz + assignment coverage only. New Quizzes are documented as a known limitation via a fixed caveat; they are NOT actively excluded from the scan.**

Classic Quizzes are backed by the standard assignment + quiz submission REST API:
- The assignment record has `is_quiz_assignment: true` and a non-null `quiz_id`.
- The corresponding assignment submission has `workflow_state: 'pending_review'` when one or more quiz questions require manual scoring (essay, file-upload, or subjectively-graded fill-in-the-blank questions not in the answer key).

New Quizzes (Quizzes.Next) are backed by the Quizzes Engine LTI and have `submission_types: ['external_tool']`. Their assignment submission records are typically set to `workflow_state: 'graded'` by the LTI after the external engine processes them — they do **not** surface `pending_review` states via the standard assignment submission REST API, so this tool cannot detect their manual-grading queues.

**Why not actively exclude `external_tool` assignments?** Any heuristic that identifies New Quizzes by `submission_types.includes('external_tool')` would also exclude other LTI/external-tool assignments (e.g. Google Assignments, Turnitin) that can legitimately have `workflow_state: 'submitted'` submissions awaiting instructor grading. Excluding them silently would cause real grading work to disappear from the triage list. Instead, a fixed caveat in every response informs the instructor about the New Quizzes gap without hiding other work.

**Fixed caveat (always appended):**
> *"New Quizzes (Quizzes.Next) manage their own grading queue and their submission records may not appear with 'pending_review' workflow state here. Use SpeedGrader or the New Quizzes interface to check for pending New Quiz grading."*

**Type labeling:** The output field `type` distinguishes Classic Quizzes (`'classic_quiz'` when `isClassicQuiz(a) === true`) from everything else (`'assignment'`). Regular LTI/external-tool assignments are labeled `'assignment'` — no quiz subtype is asserted for them.

```ts
function isClassicQuiz(a: CanvasAssignment): boolean {
  return a.is_quiz_assignment === true && a.quiz_id != null
}
```

### 2. Submission-level vs per-question detail

**Decision: V1 surfaces submission-level state only.**

The output field `has_pending_manual_questions: boolean` is `true` when `workflow_state === 'pending_review'`, indicating that the submission has one or more questions requiring manual scoring. This field is always computed as:
```ts
has_pending_manual_questions: s.workflow_state === 'pending_review'
```
Surfacing which specific questions need grading would require an additional API call per quiz submission to `GET /quiz_submissions/:id/questions` — an N-per-submission fan-out that could mean dozens or hundreds of extra requests in a large course. V2 can add a `include_question_detail: boolean` parameter.

### 3. Fill-in-the-blank false negatives

**Out of scope for V1.** Canvas may auto-mark a fill-in-the-blank answer as `graded` when the student's phrasing didn't match any answer-key variant. Such submissions are invisible to this tool. A fixed caveat is always appended:
> *"Fill-in-the-blank submissions that Canvas auto-marked as graded are not included, even if the answer-key variant was incomplete."*

### 4. Scope of `assignment_ids` parameter

**Decision: when `assignment_ids` is provided, limit the scan to exactly those assignment IDs.** When omitted, scan all assignments in the course. The `assignment_ids` filter is passed directly to `canvas.assignments.list` so only those assignments are fetched.

### 5. The `include_quizzes` / `include_assignments` toggles

**Decision: both default to `true`.** When `include_quizzes: false`, Classic Quiz assignments (`isClassicQuiz() === true`) are excluded from the eligible set. When `include_assignments: false`, non-quiz assignments are excluded. If both are `false`, the tool returns an error. Non-Classic-Quiz LTI/external-tool assignments are treated as `'assignment'` type and follow the `include_assignments` toggle.

### 6. The `only_pending_review` toggle

**Decision: when `true`, narrow the result to `workflow_state === 'pending_review'` only.** Regular `submitted` assignments (awaiting any grading) are excluded. When `false` (default), both `submitted` and `pending_review` are included.

The fill-in-the-blank caveat is suppressed when `only_pending_review: true` because in that mode every returned submission is unambiguously in `pending_review` state. When `submitted` is also included, an instructor cannot tell from workflow state alone whether an auto-graded quiz still needs review.

### 7. PII / pseudonymizer handling

**Decision: fetch `user` objects via `include: ['user']` on the submissions call. Route each submission through `pseudonymizer.anonymizeSubmission(courseId, submission)` when the pseudonymizer is enabled.**

`CanvasSubmission.user` (populated when `include: ['user']` is requested) is student PII. The output's `user_name` field is read from `submission.user?.name ?? null` after pseudonymization. `user_id` is always the raw Canvas numeric ID and is not pseudonymized — this is consistent with how other tools handle stable per-student identifiers.

Add `'list_submissions_awaiting_grading'` to:
1. `PSEUDONYMIZER_WRAPPED_TOOLS` in `src/pseudonym/coverage.ts`
2. `EXPECTED_PII_BEARING_TOOLS` in `tests/pseudonym/coverage.test.ts` (CI enforces exact equality between these two sets)

### 8. Sorting

**Decision: items sorted by their oldest `submitted_at` (minimum across all submissions in that item); within each item, submissions sorted oldest-first. Null `submitted_at` sorts after non-null values.**

Sort key for items: `Math.min(...item.submissions.filter(s => s.submitted_at).map(s => Date.parse(s.submitted_at!)))`, or `Infinity` if all `submitted_at` are null.

### 9. Audience

**Decision: `educator`.** This is an instructor/teacher triage tool.

### 10. `needs_grading_count` pre-filter behavior

`CanvasAssignment.needs_grading_count` is typed as `optional` (`number | undefined`). Canvas populates it automatically in assignment responses for users with grading permissions — it is the field used as a pre-filter to avoid fetching submissions for assignments with no pending grading.

**When `needs_grading_count` is `undefined`**: the pre-filter `(a.needs_grading_count ?? 0) > 0` evaluates to `false`, and the assignment is excluded from the submissions fetch. This is conservative and correct for the normal case: if Canvas doesn't populate the field, we can't confirm there's pending work. For student tokens (which typically don't receive this field), the scan returns an empty result; the second Canvas API call (submissions fetch) is never made for such tokens anyway since `GET /courses/:id/students/submissions?student_ids[]=all` requires grading permissions and would 403.

**Implementer note:** If a course shows unexpected empty results for an instructor, check whether `needs_grading_count` is being populated on the returned assignment objects. If not, the Canvas instance may require the `needs_grading_count_by_section` query parameter or a specific role. This is left as a debugging hint; V1 does not add a fallback.

---

## Canvas API calls

| # | Endpoint | Purpose | Client method |
|---|----------|---------|---------------|
| 1 | `GET /api/v1/courses/:id/assignments[?assignment_ids[]=...]` | Assignment list with `needs_grading_count`; filtered by `assignment_ids` if provided | `canvas.assignments.list(courseId, opts)` |
| 2 | `GET /api/v1/courses/:id/students/submissions?student_ids[]=all&assignment_ids[]=[filtered]&include[]=user` | All submissions for filtered assignment IDs; tool layer filters to target states | `canvas.submissions.listForStudents(courseId, { student_ids: ['all'], assignment_ids: [...], include: ['user'] })` |

**Only 2 paginated calls** regardless of course size. No per-assignment or per-quiz fan-out.

**Dependency:** Call 2's `assignment_ids` argument is derived from Call 1's filtered results; Call 2 runs after Call 1.

**Early return:** When `toFetch` is empty after filtering, Call 2 is skipped entirely.

**Why no `workflow_state` filter on Call 2?** `ListStudentSubmissionsOptions.workflow_state` accepts only a single `SubmissionWorkflowState` value. Since we need both `'submitted'` and `'pending_review'`, passing a server-side filter would require two separate calls. Omitting it and filtering client-side handles both states (and the `only_pending_review` toggle) in one call. The over-fetch is acceptable given that Call 1's `assignment_ids` already scopes the response to assignments with `needs_grading_count > 0`.

**Client notes:**
- `CanvasAssignment.needs_grading_count?: number` is already in `src/canvas/types.ts`; Canvas populates it for grader tokens without a special include parameter.
- `SubmissionListInclude` already includes `'user'` in `src/canvas/submissions.ts`.
- `ListAssignmentsOptions.assignment_ids` already exists on `AssignmentsModule.list()` and accepts `ReadonlyArray<number>`.
- No changes to `src/canvas/` are required.

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
      'Include Classic Quiz assignments in the scan. Default: true. '
      + 'New Quizzes are always covered by the global New Quizzes caveat — see response.caveats.',
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
// Caught by buildHandler -> formatError -> isError: true response
```

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
    type: 'classic_quiz' | 'assignment',      // 'classic_quiz' when isClassicQuiz(a) === true
    due_at: string | null,
    submissions_awaiting_count: number,       // === submissions.length
    submissions: Array<{
      submission_id: number,
      user_id: number,                        // always the raw Canvas numeric ID; not pseudonymized
      user_name: string | null,               // null when submission.user is absent; pseudonymized when enabled
      workflow_state: 'submitted' | 'pending_review',
      submitted_at: string | null,
      has_pending_manual_questions: boolean,  // === (workflow_state === 'pending_review')
    }>
  }>,
  caveats: string[],
}
```

### Algorithm (annotated pseudocode)

```ts
// Guard
if (params.include_quizzes === false && params.include_assignments === false) {
  throw new Error('At least one of include_quizzes or include_assignments must be true.')
}

// Step 1: fetch assignment list (optionally scoped by assignment_ids)
const assignmentListOpts = params.assignment_ids?.length
  ? { assignment_ids: params.assignment_ids }
  : {}
const allAssignments = await canvas.assignments.list(courseId, assignmentListOpts)

// Step 2: classify assignments
const classicQuizAssignments = allAssignments.filter(isClassicQuiz)
const regularAssignments = allAssignments.filter(a => !isClassicQuiz(a))

// Step 3: apply include_quizzes / include_assignments toggles
const eligibleAssignments = [
  ...(params.include_quizzes !== false ? classicQuizAssignments : []),
  ...(params.include_assignments !== false ? regularAssignments : []),
]

// Step 4: pre-filter by needs_grading_count
// Note: if needs_grading_count is undefined (field absent from Canvas response),
// ?? 0 yields false — the assignment is excluded. This is conservative and correct;
// see Design unknown #10 for discussion. For instructor tokens, Canvas always populates
// this field and undefined should not occur.
const toFetch = eligibleAssignments.filter(a => (a.needs_grading_count ?? 0) > 0)

// Step 5: build caveats
const caveats: string[] = []
caveats.push(
  'New Quizzes (Quizzes.Next) manage their own grading queue and their submission records '
  + 'may not appear with \'pending_review\' workflow state here. Use SpeedGrader or the '
  + 'New Quizzes interface to check for pending New Quiz grading.',
)
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
    caveats,
  }
}

// Step 7: bulk fetch submissions for the filtered assignments
// workflow_state is intentionally omitted from the API call: ListStudentSubmissionsOptions
// only accepts a single workflow_state value, and we need both 'submitted' and
// 'pending_review'. Client-side filtering below handles both (and the only_pending_review
// toggle) in a single API call. The assignment_ids scope limits over-fetch.
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

// Step 12: assemble items; sort submissions within each item oldest-first
// Defensive: Canvas may return submissions for assignment_ids outside toFetch (edge case).
// Collect any such orphaned IDs and skip; caveat appended in Step 14.
const unmatchedIds: number[] = []
const items = [...byAssignment.entries()]
  .flatMap(([assignmentId, subs]) => {
    const assignment = assignmentById.get(assignmentId)
    if (!assignment) {
      unmatchedIds.push(assignmentId)
      return []
    }
    const sortedSubs = [...subs].sort((a, b) => {
      if (!a.submitted_at) return 1   // null sorts last
      if (!b.submitted_at) return -1
      return a.submitted_at < b.submitted_at ? -1 : 1
    })
    return [{
      assignment_id: assignmentId,
      assignment_name: assignment.name,
      type: isClassicQuiz(assignment) ? 'classic_quiz' as const : 'assignment' as const,
      due_at: assignment.due_at,
      submissions_awaiting_count: sortedSubs.length,
      submissions: sortedSubs.map(s => ({
        submission_id: s.id,
        user_id: s.user_id,
        user_name: s.user?.name ?? null,
        workflow_state: s.workflow_state as 'submitted' | 'pending_review',
        submitted_at: s.submitted_at,
        has_pending_manual_questions: s.workflow_state === 'pending_review',
      })),
    }]
  })
  // Step 13: sort items by oldest submitted_at (ascending; items with only null dates sort last)
  .sort((a, b) => {
    const aOldest = a.submissions
      .filter(s => s.submitted_at)
      .map(s => Date.parse(s.submitted_at!))
      .reduce((min, t) => (t < min ? t : min), Infinity)
    const bOldest = b.submissions
      .filter(s => s.submitted_at)
      .map(s => Date.parse(s.submitted_at!))
      .reduce((min, t) => (t < min ? t : min), Infinity)
    // Guard: Infinity - Infinity === NaN (violates ECMAScript sort contract). Both-Infinity
    // means every submission in both groups has null submitted_at — stable tie.
    if (aOldest === Infinity && bOldest === Infinity) return 0
    return aOldest - bOldest
  })

// Step 14: append defensive caveat if Canvas returned stray submissions
if (unmatchedIds.length > 0) {
  caveats.push('Some submissions could not be matched to an assignment and were excluded.')
}

return {
  course_id: courseId,
  total_submissions_awaiting: items.reduce((s, i) => s + i.submissions_awaiting_count, 0),
  items,
  caveats,
}
```

---

## Pseudonymizer integration

Every awaiting submission in the output includes `user_id` and `user_name` derived from `submission.user` — student PII.

**Wrap each submission through `pseudonymizer.anonymizeSubmission(courseId, submission)`** when `pseudonymizer.isEnabled()` is `true` AND `s.user` is defined. This replaces `submission.user.name` with a pseudonym (e.g. `"Student 0"`). The output's `user_name` reads `s.user?.name ?? null` after anonymization.

When `s.user` is absent (Canvas did not sideload the user object), `user_name` is `null` and no pseudonymization is attempted — `user_id` is the only identifying field in this case. In practice, `include: ['user']` on the submissions call causes Canvas to populate `s.user` for all returned submissions.

`user_id` is always the raw Canvas numeric ID — it is not pseudonymized. This is consistent with how other tools handle stable per-student identifiers (the instructor can use `resolve_pseudonym` to look up the real identity).

Add `'list_submissions_awaiting_grading'` to **both**:
1. `PSEUDONYMIZER_WRAPPED_TOOLS` in `src/pseudonym/coverage.ts`
2. `EXPECTED_PII_BEARING_TOOLS` inside `tests/pseudonym/coverage.test.ts`

CI enforces exact equality between these two sets (`tests/pseudonym/coverage.test.ts`); updating only one will fail the build.

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
| All assignments have `needs_grading_count === 0` or `undefined` after filtering | Return `items: []`, `total_submissions_awaiting: 0`; no error |
| `assignment_ids` contains IDs not in the course | Canvas silently excludes unknown IDs; tool returns normally with no items for those IDs |
| 401 / 403 / 404 on Canvas calls | `formatError()` maps to user-friendly message |
| Submission returned with `assignment_id` not in `assignmentById` (defensive) | Skip that submission; append caveat `'Some submissions could not be matched to an assignment and were excluded.'` |
| Network failure | Propagated via `formatError()` |
| `pseudonymizer.anonymizeSubmission` throws | Propagate — do NOT swallow pseudonymizer errors |

---

## Test plan (`tests/submissions-awaiting-grading.test.ts`)

All tests use `vi.spyOn` on `canvas.*` methods (same pattern as `tests/grade-explanation.test.ts`). No real Canvas instance.

### Fixture A — Happy path: mixed submitted + pending_review, sorting, type detection

**Mocks:**
- `canvas.assignments.list(courseId)` → 3 assignments:
  - A1: regular assignment (`is_quiz_assignment: false`), `needs_grading_count: 2`
  - A2: Classic Quiz (`is_quiz_assignment: true`, `quiz_id: 10`), `needs_grading_count: 1`
  - A3: regular assignment, `needs_grading_count: 0` (should be excluded)
- `canvas.submissions.listForStudents(courseId, { assignment_ids: [A1.id, A2.id], ... })` → 3 submissions:
  - S1: A1, `user: { id: 101, name: 'Alice' }`, `workflow_state: 'submitted'`, `submitted_at: '2026-06-20T10:00:00Z'`
  - S2: A1, `user: { id: 102, name: 'Bob' }`, `workflow_state: 'submitted'`, `submitted_at: '2026-06-21T10:00:00Z'`
  - S3: A2, `user: { id: 103, name: 'Carol' }`, `workflow_state: 'pending_review'`, `submitted_at: '2026-06-19T10:00:00Z'`

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
9. `canvas.submissions.listForStudents` called with `assignment_ids` containing A1.id and A2.id but NOT A3.id
10. `result.caveats` contains at least one entry mentioning 'New Quizzes'

### Fixture B — `only_pending_review: true`

**Same mocks as Fixture A.**

**Call**: `{ course_id: courseId, only_pending_review: true }`

**Assertions:**
1. `result.total_submissions_awaiting === 1` (only S3 with `pending_review`)
2. `result.items.length === 1`
3. `result.items[0].assignment_id === A2.id`
4. `result.items[0].submissions[0].workflow_state === 'pending_review'`
5. `result.caveats` does NOT contain the fill-in-the-blank caveat

### Fixture C — `assignment_ids` scope

**Same mocks as Fixture A.**

**Call**: `{ course_id: courseId, assignment_ids: [A2.id] }`

**Assertions:**
1. `result.total_submissions_awaiting === 1`
2. `result.items.length === 1`
3. `result.items[0].assignment_id === A2.id`
4. `canvas.assignments.list` called with `assignment_ids: [A2.id]`

### Fixture D — `include_quizzes: false`

**Same mocks as Fixture A.**

**Call**: `{ course_id: courseId, include_quizzes: false }`

**Assertions:**
1. `result.items.every(i => i.type === 'assignment')`
2. No item with `assignment_id === A2.id`

### Fixture E — `include_assignments: false`

**Same mocks as Fixture A.**

**Call**: `{ course_id: courseId, include_assignments: false }`

**Assertions:**
1. `result.items.every(i => i.type === 'classic_quiz')`
2. Only A2 in `result.items`

### Fixture F — Both toggles `false` → error

**Call**: `{ course_id: courseId, include_quizzes: false, include_assignments: false }`

**Assertions:**
1. Response has `isError: true`
2. Message contains `'At least one of include_quizzes or include_assignments must be true'`

### Fixture G — No submissions awaiting (all graded)

**Mocks:** All assignments have `needs_grading_count: 0`.

**Call**: `{ course_id: courseId }`

**Assertions:**
1. `result.items.length === 0`
2. `result.total_submissions_awaiting === 0`
3. `canvas.submissions.listForStudents` was **not** called (early-return path)

### Fixture G2 — `needs_grading_count` absent (undefined) on all assignments

**Mocks:** Assignments returned with `needs_grading_count` field absent (undefined).

**Call**: `{ course_id: courseId }`

**Assertions:**
1. `result.items.length === 0` (`undefined ?? 0` → `0 > 0` is false, all excluded)
2. `canvas.submissions.listForStudents` was **not** called

### Fixture H — FERPA pseudonymization

**Setup:** pseudonymizer enabled.
- S1 has `user: { id: 101, name: 'Alice Student' }`
- `pseudonymizer.anonymizeSubmission(courseId, S1)` → S1 with `user.name: 'Student 0'`

**Assertions:**
1. `result.items[0].submissions[0].user_name === 'Student 0'`
2. `result.items[0].submissions[0].user_id === 101` (id not replaced)

### Fixture H2 — FERPA: `user` absent from submission (sideload missing)

**Setup:** pseudonymizer enabled. Submission returned with `user` field absent (undefined).

**Assertions:**
1. `result.items[0].submissions[0].user_name === null`
2. `pseudonymizer.anonymizeSubmission` was **not** called for this submission

### Fixture I — Sorting correctness

**Mocks:**
- A1: `needs_grading_count: 1`, submission `submitted_at: '2026-06-25T10:00:00Z'`
- A2: `needs_grading_count: 1`, submission `submitted_at: '2026-06-23T10:00:00Z'` (older)

**Call**: `{ course_id: courseId }`

**Assertions:**
1. `result.items[0].assignment_id === A2.id` (older submission first)
2. `result.items[1].assignment_id === A1.id`

### Fixture J — External-tool (LTI) assignment included (not falsely excluded)

**Mocks:**
- A_LTI: `submission_types: ['external_tool']`, `is_quiz_assignment: false`, `quiz_id: null`, `needs_grading_count: 2`
- Submissions: 2 with `workflow_state: 'submitted'`

**Call**: `{ course_id: courseId }`

**Assertions:**
1. `result.items.length === 1`
2. `result.items[0].assignment_id === A_LTI.id`
3. `result.items[0].type === 'assignment'` (not 'classic_quiz')
4. `result.total_submissions_awaiting === 2`

*(This fixture documents the intentional decision to include external-tool assignments rather than falsely excluding them as "New Quizzes".)*

### Fixture I2 — Null submitted_at: no NaN corruption in items sort

**Mocks:**
- A1: `needs_grading_count: 1`, submission `submitted_at: null`
- A2: `needs_grading_count: 1`, submission `submitted_at: null`

**Call**: `{ course_id: courseId }`

**Assertions:**
1. `result.items.length === 2` (no crash, no corruption)
2. Items appear in stable order (either [A1, A2] or [A2, A1] — any stable tie order is acceptable, but the array must have exactly 2 entries)

*(This fixture guards against the Infinity − Infinity = NaN sort-contract violation; if the NaN guard is absent, V8 may silently drop or reorder items.)*

### Fixture K — Stray submission defensive skip

**Mocks:**
- `canvas.assignments.list(courseId)` → 1 assignment (A1, `needs_grading_count: 2`)
- `canvas.submissions.listForStudents(...)` → 2 submissions:
  - S1: `assignment_id: A1.id`, `workflow_state: 'submitted'`
  - S_stray: `assignment_id: 9999` (not in `toFetch`), `workflow_state: 'submitted'`

**Call**: `{ course_id: courseId }`

**Assertions:**
1. `result.items.length === 1` (S_stray's group excluded)
2. `result.items[0].assignment_id === A1.id`
3. `result.caveats` contains `'Some submissions could not be matched to an assignment and were excluded.'`

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
- New Quizzes (Quizzes.Next) may not appear with 'pending_review' workflow state here;
  use SpeedGrader or the New Quizzes interface for their grading queue.
- Fill-in-the-blank answers that Canvas auto-marked are not surfaced.
- V1 returns submission-level state only; per-question detail is not included.
- When CANVAS_PSEUDONYMIZE_STUDENTS is enabled, student names are replaced with pseudonyms.
  Use resolve_pseudonym to look up the real identity.
```

---

## File changes summary

| File | Change |
|------|--------|
| `src/tools/submissions-awaiting-grading.ts` | **New** — `submissionsAwaitingGradingTools(canvas, pseudonymizer?)` exporting `list_submissions_awaiting_grading`; Zod schema, annotations, algorithm, output shape as specified above |
| `src/tools/catalog.ts` | **Modify** — add `import { submissionsAwaitingGradingTools } from './submissions-awaiting-grading'`; add `submissions_awaiting_grading` domain entry (`defaultPrimaryAudience: 'educator'`) after the `submission_files` entry |
| `src/pseudonym/coverage.ts` | **Modify** — add `'list_submissions_awaiting_grading'` to `PSEUDONYMIZER_WRAPPED_TOOLS` |
| `tests/submissions-awaiting-grading.test.ts` | **New** — Fixtures A–K as specified above |
| `tests/pseudonym/coverage.test.ts` | **Modify** — add `'list_submissions_awaiting_grading'` to `EXPECTED_PII_BEARING_TOOLS` (CI enforces exact equality with `PSEUDONYMIZER_WRAPPED_TOOLS`) |

**5 files total. No new Canvas module. No new package dependencies.**

All Canvas calls reuse existing `CanvasClient` facade methods (`assignments.list`, `submissions.listForStudents`). The `src/canvas/` layer is untouched.

If `pnpm generate:manifests` is present in `package.json`, run it after catalog registration to update manifest counts and ensure registry/discovery tests pass (per acceptance criteria).

---

## Open questions for CTO review

None — all design unknowns are retired above. The spec is implementation-ready.
