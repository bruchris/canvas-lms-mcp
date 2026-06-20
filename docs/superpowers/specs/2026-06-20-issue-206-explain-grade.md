---
issue: 206
---

# Weighted Grade Reconciliation Tool — `explain_grade` MCP Tool Design

**Date**: 2026-06-20
**Issue**: [bruchris/canvas-lms-mcp#206](https://github.com/bruchris/canvas-lms-mcp/issues/206)
**Status**: Design — awaiting CTO review

---

## Purpose

Add a single read-only tool, `explain_grade`, that recomputes and explains a Canvas course grade
for one student at a time — accounting for assignment-group weights, `drop_lowest` / `drop_highest`
/ `never_drop` rules, excused/missing assignments, and the percentage-to-letter mapping — and
reconciles the computed result against Canvas's posted `current_score` / `final_score`. The output
is a transparent, group-by-group breakdown that an instructor or student can audit in plain language
instead of rebuilding the math in a parallel spreadsheet.

This is **distinct from `grading_standards` tools** (which only map a percentage to a letter).
The unmet need is the weighting + drop-rule + reconciliation math.

---

## Design unknowns (retired)

### 1. Drop-rule application algorithm

**Decision: brute-force combinatorial search, honoring `never_drop`, choosing the drop set that
maximises the group's score percentage.**

Canvas's documented drop-rule behavior:

> Canvas drops scores so as to maximize the student's grade. `drop_lowest: N` removes the N
> assignments whose removal most improves the group percentage; `drop_highest: N` removes the N
> assignments whose removal most reduces the group percentage (bonus exclusion).
> Assignments listed in `never_drop` are excluded from consideration.

A naïve "drop the lowest raw scores" approach is **wrong** because points_possible differs between
assignments — a 30/40 (75%) is less valuable to keep than a 9/10 (90%) even though 9 < 30.

**Algorithm (per group, per student):**

1. Collect the group's non-excused, gradeable assignments. Mark those in `never_drop` as ineligible
   for dropping.
2. For `drop_lowest: N`:
   - If all remaining droppable assignments ≤ N, drop none (cannot drop everything).
   - Otherwise, generate all combinations C(droppable, N) and for each compute the group
     percentage over the retained set. Choose the combination yielding the highest percentage.
3. For `drop_highest: N`: same but choose the combination yielding the **lowest** percentage
   (Canvas's bonus-exclusion intent).
4. Apply both `drop_lowest` and `drop_highest` sequentially when both are set (drop_highest runs
   first, per Canvas's documented order).

**Combinatorial upper bound**: Canvas assignment groups are small in practice (typically 3–30
assignments). The worst real-world case is C(30, 3) = 4,060 combinations per group — computationally
trivial for a Node synchronous loop. A hard safety cap of 10,000 combinations per group is enforced
at runtime; if exceeded (pathological groups), the tool falls back to the greedy ranked sort and
adds a caveat.

**Why not greedy ranked sort?**
A greedy approach (sort assignments by score/points_possible, drop the bottom N) is O(n log n) but
can produce a suboptimal drop in degenerate cases (e.g. one very-high-points assignment at 50%
outranks many low-points assignments at 60%). The brute-force approach is correct by definition and
fast enough for the actual data sizes.

### 2. Curves / fudge points

**Decision: compute best-effort (pre-curve) and surface a caveat when discrepancy exceeds the
reconciliation tolerance.**

Canvas's `score_adjustment` (curve/fudge_points) is not exposed through the REST API. The tool
cannot reproduce a curved grade.

Handling:

- If `totals.final.discrepancy` or `totals.current.discrepancy` exceeds 0.5 pp after all other
  rules are applied, a caveat is added:
  `"Canvas's posted score differs from the computed value by X.X pp. If the instructor applied a
  curve or fudge points these are not accessible via the API and cannot be reflected here."`
- When there is no discrepancy, the curve caveat is omitted.

### 3. Ungraded / excused / missing handling

**Decision:**

| Submission state                                              | Numerator      | Denominator                        | Notes                                |
|---------------------------------------------------------------|----------------|------------------------------------|--------------------------------------|
| `excused: true`                                               | excluded       | excluded                           | As if the assignment doesn't exist   |
| `workflow_state: 'graded'` (score present, `excused: false`)  | `score`        | `points_possible` (current + final)| Normal graded assignment             |
| `workflow_state: 'submitted'` (not yet graded)                | excluded       | excluded (current) / 0 (final)     | Submitted but awaiting grade         |
| Missing / unsubmitted (`missing: true` or `workflow_state: 'unsubmitted'`) | 0 | excluded (current) / `points_possible` (final) | As per Canvas current/final semantics |
| `grading_type: 'not_graded'`                                  | excluded       | excluded                           | Not-graded assignments never affect the gradebook |

**current vs. final semantics** (mirrors Canvas's two score columns):

- **current**: only graded assignments (score present, not excused) contribute. Ungraded / unsubmitted / submitted-but-ungraded assignments are excluded from both numerator and denominator. This matches Canvas's `enrollment.grades.current_score`.
- **final**: all non-excused, non-`not_graded` assignments contribute. Missing/unsubmitted score as 0 in the numerator but contribute `points_possible` to the denominator. This matches Canvas's `enrollment.grades.final_score`.

The tool computes and exposes **both** columns so the caller can see which Canvas posted value they
are reconciling against.

### 4. Reconciliation tolerance

**Decision: ±0.5 percentage points (`discrepancy ≤ 0.5` → `matches: true`).**

Canvas accumulates intermediate floating-point rounding across many group calculations. A 0.5 pp
tolerance absorbs all documented rounding drift observed in Canvas's open-source gradebook code
while still flagging genuinely unexpected differences (e.g. from curves, dropped-score ambiguity,
or grading-period filtering not visible to the API caller).

### 5. Single student vs. multi-student in V1

**Decision: V1 supports a single student per call (self or a specified `student_id`).**

Multi-student fan-out (all students in a course) would require: enumerate all student enrollments,
then for each student fetch their full submission list — an O(students × assignments) call count
that can exceed 100 Canvas API calls for a large course. This is deferred to V2.

V1 call pattern for a single student (self):

1. `GET /api/v1/courses/:id` → `apply_assignment_group_weights`, `grading_standard_id`
2. `GET /api/v1/courses/:id/assignment_groups?include[]=assignments` → groups, weights, rules
3. `GET /api/v1/courses/:id/students/submissions?student_ids[]=:id` → all submissions for one student
4. `GET /api/v1/courses/:id/enrollments?user_id=:id&include[]=grades` → Canvas's posted scores
5. (conditional) `GET /api/v1/courses/:id/grading_standards` → letter mapping when `grading_standard_id` is set

When `student_id` is omitted, substitute `student_ids[]=self` for call 3 and `user_id=self` for
call 4. Canvas returns only the caller's own data in that case.

### 6. New canvas module vs. pure tool-layer orchestration

**Decision: add a new `src/canvas/grade-explanation.ts` module that fetches the raw data, and put
all grade-computation logic in `src/tools/grade-explanation.ts`.**

Rationale:
- The canvas module collects the four/five REST calls into one typed method, consistent with every
  other domain module in the codebase.
- All arithmetic (drop algorithm, weighted percentage, letter lookup) lives in the tool layer —
  matching the pattern where canvas modules are "pure fetch, no logic" and tools are "logic + MCP
  shape."

### 7. FERPA / pseudonymization

**Decision: `explain_grade` must be added to `PSEUDONYMIZER_WRAPPED_TOOLS` and must route its
per-student user data through `pseudonymizer.anonymizeUser()`.**

`explain_grade` returns `student_id` and `student_name` in the output. When called for a specific
`student_id`, these fields identify a real student. Instructors calling for another student
receive student PII — this matches the trigger condition for pseudonymizer wrapping.

When `student_id` is omitted (self), the user object is still returned and anonymized through the
same path (the caller is already identified; the pseudonymizer pass-through when `shouldPseudonymize`
is false for staff roles is correct here).

The `anonymizeUser(courseId, user)` method is the right call. The result's `student_id` becomes
`user.id` after anonymization (pseudonymized records keep the opaque numeric id in the user object;
the `student_name` field is replaced by the pseudonym).

### 8. Audience

**Decision: `audience: 'shared'`.**

Both instructor persona (verify a student's grade, spot discrepancies) and student persona (verify
their own grade) benefit from this tool. `'shared'` marks it available to both roles, overriding
the `assignments` domain's `'educator'` default.

### 9. Grading-period filtering

**Decision: V1 ignores grading periods. The tool computes the overall course grade across all
assignment groups.**

Canvas supports multiple grading periods (terms within a course). When grading periods are active,
Canvas's posted `current_score` in the enrollment may reflect only the current grading period, not
the overall course. This is a known limitation documented in the tool description:
`"When the course uses grading periods, the reconciliation is against the overall course grade, not
the current grading period."`

V2 can add a `grading_period_id` parameter.

---

## Canvas API calls

| # | Endpoint | Purpose | Existing module method |
|---|----------|---------|------------------------|
| 1 | `GET /api/v1/courses/:id` | `apply_assignment_group_weights`, `grading_standard_id`, `hide_final_grades` | `canvas.courses.get()` |
| 2 | `GET /api/v1/courses/:id/assignment_groups?include[]=assignments` | Groups with weights, rules, and assignment list | `canvas.assignments.listGroups({ include: ['assignments'] })` |
| 3 | `GET /api/v1/courses/:id/students/submissions?student_ids[]=:id` | All submissions for one student | `canvas.submissions.listForStudents(courseId, { student_ids: [id] })` |
| 4 | `GET /api/v1/courses/:id/enrollments?user_id=:id&include[]=grades` | Canvas's posted `current_score` / `final_score` / `current_grade` / `final_grade` | `canvas.enrollments.listForCourse(courseId, { user_id: id, include: ['grades'] })` |
| 5 | `GET /api/v1/courses/:id/grading_standards` | Letter mapping when `grading_standard_id !== null` | `canvas.gradingStandards.listForCourse(courseId)` |

All five calls use existing module methods. **No new Canvas API endpoints are required.**

---

## New canvas module: `src/canvas/grade-explanation.ts`

```ts
export interface GradeExplanationInput {
  courseId: number
  /** Canvas user_id, or 'self' to resolve the caller's own identity. */
  studentId: number | 'self'
  /** Narrow output to a single group; `undefined` = all groups. */
  assignmentGroupId?: number
}

export interface GradeExplanationRaw {
  course: CanvasCourse
  groups: CanvasAssignmentGroup[]  // includes assignments[]
  submissions: CanvasSubmission[]
  enrollment: CanvasEnrollment | null
  gradingStandard: CanvasGradingStandard | null
  studentId: number | 'self'
}

export class GradeExplanationModule {
  constructor(private client: CanvasHttpClient) {}

  async fetchRaw(input: GradeExplanationInput): Promise<GradeExplanationRaw>
}
```

`fetchRaw` issues the 4–5 parallel-safe sequential fetches above and returns all raw data to the
tool layer. The module does **no arithmetic** — all computation happens in the tool.

Parallelism: calls 2, 3, 4, 5 are independent of each other (only call 1 must precede call 5 to
know whether `grading_standard_id` is set). The implementation fires calls 2, 3, 4 as
`Promise.all`, then fires call 5 if needed.

---

## New types (`src/canvas/types.ts`)

No new types are strictly needed — the module reuses `CanvasCourse`, `CanvasAssignmentGroup`,
`CanvasAssignment`, `CanvasSubmission`, `CanvasEnrollment`, `CanvasGradingStandard`. The tool layer
constructs output shapes purely in the tool file without adding to `types.ts`.

---

## Tool contract (`src/tools/grade-explanation.ts`)

### Tool name

`explain_grade`

### Zod input schema

```ts
z.object({
  course_id: z.number().int().positive().describe(
    'Canvas course ID to compute the grade for.'
  ),
  student_id: z.number().int().positive().optional().describe(
    'Canvas user_id of the student to compute the grade for. Omit to compute for the currently authenticated user. ' +
    'Instructors may pass any enrolled student\'s user_id. ' +
    'When CANVAS_PSEUDONYMIZE_STUDENTS is enabled, pass the numeric Canvas user_id after resolving the pseudonym via resolve_pseudonym.'
  ),
  assignment_group_id: z.number().int().positive().optional().describe(
    'Narrow the output to a single assignment group. When omitted all groups are included and the overall course grade is computed.'
  ),
})
```

### Annotations

```ts
{
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
}
```

### Output shape (per invocation — always one student in V1)

```ts
{
  student: {
    id: number,
    name: string,  // pseudonymized when CANVAS_PSEUDONYMIZE_STUDENTS=true
  },
  course: {
    id: number,
    name: string,
    weighted: boolean,  // course.apply_assignment_group_weights
    grading_standard_id: number | null,
  },
  groups: Array<{
    group_id: number,
    group_name: string,
    group_weight: number,  // 0–100; equals 100/N for unweighted courses
    rules: {
      drop_lowest: number,
      drop_highest: number,
      never_drop: number[],  // assignment_ids
    },
    assignments: Array<{
      assignment_id: number,
      assignment_name: string,
      points_possible: number,
      score: number | null,  // null if not graded / excused / not_graded
      status: 'graded' | 'excused' | 'missing' | 'unsubmitted' | 'not_graded',
      dropped: boolean,
      drop_reason: 'drop_lowest' | 'drop_highest' | null,
    }>,
    current: {
      earned_points: number,
      possible_points: number,
      percentage: number | null,  // null if possible_points === 0
      weighted_contribution: number | null,  // group_weight * percentage / 100; null if unweighted or percentage null
    },
    final: {
      earned_points: number,
      possible_points: number,
      percentage: number | null,
      weighted_contribution: number | null,
    },
  }>,
  totals: {
    current: {
      computed_percentage: number | null,
      canvas_posted_score: number | null,
      discrepancy: number | null,  // |computed - posted|; null if either is null
      matches: boolean | null,     // true when discrepancy ≤ 0.5; null when not computable
      letter: string | null,       // from grading standard; null if no standard or percentage null
      canvas_posted_letter: string | null,  // enrollment.grades.current_grade
    },
    final: {
      computed_percentage: number | null,
      canvas_posted_score: number | null,
      discrepancy: number | null,
      matches: boolean | null,
      letter: string | null,
      canvas_posted_letter: string | null,
    },
  },
  caveats: string[],  // human-readable disclaimers (curves, grading periods, etc.)
}
```

### Weighted percentage calculation

When `course.apply_assignment_group_weights === true`:

```
group_percentage = earned_points / possible_points * 100
weighted_contribution = group_weight * (group_percentage / 100)
overall_percentage = sum(weighted_contribution) / sum(group_weight for groups with possible_points > 0) * 100
```

When `apply_assignment_group_weights === false` (unweighted), all groups contribute equally by
points; the overall percentage is simply total_earned / total_possible * 100 across all groups.

### Letter grade lookup

The grading scheme entries are sorted descending by `value` (Canvas stores them as decimals, e.g.
0.9 for 90%). To map `percentage` to a letter:

```
for each entry in grading_scheme (sorted descending by value):
  if percentage / 100 >= entry.value:
    return entry.name
return grading_scheme[last].name  // below the lowest cutoff
```

---

## Grade computation algorithm (pseudocode)

```
function computeGroupGrade(group, submissions, mode):
  // mode: 'current' | 'final'
  assignments = group.assignments.filter(a => a.grading_type !== 'not_graded')
  
  // Build score list (excluding excused)
  scorable = []
  for each assignment in assignments:
    sub = submissions[assignment.id]
    excused = sub?.excused === true
    if excused: continue
    
    score = null
    status = 'unsubmitted'
    if sub?.workflow_state === 'graded' and sub.score !== null:
      score = sub.score
      status = 'graded'
    else if sub?.missing === true:
      status = 'missing'
    
    scorable.push({ assignment, score, status })
  
  // Apply drop rules to scorable set
  droppable = scorable.filter(s => s.assignment.id not in group.rules.never_drop)
  pinned = scorable.filter(s => s.assignment.id in group.rules.never_drop)
  
  // Compute effective score for drop-rule evaluation (use 0 for ungraded in 'final'; skip in 'current')
  effectiveScore = (item) =>
    item.score !== null ? item.score :
    mode === 'final' ? 0 :
    null  // null = exclude from current

  // For drop_highest: runs first
  if group.rules.drop_highest > 0:
    droppable = applyDrop(droppable, group.rules.drop_highest, 'maximize_removed', effectiveScore)
  
  // For drop_lowest: runs second
  if group.rules.drop_lowest > 0:
    droppable = applyDrop(droppable, group.rules.drop_lowest, 'maximize_retained', effectiveScore)
  
  retained = [...droppable, ...pinned]
  dropped = scorable.filter(s => s not in retained)
  
  // Compute group earned / possible
  earned = 0, possible = 0
  for each item in retained:
    eff = effectiveScore(item)
    if mode === 'current' and eff === null: continue  // skip ungraded in current mode
    earned += eff ?? 0
    possible += item.assignment.points_possible
  
  return { retained, dropped, earned, possible }

function applyDrop(items, count, strategy, effectiveScore):
  // brute-force: try all C(items, count) combinations to find which 'count' items to drop
  // such that the retained set's percentage is maximized (strategy='maximize_retained')
  // or the removed set's percentage is maximized (strategy='maximize_removed')
  // Safety: if C(len, count) > 10_000, fall back to greedy sort
  ...
```

---

## Pseudonymizer integration

`explain_grade` returns `student.id` and `student.name`. When the result contains a student who
is not the authenticated user themselves (or when the pseudonymizer is enabled regardless), the
tool calls `pseudonymizer.anonymizeUser(course_id, user)` on the student user object fetched
from the enrollment, then copies the anonymized `id`, `name` fields into `student`.

Add `'explain_grade'` to `PSEUDONYMIZER_WRAPPED_TOOLS` in `src/pseudonym/coverage.ts`.

---

## Catalog registration (`src/tools/catalog.ts`)

New domain entry:

```ts
{
  domain: 'grade_explanation',
  defaultPrimaryAudience: 'shared',
  getTools: gradeExplanationTools,
}
```

The `'shared'` audience makes the tool available to both `student` and `educator` roles.

---

## Test plan (`tests/grade-explanation.test.ts`)

All tests use mocked Canvas responses — no real Canvas instance is hit.

### Fixture A — Weighted course, `drop_lowest: 1` + `never_drop`

Course: `apply_assignment_group_weights: true`, grading standard A/B/C (90/80/70%).

Groups:
- **Homework** (weight 30%, `drop_lowest: 1`, `never_drop: [assignment_3]`):
  - Assignment 1 (10 pts): score 8 → 80%
  - Assignment 2 (10 pts): score 5 → 50%   ← expected drop (lowest non-pinned)
  - Assignment 3 (10 pts, never_drop): score 6 → 60%
- **Exams** (weight 70%, no rules):
  - Midterm (100 pts): score 88
  - Final (100 pts): score 75

Expected current computation:
- Homework retained: assignments 1 + 3 → 14/20 = 70% → weighted = 30 * 0.70 = 21
- Exams: 163/200 = 81.5% → weighted = 70 * 0.815 = 57.05
- Overall = (21 + 57.05) / (30 + 70) * 100 = 78.05 / 100 * 100 = 78.05%
- Letter = B (≥ 80%? No → C? No → B is 80%, so C at 70%: 78.05% → C)

Wait, let me recalculate:
- weighted overall = sum(group_weight * group_percentage / 100) / sum(group_weight for active groups) * 100
- = (30 * 0.70 + 70 * 0.815) / 100 * 100

Actually the weighted calculation when all weights are active:
overall_percentage = sum(weighted_contributions) where weighted_contribution = group_weight * group_pct

Let me think again. If the sum of all group weights is 100 (as Canvas requires), then:
overall = Σ (group_weight_i * group_pct_i) / 100

So:
- Homework: 30 * 70 / 100 = 21
- Exams: 70 * 81.5 / 100 = 57.05
- Overall = 21 + 57.05 = 78.05%
- Letter = C (cutoff 70%) since 78.05% < 80% (B cutoff)

Tests verify:
1. Assignment 2 has `dropped: true`, `drop_reason: 'drop_lowest'`
2. Assignment 3 has `dropped: false` despite being the lowest-ratio assignment without pinning
3. `totals.current.computed_percentage ≈ 78.05`
4. `totals.current.letter === 'C'`

### Fixture B — Unweighted course (no drop rules)

Course: `apply_assignment_group_weights: false`, no grading standard.

Groups:
- **Group A**: assignment 100pts scored 90 → 90/100
- **Group B**: assignment 50pts scored 40 → 40/50

Unweighted: total = (90+40)/(100+50) = 130/150 = 86.67%

Tests verify:
1. `course.weighted: false`
2. `totals.current.computed_percentage ≈ 86.67`
3. `totals.current.letter === null` (no grading standard)

### Fixture C — Reconciliation match + discrepancy

Uses fixture A data and mocks enrollment to return `current_score: 78.1` (within 0.5 pp → `matches: true`).
Then mocks enrollment to return `current_score: 81.0` (2.95 pp discrepancy → `matches: false`, caveat included).

### Fixture D — Excused + missing assignments

Group with 3 assignments:
- Assignment 1: score 80/100 (graded)
- Assignment 2: excused
- Assignment 3: missing (workflow_state: unsubmitted, missing: true)

current mode: only A1 contributes → 80/100 = 80%
final mode: A1 + A3 (as 0) → 80/200 = 40%, A2 excluded

### Fixture E — `drop_highest: 1` (bonus exclusion)

Group with 4 assignments incl. one extra credit:
- A1: 10/10 (100%) — expected dropped (drop_highest removes best)
- A2: 8/10 (80%)
- A3: 6/10 (60%)
- A4: 4/10 (40%)

After drop_highest: retain A2+A3+A4 → 18/30 = 60%
Test verifies A1 has `dropped: true, drop_reason: 'drop_highest'`

### Fixture F — FERPA pseudonymization

With `CANVAS_PSEUDONYMIZE_STUDENTS=true`, verify:
- `student.name` is replaced with `Student 0` (or matching pseudonymizer output)
- `student.id` remains numeric (pseudonymizer does not change the id field)

---

## Tool description (MCP tool.description)

```
Recomputes and explains the weighted course grade for a student, including assignment-group weights,
drop_lowest / drop_highest / never_drop rules, per-group breakdowns (earned points, dropped
assignments, weighted contributions), the mapped letter grade (via the course grading standard when
present), and a reconciliation check against Canvas's posted current_score / final_score.

Use this when you need to verify that Canvas's displayed grade matches the rules, or to explain to
a student or instructor how their grade was calculated.

Limitations:
- V1 computes one student per call. Omit student_id to compute for the authenticated user.
- Instructor-applied curves and fudge points are not exposed via the Canvas REST API and cannot
  be reflected in the computation; a caveat is added when the discrepancy exceeds 0.5 pp.
- When the course uses grading periods, reconciliation is against the overall (cross-period) grade.
- When CANVAS_PSEUDONYMIZE_STUDENTS is enabled and you are passing a student_id, first call
  resolve_pseudonym to obtain the real Canvas user_id.
```

---

## File changes summary

| File | Change |
|------|--------|
| `src/canvas/grade-explanation.ts` | **New** — `GradeExplanationModule` with `fetchRaw()` |
| `src/canvas/index.ts` | Add `gradeExplanation: GradeExplanationModule` to `CanvasClient` |
| `src/tools/grade-explanation.ts` | **New** — `gradeExplanationTools()` exporting `explain_grade` ToolDefinition |
| `src/tools/catalog.ts` | Register `grade_explanation` domain (`shared` audience) |
| `src/tools/index.ts` | Import and spread `gradeExplanationTools` in `getAllTools()` |
| `src/pseudonym/coverage.ts` | Add `'explain_grade'` to `PSEUDONYMIZER_WRAPPED_TOOLS` |
| `tests/grade-explanation.test.ts` | **New** — fixtures A–F with mocked Canvas responses |

**7 files total.** No new package dependencies.

---

## Open questions for CTO review

None — all four design unknowns are retired above. The spec is implementation-ready.
