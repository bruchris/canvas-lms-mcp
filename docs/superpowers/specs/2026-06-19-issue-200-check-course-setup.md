---
issue: 200
---

# Course-Setup Health Check Tool — MCP Tool Design

**Date**: 2026-06-19
**Issue**: [bruchris/canvas-lms-mcp#200](https://github.com/bruchris/canvas-lms-mcp/issues/200)
**Status**: Design — awaiting CTO review

---

## Purpose

Add a single read-only tool, `check_course_setup`, that composes existing Canvas read endpoints into
a factual course-readiness report. An instructor asks "what's wrong with my course before I publish
it?" and gets a structured list of high-signal configuration problems — grouped by check, with
exact details per finding — so they can fix them without clicking through every settings page by hand.

This is deliberately **config-health only** (course structure / settings), not student-performance
monitoring. It complements rather than duplicates `list_students_needing_attention` and
`get_missing_submissions`, which focus on student behaviour after the course is live.

---

## Design unknowns (retired)

### 1. Which checks ship in v1

**Decision: all four candidate checks ship in v1.**

| Check name                 | Signal                                                                     | Canvas data                                     |
| -------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------- |
| `missing_due_dates`        | Published assignment with no base `due_at` and no override with a due date | `assignments.list` + `include=all_dates`        |
| `unpublished_items`        | Unpublished assignments; unpublished modules; items unpublished inside a published module | `assignments.list`; `modules.listWithItems` |
| `assignment_group_weights` | Weighting enabled on the course but group weights don't sum to 100         | `courses.get`; `assignments.listGroups`         |
| `ungraded_setup`           | Assignment with `grading_type !== 'not_graded'` and `points_possible === 0` | `assignments.list`                              |

All four pass the "factual, unambiguous, high-signal" bar set in the issue. None require
cross-referencing student data. All fire only when something is measurably missing or inconsistent —
not on opinionated style choices — which keeps false-positive risk low.

**Why not a smaller v1:**

Shipping all four together costs one extra tool registration but saves shipping them as four
sequential PRs. The checks are independent (each can produce zero findings), and the caller
opts in to a subset via the `checks` input, so false-positive overwhelm is not a concern.

**Late/missing submissions are excluded.** `tardiness_breakdown`, missing submissions, and
late submissions are student-performance signals already covered by `list_students_needing_attention`
and `get_missing_submissions`. Duplicating them here conflates two audiences (course config vs.
student outcomes) and breaks the factual/config-only framing.

### 2. Severity model and opt-in `checks` parameter

**Decision: all findings have severity `"warn"` in v1. The `checks` input enables opting into a
subset; omitting it runs all four.**

Rationale:
- A single severity level (`"warn"`) keeps the v1 contract simple. There are no
  "course-breaking" checks in this set — all findings are actionable but not blocking.
- The `checks` array lets instructors who know their course is intentionally gradebook-weight-free
  suppress that check without losing the others. This directly addresses the community concern
  about false-positive overwhelm.
- The output always includes `summary.checks_run` listing every check attempted, and `findings`
  includes an entry for each run check even if `items` is empty — so the absence of findings is
  explicit, not ambiguous.

### 3. `unpublished_items` sub-checks

**Decision: three sub-item types within the `unpublished_items` check:**

1. **Unpublished assignments** — `assignment.published !== true` for any assignment in the course.
2. **Unpublished modules** — `module.published !== true` for any module.
3. **Unpublished module items inside a published module** — `item.published !== true` where the
   parent module `is` published. Items inside an unpublished module are NOT reported individually
   (the parent module finding already covers them; individual item noise would dominate the output).

All three use `type` to distinguish them in the `items` array: `"assignment"`, `"module"`,
`"module_item"`. The `name` field is populated from `assignment.name`, `module.name`, and
`item.title` respectively. Module items carry an extra `parent_module_name` field so the
instructor can locate them without cross-referencing.

### 4. MCP Apps widget

**Decision: out of scope for v1.**

A course-readiness widget is a plausible follow-up (see the note in the issue), but it requires
the MCP Apps infrastructure and a separate design pass. V1 ships the data tool only.

---

## Canvas client addition (`src/canvas/modules.ts`)

Add one new method to the **existing** `ModulesModule` class. No new file.

### Method: `listWithItems`

```ts
async listWithItems(
  courseId: number,
): Promise<(CanvasModule & { items?: CanvasModuleItem[] })[]> {
  return this.client.paginate<CanvasModule & { items?: CanvasModuleItem[] }>(
    `/api/v1/courses/${courseId}/modules`,
    { include: ['items'] },
  )
}
```

**Why a new method (not reusing `getCourseStructure`)**: `getCourseStructure` returns a
`CanvasCourseStructure` summary shape — modules are projected and items are filtered by an
`includePublishedOnly` flag. The course-setup check needs the raw `published` state on every
item (including unpublished ones) to detect them. A lightweight dedicated method avoids the
intermediate projection and keeps the check handler's logic visible in one place.

**Pagination**: Canvas paginates module lists via Link headers. `client.paginate()` handles this.
The `include[]=items` parameter causes Canvas to inline each module's items in the list response —
no per-module `listItems()` fan-out needed.

---

## Tool module — `src/tools/course-setup.ts` (new file)

```ts
import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

const ALL_CHECKS = [
  'missing_due_dates',
  'unpublished_items',
  'assignment_group_weights',
  'ungraded_setup',
] as const

type CheckName = (typeof ALL_CHECKS)[number]

interface SetupFinding {
  type: string
  id: number
  name: string
  detail: string
  parent_module_name?: string
}

interface CheckResult {
  check: CheckName
  severity: 'warn'
  items: SetupFinding[]
}

export function courseSetupTools(canvas: CanvasClient): ToolDefinition[] {
  return [/* check_course_setup tool — see below */]
}
```

### Tool: `check_course_setup`

```ts
{
  name: 'check_course_setup',
  description:
    'Run a factual course-readiness report that surfaces common configuration problems — ' +
    'assignments missing due dates, unpublished items students will not see, ' +
    'gradebook weighting gaps, and graded assignments with no points. ' +
    'Returns findings grouped by check with a plain-language detail per item. ' +
    'This is a config-health report only; it does not inspect student submissions or performance. ' +
    'Requires instructor permissions in the course.',
  inputSchema: {
    course_id: z.number().int().positive().describe('Canvas course ID'),
    checks: z
      .array(
        z.enum([
          'missing_due_dates',
          'unpublished_items',
          'assignment_group_weights',
          'ungraded_setup',
        ]),
      )
      .optional()
      .describe(
        'Subset of checks to run. Omit to run all four checks. ' +
          'Valid values: missing_due_dates, unpublished_items, ' +
          'assignment_group_weights, ungraded_setup.',
      ),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  handler: async (params) => {
    const courseId = params.course_id as number
    const requestedChecks = (params.checks as CheckName[] | undefined) ?? [...ALL_CHECKS]
    const activeChecks = new Set<CheckName>(requestedChecks)

    /* Parallel fetch — skip API calls not needed for the active checks */
    const [course, assignments, assignmentGroups, modules] = await Promise.all([
      canvas.courses.get(courseId),
      canvas.assignments.list(courseId, { include: ['all_dates'] }),
      activeChecks.has('assignment_group_weights')
        ? canvas.assignments.listGroups(courseId)
        : Promise.resolve([]),
      activeChecks.has('unpublished_items')
        ? canvas.modules.listWithItems(courseId)
        : Promise.resolve([]),
    ])

    const results: CheckResult[] = []

    /* ── check: missing_due_dates ─────────────────────────────────── */
    if (activeChecks.has('missing_due_dates')) {
      const items: SetupFinding[] = []
      for (const a of assignments) {
        if (a.published !== true) continue
        if (a.due_at !== null) continue
        const hasOverrideDueDate = (a.all_dates ?? []).some((d) => d.due_at !== null)
        if (!hasOverrideDueDate) {
          items.push({
            type: 'assignment',
            id: a.id,
            name: a.name,
            detail: 'published, no due_at and no override dates with a due date',
          })
        }
      }
      results.push({ check: 'missing_due_dates', severity: 'warn', items })
    }

    /* ── check: unpublished_items ─────────────────────────────────── */
    if (activeChecks.has('unpublished_items')) {
      const items: SetupFinding[] = []

      for (const a of assignments) {
        if (a.published !== true) {
          items.push({
            type: 'assignment',
            id: a.id,
            name: a.name,
            detail: 'not published — students cannot see this assignment',
          })
        }
      }

      for (const mod of modules as (import('../canvas/types').CanvasModule & {
        items?: import('../canvas/types').CanvasModuleItem[]
      })[]) {
        if (mod.published !== true) {
          items.push({
            type: 'module',
            id: mod.id,
            name: mod.name,
            detail: 'not published — students cannot see this module or any of its items',
          })
        } else {
          for (const item of mod.items ?? []) {
            if (item.published !== true) {
              items.push({
                type: 'module_item',
                id: item.id,
                name: item.title,
                detail: `not published (inside published module "${mod.name}")`,
                parent_module_name: mod.name,
              })
            }
          }
        }
      }

      results.push({ check: 'unpublished_items', severity: 'warn', items })
    }

    /* ── check: assignment_group_weights ──────────────────────────── */
    if (activeChecks.has('assignment_group_weights')) {
      const items: SetupFinding[] = []
      if (course.apply_assignment_group_weights === true) {
        const total = assignmentGroups.reduce((sum, g) => sum + (g.group_weight ?? 0), 0)
        if (Math.abs(total - 100) > 0.01) {
          items.push({
            type: 'course',
            id: courseId,
            name: course.name,
            detail: `weighting enabled; group weights sum to ${total.toFixed(2)}, not 100`,
          })
        }
      }
      results.push({ check: 'assignment_group_weights', severity: 'warn', items })
    }

    /* ── check: ungraded_setup ───────────────────────────────────── */
    if (activeChecks.has('ungraded_setup')) {
      const items: SetupFinding[] = []
      for (const a of assignments) {
        if (a.grading_type !== 'not_graded' && a.points_possible === 0) {
          items.push({
            type: 'assignment',
            id: a.id,
            name: a.name,
            detail: `grading_type is "${a.grading_type}" but points_possible is 0 — will not affect gradebook totals`,
          })
        }
      }
      results.push({ check: 'ungraded_setup', severity: 'warn', items })
    }

    const totalFindings = results.reduce((n, r) => n + r.items.length, 0)

    return {
      summary: {
        course_id: courseId,
        checks_run: results.map((r) => r.check),
        total_findings: totalFindings,
      },
      findings: results,
    }
  },
}
```

**Notes on design decisions baked into the handler:**

- **`missing_due_dates` — published-only scope**: Unpublished assignments without due dates are
  intentional (content in progress). Only published assignments are flagged.
- **`missing_due_dates` — `all_dates` presence check**: `all_dates` is included via the list
  request (`include: ['all_dates']`). If the field is absent or empty, the assignment is
  considered to have no dates at all and is flagged.
- **`unpublished_items` — unpublished parent modules skip item scanning**: An unpublished module
  hides all its items regardless of item-level publish state; reporting each item separately
  would be redundant noise.
- **`assignment_group_weights` — floating-point tolerance**: `Math.abs(total - 100) > 0.01` allows
  for `99.99` / `100.01` from floating-point arithmetic in Canvas group-weight values.
- **`assignment_group_weights` — skip when weighting disabled**: When
  `apply_assignment_group_weights` is `false` or `undefined`, the check produces zero findings;
  the per-group weights are irrelevant because Canvas ignores them. The `findings` entry still
  appears with `items: []`.
- **`ungraded_setup` — `points_possible === 0`**: Strict equality (not `<= 0`). Canvas stores
  `points_possible` as a float; negative values are not possible via the API.
- **Parallel fetch**: All four API calls are issued via `Promise.all`. The `assignmentGroups`
  and `modules` calls are gated on their respective `activeChecks` flags so the handler skips
  them when those checks are omitted. `courses.get` and `assignments.list` are always fetched
  because they are needed by at least two checks each.

---

## Catalog registration (`src/tools/catalog.ts`)

Two changes:

### 1. Import (after `import { quizAccommodationTools } from './quiz-accommodations'`):

```ts
import { courseSetupTools } from './course-setup'
```

### 2. Entry (after the `quiz_accommodations` entry at the end of `toolDomainCatalog`):

```ts
  {
    domain: 'course_setup',
    defaultPrimaryAudience: 'educator',
    getTools: courseSetupTools,
  },
```

---

## FERPA / pseudonymizer coverage

**No pseudonymizer wrapping required. Do NOT add `check_course_setup` to `PSEUDONYMIZER_WRAPPED_TOOLS`.**

The output payload contains:
- Assignment IDs and names (course structure metadata, not student data)
- Module IDs and names (course structure metadata)
- Course name and ID (course settings)
- Numeric `group_weight` values (gradebook configuration)

None of the output fields are a `CanvasUser` object, a `participants` array, or a `user_name`
string — the three triggering patterns for `PSEUDONYMIZER_WRAPPED_TOOLS` registration.
`tests/pseudonym/coverage.test.ts` passes without modification.

---

## Test plan

All tests use mocked Canvas responses. No live Canvas calls.

### Canvas client test — `tests/canvas/modules.test.ts` (modify existing file)

Add a `describe('listWithItems')` block:

**`listWithItems` cases:**

1. **Happy path**: Mock `client.paginate` returns
   ```ts
   [
     { id: 1, name: 'Module 1', position: 1, items_count: 2, published: true,
       items: [
         { id: 10, module_id: 1, title: 'Reading', position: 1, type: 'Page', published: true },
         { id: 11, module_id: 1, title: 'Quiz 1',  position: 2, type: 'Quiz', published: false },
       ] },
   ]
   ```
   Assert `modules.listWithItems(42)` returns that array unchanged.
   Assert `client.paginate` called with `('/api/v1/courses/42/modules', { include: ['items'] })`.

2. **Empty course**: Mock `client.paginate` returns `[]`.
   Assert `modules.listWithItems(42)` returns `[]`.

3. **Error propagation**: Mock `client.paginate` throws `new CanvasApiError('Not Found', 404, '...')`.
   Assert the error propagates unchanged from `listWithItems`.

### Tool tests — `tests/tools/course-setup.test.ts` (new file)

**`buildMockCanvas()` helper:**

```ts
function buildMockCanvas(overrides?: Partial<...>) {
  return {
    courses: {
      get: vi.fn().mockResolvedValue({
        id: 10, name: 'Test Course', apply_assignment_group_weights: true,
      }),
    },
    assignments: {
      list: vi.fn().mockResolvedValue([
        { id: 1, name: 'Essay 1',   published: true,  due_at: null,
          all_dates: [], grading_type: 'points', points_possible: 10 },
        { id: 2, name: 'Essay 2',   published: true,  due_at: '2026-09-01T23:59:00Z',
          all_dates: [], grading_type: 'points', points_possible: 20 },
        { id: 3, name: 'Ungraded',  published: false, due_at: null,
          all_dates: [], grading_type: 'not_graded', points_possible: 0 },
      ]),
      listGroups: vi.fn().mockResolvedValue([
        { id: 1, name: 'Homework', position: 1, group_weight: 50 },
        { id: 2, name: 'Exams',    position: 2, group_weight: 50 },
      ]),
    },
    modules: {
      listWithItems: vi.fn().mockResolvedValue([
        { id: 1, name: 'Week 1', published: true,
          items: [
            { id: 10, module_id: 1, title: 'Reading', type: 'Page', position: 1, published: true },
            { id: 11, module_id: 1, title: 'Quiz',    type: 'Quiz', position: 2, published: false },
          ] },
        { id: 2, name: 'Week 2 (Draft)', published: false,
          items: [
            { id: 20, module_id: 2, title: 'Lecture', type: 'Page', position: 1, published: false },
          ] },
      ]),
    },
  } as unknown as CanvasClient
}
```

**Suite-level checks:**
- `courseSetupTools(buildMockCanvas())` returns exactly **1** tool definition.
- Tool name: `'check_course_setup'`.

**Annotation check:**
- `{ readOnlyHint: true, openWorldHint: true }`.

**`checks_run` and output structure:**
1. **Full run (no `checks` param)**: Call `{ course_id: 10 }`. Assert
   `result.summary.checks_run` equals `['missing_due_dates', 'unpublished_items', 'assignment_group_weights', 'ungraded_setup']`.
   Assert `result.findings` has length 4 (one entry per check).

**`missing_due_dates` cases:**

2. **Flags published assignment with no due dates**: Default mock — `Essay 1` is published with
   `due_at: null` and empty `all_dates`. Assert findings entry for `missing_due_dates` has
   `items` containing exactly one entry: `{ type: 'assignment', id: 1, name: 'Essay 1' }`.
   `detail` contains `'published, no due_at'`.

3. **Skips unpublished assignments**: `Essay 3` (`published: false`) must NOT appear in
   `missing_due_dates` findings even though `due_at` is null.

4. **Skips assignment with override due date**: Override mock where `Essay 1` has
   `all_dates: [{ due_at: '2026-09-15T23:59:00Z', unlock_at: null, lock_at: null }]`.
   Assert no finding for `Essay 1` in `missing_due_dates`.

5. **Skips when `missing_due_dates` not in `checks`**: Call with `{ course_id: 10, checks: ['ungraded_setup'] }`.
   Assert `canvas.assignments.list` is still called (needed by `ungraded_setup`).
   Assert `result.summary.checks_run` equals `['ungraded_setup']`.
   Assert no `missing_due_dates` entry in `result.findings`.

**`unpublished_items` cases:**

6. **Flags unpublished assignment**: Default mock has `Essay 3` (`published: false`). Assert
   finding has `{ type: 'assignment', id: 3, name: 'Ungraded' }`.

7. **Flags unpublished module**: Default mock has `Week 2 (Draft)` (`published: false`). Assert
   finding has `{ type: 'module', id: 2, name: 'Week 2 (Draft)' }`.

8. **Flags unpublished item inside published module**: Default mock has item `Quiz` (`id: 11,
   published: false`) inside published `Week 1`. Assert finding has
   `{ type: 'module_item', id: 11, name: 'Quiz', parent_module_name: 'Week 1' }`.

9. **Does NOT flag items inside an unpublished module individually**: `Week 2 (Draft)` is
   unpublished and contains `Lecture` (also unpublished). Assert only ONE entry for `Week 2 (Draft)`
   (type `module`) appears — `Lecture` must NOT appear as a `module_item` finding.

10. **No unpublished items — empty items array**: Mock with all published. Assert
    `unpublished_items` finding has `items: []`.

11. **Skips when `unpublished_items` not in `checks`**: Call with `{ course_id: 10, checks: ['missing_due_dates'] }`.
    Assert `canvas.modules.listWithItems` is NOT called.

**`assignment_group_weights` cases:**

12. **Weights sum to 100 — no findings**: Default mock (50+50=100). Assert `assignment_group_weights`
    finding has `items: []`.

13. **Weights don't sum to 100**: Mock `listGroups` returns `[{ group_weight: 40 }, { group_weight: 50 }]`
    (sum = 90). Assert `items` has one entry: `{ type: 'course', id: 10, name: 'Test Course' }`,
    `detail` contains `'sum to 90.00, not 100'`.

14. **Weighting disabled — no findings**: Mock `courses.get` returns `{ apply_assignment_group_weights: false }`.
    Assert `assignment_group_weights` finding has `items: []`.
    Assert `canvas.assignments.listGroups` is still called (the handler fetches it; the condition
    gate is inside the check body, not the fetch).

15. **Skips fetch when not in `checks`**: Call with
    `{ course_id: 10, checks: ['missing_due_dates'] }`.
    Assert `canvas.assignments.listGroups` is NOT called.

**`ungraded_setup` cases:**

16. **Flags graded assignment with 0 points**: Add a mock assignment
    `{ id: 4, name: 'Extra Credit', grading_type: 'points', points_possible: 0, published: true, due_at: null, all_dates: [] }`.
    Assert finding has `{ type: 'assignment', id: 4, name: 'Extra Credit' }`,
    `detail` contains `'grading_type is "points"'` and `'points_possible is 0'`.

17. **Does NOT flag `not_graded` assignment with 0 points**: Default mock — `Ungraded` has
    `grading_type: 'not_graded'` and `points_possible: 0`. Assert `Ungraded` does NOT appear in
    `ungraded_setup` findings.

18. **Does NOT flag graded assignment with >0 points**: `Essay 1` and `Essay 2` have
    `points_possible > 0`. Assert neither appears in `ungraded_setup` findings.

**`checks` filter integration:**

19. **Subset check — only two checks run**: Call with `{ course_id: 10, checks: ['missing_due_dates', 'ungraded_setup'] }`.
    Assert `result.summary.checks_run` has length 2.
    Assert `result.findings` has length 2.
    Assert `canvas.modules.listWithItems` is NOT called.
    Assert `canvas.assignments.listGroups` is NOT called.

20. **`total_findings` matches item counts**: Use default mock and assert
    `result.summary.total_findings === result.findings.reduce((n, f) => n + f.items.length, 0)`.

### Registry test — `tests/tools/registry.test.ts` (modify existing file)

**Three changes:**

**Change 1 — `buildFullMockCanvas()` mock**: Add `listWithItems` to the existing `modules` property:

```ts
    modules: {
      list: async () => [],
      get: async () => ({}),
      listItems: async () => [],
      create: async () => ({}),
      update: async () => ({}),
      createItem: async () => ({}),
      getCourseStructure: async () => ({ modules: [], summary: { total_modules: 0, total_items: 0, items_by_type: {} } }),
      listWithItems: async () => [],    // NEW
    },
```

Without this, `courseSetupTools` accesses `canvas.modules.listWithItems` which would be `undefined`
and throw at tool registration time in `getAllTools`.

**Change 2 — tool count**: Change `expect(tools).toHaveLength(130)` → `expect(tools).toHaveLength(131)`.

**Change 3 — `toContain` assertion**: Add after the `// Quiz Accommodations (2)` block:

```ts
    // Course Setup (1)
    expect(names).toContain('check_course_setup')
```

`check_course_setup` has `readOnlyHint: true`. It does NOT appear in `writeToolNames` — the existing
"read tools have readOnlyHint: true" assertion loop will cover it automatically.

### Pseudonymizer coverage test — `tests/pseudonym/coverage.test.ts`

No changes. `check_course_setup` does not appear in `PSEUDONYMIZER_WRAPPED_TOOLS`. The CI coverage
test passes without modification.

### Audience coverage test — `tests/tools/audience-coverage.test.ts`

No changes. The domain `course_setup` registers with `defaultPrimaryAudience: 'educator'`.
`check_course_setup` does not set a `audience` override — it inherits `educator`. The CI test
passes without modification.

---

## Implementation checklist for the implementor

1. `src/canvas/modules.ts` — add `listWithItems(courseId)` method to `ModulesModule`.
2. `src/tools/course-setup.ts` — new file with `courseSetupTools()` function, inline type
   definitions (`CheckName`, `SetupFinding`, `CheckResult`), and the `check_course_setup` tool.
3. `src/tools/catalog.ts` — import `courseSetupTools`; add `course_setup` domain entry after
   `quiz_accommodations`.
4. `tests/canvas/modules.test.ts` — add `listWithItems` (3 cases) to the existing file.
5. `tests/tools/course-setup.test.ts` — new file (20 test cases across suite, annotation,
   and check-level groups).
6. `tests/tools/registry.test.ts` — 3 changes: `listWithItems` on the existing `modules` mock;
   count 130→131; `check_course_setup` in `toContain` block.

---

## Acceptance check

- [x] `**design-first**` flag present in issue #200.
- [x] Design unknown §1 (which checks ship in v1): retired — all four candidate checks ship;
  rationale: all are factual/unambiguous and low false-positive; late/missing submissions
  deliberately excluded to avoid duplication with student-attention tools.
- [x] Design unknown §2 (severity model and opt-in `checks`): retired — single `"warn"` severity
  in v1; `checks` array parameter for subset selection; all run checks appear in `findings` (even
  if `items: []`) for explicit zero-finding acknowledgement.
- [x] Design unknown §3 (whether to exclude late/missing submissions): retired — excluded; config-
  health scope only; cross-reference to `list_students_needing_attention` / `get_missing_submissions`
  noted in tool description.
- [x] Design unknown §4 (MCP Apps widget): retired — out of scope for v1.
- [x] No new package dependencies.
- [x] No student PII in output; pseudonymizer wrapping not required; no `PSEUDONYMIZER_WRAPPED_TOOLS` entry.
- [x] Exact tool name, Zod schema, Canvas endpoints, MCP annotations, output shape specified.
- [x] Canvas client addition: `listWithItems` on `ModulesModule` with exact endpoint and `client.paginate` call.
- [x] All four check implementations specified, including Canvas field access, filter conditions,
  output item `type` values, and detail string format.
- [x] Parallel fetch strategy with `Promise.all` and conditional fetch for `listGroups` / `listWithItems`.
- [x] Catalog: verbatim import and insertion point after `quiz_accommodations`.
- [x] Registry test: 3 precise changes (mock method, count, `toContain`).
- [x] Test plan: 3 canvas client cases + 20 tool cases covering all 4 checks, filter logic,
  parallel-fetch gating, and structural output assertions.
- [x] FERPA and audience coverage tests unaffected.
