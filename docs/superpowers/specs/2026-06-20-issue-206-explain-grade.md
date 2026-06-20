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
maximises the retained-set percentage for `drop_lowest`, and minimises the retained-set percentage
for `drop_highest`.**

Canvas's documented drop-rule behavior:

> Canvas drops scores so as to maximize the student's grade. `drop_lowest: N` removes the N
> assignments whose removal most improves the group percentage; `drop_highest: N` removes the N
> assignments whose removal most reduces the group percentage (bonus exclusion).
> Assignments listed in `never_drop` are excluded from consideration.

A naïve "drop the lowest raw scores" approach is **wrong** because points_possible differs between
assignments — a 30/40 (75%) is less valuable to keep than a 9/10 (90%) even though 9 < 30.

**Algorithm (per group, per student):**

1. Build the set of non-excused, non-`not_graded` assignments with their effective scores.
   Mark those in `never_drop` as ineligible for dropping (`pinned`). The remainder are `droppable`.
2. Apply `drop_highest: N` first (Canvas documented order):
   - If `droppable.length ≤ N`, skip (cannot drop everything).
   - If `droppable` is empty (all assignments are pinned), skip.
   - Otherwise: generate all `C(droppable.length, N)` combinations of items to remove.
     For each combination, compute the **retained-set percentage** over the items not in that
     combination. Choose the combination whose retained-set percentage is **minimised** (i.e.
     dropping these items hurts the grade the most — the "bonus exclusion" intent). Reassign
     `droppable` to the retained items; the chosen N items are marked `drop_highest` dropped.
3. Apply `drop_lowest: N` second, on the updated `droppable`:
   - If `droppable.length ≤ N`, skip.
   - If `droppable` is empty, skip.
   - Otherwise: generate all `C(droppable.length, N)` combinations of items to remove.
     For each combination, compute the **retained-set percentage**. Choose the combination
     whose retained-set percentage is **maximised** (i.e. dropping these items helps the grade
     the most). Reassign `droppable` to the retained items; the chosen N items are marked
     `drop_lowest` dropped.
4. Final retained set = updated `droppable` + `pinned`.

**Retained-set percentage inside `applyDrop`:** When computing the candidate percentage over a
retained set, use the same current/final semantics as the outer grade computation:
- In **current mode**: exclude items whose effective score is `null` (ungraded/unsubmitted) from
  both numerator and denominator. A combination consisting entirely of null-score items yields
  `null` percentage — treated as 0 for comparison (worst outcome).
- In **final mode**: items with `null` effective score contribute 0 to numerator and
  `points_possible` to denominator.

**Combinatorial upper bound**: Canvas assignment groups are small in practice (typically 3–30
assignments). The worst real-world case is C(30, 3) = 4,060 combinations per group —
computationally trivial for a Node synchronous loop. A hard safety cap of **10,000 combinations
per drop call** is enforced at runtime; if exceeded (pathological groups), the tool falls back to a
greedy ranked sort (sort by score/points_possible, drop the worst/best N) and appends a caveat:
`"Drop-rule optimisation used a greedy approximation for group '<name>' due to the large number of
assignments. Result may differ slightly from Canvas."` The combination generator is written
in-tree (no new package dependencies).

**Why not greedy ranked sort?**
A greedy approach (sort assignments by score/points_possible) can produce a suboptimal drop in
degenerate cases (e.g. one very-high-points assignment at 50% vs. many low-points at 60%).
The brute-force approach is correct by definition and fast enough for the actual data sizes.

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

### 3. Ungraded / excused / missing / pending-review handling

**Decision:**

| Submission state | `current` mode (numerator / denominator) | `final` mode (numerator / denominator) | Output `status` |
|------------------|------------------------------------------|-----------------------------------------|-----------------|
| `excused: true` | excluded / excluded | excluded / excluded | `'excused'` |
| `workflow_state: 'graded'` (score present, not excused) | score / points_possible | score / points_possible | `'graded'` |
| `workflow_state: 'submitted'` (not yet graded, not excused) | excluded / excluded | 0 / points_possible | `'submitted'` |
| `workflow_state: 'pending_review'` (quiz awaiting manual grade) | excluded / excluded | 0 / points_possible | `'submitted'` (same bucket) |
| `missing: true` OR `workflow_state: 'unsubmitted'` (not submitted, not excused) | excluded / excluded | 0 / points_possible | `'missing'` |
| `grading_type: 'not_graded'` | excluded / excluded | excluded / excluded | `'not_graded'` |

**current vs. final semantics** (mirrors Canvas's two score columns):

- **current**: only graded assignments (score present, not excused, not `not_graded`) contribute.
  Ungraded/unsubmitted/pending assignments are excluded from both numerator and denominator.
  This matches Canvas's `enrollment.grades.current_score`.
- **final**: all non-excused, non-`not_graded` assignments contribute. Ungraded/unsubmitted/
  submitted-but-pending score as 0 in the numerator and contribute `points_possible` to the
  denominator. This matches Canvas's `enrollment.grades.final_score`.

The tool computes and exposes **both** columns so the caller can see which Canvas posted value
they are reconciling against.

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

V1 call pattern for a single student (5–6 calls):

1. `GET /api/v1/courses/:id` → `apply_assignment_group_weights`, `grading_standard_id`, `account_id`
2. `GET /api/v1/courses/:id/assignment_groups?include[]=assignments` → groups, weights, rules
3. Submissions — **branched on `studentId`**:
   - `studentId === 'self'`: call `canvas.submissions.listMy(courseId)`
     (uses `student_ids[]=self` internally)
   - `studentId` is numeric: call `canvas.submissions.listForStudents(courseId, { student_ids: [studentId] })`
   Note: `'self'` is not a valid value in the existing `ListStudentSubmissionsOptions.student_ids`
   type union (`ReadonlyArray<number | 'all'>`), hence the branch.
4. Enrollment with grades — `GET /api/v1/courses/:id/enrollments?user_id=<id>&include[]=grades`
   - `studentId === 'self'`: pass `user_id: 'self'`
   - `studentId` is numeric: pass `user_id: studentId`
   - If the returned array is empty (student not enrolled), set `enrollment: null`; add caveat
     `"No student enrollment found for this course — Canvas posted scores are unavailable."`;
     continue computation (all `canvas_posted_*` fields will be null).
5. Student user object (for pseudonymizer and `student.name`) — **branched**:
   - `studentId === 'self'`: `GET /api/v1/users/self` → `canvas.users.getSelf()` (or equivalent)
   - `studentId` is numeric: `GET /api/v1/users/:id` → `canvas.users.get(studentId)`
6. (Conditional) Grading standard: only when `course.grading_standard_id !== null`:
   - First fetch `canvas.gradingStandards.listForCourse(courseId)` and filter for
     `standard.id === course.grading_standard_id`.
   - If not found in the course-level list (the standard may be account-scoped), fetch
     `canvas.gradingStandards.listForAccount(course.account_id)` and filter again.
   - If still not found, `gradingStandard: null`; add caveat
     `"The course's grading standard (id: X) could not be retrieved — letter grades are unavailable."`.

### 6. No new canvas module — tool-layer orchestration

**Decision: do NOT create a new `src/canvas/grade-explanation.ts` module. All five/six Canvas
calls are issued directly from the tool handler using existing `CanvasClient` facade methods.**

Rationale:
- Every new canvas module receives `CanvasHttpClient` and calls `client.request()` /
  `client.paginate()` directly. A "grade-explanation module" would only compose already-wrapped
  methods from *other* modules — violating the "no logic in canvas layer" principle and creating
  a confusing dependency between canvas-layer classes.
- Tools already receive `CanvasClient` (the composed facade). Issuing the five/six calls from
  the tool handler directly is idiomatic and keeps grade-computation logic and data-fetching
  co-located.
- File count drops from 7 to 5 (no new canvas module, no new `index.ts` canvas edit).

### 7. FERPA / pseudonymization

**Decision: `explain_grade` must be added to `PSEUDONYMIZER_WRAPPED_TOOLS` and must route its
per-student user data through `pseudonymizer.anonymizeUser()`.**

`explain_grade` returns `student.id` and `student.name` in the output. These are sourced from the
`CanvasUser` object fetched in call 5. When called for a specific `student_id`, these fields
identify a real student — this matches the trigger condition for pseudonymizer wrapping.

The tool calls `pseudonymizer.anonymizeUser(courseId, user)` on the fetched `CanvasUser`. The
anonymized user's `name` populates `student.name`; `user.id` (unchanged by pseudonymization)
populates `student.id`.

### 8. Audience

**Decision: `audience: 'shared'`.**

Both instructor persona (verify a student's grade, spot discrepancies) and student persona (verify
their own grade) benefit from this tool. `'shared'` overrides the `assignments` domain's
`'educator'` default.

### 9. Grading-period filtering

**Decision: V1 ignores grading periods. The tool computes the overall course grade across all
assignment groups.**

Canvas supports multiple grading periods (terms within a course). When grading periods are active,
Canvas's posted `current_score` in the enrollment may reflect only the current grading period, not
the overall course. This is a known limitation documented in the tool description.

V2 can add a `grading_period_id` parameter.

---

## Canvas API calls

| # | Endpoint | Purpose | CanvasClient method |
|---|----------|---------|---------------------|
| 1 | `GET /api/v1/courses/:id` | `apply_assignment_group_weights`, `grading_standard_id`, `account_id` | `canvas.courses.get(courseId)` |
| 2 | `GET /api/v1/courses/:id/assignment_groups?include[]=assignments` | Groups with weights, rules, and assignment list | `canvas.assignments.listGroups(courseId, { include: ['assignments'] })` |
| 3a | `GET /api/v1/courses/:id/students/submissions?student_ids[]=self` | All submissions for authenticated user | `canvas.submissions.listMy(courseId)` |
| 3b | `GET /api/v1/courses/:id/students/submissions?student_ids[]=:id` | All submissions for a specified student | `canvas.submissions.listForStudents(courseId, { student_ids: [studentId] })` |
| 4 | `GET /api/v1/courses/:id/enrollments?user_id=:id&include[]=grades` | Canvas's posted `current_score` / `final_score` | `canvas.enrollments.listForCourse(courseId, { user_id: id, include: ['grades'] })` |
| 5 | `GET /api/v1/users/:id` (or `/users/self`) | Student name for output + pseudonymizer | `canvas.users.get(studentId)` or `canvas.users.getSelf()` |
| 6 | `GET /api/v1/courses/:id/grading_standards` (then account fallback) | Letter mapping when `grading_standard_id !== null` | `canvas.gradingStandards.listForCourse()` / `listForAccount()` |

Calls 2, 3, 4, 5 are independent of each other after call 1 resolves. Issue them as
`Promise.all([call2, call3, call4, call5])`, then issue call 6 if needed.

All calls use **existing** `CanvasClient` facade methods. No new Canvas endpoints are required.

---

## Tool contract (`src/tools/grade-explanation.ts`)

### Export signature

```ts
export function gradeExplanationTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[]
```

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

### Output shape

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
    group_weight: number,  // raw Canvas value (0–100); ignored in grade computation when course.weighted is false
    rules: {
      drop_lowest: number,    // 0 if not set
      drop_highest: number,   // 0 if not set
      never_drop: number[],   // assignment_ids; empty array if not set
    },
    assignments: Array<{
      assignment_id: number,
      assignment_name: string,
      points_possible: number,
      score: number | null,
      // 'graded'=has a score | 'submitted'=submitted or pending_review but not graded |
      // 'missing'=not submitted | 'excused' | 'not_graded'=grading_type:not_graded
      status: 'graded' | 'submitted' | 'missing' | 'excused' | 'not_graded',
      dropped: boolean,
      drop_reason: 'drop_lowest' | 'drop_highest' | null,
    }>,
    current: {
      earned_points: number,
      possible_points: number,
      percentage: number | null,           // null if possible_points === 0
      weighted_contribution: number | null, // group_weight * (percentage / 100); null when unweighted or percentage null
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
      discrepancy: number | null,             // |computed - posted|; null if either is null
      matches: boolean | null,               // true when discrepancy ≤ 0.5; null when not computable
      letter: string | null,                 // from grading standard; null if none or percentage null
      canvas_posted_letter: string | null,   // enrollment.grades.current_grade
    },
    final: {
      computed_percentage: number | null,
      canvas_posted_score: number | null,
      discrepancy: number | null,
      matches: boolean | null,
      letter: string | null,
      canvas_posted_letter: string | null,   // enrollment.grades.final_grade
    },
  },
  caveats: string[],
}
```

---

## Grade computation

### Weighted percentage

When `course.apply_assignment_group_weights === true`:

```
For each group:
  group_percentage = earned_points / possible_points * 100   (null if possible_points === 0)
  weighted_contribution = group_weight * (group_percentage / 100)

active_weight_sum = sum of group_weight for groups where possible_points > 0

If active_weight_sum === 0:
  overall_percentage = null

Else:
  overall_percentage = (sum of weighted_contribution for active groups) / active_weight_sum * 100
```

Note: `weighted_contribution` is on a 0–100 scale (group_weight × group_pct/100). Dividing by
`active_weight_sum` and multiplying by 100 rescales to an overall percentage. Example: two groups
with weight 30 and 70, group percentages 70% and 81.5%:
- contributions: 30 × 0.70 = 21, 70 × 0.815 = 57.05
- active_weight_sum = 100
- overall = (21 + 57.05) / 100 × 100 = 78.05%

When `apply_assignment_group_weights === false` (unweighted):
- `weighted_contribution` is `null` for all groups in the output.
- Overall = total_earned_points / total_possible_points × 100 (across all retained assignments in
  all groups, regardless of `group_weight`).
- `active_weight_sum` concept does not apply.

### Letter grade lookup

The grading scheme entries use **decimal fraction values** (e.g. `0.9` for 90%, `0.8` for 80%).
They are stored sorted descending by `value` in Canvas's API response.

```
To map `percentage` (0–100) to a letter:
  for each entry in grading_scheme (sorted descending by entry.value):
    if percentage / 100 >= entry.value:
      return entry.name
  return grading_scheme[last].name   // score below the lowest cutoff (fallthrough)
```

Example grading scheme: `[{name:'A', value:0.9}, {name:'B', value:0.8}, {name:'C', value:0.7}, {name:'F', value:0.0}]`

### Drop algorithm (pseudocode)

```ts
function computeGroupGrade(group, submissionsById, mode: 'current' | 'final'):
  assignments = group.assignments.filter(a => a.grading_type !== 'not_graded')

  // Classify each assignment
  items = []
  for a of assignments:
    sub = submissionsById[a.id]
    excused = sub?.excused === true
    if excused:
      items.push({ a, score: null, status: 'excused', pinned: false })
      continue
    if sub?.workflow_state === 'graded' && sub.score !== null:
      items.push({ a, score: sub.score, status: 'graded', pinned: group.rules.never_drop.includes(a.id) })
    else if sub?.workflow_state === 'submitted' || sub?.workflow_state === 'pending_review':
      items.push({ a, score: null, status: 'submitted', pinned: group.rules.never_drop.includes(a.id) })
    else:
      // missing / unsubmitted
      items.push({ a, score: null, status: 'missing', pinned: group.rules.never_drop.includes(a.id) })

  // Separate excused (already excluded) from droppable candidates
  excused_items = items.filter(i => i.status === 'excused')
  droppable = items.filter(i => i.status !== 'excused' && !i.pinned)
  pinned = items.filter(i => i.status !== 'excused' && i.pinned)

  // effective score for drop-algorithm comparisons
  effectiveScore = (item) =>
    item.score              // already a number, or null
    // In current mode, null means "excluded" and is treated as worst score for comparison
    // In final mode, null means 0

  // Apply drop_highest first (Canvas documented order)
  dropped_high = []
  if group.rules.drop_highest > 0 && droppable.length > group.rules.drop_highest:
    [droppable, dropped_high] = applyDrop(droppable, group.rules.drop_highest, 'minimize_retained', effectiveScore, mode)

  // Apply drop_lowest second
  dropped_low = []
  if group.rules.drop_lowest > 0 && droppable.length > group.rules.drop_lowest:
    [droppable, dropped_low] = applyDrop(droppable, group.rules.drop_lowest, 'maximize_retained', effectiveScore, mode)

  retained = [...droppable, ...pinned]

  // Annotate output assignments
  for item of dropped_high: item.dropped = true; item.drop_reason = 'drop_highest'
  for item of dropped_low:  item.dropped = true; item.drop_reason = 'drop_lowest'

  // Compute earned/possible for this mode
  earned = 0; possible = 0
  for item of retained:
    if item.status === 'excused' || item.status === 'not_graded': continue
    if mode === 'current' && item.score === null: continue  // exclude ungraded from current
    earned += item.score ?? 0
    possible += item.a.points_possible

  return { retained, excused_items, dropped_high, dropped_low, earned, possible }


// applyDrop returns [retained_items, dropped_items]
function applyDrop(items, count, strategy, effectiveScore, mode):
  // Guard: if droppable is empty or count >= len, skip
  if items.length === 0 || count >= items.length: return [items, []]

  // Candidate percentage of a retained set (items NOT dropped)
  function retainedPct(retained):
    e = 0; p = 0
    for item of retained:
      eff = effectiveScore(item)
      if mode === 'current' && eff === null: continue  // excluded from current
      e += eff ?? 0
      p += item.a.points_possible
    return p === 0 ? null : e / p

  // Generate all C(items.length, count) subsets to DROP
  dropped_combos = combinations(items, count)

  // Safety cap
  if dropped_combos.length > 10_000:
    // Greedy fallback — add caveat (see §1)
    return greedyDrop(items, count, strategy, effectiveScore, mode)

  best_retained = null
  best_pct = null

  for combo of dropped_combos:
    retained = items.filter(i => i not in combo)
    pct = retainedPct(retained) ?? (mode === 'current' ? -Infinity : 0)
    if best_retained === null
      || (strategy === 'maximize_retained' && pct > best_pct)
      || (strategy === 'minimize_retained' && pct < best_pct):
      best_retained = retained
      best_pct = pct
      best_dropped = combo

  return [best_retained, best_dropped]
```

---

## Pseudonymizer integration

`explain_grade` returns `student.id` and `student.name`. The `CanvasUser` object is fetched in
call 5. The tool calls `pseudonymizer.anonymizeUser(course_id, user)` on that object:

```ts
const user = studentId === 'self'
  ? await canvas.users.getSelf()
  : await canvas.users.get(studentId)

const anonUser = pseudonymizer
  ? await pseudonymizer.anonymizeUser(courseId, user)
  : user

// In output:
student: { id: anonUser.id, name: anonUser.name }
```

Add `'explain_grade'` to `PSEUDONYMIZER_WRAPPED_TOOLS` in `src/pseudonym/coverage.ts`.

---

## Catalog registration (`src/tools/catalog.ts`)

New domain entry (append to `toolDomainCatalog`):

```ts
{
  domain: 'grade_explanation',
  defaultPrimaryAudience: 'shared',
  getTools: gradeExplanationTools,
}
```

`src/tools/index.ts` does **not** need to be edited — tools are wired automatically through the
catalog (the existing `getAllTools()` iterates `toolDomainCatalog`).

---

## Test plan (`tests/grade-explanation.test.ts`)

All tests use mocked Canvas responses — no real Canvas instance is hit.

### Fixture A — Weighted course, `drop_lowest: 1` + `never_drop`

**Course mock**: `apply_assignment_group_weights: true`, `grading_standard_id: 42`

**Grading standard mock** (id 42):
```ts
{ grading_scheme: [
  { name: 'A', value: 0.9 },
  { name: 'B', value: 0.8 },
  { name: 'C', value: 0.7 },
  { name: 'F', value: 0.0 },
] }
```

**Groups**:
- **Homework** (group_weight: 30, `drop_lowest: 1`, `never_drop: [3]`):
  - Assignment 1 (10 pts): score 8 → 80%
  - Assignment 2 (10 pts): score 5 → 50%  ← expected drop (lowest droppable ratio)
  - Assignment 3 (10 pts, never_drop): score 6 → 60%
- **Exams** (group_weight: 70, no rules):
  - Midterm (100 pts): score 88
  - Final (100 pts): score 75

**Expected current computation**:
- Homework retained: A1 + A3 (A2 dropped) → earned 14/20 = 70% → contribution = 30 × 0.70 = 21
- Exams: 163/200 = 81.5% → contribution = 70 × 0.815 = 57.05
- active_weight_sum = 100
- overall_percentage = (21 + 57.05) / 100 × 100 = 78.05%
- Letter: 78.05/100 = 0.7805 ≥ 0.7 (C) but < 0.8 (B) → **C**

**Assertions**:
1. Assignment 2: `dropped: true`, `drop_reason: 'drop_lowest'`
2. Assignment 3: `dropped: false` (pinned by `never_drop`)
3. `totals.current.computed_percentage ≈ 78.05` (within 0.01)
4. `totals.current.letter === 'C'`

### Fixture B — Unweighted course (no drop rules)

**Course mock**: `apply_assignment_group_weights: false`, `grading_standard_id: null`

**Groups**:
- Group A: assignment (100 pts): score 90
- Group B: assignment (50 pts): score 40

**Expected**: total = 130/150 = 86.67%

**Assertions**:
1. `course.weighted === false`
2. `groups[*].current.weighted_contribution === null` (unweighted)
3. `totals.current.computed_percentage ≈ 86.67`
4. `totals.current.letter === null`

### Fixture C — Reconciliation: match vs discrepancy (two separate `it()` blocks)

**Block 1** — uses Fixture A data; mock enrollment `current_score: 78.1`:
- `|78.05 - 78.1| = 0.05 ≤ 0.5` → `matches: true`

**Block 2** — uses Fixture A data; mock enrollment `current_score: 81.0`:
- `|78.05 - 81.0| = 2.95 > 0.5` → `matches: false`, caveat about possible curve is present

### Fixture D — Excused + missing + submitted/pending_review assignments

**Group** (unweighted) with 4 assignments (10 pts each):
- A1: score 8 (graded)
- A2: excused
- A3: missing (`workflow_state: 'unsubmitted'`, `missing: true`)
- A4: `workflow_state: 'pending_review'`

**Current mode**: only A1 contributes → 8/10 = 80%
**Final mode**: A1 (8) + A3 (0) + A4 (0) → 8/30 ≈ 26.67%; A2 excluded

**Assertions**:
1. A2: `status: 'excused'`, `dropped: false`
2. A3: `status: 'missing'`
3. A4: `status: 'submitted'` (pending_review collapses to 'submitted')
4. `groups[0].current.earned_points === 8`, `groups[0].current.possible_points === 10`
5. `groups[0].final.earned_points === 8`, `groups[0].final.possible_points === 30`

### Fixture E — `drop_highest: 1` (bonus exclusion)

**Group** (4 assignments, 10 pts each):
- A1: score 10/10 = 100% ← expected dropped (best ratio)
- A2: score 8/10 = 80%
- A3: score 6/10 = 60%
- A4: score 4/10 = 40%

**Expected**: drop A1 → retained A2+A3+A4 → 18/30 = 60%

**Assertions**:
1. A1: `dropped: true`, `drop_reason: 'drop_highest'`
2. `groups[0].current.percentage ≈ 60`

### Fixture F — FERPA pseudonymization

With `CANVAS_PSEUDONYMIZE_STUDENTS=true` (mocked via test env):
- Mock `canvas.users.get()` returns `{ id: 1234, name: 'Alice Student', ... }`
- Pseudonymizer maps user_id 1234 to `'Student 0'`

**Assertions**:
1. `result.student.name === 'Student 0'`
2. `result.student.id === 1234` (pseudonymizer does not change the numeric id)

### Fixture G — Missing enrollment

Mock `canvas.enrollments.listForCourse()` returns `[]`:

**Assertions**:
1. `result.totals.current.canvas_posted_score === null`
2. `result.caveats` includes the "No student enrollment found" string
3. Grade computation still runs (computed_percentage is not null if assignments exist)

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
| `src/tools/grade-explanation.ts` | **New** — `gradeExplanationTools()` with `explain_grade` ToolDefinition; all Canvas calls and grade-computation logic |
| `src/tools/catalog.ts` | Add `grade_explanation` domain entry (`shared` audience) |
| `src/pseudonym/coverage.ts` | Add `'explain_grade'` to `PSEUDONYMIZER_WRAPPED_TOOLS` |
| `tests/grade-explanation.test.ts` | **New** — fixtures A–G with mocked Canvas responses |

**4 files total. No new canvas module. No new package dependencies.** The combination generator
(`combinations(items, k)` iterator) and the greedy fallback are authored in-tree inside
`src/tools/grade-explanation.ts` (or a private helper section of the same file).

---

## Open questions for CTO review

None — all design unknowns are retired above. The spec is implementation-ready.
