---
issue: 237
---

# Flag Submissions Open Past Due — `check_course_setup` Extension Design

**Date**: 2026-07-08
**Issue**: [bruchris/canvas-lms-mcp#237](https://github.com/bruchris/canvas-lms-mcp/issues/237)
**Status**: Design — awaiting CTO review

---

## Purpose

Add a fifth check, `submissions_open_past_due`, to the existing `check_course_setup` tool
(`src/tools/course-setup.ts`, added in #200). An instructor asks "what did I forget to close?"
and gets a factual list of published assignments whose due date has passed but that are still
accepting submissions right now (no lock date, or a lock date still in the future) — closing the
exact gap called out in the issue's evidence thread, where instructors repeatedly describe
forgetting to lock a drop box after the deadline.

This is an **extension of an existing tool**, not a new tool. No new tool registration, no catalog
change, no manifest tool-count bump. `check_course_setup` already fetches
`canvas.assignments.list(courseId, { include: ['all_dates'] })` unconditionally (needed by three of
the four existing checks) — the new check reuses that same response with zero new Canvas calls and
no Canvas client changes.

---

## Design unknowns (retired)

### 1. Predicate — report facts, not prescriptions; no grace-period parameter

**Decision: evaluate against the current instant. Flag when `due_at` has passed AND
(`lock_at` is null OR `lock_at` is still in the future). No optional grace-period input in v1.**

Rationale:
- This is deliberately a "right now" predicate, not "was this ever open past due." If an instructor
  set `lock_at` to an intentional grace-period deadline and that deadline has already passed, the
  assignment is closed *now* — no finding. If the grace window is still running (`lock_at` in the
  future) or there is no lock date at all, submissions are still open *now* — that is precisely the
  "did I forget to close this" moment the issue asks for, so it is flagged.
- A configurable grace-period threshold would just re-derive what `lock_at` itself already encodes
  once an instructor has set one deliberately. Adding a second knob on top of `lock_at` increases
  the input surface for no extra signal.
- The detail string states the fact ("due X has passed; lock_at is Y — submissions still open") and
  never asserts "you forgot" or "you are missing a lock date" — matching the issue's explicit
  instruction to avoid false-positive-prone prescriptive language for instructors who intentionally
  leave assignments open and penalize late work.

### 2. Overrides — evaluate every date set independently, exclude non-visible base

**Decision: build one "date set" per relevant audience (base + each override) from
`all_dates`, evaluate each independently, and flag the assignment once if any date set is open past
due.** The finding's detail is built from the open date set with the earliest `due_at`; if more than
one date set is simultaneously open, the detail notes how many additional ones are also open.

Rationale:
- Section/student overrides can leave one audience closed while another remains open (or vice
  versa) — evaluating only the base `due_at`/`lock_at` would miss an open override, and evaluating
  only overrides would miss an open base assignment. Checking every date set independently is the
  only way to catch both directions the issue's design-unknowns section called out.
- **`only_visible_to_overrides: true` excludes the base date set from evaluation.** When an
  assignment is only visible via overrides, no student is bound by the base `due_at`/`lock_at` —
  Canvas still returns a `base: true` entry in `all_dates`, but including it would produce a
  finding no student could ever act on (a phantom "everyone" audience that doesn't exist).
- **One finding per assignment, not per date set** — matches every existing check's granularity
  (`missing_due_dates`, `unpublished_items`, `ungraded_setup` all produce at most one `assignment`-
  type item per assignment; `unpublished_items`' `module_item` sub-items are the only precedent for
  finer granularity, and that's because module items have distinct Canvas IDs to key on — override
  date sets don't have a separate addressable entity in this tool's output shape). Fanning out one
  item per open override would multiply noise for large multi-section courses without adding an
  actionable distinct target (the `SetupFinding.id` field can only reference the assignment ID
  either way).
- **`all_dates` empty → fall back to the top-level `due_at`/`lock_at`** as a single synthetic base
  date set. This mirrors `missing_due_dates`' existing convention for the same field (see
  `course-setup.ts` line 108: `(a.all_dates ?? []).some(...)`) and this codebase's own test fixtures
  (`DEFAULT_ASSIGNMENTS` in `tests/tools/course-setup.test.ts` sets `all_dates: []` alongside a
  populated top-level `due_at`).

### 3. Scope — assignments only in v1; quizzes noted as out of scope

**Decision: assignments only, exactly as the issue's proposed contract states.**

Every **graded** classic quiz and New Quiz already has a backing `CanvasAssignment` record (Canvas
creates one automatically, typically with `submission_types` containing `'online_quiz'` or
`is_quiz_assignment: true`), so graded quizzes are already covered indirectly through
`assignments.list()` — no special-casing needed. **Ungraded quizzes and surveys have no assignment
record and are out of scope for v1** — they carry their own independent `lock_at` on the
`CanvasQuiz` resource (see `unlock_at`/`lock_at` on `CanvasQuiz` in `src/canvas/types.ts`), which is
a separate Canvas endpoint (`assignments.list` does not return them) and a separate effort. This
mirrors the issue's own "Effort S–M, composes `list_assignments`" framing — pulling in
`quizzes.list` would be a second Canvas call and a second finding shape for a check this narrowly
scoped, and none of the issue's evidence quotes mention ungraded quizzes/surveys specifically.

### 4. New check vs. standalone tool

**Decision: new check on the existing `check_course_setup` tool**, per the issue's stated
preference ("keeps the surface tight — no new tool, no tool-count bump"). It composes the same
already-fetched `assignments.list` response the other three assignment-scoped checks already use;
there is no reason to introduce a fifth Canvas round-trip or a new tool registration for what is
structurally identical to the existing checks.

---

## Canvas client changes

**None.** `check_course_setup` already calls
`canvas.assignments.list(courseId, { include: ['all_dates'] })` unconditionally (not gated behind
any `activeChecks.has(...)` check, because three of the four existing checks need it). The new
check reads `due_at`, `lock_at`, `published`, `only_visible_to_overrides`, and `all_dates` off the
same `CanvasAssignment[]` response already in scope — all fields already declared on
`CanvasAssignment` / `CanvasAssignmentDate` in `src/canvas/types.ts`. No new Canvas endpoint, no new
client method, no `src/canvas/types.ts` changes.

---

## Tool module changes — `src/tools/course-setup.ts`

### 1. `ALL_CHECKS` — append the new check name

```ts
const ALL_CHECKS = [
  'missing_due_dates',
  'unpublished_items',
  'assignment_group_weights',
  'ungraded_setup',
  'submissions_open_past_due',
] as const
```

### 2. New module-level type and helpers (add above `courseSetupTools`, after the existing
`CheckResult` interface)

```ts
interface DateSet {
  due_at: string | null
  lock_at: string | null
  base: boolean
  title?: string
}

function buildDateSets(a: CanvasAssignment): DateSet[] {
  const raw = a.all_dates ?? []
  const sets: DateSet[] =
    raw.length > 0
      ? raw.map((d) => ({
          due_at: d.due_at,
          lock_at: d.lock_at,
          base: d.base === true,
          title: d.title,
        }))
      : [{ due_at: a.due_at, lock_at: a.lock_at ?? null, base: true }]
  return a.only_visible_to_overrides === true ? sets.filter((d) => !d.base) : sets
}

function isOpenPastDue(d: DateSet, nowMs: number): boolean {
  if (d.due_at === null) return false
  if (new Date(d.due_at).getTime() >= nowMs) return false
  if (d.lock_at !== null && new Date(d.lock_at).getTime() <= nowMs) return false
  return true
}

function pickEarliestOpen(openSets: DateSet[]): DateSet {
  return openSets.reduce((earliest, d) =>
    new Date(d.due_at as string).getTime() < new Date(earliest.due_at as string).getTime()
      ? d
      : earliest,
  )
}
```

`Date.now()` / `new Date(x).getTime()` matches this codebase's existing time-comparison convention
(see `src/tools/attention.ts` lines 217–228 — `const now = Date.now()`, `new Date(e.last_activity_at).getTime()`).

### 3. Tool `description` — mention the fifth check

Replace the current description string with:

```ts
description:
  'Run a factual course-readiness report that surfaces common configuration problems — ' +
  'assignments missing due dates, unpublished items students will not see, ' +
  'gradebook weighting gaps, graded assignments with no points, and published assignments ' +
  'still accepting submissions after their due date. ' +
  'Returns findings grouped by check with a plain-language detail per item. ' +
  'This is a config-health report only; it does not inspect student submissions or performance ' +
  '(see list_students_needing_attention / get_missing_submissions for those). ' +
  'Requires instructor permissions in the course.',
```

### 4. `inputSchema.checks` — add the enum value and update the describe() text

```ts
checks: z
  .array(
    z.enum([
      'missing_due_dates',
      'unpublished_items',
      'assignment_group_weights',
      'ungraded_setup',
      'submissions_open_past_due',
    ]),
  )
  .optional()
  .describe(
    'Subset of checks to run. Omit to run all five checks. ' +
      'Valid values: missing_due_dates, unpublished_items, ' +
      'assignment_group_weights, ungraded_setup, submissions_open_past_due.',
  ),
```

### 5. New check block — insert after the `ungraded_setup` block, before
`const totalFindings = ...`

```ts
// ── check: submissions_open_past_due ──────────────────────────
// Evaluated against "right now," not "was this ever open past due" — see spec
// design-unknown §1. A lock_at already in the past means the instructor closed
// it (even via a grace period); only a null or still-future lock_at is flagged.
if (activeChecks.has('submissions_open_past_due')) {
  const items: SetupFinding[] = []
  const nowMs = Date.now()
  for (const a of assignments) {
    if (a.published !== true) continue
    const dateSets = buildDateSets(a)
    const openSets = dateSets.filter((d) => isOpenPastDue(d, nowMs))
    if (openSets.length === 0) continue
    const chosen = pickEarliestOpen(openSets)
    const lockDisplay = chosen.lock_at ?? 'not set'
    const scopeText = chosen.base ? '' : ` for override "${chosen.title ?? 'untitled override'}"`
    const moreText =
      openSets.length > 1 ? ` (+${openSets.length - 1} more override(s) also open)` : ''
    items.push({
      type: 'assignment',
      id: a.id,
      name: a.name,
      detail: `due ${chosen.due_at}${scopeText} has passed; lock_at is ${lockDisplay} — submissions still open${moreText}`,
    })
  }
  results.push({ check: 'submissions_open_past_due', severity: 'warn', items })
}
```

No change to the `Promise.all` fetch block — `assignments.list` is already fetched unconditionally.

---

## Catalog registration (`src/tools/catalog.ts`)

**No change.** `check_course_setup` is already registered under the `course_setup` domain
(`defaultPrimaryAudience: 'educator'`); this PR adds a check to an existing tool, not a new tool.

---

## FERPA / pseudonymizer coverage

**No pseudonymizer wrapping required. Do NOT add `check_course_setup` to
`PSEUDONYMIZER_WRAPPED_TOOLS`** (it is not there today and this change does not alter that).

The new check's output fields are assignment IDs, names, ISO date strings, and (for override date
sets) the override's `title` string — all assignment/course configuration metadata, not student
data. No `CanvasUser` object, `participants` array, or `user_name` field appears anywhere in the
output. This matches the existing tool's own FERPA note from the #200 spec and the precedent
already set by `list_assignments`, which returns `all_dates[].title` (including override titles)
unpseudonymized today (`src/tools/assignments.ts`, `all_dates` include) — this change does not
introduce a new PII surface, it reads a field this codebase already exposes raw elsewhere.
`tests/pseudonym/coverage.test.ts` passes without modification.

---

## Manifest regeneration — required despite unchanged tool count

**The tool count stays at 143 — no `toHaveLength` bump anywhere.** But the tool's `description` and
`inputSchema` **do** change (new check name in the description prose and the `checks` enum), and
`tests/discovery/manifests.test.ts`'s `'matches the committed generated JSON artifact'` test does a
deep `toEqual` between `buildToolManifest()` and the committed `docs/generated/tool-manifest.json`.
**Run `pnpm generate:manifests` and commit the regenerated `docs/generated/tool-manifest.json`** (and
`docs/generated/workflow-manifest.json`, regenerated as a side effect of the same script, though its
content is unaffected since `check_course_setup` has no `relatedWorkflows` entries) — otherwise that
test fails on the stale committed description string. `manifest.json` (the `.mcpb` bundle manifest
checked by `tests/manifest.test.ts`) is unrelated and needs no change.

---

## Test plan

All tests use mocked Canvas responses. No live Canvas calls. Time-relative fixtures follow this
codebase's existing convention (`tests/tools/attention.test.ts`) of computing ISO strings relative
to `Date.now()` rather than fixed calendar dates or mocked system time.

### Modify `tests/tools/course-setup.test.ts`

**Fixture additions** (add near the top, alongside `DEFAULT_ASSIGNMENTS`):

```ts
const DAY_MS = 24 * 60 * 60 * 1000
const PAST_DUE = new Date(Date.now() - 5 * DAY_MS).toISOString()
const EARLIER_PAST_DUE = new Date(Date.now() - 10 * DAY_MS).toISOString()
const PAST_LOCK = new Date(Date.now() - 1 * DAY_MS).toISOString()
const FUTURE_LOCK = new Date(Date.now() + 5 * DAY_MS).toISOString()
const FUTURE_DUE = new Date(Date.now() + 5 * DAY_MS).toISOString()
```

**Update the existing "runs all N checks" test** (currently asserts 4 checks / 4 findings):

1. `report.summary.checks_run` now equals
   `['missing_due_dates', 'unpublished_items', 'assignment_group_weights', 'ungraded_setup', 'submissions_open_past_due']`;
   `report.findings` has length **5**.

**New `describe('submissions_open_past_due', ...)` block:**

2. **Flags a published assignment past due with no lock date**: assignment
   `{ id: 8, name: 'Reflection', published: true, due_at: PAST_DUE, lock_at: null, all_dates: [], grading_type: 'points', points_possible: 10 }`.
   Assert `submissions_open_past_due` findings contains
   `{ type: 'assignment', id: 8, name: 'Reflection' }` and `detail` contains
   `'has passed; lock_at is not set — submissions still open'`.

3. **Flags a published assignment past due with a future lock date**: same as above but
   `lock_at: FUTURE_LOCK`. Assert a finding is produced and `detail` contains the `FUTURE_LOCK`
   value (not the literal `'not set'`).

4. **Does not flag when already locked (lock_at in the past)**: `due_at: PAST_DUE, lock_at: PAST_LOCK`.
   Assert no finding for this assignment.

5. **Does not flag when not yet due**: `due_at: FUTURE_DUE, lock_at: null`. Assert no finding.

6. **Does not flag when due_at is null**: `due_at: null, lock_at: null`. Assert no finding (nothing
   has "passed").

7. **Does not flag an unpublished assignment even when past due and unlocked**: same open date
   shape as case 2 but `published: false`. Assert no finding (published guard fires first, same
   pattern as `missing_due_dates` / `ungraded_setup`).

8. **Falls back to top-level due_at/lock_at when all_dates is empty**: reuse case 2's shape
   (`all_dates: []`) — this is already exercised by case 2 itself; add an explicit assertion that
   `detail` contains the exact `PAST_DUE` string, pinning the "no override, empty all_dates, still
   evaluated" fallback path from design-unknown §2.

9. **Override still open while base is already locked**: assignment with
   `all_dates: [{ base: true, due_at: PAST_DUE, unlock_at: null, lock_at: PAST_LOCK }, { base: false, title: 'Late Registrants', due_at: PAST_DUE, unlock_at: null, lock_at: null }]`.
   Assert exactly one finding for the assignment, `detail` contains
   `'for override "Late Registrants"'` and `'submissions still open'` (base is closed, override is
   not — the override drives the finding).

10. **Base still open while a named override is already locked**: inverse of case 9 —
    `all_dates: [{ base: true, due_at: PAST_DUE, unlock_at: null, lock_at: null }, { base: false, title: 'Section B', due_at: PAST_DUE, unlock_at: null, lock_at: PAST_LOCK }]`.
    Assert one finding, `detail` does NOT contain `'for override'` (the chosen open date set is the
    base one, since the override is closed).

11. **`only_visible_to_overrides: true` excludes the phantom base entry**: assignment
    `{ ..., only_visible_to_overrides: true, all_dates: [{ base: true, due_at: PAST_DUE, unlock_at: null, lock_at: null }, { base: false, title: 'Group A', due_at: FUTURE_DUE, unlock_at: null, lock_at: null }] }`.
    Assert **no finding** — the base entry (which would otherwise be open) is excluded, and the
    only real override (`Group A`) is not yet due.

12. **`only_visible_to_overrides: true` still flags an open override**: same as case 11 but
    `Group A`'s `due_at: PAST_DUE`. Assert one finding with `detail` containing
    `'for override "Group A"'`.

13. **Multiple simultaneously-open date sets — earliest due date wins, count noted**: assignment
    with `all_dates: [{ base: true, due_at: EARLIER_PAST_DUE, unlock_at: null, lock_at: null }, { base: false, title: 'Extended', due_at: PAST_DUE, unlock_at: null, lock_at: null }]`.
    Assert one finding: `detail` contains the `EARLIER_PAST_DUE` value (not `PAST_DUE`, not the
    override title, since the base set is earliest) and contains
    `'(+1 more override(s) also open)'`.

14. **`checks: ['submissions_open_past_due']` alone — no extra fetches, correct `checks_run`**:
    Assert `canvas.modules.listWithItems`, `canvas.assignments.listGroups`, and `canvas.courses.get`
    are all NOT called (this check needs none of them); `canvas.assignments.list` IS called (already
    unconditional); `result.summary.checks_run` equals `['submissions_open_past_due']`;
    `result.findings` has length 1.

15. **Empty items array when nothing is open past due**: use only case-5/case-6-shaped assignments
    (not-yet-due, no-due-date). Assert `submissions_open_past_due` finding has `items: []` (the
    check still appears in `findings` with zero items, matching the "explicit zero-finding
    acknowledgement" convention from #200).

**Update the existing `total_findings` sum test** (case "reports total_findings equal to the sum of
all item counts") — no code change needed; it already sums whatever `report.findings` contains, so
it automatically covers the fifth check once findings 2–15 exist in the same file. Verify it still
passes with the new fixtures present in `DEFAULT_ASSIGNMENTS` if any are added there — **do not**
add the new time-relative fixtures to `DEFAULT_ASSIGNMENTS` itself; keep them scoped to the new
`describe('submissions_open_past_due', ...)` block's own `buildMockCanvas({ assignments: [...] })`
overrides so the other 20 existing tests in this file (which assert exact `items` arrays for the
other four checks) are not perturbed.

### `tests/tools/registry.test.ts` — no change

`check_course_setup` already appears in the `toContain` list (line 368) and the tool count stays at
143. No edits needed.

### `tests/discovery/manifests.test.ts` — no test-code change; regenerated fixture required

The test file itself needs no edits. `docs/generated/tool-manifest.json` must be regenerated (see
"Manifest regeneration" section above) so the `'matches the committed generated JSON artifact'` test
keeps passing against the new `check_course_setup` description string.

### `tests/pseudonym/coverage.test.ts` / `tests/tools/audience-coverage.test.ts` — no change

`check_course_setup` is not in `PSEUDONYMIZER_WRAPPED_TOOLS` and does not need to be. It has no
`audience` override and keeps inheriting `course_setup`'s `defaultPrimaryAudience: 'educator'`. Both
CI coverage tests pass without modification.

---

## Implementation checklist for the implementor

1. `src/tools/course-setup.ts`:
   - Append `'submissions_open_past_due'` to `ALL_CHECKS`.
   - Add the `DateSet` interface and `buildDateSets` / `isOpenPastDue` / `pickEarliestOpen` helper
     functions above `courseSetupTools`.
   - Update the tool's `description` string to mention the fifth check.
   - Add `'submissions_open_past_due'` to the `checks` Zod enum and update its `.describe()` text
     ("all five checks", trailing enum list).
   - Insert the new check block after the existing `ungraded_setup` block.
2. `tests/tools/course-setup.test.ts`:
   - Add the time-relative fixture constants.
   - Update the "runs all N checks" test to expect 5 checks / 5 findings.
   - Add the new `describe('submissions_open_past_due', ...)` block (14 new cases).
3. Run `pnpm generate:manifests` and commit the regenerated `docs/generated/tool-manifest.json` (and
   `docs/generated/workflow-manifest.json`, unaffected in content but regenerated by the same
   script run).
4. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.

No changes to: `src/canvas/*` (client), `src/tools/catalog.ts`, `tests/tools/registry.test.ts`,
`tests/pseudonym/coverage.test.ts`, `tests/tools/audience-coverage.test.ts`, `manifest.json`,
`tests/manifest.test.ts`.

---

## Acceptance check

- [x] `**design-first**` flag present in issue #237.
- [x] Design unknown (predicate / grace period): retired — evaluated against current instant
  (`due_at` passed AND (`lock_at` null OR still future)); no grace-period parameter; rationale tied
  directly to the "report facts, not prescriptions" principle from the issue.
- [x] Design unknown (overrides): retired — every date set (base + each override) evaluated
  independently via `all_dates`; `only_visible_to_overrides` excludes the non-visible base entry;
  one finding per assignment keyed on the earliest-due open date set, with a count suffix when more
  than one date set is open.
- [x] Design unknown (scope — assignments vs. quizzes): retired — assignments only in v1; graded
  quizzes already covered indirectly via their backing assignment record; ungraded
  quizzes/surveys explicitly out of scope with rationale.
- [x] Design unknown (new check vs. standalone tool): retired — new check on `check_course_setup`,
  per the issue's own stated preference; zero new Canvas calls.
- [x] No new package dependencies.
- [x] No student PII in output; pseudonymizer wrapping not required; no
  `PSEUDONYMIZER_WRAPPED_TOOLS` entry; precedent cited (`list_assignments` already exposes
  `all_dates[].title` unpseudonymized).
- [x] Exact check name, Zod enum addition, description text, helper function signatures, and
  finding `detail` string format specified.
- [x] Canvas client: no changes; exact justification given (assignments.list + all_dates already
  fetched unconditionally).
- [x] Catalog: no changes; exact justification given (extension, not a new tool).
- [x] Manifest regeneration requirement flagged explicitly despite unchanged tool count, with the
  exact failing test identified (`tests/discovery/manifests.test.ts`'s committed-artifact check).
- [x] Test plan: 14 new cases for the new check plus 1 update to the existing "runs all checks"
  test, covering the open/closed/not-yet-due/no-due-date/unpublished matrix, both override
  directions, `only_visible_to_overrides` exclusion, multi-open-date-set selection and count
  suffix, checks-filter fetch gating, and the empty-items case.
- [x] Explicit warning against polluting `DEFAULT_ASSIGNMENTS` with time-relative fixtures, to avoid
  perturbing the other 20 existing tests in the same file.
- [x] FERPA and audience coverage tests unaffected, with reasoning given.
