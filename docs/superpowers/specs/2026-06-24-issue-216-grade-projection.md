---
issue: 216
---

# Grade Projection Tool — `project_grade` MCP Tool Design

**Date**: 2026-06-24
**Issue**: [bruchris/canvas-lms-mcp#216](https://github.com/bruchris/canvas-lms-mcp/issues/216)
**Status**: Design — awaiting CTO review

---

## Purpose

Add a single read-only tool, `project_grade`, that answers: *"what score do I need on my remaining assignments to reach a target grade?"* The tool inverts the weighted-grade computation already shipped in `explain_grade` (#206) to surface the **minimum uniform percentage that must be earned on all remaining (ungraded) assignments** for the overall course grade to equal the target. It accounts for assignment-group weights, drop-lowest / drop-highest / never-drop rules, and the course grading scheme (for letter-grade targets and output), and returns a feasibility verdict (`achievable` / `already_secured` / `impossible`) plus a plain-language summary.

The tool reuses the grade-computation engine from `explain_grade` and the grading-scheme resolution from `explain_grading_policy` (#213) / grading standards (#186). It inverts the same weighted-average math rather than introducing a new Canvas domain.

---

## Design unknowns (retired)

### 1. Projection math: weighted vs points-based courses

**Decision: uniform-x model — solve for the single percentage x such that, if every remaining item earns x%, the overall course grade exactly equals the target. Closed-form algebra; no iteration required.**

**Points-based courses (`course.apply_assignment_group_weights === false`):**

After drop rules are applied in current mode (see §2), all non-excused, non-`not_graded` assignments contribute to a single pool regardless of group:

```
E           = Σ score for all graded retained assignments (current mode)
P_graded    = Σ points_possible for graded retained assignments
P_remaining = Σ points_possible for remaining (ungraded, retained) assignments
P_total     = P_graded + P_remaining

x = (T × P_total − E) / P_remaining    (when P_remaining > 0)
```

Where T is the target as a fraction (0–1). When `P_remaining = 0` the grade is fully determined.

**Weighted courses (`apply_assignment_group_weights === true`):**

Each group g has weight w_g. Variable definitions for the weighted formula:

```
E_g           = Σ score for graded retained assignments in group g
P_g_graded    = Σ points_possible for graded retained assignments in group g
P_g_remaining = Σ points_possible for remaining (ungraded, retained) assignments in group g
P_g_total     = P_g_graded + P_g_remaining
                (NOT GroupModeResult.possible — in current mode that only sums graded items)
T             = target_percentage / 100  (target as fraction, 0–1)
```

Assuming uniform x on every remaining assignment across every group:

```
pct_g(x)         = (E_g + x × P_g_remaining) / P_g_total   (for active groups: P_g_total > 0)
active_weight_sum = Σ w_g  for active groups
Overall(x)        = Σ(w_g × pct_g(x)) / active_weight_sum  = T

Expanding into a linear equation A + x × B = T:
  A = Σ(w_g × E_g / P_g_total) / active_weight_sum    (weighted grade over full denominator — differs from computeOverall() which uses only p_graded)
  B = Σ(w_g × P_g_remaining / P_g_total) / active_weight_sum  (weighted fraction still to grade)
  x = (T − A) / B    (when B > 0; when B = 0, compare A to T directly — see §5 and pseudocode)
```

When `B = 0` (no remaining work) the grade is fully determined; compare A to T.

**Rationale for uniform-x:** the user story asks for the *minimum average needed*, not per-assignment targets. A single uniform x is the natural interpretation and yields closed-form algebra. Per-group optimization is underdetermined without specifying an objective; V2 can add that variant.

### 2. Drop-rule interaction with remaining assignments

**Decision: run drop rules in current mode (using only already-graded scores) first, then project over the non-dropped, not-yet-graded items.**

`computeGroupGrade(group, submissionsById, 'current')` from the shared grade engine identifies which currently-graded assignments are dropped. Those items are excluded from both the locked-in totals and the remaining totals. Remaining items that are theoretically droppable are treated as remaining — the tool assumes the current drop assignments will not change once future work is graded.

This matches Canvas's own per-item "what-if" behavior and is correct for the common case where remaining items are of comparable point value to graded ones.

A caveat is added when the course has any group with `drop_lowest > 0` or `drop_highest > 0`: *"Drop rules are applied using currently graded scores only; which items are dropped may change as remaining assignments are graded."*

**Why not iterate / binary-search with x on remaining items?**
Running drops with hypothetical scores creates a circular dependency (x affects which items are dropped; which items are dropped affects x). Resolving this via iteration adds significant complexity for marginal accuracy gain in typical courses. The simplified model is used by Canvas's own "what-if" tool.

### 3. What counts as "remaining"

**Decision: remaining = assignments whose status per the current-mode `classify()` result is `missing` or `submitted`, that are not dropped and not excluded.**

| Assignment status | Treatment in projection |
|-------------------|------------------------|
| `graded` (retained) | Locked in — contributes to E_g and P_g_graded |
| `graded` (dropped) | Excluded entirely |
| `submitted` (awaiting grading; includes `workflow_state === 'pending_review'` mapped by `classify()`) | **Remaining** — contributes P_g_remaining |
| `missing` (not submitted) | **Remaining** — contributes P_g_remaining |
| `excused` | Excluded (same as `explain_grade`) |
| `not_graded` | Excluded (same as `explain_grade`) |

The output surfaces per-group `remaining_assignments` so the student can see exactly which items count. A fixed caveat is always included: *"Submitted but ungraded assignments are treated as remaining; their actual scores may differ from the projected minimum."*

### 4. Target input: percentage vs letter grade

**Decision: accept `target_percentage` (0–100 number) or `target_letter` (string resolved against the grading scheme); exactly one must be provided.**

When `target_letter` is provided:
- Fetch the course grading scheme via `resolveGradingScheme()` (shared with `explain_grade`).
- Find the entry whose `name` matches (case-insensitive); use `entry.value × 100` as the resolved target percentage. This is the lower bound for that letter, i.e. the minimum score that earns it.
- If no grading scheme is configured: `throw new Error('A letter-grade target requires a grading scheme, but this course has no grading standard configured. Pass target_percentage instead.')` — caught by `buildHandler` and passed to `formatError`, producing `isError: true` in the response.
- If the letter is not in the scheme: `throw new Error("Letter grade '<X>' is not in the course grading scheme. Valid letters: <comma-separated list>.")` — same path via `buildHandler`.

**Why lower-bound resolution?** The student wants *at least* a B — the lower bound of B (e.g. 80%) is the exact minimum that achieves it. Scoring at the lower bound earns precisely that letter.

### 5. Feasibility verdict

**Decision: three verdicts determined by the computed x value.**

| Condition | Verdict |
|-----------|---------|
| `x ≤ 0` | `already_secured` — current locked-in grade already meets target even scoring 0% on remaining |
| `0 < x ≤ 1` (0–100% as fraction) | `achievable` |
| `x > 1` (> 100%) | `impossible` |

When `P_remaining = 0` / `B = 0` (no remaining work):
- `minimum_pct_on_remaining: null`
- If current grade ≥ target: `already_secured`
- If current grade < target: `impossible`

### 6. Per-group output in weighted courses

**Decision: always include a per-group breakdown showing locked-in totals, remaining points, and the remaining-assignment list.**

For weighted courses the per-group breakdown lets the student see which groups carry more remaining weight. The uniform x applies across all groups equally; `minimum_pct_on_remaining` is a single course-level value. A future V2 could expose group-targeted recommendations ("concentrate effort on high-weight groups").

For unweighted courses, `group_weight` is included as 0 or its raw value, but `weighted_contribution` is omitted (matching `explain_grade`).

### 7. Reuse of the grade-computation engine

**Decision: extract the shared grade-computation helpers into a new module `src/tools/grade-engine.ts`; update `grade-explanation.ts` to import from it; `grade-projection.ts` also imports from it.**

Functions and types moved to `grade-engine.ts` (all exported):

- **Computation**: `computeGroupGrade`, `computeOverall`, `mapLetter`, `resolveGradingScheme`
- **Drop helpers**: `applyDrop`, `greedyDrop`, `combinations`, `binomial`
- **Classification**: `classify`, `isCountable`, `normalizePoints`, `retainedFraction`, `sortRatio`, `percentageOf`
- **Types**: `GradeItem`, `GroupModeResult`, `Mode`, `DropReason`, `DropStrategy`

`grade-explanation.ts` is updated to import these from `./grade-engine`. No behavior change to any function — this is a purely extractive refactor.

**Rationale:** Without extraction, `grade-projection.ts` would either duplicate ~230 lines of math or import from a file whose internals are not part of its public contract. The shared engine module makes the dependency explicit, keeps each tool file focused on its tool logic, and simplifies future algorithm improvements.

### 8. FERPA / pseudonymization

**Decision: same integration as `explain_grade`.**

`project_grade` returns `student.id` and `student.name` sourced from the fetched `CanvasUser`. When `student_id` is numeric (viewing another student's data), call `pseudonymizer.anonymizeUser(courseId, user, enrollments)` — confirmed 3-argument signature (`courseId`, fetched `CanvasUser`, optional enrollment array). Skip for `self` (no third-party PII). Add `'project_grade'` to `PSEUDONYMIZER_WRAPPED_TOOLS`.

The `remaining_assignments` array in the output contains only assignment metadata (id, name, points_possible, status) — no student-identifying fields.

### 9. Late penalties

**Decision: V1 does not fetch or apply late-submission penalties.**

Including late-policy data would require a `canvas.latePolicy.get()` call that returns 403 for student tokens, complicating the permission model and producing inconsistent output depending on the caller's role. A static caveat is always appended: *"This projection does not account for late-submission penalties; if the course deducts points for late work, the actual score needed may be higher."*

### 10. Audience

**Decision: `audience: 'shared'`.**

Both the student self-view and the instructor-advising-a-student case benefit from this tool. The `grade_projection` domain sets `defaultPrimaryAudience: 'shared'` — no per-tool override needed.

### 11. Grading-period filtering

**Decision: V1 ignores grading periods — projects the overall course grade across all assignment groups.** Same limitation as `explain_grade`. V2 can add a `grading_period_id` parameter.

### 12. V1 is single-student only

**Decision: same as `explain_grade` — one student per call.** Omit `student_id` for self; supply a numeric `student_id` for another student. Fan-out to all students is deferred to V2.

---

## Canvas API calls

| # | Endpoint | Purpose | CanvasClient method |
|---|----------|---------|---------------------|
| 1 | `GET /api/v1/courses/:id` | `apply_assignment_group_weights`, `grading_standard_id`, `account_id` | `canvas.courses.get(courseId)` |
| 2 | `GET /api/v1/courses/:id/assignment_groups?include[]=assignments` | Groups with weights, rules, and assignment list | `canvas.assignments.listGroups(courseId, { include: ['assignments'] })` |
| 3a | `GET /api/v1/courses/:id/students/submissions?student_ids[]=self` | Submissions for authenticated user | `canvas.submissions.listMy(courseId)` |
| 3b | `GET /api/v1/courses/:id/students/submissions?student_ids[]=:id` | Submissions for specified student | `canvas.submissions.listForStudents(courseId, { student_ids: [userId] })` |
| 4 | `GET /api/v1/courses/:id/enrollments?user_id=:id&include[]=grades` | Canvas's posted current score (for `current_grade` output) | `canvas.enrollments.listForCourse(courseId, { user_id, include: ['grades'] })` |
| 5 | `GET /api/v1/users/:id` (or `/users/self`) | Student name for output and pseudonymizer | `canvas.users.get(studentId)` or `canvas.users.getSelf()` (both already exist on `CanvasClient.users`; same as `explain_grade`) |
| 6 (conditional) | `GET /api/v1/courses/:id/grading_standards` (then account fallback) | Grading scheme for letter-grade target resolution and output letter | `canvas.gradingStandards.listForCourse()` / `listForAccount()` |

Calls 2–5 are independent after call 1 resolves; issue as `Promise.all([call2, call3, call4, call5])`. Call 6 is conditional on `target_letter` being provided OR `course.grading_standard_id !== null` (for mapping the output `current_grade.letter` and `target.letter`).

Call pattern is identical to `explain_grade`. No new Canvas endpoints are required.

---

## New shared module: `src/tools/grade-engine.ts`

All grade-computation logic currently inline in `grade-explanation.ts` is moved here verbatim and exported. `grade-explanation.ts` is updated to:

```ts
// Remove all local definitions; replace with:
import {
  computeGroupGrade, computeOverall, mapLetter, resolveGradingScheme,
  normalizePoints, classify, isCountable, retainedFraction, sortRatio,
  applyDrop, greedyDrop, combinations, binomial, percentageOf,
  MAX_DROP_COMBINATIONS, RECONCILIATION_TOLERANCE, CURVE_CAVEAT_THRESHOLD,
} from './grade-engine'
import type { GradeItem, GroupModeResult, Mode, DropReason, DropStrategy } from './grade-engine'
```

`grade-projection.ts` imports the subset it needs:

```ts
import { computeGroupGrade, computeOverall, mapLetter, resolveGradingScheme } from './grade-engine'
import type { GradeItem, GroupModeResult } from './grade-engine'
```

No behavioral changes to any function. All existing `explain_grade` tests pass unchanged.

---

## Tool contract (`src/tools/grade-projection.ts`)

### Export signature

```ts
export function gradeProjectionTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[]
```

### Tool name

`project_grade`

### Zod input schema

```ts
inputSchema: {
  course_id: z.number().int().positive()
    .describe('Canvas course ID to compute the grade projection for.'),
  target_percentage: z.number().min(0).max(100).optional()
    .describe(
      'Target course grade as a percentage (0–100). Exactly one of target_percentage or ' +
      'target_letter must be provided. Example: 90.0 for a 90% target.',
    ),
  target_letter: z.string().optional()
    .describe(
      'Target course grade as a letter (e.g. "A", "B+"). Requires the course to have a ' +
      'grading standard configured. Exactly one of target_percentage or target_letter must ' +
      'be provided. Case-insensitive.',
    ),
  student_id: z.number().int().positive().optional()
    .describe(
      'Canvas user_id of the student to compute for. Omit to compute for the authenticated user. ' +
      'Instructors may pass any enrolled student\'s user_id. When CANVAS_PSEUDONYMIZE_STUDENTS ' +
      'is enabled, pass the numeric Canvas user_id after resolving the pseudonym via resolve_pseudonym.',
    ),
}
```

Input validation at the top of the handler (before any Canvas calls):

```ts
if (targetPercentage !== undefined && targetLetter !== undefined) {
  throw new Error('Provide either target_percentage or target_letter, not both.')
}
if (targetPercentage === undefined && targetLetter === undefined) {
  throw new Error('Provide one of target_percentage or target_letter.')
}
```

These throw plain `Error` (not `CanvasApiError`) and are caught by `buildHandler`'s catch block, returning a structured error response via `formatError`.

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
  student: {
    id: number,
    name: string,             // pseudonymized when CANVAS_PSEUDONYMIZE_STUDENTS=true and student_id set
  },
  course: {
    id: number,
    name: string,
    weighted: boolean,
    grading_standard_id: number | null,
  },
  target: {
    requested: string,        // as-provided: "90" (stringified number) or "A"
    percentage: number,       // resolved target (0–100)
    letter: string | null,    // mapped via grading scheme at target percentage; null if no scheme
  },
  current_grade: {
    percentage: number | null,  // computed weighted grade (current mode), via computeOverall()
    letter: string | null,      // mapped via grading scheme; null if no scheme or no grade
  },
  projection: {
    minimum_pct_on_remaining: number | null,
    // The uniform percentage (0–100+) each remaining item must earn.
    // null only when P_remaining = 0 (no remaining work at all).
    // Values ≤ 0 → 'already_secured'; values > 100 → 'impossible'.
    feasibility: 'already_secured' | 'achievable' | 'impossible',
    remaining_points_possible: number,  // Σ points_possible across all remaining items (all groups)
    locked_in: {
      earned: number,         // Σ scores on graded retained assignments across all groups
      possible: number,       // Σ points_possible on graded retained assignments across all groups
    },
    groups: Array<{
      group_id: number,
      group_name: string,
      group_weight: number,   // raw Canvas group_weight (0 if not set)
      locked_in: {
        earned: number,
        possible: number,
        percentage: number | null,  // null if possible === 0
      },
      remaining_points_possible: number,
      remaining_assignments: Array<{
        assignment_id: number,
        assignment_name: string,
        points_possible: number,
        status: 'missing' | 'submitted',
      }>,
    }>,
  },
  caveats: string[],
  summary: string,
}
```

### Projection computation (annotated pseudocode)

```ts
// Derive student identity — mirrors the explain_grade convention
const studentId: number | 'self' = params.student_id ?? 'self'

// Step 1: run current-mode drop algorithm for every group (reuses grade-engine)
const groupResults: GroupModeResult[] = groups.map(group =>
  computeGroupGrade(group, submissionsById, 'current'),
)

// Step 2: for each group, partition retained items into locked-in vs remaining
interface GroupProjData {
  group: CanvasAssignmentGroup
  result: GroupModeResult
  earned: number        // E_g: sum of scores on retained graded items in this group
  p_graded: number      // Σ points_possible of retained graded items
  p_remaining: number   // Σ points_possible of retained ungraded (missing/submitted) items
  p_total: number       // p_graded + p_remaining
}

// An item is "retained" if !item.dropped AND status !== 'excused' AND status !== 'not_graded'
const projData: GroupProjData[] = groups.map((group, i) => {
  const result = groupResults[i]!
  let earned = 0, p_graded = 0, p_remaining = 0
  for (const item of result.items) {
    if (item.dropped || item.status === 'excused' || item.status === 'not_graded') continue
    if (item.status === 'graded') {
      earned   += item.score!   // score is non-null for 'graded' items
      p_graded += item.points
    } else {
      p_remaining += item.points  // 'missing' or 'submitted'
    }
  }
  return { group, result, earned, p_graded, p_remaining, p_total: p_graded + p_remaining }
})

// Step 3: solve for x (uniform minimum percentage on remaining items)
const weighted = course.apply_assignment_group_weights ?? false
let minimumPctOnRemaining: number | null
let feasibility: 'already_secured' | 'achievable' | 'impossible'
const T = targetPercentage / 100  // target as fraction

if (!weighted) {
  const E           = projData.reduce((s, d) => s + d.earned, 0)
  const P_total     = projData.reduce((s, d) => s + d.p_total, 0)
  const P_remaining = projData.reduce((s, d) => s + d.p_remaining, 0)

  if (P_remaining === 0) {
    minimumPctOnRemaining = null
    const currentFraction = P_total > 0 ? E / P_total : null
    feasibility = (currentFraction !== null && currentFraction >= T)
      ? 'already_secured' : 'impossible'
  } else {
    const x = (T * P_total - E) / P_remaining
    minimumPctOnRemaining = x * 100
    feasibility = x <= 0 ? 'already_secured' : x <= 1 ? 'achievable' : 'impossible'
  }

} else {
  // Weighted
  const activeGroups     = projData.filter(d => d.p_total > 0)
  const activeWeightSum  = activeGroups.reduce((s, d) => s + (d.group.group_weight ?? 0), 0)

  if (activeWeightSum === 0) {
    minimumPctOnRemaining = null
    feasibility = 'impossible'
    caveats.push('No assignment groups have any gradeable assignments; overall grade cannot be computed.')
  } else {
    const A = activeGroups.reduce((s, d) => {
      const w = (d.group.group_weight ?? 0) / activeWeightSum
      return s + w * (d.earned / d.p_total)
    }, 0)
    const B = activeGroups.reduce((s, d) => {
      const w = (d.group.group_weight ?? 0) / activeWeightSum
      return s + w * (d.p_remaining / d.p_total)
    }, 0)

    if (B === 0) {
      minimumPctOnRemaining = null
      feasibility = A >= T ? 'already_secured' : 'impossible'
    } else {
      const x = (T - A) / B
      minimumPctOnRemaining = x * 100
      feasibility = x <= 0 ? 'already_secured' : x <= 1 ? 'achievable' : 'impossible'
    }
  }
}
```

### Drop-rule caveat insertion

```ts
const hasDropRules = groups.some(
  g => (g.rules?.drop_lowest ?? 0) > 0 || (g.rules?.drop_highest ?? 0) > 0,
)
if (hasDropRules) {
  caveats.push(
    'Drop rules are applied using currently graded scores only; ' +
    'which items are dropped may change as remaining assignments are graded.',
  )
}
```

### Target letter resolution

```ts
// Runs before Canvas calls if target_letter is provided
let targetPercentage: number
if (params.target_letter !== undefined) {
  const letter = params.target_letter as string
  // gradingScheme fetched via resolveGradingScheme() after call 1 resolves
  if (!gradingScheme) {
    throw new Error(
      'A letter-grade target requires a grading scheme, but this course has no grading standard configured. ' +
      'Pass target_percentage instead.',
    )
  }
  const entry = [...gradingScheme]
    .sort((a, b) => b.value - a.value)
    .find(e => e.name.toLowerCase() === letter.toLowerCase())
  if (!entry) {
    const valid = [...gradingScheme].sort((a, b) => b.value - a.value).map(e => e.name).join(', ')
    throw new Error(
      `Letter grade '${letter}' is not in the course grading scheme. Valid letters: ${valid}.`,
    )
  }
  targetPercentage = entry.value * 100
} else {
  targetPercentage = params.target_percentage as number
}
```

Note: `resolveGradingScheme()` is called speculatively when `course.grading_standard_id !== null` even for `target_percentage` callers, so the output `target.letter` and `current_grade.letter` can be mapped. Letter resolution for the target only runs when `target_letter` is actually provided.

### Summary generation

```ts
function buildProjectionSummary(
  feasibility: string,
  minimumPct: number | null,
  targetStr: string,       // e.g. "90.0%" or "B (80.0%)"
  currentPct: number | null,
  totalRemaining: number,
): string {
  const currentStr = currentPct !== null ? `${currentPct.toFixed(1)}%` : 'unknown'
  if (feasibility === 'already_secured') {
    return (
      `With a current grade of ${currentStr}, the target of ${targetStr} is already secured ` +
      `— no minimum score is required on the remaining work.`
    )
  }
  if (feasibility === 'impossible') {
    return (
      `Reaching ${targetStr} (current grade: ${currentStr}) is not possible — even scoring ` +
      `100% on all remaining ${totalRemaining} points of ungraded work would not be sufficient.`
    )
  }
  // 'achievable'
  return (
    `To reach ${targetStr} (current grade: ${currentStr}), a minimum average of ` +
    `${minimumPct!.toFixed(1)}% is needed on the remaining ${totalRemaining} points of ` +
    `ungraded work.`
  )
}

// targetStr construction:
const targetStr = targetLetter
  ? `${targetLetter} (${targetPercentage.toFixed(1)}%)`
  : `${targetPercentage.toFixed(1)}%`
```

---

## Pseudonymizer integration

Same pattern as `explain_grade`:

```ts
// enrollments = result of call 4: canvas.enrollments.listForCourse(courseId, { user_id: studentId, include: ['grades'] })
// Passing enrollments lets anonymizeUser classify role correctly; staff pass through unchanged.
const anonUser =
  pseudonymizer?.isEnabled() && typeof studentId === 'number'
    ? await pseudonymizer.anonymizeUser(courseId, user, enrollments)
    : user

const targetRequested: string = params.target_letter ?? String(params.target_percentage)

// In output:
student: { id: anonUser.id, name: anonUser.name }
target: { requested: targetRequested, percentage: targetPercentage, letter: /* mapLetter result or null */ }
```

Add `'project_grade'` to `PSEUDONYMIZER_WRAPPED_TOOLS` in `src/pseudonym/coverage.ts`.

---

## Catalog registration (`src/tools/catalog.ts`)

```ts
import { gradeProjectionTools } from './grade-projection'

// Append after the 'grading_policy' entry:
{
  domain: 'grade_projection',
  defaultPrimaryAudience: 'shared',
  getTools: gradeProjectionTools,
},
```

---

## FERPA / pseudonymization

`project_grade` returns `student.id` and `student.name` from the fetched `CanvasUser` — same PII profile as `explain_grade`. Pseudonymizer wrapping is required when `student_id` is numeric (viewing another student's data). The `remaining_assignments` list contains only assignment metadata (id, name, points_possible, status) — no student-identifying fields. Add `'project_grade'` to both `PSEUDONYMIZER_WRAPPED_TOOLS` (`src/pseudonym/coverage.ts`) and `EXPECTED_PII_BEARING_TOOLS` (`tests/pseudonym/coverage.test.ts`).

---

## Error handling

| Scenario | Handling |
|----------|----------|
| Both `target_percentage` and `target_letter` provided | `throw new Error(...)` before Canvas calls → `formatError()` |
| Neither provided | `throw new Error(...)` before Canvas calls |
| `target_letter` with no grading scheme on course | `throw new Error(...)` after call 1 resolves |
| `target_letter` letter not in scheme | `throw new Error(...)` with valid-letters list |
| `student_id` not enrolled in course (enrollments = []) | Push caveat; set `current_grade = { percentage: null, letter: null }`; continue to projection computation (enrollment absence does not affect assignment/submission data) |
| 401/403/404 on Canvas calls | `formatError()` maps to user-friendly message |
| `activeWeightSum === 0` (no active groups) | Caveat pushed; `feasibility: 'impossible'` |
| All assignments excused / `not_graded` (P_total = 0) | `current_grade.percentage: null`; `minimum_pct_on_remaining: null`; `feasibility: 'impossible'`; caveat pushed |
| Network failure | Propagated via `formatError()` |

---

## Test plan (`tests/grade-projection.test.ts`)

All tests use mocked Canvas responses — no real Canvas instance is hit. The mock setup pattern follows `tests/grade-explanation.test.ts` (vi.spyOn on `canvas.*` methods).

### Fixture A — Points-based, achievable target (exact boundary)

**Course mock**: `apply_assignment_group_weights: false`, `grading_standard_id: null`

**Group**: Assignment 1 (100 pts, score 90), Assignment 2 (100 pts, score 80), Assignment 3 (100 pts, missing)

**Call**: `target_percentage: 90`

**Expected math**: E=170, P_total=300, P_remaining=100; x = (270−170)/100 = 1.0 = 100%

**Assertions**:
1. `result.projection.feasibility === 'achievable'`
2. `result.projection.minimum_pct_on_remaining` within 0.01 of 100
3. `result.projection.remaining_points_possible === 100`
4. `result.projection.locked_in.earned === 170`
5. `result.projection.locked_in.possible === 200`
6. `result.projection.groups[0].remaining_assignments` has length 1 and `assignment_id` matching A3
7. `result.summary` contains "100.0%"

### Fixture B — Points-based, already secured (negative x)

**Group**: A1 (100 pts, score 95), A2 (100 pts, score 90), A3 (20 pts, missing)

**Call**: `target_percentage: 80`

**Expected math**: E=185, P_total=220, P_remaining=20; x = (176−185)/20 = −0.45 → `already_secured`

**Assertions**:
1. `result.projection.feasibility === 'already_secured'`
2. `result.projection.minimum_pct_on_remaining` within 0.01 of −45
3. `result.summary` contains "already secured"

### Fixture C — Points-based, impossible target

**Group**: A1 (100 pts, score 50), A2 (100 pts, score 50), A3 (50 pts, missing)

**Call**: `target_percentage: 90`

**Expected math**: E=100, P_total=250, P_remaining=50; x = (225−100)/50 = 2.5 = 250%

**Assertions**:
1. `result.projection.feasibility === 'impossible'`
2. `result.projection.minimum_pct_on_remaining` within 0.01 of 250
3. `result.summary` contains "not possible"

### Fixture D — Weighted course, achievable

**Course mock**: `apply_assignment_group_weights: true`, `grading_standard_id: null`

**Groups**:
- Homework (weight 30): A1 (100 pts, score 80), A2 (100 pts, missing)
- Exams (weight 70): A3 (100 pts, score 85), A4 (100 pts, missing)

**Call**: `target_percentage: 90`

**Expected math**:
- A = (30/100 × 80/200) + (70/100 × 85/200) = 0.12 + 0.2975 = 0.4175
- B = (30/100 × 100/200) + (70/100 × 100/200) = 0.15 + 0.35 = 0.50
- x = (0.90 − 0.4175) / 0.50 = 0.965 = 96.5%

**Assertions**:
1. `result.projection.feasibility === 'achievable'`
2. `result.projection.minimum_pct_on_remaining` within 0.01 of 96.5
3. `result.current_grade.percentage` within 0.01 of 83.5 (computeOverall current-mode: Homework earned=80/possible=100, Exams earned=85/possible=100 → weighted = ((30×0.80)+(70×0.85))/100×100 = 83.5%)
4. `result.projection.groups.length === 2`
5. Each group entry has correct `remaining_points_possible === 100`

### Fixture E — Target letter grade (resolved correctly)

**Course mock**: `apply_assignment_group_weights: false`, `grading_standard_id: 42`

**Grading standard mock** (id 42): `[{name:'A', value:0.90}, {name:'B', value:0.80}, {name:'C', value:0.70}, {name:'F', value:0.0}]`

**Group**: A1 (100 pts, score 80), A2 (100 pts, missing)

**Call**: `target_letter: 'B'`

**Expected**: target resolves to 80%; E=80, P_total=200, P_remaining=100; x = (160−80)/100 = 80%

**Assertions**:
1. `result.target.percentage === 80`
2. `result.target.requested === 'B'`
3. `result.target.letter === 'B'` (mapped back via scheme)
4. `result.projection.minimum_pct_on_remaining` within 0.01 of 80
5. `result.projection.feasibility === 'achievable'`

### Fixture F — Letter target, no grading scheme

**Course mock**: `grading_standard_id: null`

**Call**: `target_letter: 'A'`

**Assertion**: Response has `isError: true`; message contains "no grading standard configured"

### Fixture G — Letter target, letter not in scheme

**Grading standard**: only `[{name:'A', value:0.9}, {name:'F', value:0.0}]`

**Call**: `target_letter: 'B'`

**Assertions**:
1. Response has `isError: true`
2. Message contains "Letter grade 'B' is not in the course grading scheme"
3. Message contains valid-letters list (e.g. "A, F")

### Fixture H — Drop-lowest interaction (dropped item excluded from locked-in and remaining)

**Course mock**: `apply_assignment_group_weights: false`

**Group with `drop_lowest: 1`**:
- A1 (50 pts, score 10) — expected dropped (lowest ratio: 20%)
- A2 (50 pts, score 40) — retained
- A3 (50 pts, missing)

**Call**: `target_percentage: 80`

**Expected**: A1 dropped by current-mode drop rules; retained graded = A2 only; remaining = A3 only
- E=40, P_total=100, P_remaining=50; x = (80−40)/50 = 80%

**Assertions**:
1. `result.projection.locked_in.earned === 40` (A1 excluded)
2. `result.projection.locked_in.possible === 50` (just A2)
3. `result.projection.remaining_points_possible === 50` (just A3)
4. `result.projection.minimum_pct_on_remaining` within 0.01 of 80
5. `result.caveats` contains at least one string mentioning "drop rules"

### Fixture I — No remaining work, all graded

**Course mock**: `apply_assignment_group_weights: false`

**Two assignments**: A1 (100 pts, score 95), A2 (100 pts, score 90). No ungraded.

**Call**: `target_percentage: 80`

**Assertions**:
1. `result.projection.minimum_pct_on_remaining === null`
2. `result.projection.feasibility === 'already_secured'`
3. `result.projection.remaining_points_possible === 0`
4. `result.current_grade.percentage` within 0.01 of 92.5

### Fixture J — No remaining work, impossible

**Two assignments**: A1 (100 pts, score 50), A2 (100 pts, score 60). No ungraded.

**Call**: `target_percentage: 90`

**Assertions**:
1. `result.projection.minimum_pct_on_remaining === null`
2. `result.projection.feasibility === 'impossible'`

### Fixture K — FERPA pseudonymization

**With CANVAS_PSEUDONYMIZE_STUDENTS=true, `student_id: 1234`**:
- `canvas.users.get(1234)` → `{ id: 1234, name: 'Alice Student', ... }`
- Pseudonymizer maps user 1234 → `'Student 0'`

**Assertions**:
1. `result.student.name === 'Student 0'`
2. `result.student.id === 1234` (pseudonymizer does not change the numeric id)

### Fixture L — Weighted course, group with no assignments (inactive group excluded)

**Course mock**: `apply_assignment_group_weights: true`

**Groups**:
- Exams (weight 70): A1 (100 pts, score 80), A2 (100 pts, missing)
- Extra Credit (weight 10): no assignments (P_g_total = 0; inactive)

**Call**: `target_percentage: 90`

**Expected**: Extra Credit excluded from `active_weight_sum`; `active_weight_sum = 70`
- A = (70/70 × 80/200) = 0.40
- B = (70/70 × 100/200) = 0.50
- x = (0.90 − 0.40) / 0.50 = 1.0 = 100%

**Assertions**:
1. `result.projection.minimum_pct_on_remaining` within 0.01 of 100
2. `result.projection.feasibility === 'achievable'`
3. No caveat about "no assignment groups" (the Extra Credit group is simply inactive, not all groups)

---

## Tool description (MCP `tool.description`)

```
Projects the minimum score needed on remaining assignments to reach a target course grade.

Given a target (as a percentage, e.g. 90, or a letter grade, e.g. "A") and the student's
current scores, computes the minimum uniform percentage that must be earned on all remaining
(not yet graded) assignments for the overall course grade to reach the target. Accounts for
assignment-group weights, drop_lowest / drop_highest / never_drop rules, and the course
grading scheme (for letter-grade targets and output letter mapping).

Returns:
- minimum_pct_on_remaining: the uniform percentage needed on all remaining items.
- feasibility: 'achievable' | 'already_secured' | 'impossible'.
- Per-group breakdown of locked-in scores and remaining assignments.
- A plain-language summary.

Limitations:
- Uses a uniform-x model: the same percentage is assumed for every remaining item. This is
  the natural interpretation of "minimum average needed." Per-item optimization is not supported.
- Drop rules are frozen at their current state (based on already-graded scores); which items
  are dropped may shift as remaining assignments are graded.
- Late-submission penalties are not factored in.
- V1 computes one student per call. Omit student_id to compute for the authenticated user.
  When CANVAS_PSEUDONYMIZE_STUDENTS is enabled, resolve the pseudonym first via resolve_pseudonym.
```

---

## File changes summary

| File | Change |
|------|--------|
| `src/tools/grade-engine.ts` | **New** — Extracted grade-computation helpers and types from `grade-explanation.ts`: `computeGroupGrade`, `computeOverall`, `mapLetter`, `resolveGradingScheme`, drop-algorithm helpers (`applyDrop`, `greedyDrop`, `combinations`, `binomial`), classification helpers (`classify`, `isCountable`, `normalizePoints`, `retainedFraction`, `sortRatio`, `percentageOf`), shared constants (`MAX_DROP_COMBINATIONS`, `RECONCILIATION_TOLERANCE`, `CURVE_CAVEAT_THRESHOLD`), and types (`GradeItem`, `GroupModeResult`, `Mode`, `DropReason`, `DropStrategy`) |
| `src/tools/grade-explanation.ts` | **Modify** — Replace all locally-defined engine functions/types/constants with imports from `./grade-engine`; no behavior change; all existing tests remain green |
| `src/tools/grade-projection.ts` | **New** — `gradeProjectionTools(canvas, pseudonymizer?)` exporting the `project_grade` ToolDefinition; imports grade engine from `./grade-engine` |
| `src/tools/catalog.ts` | **Modify** — Import `gradeProjectionTools`; add `grade_projection` domain entry with `defaultPrimaryAudience: 'shared'` after the `grading_policy` entry |
| `src/pseudonym/coverage.ts` | **Modify** — Add `'project_grade'` to `PSEUDONYMIZER_WRAPPED_TOOLS` |
| `tests/grade-projection.test.ts` | **New** — Fixtures A–L with mocked Canvas responses |
| `tests/pseudonym/coverage.test.ts` | **Modify** — Add `'project_grade'` to `EXPECTED_PII_BEARING_TOOLS` set (must stay in sync with `PSEUDONYMIZER_WRAPPED_TOOLS`; CI fails if either is updated without the other) |

**7 files total. No new Canvas module. No new package dependencies.**

All Canvas calls in `project_grade` use existing `CanvasClient` facade methods. The `src/canvas/` layer is untouched.

If `pnpm generate:manifests` exists as a script in `package.json`, it must be run after registration to update manifest counts and ensure discovery/registry tests pass (per acceptance criteria in issue #216).

---

## Open questions for CTO review

None — all design unknowns are retired above. The spec is implementation-ready.
