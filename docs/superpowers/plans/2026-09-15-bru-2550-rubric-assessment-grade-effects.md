# Implementation plan: explicit, verified gradebook effects for `submit_rubric_assessment`

- **Task**: BRU-2550 (parent: BRU-2547 CTO Product Research)
- **Date**: 2026-09-15
- **Design**: [`docs/superpowers/specs/2026-09-15-bru-2550-rubric-assessment-grade-effects.md`](../specs/2026-09-15-bru-2550-rubric-assessment-grade-effects.md). Section references (§) point there.
- **Base**: `origin/main` @ `db2c5e2` (v1.29.3), 165 tools
- **Revision**: 2026-09-19. Folds in the QA findings F1–F5 (BRU-2592) and the CTO decisions Q1–Q6 (design §10).
- **Shape**: one implementation PR, `fix(rubrics): …` (a patch; decision Q1)
- **Suggested owner**: Lead Developer. The diff is ordinary, but a plausible implementation would be wrong in several places that look fine: the `formatError` substring trap (Step 4), `score` vs `entered_score` (Step 3), whole-assessment replacement (Step 3), and "no write happened" assertions that pass vacuously (Step 5).

This plan is only valid because the design fully specifies the contract. If implementation uncovers a Canvas behaviour the design does not cover, stop and amend the design first. Do not improvise a new outcome or a new refusal.

---

## Step 0 — Gates before writing code

1. Create the worktree per the repo's isolation rules. Branch: `fix/bru-2550-rubric-assessment-grade-effects`.
2. `gh pr view 327 --json state,mergedAt,files`. External PR #327 touches **all six** files it shares with this plan (`src/canvas/rubrics.ts`, `src/canvas/types.ts`, `src/tools/rubrics.ts`, `tests/canvas/rubrics.test.ts`, `tests/tools/rubrics.test.ts`, `docs/generated/tool-manifest.json`). There is no functional dependency (§3.1: the new contract never needs an association ID).
   - If #327 is **merged**, rebase onto it. In Step 6, reword its `get_rubric` description, which says association IDs are "needed for rubric assessment writes"; after this PR they are not.
   - If #327 is **open**, proceed. Whichever PR merges second regenerates the manifest.
   - **Sequencing (decision Q4).** As of 2026-09-19, #327 is `OPEN` at `e3f50ebd36cf7b74545d0dc18882eb3dcbd33827`, `BEHIND`, with no checks, because its first-time-contributor workflow needs maintainer approval. The preferred order is #327 first, then rebase this implementation onto it. **The safety fix must not wait indefinitely for #327.** If #327 is still open when the implementation is ready, proceed and ask the contributor to drop "needed for rubric assessment writes" when they rebase. Do not alter #327 from this work.
3. `gh pr list --state open --json number,files` and confirm that no other open PR touches the files below.
4. Confirm the design's base facts still hold on the new base: `git grep -n "rubric_associations/.*rubric_assessments" origin/main -- src/` still shows the legacy endpoint as the only rubric write path.

## Step 1 — Types (`src/canvas/types.ts`, `src/canvas/assignments.ts`)

Add to `CanvasAssignment` (all optional; Canvas omits them conditionally — §2.5):

```ts
use_rubric_for_grading?: boolean
rubric?: CanvasAssignmentRubricCriterion[]
rubric_settings?: {
  id: number // the RUBRIC id, not the rubric association id (§2.5)
  title?: string
  points_possible?: number
  hide_score_total?: boolean
  hide_points?: boolean
  free_form_criterion_comments?: boolean
}
has_sub_assignments?: boolean // emitted only with include[]=checkpoints on checkpoint-enabled courses
moderated_grading?: boolean
grade_group_students_individually?: boolean
```

New type:

```ts
export interface CanvasAssignmentRubricCriterion {
  id: string
  points: number
  description?: string | null
  long_description?: string | null
  ignore_for_scoring?: boolean
  criterion_use_range?: boolean
  outcome_id?: number
  ratings?: Array<{ id: string; points: number; description?: string | null }>
}
```

Widen the existing `rubric_settings?: { id: number }` in place rather than adding a second field. In `src/canvas/assignments.ts`, add `'checkpoints'` to `AssignmentGetInclude`. Adding it to the `get_assignment` tool's `ASSIGNMENT_GET_INCLUDE` enum is **not** required. Leave that tool unchanged, so the manifest diff stays confined to one tool.

## Step 2 — Canvas client (`src/canvas/rubrics.ts`)

```ts
export interface RubricAssessmentCriterionInput {
  criterion_id: string
  points: number | null
  rating_id?: string
  comments?: string
}

/**
 * Save a grading-type rubric assessment through the Submissions API
 * (PUT .../submissions/:user_id with rubric_assessment only). Canvas replaces
 * the whole assessment with the criteria sent; omitted criteria are removed.
 * Whether the gradebook score changes is decided by Canvas (design §2.3), not
 * by this call — callers must verify.
 */
async assessSubmission(
  courseId: number,
  assignmentId: number,
  userId: number,
  criteria: ReadonlyArray<RubricAssessmentCriterionInput>,
): Promise<CanvasSubmission>
```

- `PUT /api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}`, JSON body.
- Body: `{ rubric_assessment: { [criterion_id]: { points, rating_id?, comments? } } }`.
  - `points: null` is sent as JSON `null`. Canvas treats it as "unscored" (probe F2).
  - `rating_id` and `comments` are **omitted** when `undefined`, never sent as `null`.
  - Send no `submission` key and no `comment` key.
- Keep `submitAssessment` **byte-identical except for the added `@deprecated` JSDoc marker** (decision Q2). It is public library API via the `./canvas` export. Do not make it throw, and do not remove it in this PR; it is removed only at a future major release:

  ```ts
  /**
   * @deprecated Sends a body Canvas does not accept (no user_id, no
   * assessment_type, criteria not keyed as criterion_<id>) — Canvas answers 404.
   * Use assessSubmission. Retained only for `canvas-lms-mcp/canvas` API
   * stability; see BRU-2550. Scheduled for removal at the next major release.
   */
  ```

**Tests** (`tests/canvas/rubrics.test.ts`):

- **C1**: `assessSubmission` uses method `PUT` and path `/api/v1/courses/100/assignments/10/submissions/42`.
- **C2**: whole-body string equality (not `toMatchObject`, not `toContain`). For input `[{criterion_id:'_1001',points:4,comments:'Good'},{criterion_id:'_1002',points:null},{criterion_id:'_1003',points:2,rating_id:'r9'}]`, expect exactly
  `{"rubric_assessment":{"_1001":{"points":4,"comments":"Good"},"_1002":{"points":null},"_1003":{"points":2,"rating_id":"r9"}}}`.
  Whole-string equality also proves that no `submission` or `comment` key is present.
- Rename the existing `submits a rubric assessment` test to `deprecated submitAssessment keeps its legacy request (Canvas rejects it — BRU-2550)`. Leave its assertion unchanged. It now characterizes kept behaviour; it no longer endorses that behaviour.

## Step 3 — Pure decision module (`src/tools/rubric-grade-effect.ts`, new)

Keep every Canvas-semantics decision here, free of I/O, so that the refusal and outcome tables are unit-testable without mocks.

```ts
export type GradeEffect = 'apply_rubric_score' | 'assessment_only'
export const SCORE_TOLERANCE = 1e-4 // Rubric::POINTS_POSSIBLE_PRECISION = 4

export type RubricGradebookErrorCode =
  | 'NO_RUBRIC' | 'MODERATED' | 'GROUP_GRADED'
  | 'DUPLICATE_CRITERIA' | 'UNKNOWN_CRITERIA' | 'MISSING_CRITERIA' | 'OUTCOME_CLAMP'
  | 'USE_FOR_GRADING_ON' | 'USE_FOR_GRADING_OFF' | 'CHECKPOINTS' | 'EXCUSED' | 'NO_POINTS'
  | 'WRITE_UNAUTHORIZED' | 'WRITE_OUTCOME_UNKNOWN'
  | 'GRADEBOOK_NOT_UPDATED' | 'UNEXPECTED_GRADEBOOK_CHANGE' | 'ASSESSMENT_NOT_VERIFIED'

export class RubricGradebookError extends ToolOutcomeError { constructor(readonly code: RubricGradebookErrorCode, message: string) }

export function preflight(input: SubmitRubricAssessmentInput, assignment: CanvasAssignment, before: CanvasSubmission): PreflightPlan
export function classify(plan: PreflightPlan, afterWrite: CanvasSubmission, readBack: CanvasSubmission): RubricAssessmentResult
```

**`preflight`** throws on the **first** failing check. The order is fixed so that messages are deterministic (§3.3):

| # | Code | Condition |
| --- | --- | --- |
| 1 | `NO_RUBRIC` | `assignment.rubric` is absent or empty |
| 2 | `MODERATED` | `assignment.moderated_grading === true` |
| 3 | `GROUP_GRADED` | `assignment.group_category_id != null && assignment.grade_group_students_individually !== true` |
| 4 | `DUPLICATE_CRITERIA` | a `criterion_id` repeats in `input.criteria` |
| 5 | `UNKNOWN_CRITERIA` | a `criterion_id` is not in `assignment.rubric` (list them) |
| 6 | `MISSING_CRITERIA` | a rubric criterion is absent from `input.criteria` (list them) |
| 7 | `OUTCOME_CLAMP` | a criterion with `outcome_id` has `points > criterion.points` |
| 8 | `USE_FOR_GRADING_ON` | `grade_effect === 'assessment_only' && use_rubric_for_grading === true` |
| 9 | `USE_FOR_GRADING_OFF` | `grade_effect === 'apply_rubric_score' && use_rubric_for_grading !== true` |
| 10 | `CHECKPOINTS` | `grade_effect === 'apply_rubric_score' && has_sub_assignments === true` |
| 11 | `EXCUSED` | `grade_effect === 'apply_rubric_score' && before.excused === true` |
| 12 | `NO_POINTS` | `grade_effect === 'apply_rubric_score'` and no criterion with `ignore_for_scoring !== true` has non-null `points` |

**Message for #8.** Choose the text by `assignment.has_sub_assignments === true`. If true, use the checkpoint wording (design §3.6, **8b**); otherwise use the generic text. Both keep the code `USE_FOR_GRADING_ON`. Do not use the generic text on a checkpoint parent. It claims that Canvas would replace the score and recommends `apply_rubric_score`. Neither is true there: Canvas does not grade checkpoint parents today (probe J rows 4–6), and #10 refuses `apply_rubric_score` on the same assignment. The two refusals must never send an agent back and forth.

`PreflightPlan` carries the following:
- `grade_effect`
- `use_rubric_for_grading`
- the ignored-criterion ID list
- the requested criteria map
- `enteredBefore = before.entered_score ?? before.score ?? null`
- `excusedBefore`

**`classify`** implements §3.5 exactly:

- Define `enteredOf(s) = s.entered_score ?? s.score ?? null`. **Never compare `score`**: late-policy deductions make `score` differ from the rubric total on every late submission (§3.5).
- `rubricScore` is the sum of `readBack.rubric_assessment[id].points` over criteria where the plan's criterion has `ignore_for_scoring !== true` and the points are non-null. It is `null` if no such points exist. (This replicates `RubricAssociation#assess`: probes D, F, H.)
- Ratings are verified when, for every requested criterion, the read-back points equal the requested points. `null` requested matches a `null` or absent read-back value; numbers match within tolerance. Failure throws `ASSESSMENT_NOT_VERIFIED`.
- `concurrent_change_detected = !sameScore(enteredOf(afterWrite), enteredOf(readBack))`. The outcome always uses `afterWrite`.
- For `apply_rubric_score`:
  - `sameScore(enteredOf(afterWrite), rubricScore)` fails → throw `GRADEBOOK_NOT_UPDATED`;
  - otherwise the outcome is `score_already_matched` if `sameScore(enteredBefore, enteredOf(afterWrite))`, else `score_changed`.
- For `assessment_only`:
  - `!sameScore(enteredBefore, enteredOf(afterWrite)) || afterWrite.excused !== excusedBefore` → throw `UNEXPECTED_GRADEBOOK_CHANGE`;
  - otherwise the outcome is `score_untouched`.
- `sameScore(a, b)`: both `null` → true; exactly one `null` → false; otherwise `Math.abs(a - b) < SCORE_TOLERANCE`.

Messages use the templates in §3.6 verbatim. The `score_*` and `GRADEBOOK NOT UPDATED` templates report observed values only, and never say whether Canvas re-graded (§3.5). Add the late-policy suffix when `score_after` and `entered_score_after` are both non-null and differ. **They must not contain the substrings `fetch`, `network`, `socket`, `dns`, `enotfound`, `econnrefused`, `econnreset` or `etimedout`**. Step 4 makes this moot, but keep the templates clean anyway.

**Tests** (`tests/tools/rubric-grade-effect.test.ts`):

- **P1–P12**: one row per preflight code. Each asserts the thrown `code` and that the message names the reason.
- **P1c–P12c**: a **control per row**, with identical input except that the single triggering condition is flipped. The control must not throw (or must throw a *later* code). Without the controls, a `preflight` that throws on everything passes P1–P12.
- **P-order**: an input that triggers both #8 and #3 throws `GROUP_GRADED`.
- **P8b (checkpoint parent)**: `assessment_only`, `use_rubric_for_grading: true`, `has_sub_assignments: true` → throws `USE_FOR_GRADING_ON`. Assert the message by **whole-string equality** with the §3.6 8b text. Do not use `toContain` or "names the reason", which is why the generic text got through review. Also assert that the message contains neither `apply_rubric_score` nor `replace the student's score`. In the same test, the identical fixture with `grade_effect: 'apply_rubric_score'` throws `CHECKPOINTS` (#10), which pins that both effects are refused and that the two messages do not contradict each other.
- **P8bc (control)**: the same input without `has_sub_assignments` throws `USE_FOR_GRADING_ON` with the **generic** text (whole-string equality). This proves that the variant is chosen by `has_sub_assignments`. Without it, a `preflight` that always returned the checkpoint text would pass P8b.
- **K1**: `apply` with before 80 / after 9 / rubric 9 → `score_changed`.
- **K2**: `apply` with before 9 / after 9 / rubric 9 → `score_already_matched`.
- **K3**: `apply` with before 80 / after 80 / rubric 9 → throws `GRADEBOOK_NOT_UPDATED`.
- **K4**: `assessment_only` with before 80 / after 80 → `score_untouched`.
- **K5**: `assessment_only` with before 80 / after 9 → throws `UNEXPECTED_GRADEBOOK_CHANGE`.
- **K6**: `assessment_only` with before `excused: true` and after `excused: false`, scores both `null` → throws `UNEXPECTED_GRADEBOOK_CHANGE`.
- **K7 (late policy)**: `apply` with before 80 (no deduction), after `{score: 8, entered_score: 9, points_deducted: 1}` and rubric 9 → `score_changed`, not `GRADEBOOK_NOT_UPDATED`. The message ends with the late-policy suffix (final score 8).
- **K8**: tolerance. 9.00009 vs 9 matches; 9.0002 vs 9 throws.
- **K9**: `ignore_for_scoring` criterion with points 2 is excluded (rubric 9, not 11).
- **K10**: before `null` (ungraded), after 9 → `score_changed`.
- **K11**: read-back points differ from requested → `ASSESSMENT_NOT_VERIFIED`.
- **K12**: afterWrite 9, readBack 12 → outcome `score_changed`, `concurrent_change_detected: true`.
- **K13 (late policy: Canvas gates on `score`, so it skips)**: `apply` with before and afterWrite both `{score: 9, entered_score: 10, points_deducted: 1}` and rubric 9 → throws `GRADEBOOK_NOT_UPDATED`. Canvas's gate (`artifact.score == score`, design §3.5 case A) sees 9 = 9 and returns early, so the entered score stays 10. Assert the whole message: `GRADEBOOK NOT UPDATED: the rubric assessment was saved, but the entered gradebook score is not the rubric total. The entered score after the write is 10 (final score 9 after a late-policy deduction); the rubric total is 9. Do not tell the user the grade changed to the rubric total.`
- **K14 (late policy: Canvas re-grades and the result is identical)**: `apply` with before and afterWrite both `{score: 8, entered_score: 9, points_deducted: 1, posted_at: <set>}` and rubric 9 → outcome `score_already_matched`, `entered_score_after: 9`, `score_after: 8` (design §3.5 case B). Assert the whole message: `Rubric assessment saved. The entered gradebook score was already 9, equal to the rubric total, and it is unchanged. The student's final score is 8 after a late-policy deduction.` It must not contain `re-grade`: from the submission alone the tool cannot tell whether Canvas re-graded.

## Step 4 — Verbatim rendering for reported outcomes (`src/tools/errors.ts`)

```ts
/** An error whose message is a complete, user-facing report. Rendered verbatim. */
export class ToolOutcomeError extends Error {
  override name = 'ToolOutcomeError'
}
```

In `formatError`, add `if (error instanceof ToolOutcomeError) return error.message` as the **first** branch. **Why first:** the generic `Error` branch runs `isNetworkError`, which rewrites any message containing `fetch`, `network`, `socket` or `dns` into "Failed to connect to Canvas". A report that mentions a network failure (`WRITE_OUTCOME_UNKNOWN` legitimately can) would be replaced by a lie.

**Test** (in `tests/tools/format-error.test.ts`): `formatError(new ToolOutcomeError('network fetch failed after the write; observed score 9'))` returns that exact string. **Injection check (quote it in the PR)**: move the branch below the generic `Error` branch and confirm that exactly this test fails.

## Step 5 — The tool (`src/tools/rubrics.ts`)

Replace `submit_rubric_assessment` in place. Keep the name, the position in the array and the annotations (`destructiveHint`, `idempotentHint` and `openWorldHint`, all `true`). Use the input schema from §3.2 and the description from §3.7 **verbatim**. Add `output: objectOutput(RUBRIC_ASSESSMENT_RESULT_SCHEMA)` using the `z.strictObject` from §3.6. The shape is server-authored, and Canvas-sourced scalars are `.nullable()` with no constraints (CLAUDE.md rule 8).

Handler algorithm:

```ts
const [assignment, before] = await Promise.all([
  canvas.assignments.get(course_id, assignment_id, { include: ['checkpoints'] }),
  canvas.submissions.get(course_id, assignment_id, user_id, { include: ['rubric_assessment'] }),
])
const plan = preflight(input, assignment, before) // throws RubricGradebookError → no write

let afterWrite: CanvasSubmission
try {
  afterWrite = await canvas.rubrics.assessSubmission(course_id, assignment_id, user_id, input.criteria)
} catch (error) {
  if (error instanceof CanvasApiError && error.status === 401) {
    throw new RubricGradebookError('WRITE_UNAUTHORIZED', /* §3.6 template */)
  }
  if (error instanceof CanvasApiError && error.status >= 400 && error.status < 500) throw error
  const observed = await canvas.submissions
    .get(course_id, assignment_id, user_id, { include: ['rubric_assessment'] })
    .catch(() => null)
  throw new RubricGradebookError('WRITE_OUTCOME_UNKNOWN', /* §3.6 template with observed */)
}

let readBack: CanvasSubmission
try {
  readBack = await canvas.submissions.get(course_id, assignment_id, user_id, { include: ['rubric_assessment'] })
} catch {
  throw new RubricGradebookError('ASSESSMENT_NOT_VERIFIED', /* §3.6: write accepted, read-back failed, score right after write = enteredOf(afterWrite) */)
}
return classify(plan, afterWrite, readBack)
```

The handler must not return the raw submission objects. The result carries no user identity, so the tool is **not** added to `PSEUDONYMIZER_WRAPPED_TOOLS`. Confirm that `tests/pseudonym/coverage.test.ts` stays green without an entry.

### Test double: `tests/tools/fixtures/rubric-gradebook-fake.ts` (new)

Test at the **fetch** level through a real `CanvasClient`. Do not use `vi.fn()` on module methods: the wire shape is part of what broke (§1.1), so the tests must exercise it.

The fake holds `assignment`, `submission` and `assessment` state, and records every request (`method`, `path`, `query`, `body`). Its knobs:

- **`gradeWrite`**, one of three modes:
  - `'canvas'` (default) replicates the `update_artifact` gates (probe J). Its "already equal" gate compares the **final** `score` with the rubric total, as Canvas does (`artifact.score == score`), not `entered_score`. Otherwise a late-policy fixture would not reproduce the two divergent cases in design §3.5;
  - `'never'` accepts the assessment and never changes the score (**the silent-accept model the brief asks for**);
  - `'always'` changes the score even when `use_for_grading` is off.
- **`checkpointsFeature`** (default `false`): emits `has_sub_assignments` only when this is `true` **and** the request carried `include[]=checkpoints`.
- **`putStatus`**: forces an error status on `PUT`.
- **`failReadBack`**: the GET after the PUT throws.
- **`afterPut(state)`**: a concurrent-writer hook that runs between the PUT response and the read-back.

The fake's routes mirror §2:

- **GET assignment** emits `use_rubric_for_grading`, `rubric` and `rubric_settings` only when a rubric is attached.
- **GET submission** emits `rubric_assessment` only with `include[]=rubric_assessment`.
- **PUT submission** behaves as follows:
  - It returns 400 `invalid rubric_assessment` if no key is a known criterion (probe G1).
  - It drops unknown keys (G2).
  - It returns 200, with nothing processed, when no rubric is attached (I).
  - It replaces the assessment with exactly the sent criteria (E).
  - It computes the score over non-ignored, non-null points (D, F2, H).
  - It applies `gradeWrite`.
  - Applying a score sets `entered_score` and `graded_at`, sets `score = entered_score - (points_deducted ?? 0)`, and sets `excused = false`.
  - Its response omits `rubric_assessment`, matching Canvas.

**Self-test** (`tests/tools/fixtures/rubric-gradebook-fake.test.ts`): the fake reproduces probe results D (score 9 with one ignored criterion), E (omitted criteria erased), G1 (400), G2 (unknown dropped) and I (200, nothing stored). This pins the double to the executed Canvas evidence, so a later edit to the fake cannot silently make it more permissive than Canvas.

### Handler tests (`tests/tools/rubrics.test.ts`, replacing the old `submit_rubric_assessment` block)

Every "no write" assertion is `expect(fake.requests.filter(r => r.method === 'PUT')).toHaveLength(0)` **and** has a paired control that issues exactly one PUT.

- **H1**: `apply`, U on, 80 → 9 gives `score_changed` and `isError` falsy. The request order is two GETs, then the PUT, then the GET. **Ordering assertion:** the PUT index is greater than both preflight GET indices.
- **H2**: `apply`, U on, already 9 → `score_already_matched`.
- **H3 (silent accept)**: `apply`, U on, `gradeWrite: 'never'` → `isError: true`. The text starts `GRADEBOOK NOT UPDATED` and contains both `80` and `9`. The fake shows one PUT and a stored assessment.
- **H4**: `assessment_only`, U off → `score_untouched`, and the fake's score is unchanged.
- **H5**: `assessment_only`, U off, `gradeWrite: 'always'` → `isError: true`. The text starts `UNEXPECTED GRADEBOOK CHANGE` and says the tool did not revert. The fake records no second write of any kind: **the tool never auto-corrects a grade**.
- **H6**: refusals through the full handler. Run each of `USE_FOR_GRADING_ON`, `USE_FOR_GRADING_OFF`, `CHECKPOINTS` (with `checkpointsFeature: true`), `NO_RUBRIC`, `MODERATED`, `GROUP_GRADED`, `EXCUSED`, `NO_POINTS`, `MISSING_CRITERIA` and `UNKNOWN_CRITERIA`, **plus the checkpoint variant of `USE_FOR_GRADING_ON`** (`assessment_only`, `checkpointsFeature: true`, whole-string equality with the §3.6 8b text). Each asserts zero PUTs, plus one control per row that PUTs.
- **H7**: with `checkpointsFeature: true` and `has_sub_assignments: true`, the preflight GET carried `include[]=checkpoints`. Assert this on the recorded query. Otherwise H6's `CHECKPOINTS` row could pass only because the fake emitted the field unconditionally.
- **H8**: PUT 401 → text starts `WRITE UNAUTHORIZED` and does **not** contain `token is invalid`. There is no read-back request.
- **H9**: PUT 403/404/400 → the existing `formatError` text, with no read-back request.
- **H10**: PUT 500 → text starts `WRITE OUTCOME UNKNOWN` and contains the observed score. Exactly one read-back GET.
- **H11**: `failReadBack` after a 200 PUT → text starts `ASSESSMENT NOT VERIFIED`, states that the write was accepted, and quotes the score from the write response.
- **H12**: an `afterPut` concurrent writer sets the score to 12 → outcome `score_changed`, with `concurrent_change_detected: true`.
- **H13 (MCP boundary)**: use `InMemoryTransport` plus `Client` and `createCanvasMCPServer`.
  - Call `listTools()` **first**: it arms output validation.
  - Call `callTool` with the legacy args `{course_id, association_id, data}`. It resolves with `isError: true` (input validation), and the fake records **zero** requests.
  - Call `callTool` with valid H1 args. `structuredContent` passes the client's validator.
- **H14**: annotations are unchanged (`destructiveHint`, `idempotentHint` and `openWorldHint`, all `true`). **This one is a characterization test and passes before the change**; say so in the PR.

**Output fixture**: add `submit_rubric_assessment` to `OUTPUT_FIXTURES` in `tests/tools/fixtures/output-fixtures.ts`, following the existing entry shape. Mock `assignments.get` (U on, three-criterion rubric), `submissions.get` (first call score 80, later calls with `rubric_assessment`) and `rubrics.assessSubmission` (entered score 9).

**RED check.** Write the tests, then run them before implementing Steps 3–5, **by file**. Steps 1–2 are already in place at that point, and the fake is test-side code. Do not use a single "all but N must be red" rule, because nine tests are green by construction:

| File | Tests | Before Steps 3–5 | Why |
| --- | --- | --- | --- |
| `tests/tools/rubric-grade-effect.test.ts` | P1–P12, P1c–P12c, P8b, P8bc, P-order, K1–K14 | **all red** | `preflight` and `classify` do not exist yet |
| `tests/tools/rubrics.test.ts` | H1–H13 | **all red** | the handler still has the legacy contract |
| `tests/tools/rubrics.test.ts` | H14 | green | characterization of unchanged annotations |
| `tests/tools/format-error.test.ts` | the `ToolOutcomeError` rendering test (Step 4) | **red** | the branch does not exist yet |
| `tests/tools/output-contract.test.ts` | the completeness gate, once the `OUTPUT_FIXTURES` entry is added | **red** | the fixture names a tool that declares no `output` yet |
| `tests/tools/fixtures/rubric-gradebook-fake.test.ts` | the five probe-pinned self-tests (D, E, G1, G2, I) | green by construction | they test the fake only and touch no production code |
| `tests/canvas/rubrics.test.ts` | C1, C2 | green | Step 2 is already implemented |
| `tests/canvas/rubrics.test.ts` | the renamed deprecated `submitAssessment` test | green | characterization of unchanged code |

That is **nine green tests** (5 self-tests + C1 + C2 + the renamed client test + H14). Everything else must be red. Any green test in a row marked "all red" is vacuous, so fix it before continuing. Any red test in a green row means that Step 1, Step 2 or the fake is wrong.

- **C1 and C2 have their own RED**: see them fail *before* `assessSubmission` is written in Step 2. They are green only at the Step 3–5 check.
- **The fake's self-tests are checked by mutation**, since they cannot go red against production code. Make the fake stop dropping unknown keys, and confirm that the G2 self-test fails. Then revert.
- **Red must come from an assertion, not a missing import.** Until `src/tools/rubric-grade-effect.ts` exists, every test in its file fails at import, which proves nothing about the assertions. Create the module first with stubs that throw or return a wrong value, then run the check.

## Step 6 — Docs, skill, manifests

1. `pnpm generate:manifests`. Expect a diff only in the `submit_rubric_assessment` description and the related workflow text; confirm with `git diff --stat docs/generated`.
2. `docs/educator-guide.md`:
   - **Example 6**: say that the assistant first checks whether the rubric is used for grading and asks which effect is intended.
   - **Line 43 and the table row at line 77**: replace "submitting again overwrites the previous assessment" with "Canvas replaces the whole assessment; criteria left out are removed".
3. `docs/workflows/educator-assignment-review.md`:
   - Fix the incorrect "overwrites prior rubric values for the targeted criteria" (probe E: *all* criteria are replaced).
   - Add a note: when the rubric is used for grading, do not call `grade_submission` after a rubric write. Canvas re-applies the rubric total on the next rubric save (§4.5).
4. `skills/canvas-grading-pass/SKILL.md`:
   - **Step 2 (line 26)**: it tells the agent to "check `rubric_id` in the assignment object from `get_assignment`". Canvas's assignment serializer emits **no `rubric_id`**. It emits `rubric`, `rubric_settings.id` (the *rubric's* ID) and `use_rubric_for_grading` (pinned `lib/api/v1/assignment.rb:330–362`). Rewrite it: an attached rubric is one where `get_assignment` returns `rubric` (criteria and points are already there), `get_rubric` takes `rubric_settings.id`, and `use_rubric_for_grading` is read here. Without this, step 2 contradicts 4c, which reads the criteria from `get_assignment`'s `rubric`.
   - **Adjacent surface (found by `rg -n "rubric_id" skills/ docs/`; not in QA's F3):** `skills/canvas-course-qc/SKILL.md:74` says "If `rubric_id` is null on an assignment … flag it as a missing rubric". That reads the same always-absent field, so the check cannot tell an attached rubric from a missing one. Change it to test for the absence of `rubric` in `get_assignment`'s result. Re-run the same `rg` after the edits: the only remaining `rubric_id` hits in `skills/` must be negations ("there is no `rubric_id`"), if any.
   - **4a**: `get_rubric_assessment` takes `course_id`, `assignment_id` and `user_id`, not a rubric ID.
   - **4c**: new parameters. Read `use_rubric_for_grading` from `get_assignment` and choose `grade_effect` from it. Remove `rubric_id`, `rubric_association_id` and `graded_anonymously`, none of which exist.
   - **4d**: call `grade_submission` only when the rubric is **not** used for grading.
   - **Report line**: quote the tool's `outcome`, and never state a grade change unless it is `score_changed`.
5. If #327 is merged, remove "needed for rubric assessment writes" from the `get_rubric` description, then regenerate.
6. **Do not run Prettier on `README.md` or `docs/`.** The lint script scopes to `src/ tests/`, and reflowing markdown tables breaks `tests/docs/tool-count-consistency.test.ts`.

## Step 7 — Validation

1. `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. The tool count stays **165 (117 read / 48 write)**, because no tool is added or removed.
2. **Injection checks.** Revert each change after running it, and quote the failing test names in the PR:
   - move the `ToolOutcomeError` branch below the generic `Error` branch → only the Step 4 test fails;
   - compare `score` instead of `entered_score` → K7 fails;
   - delete the `MISSING_CRITERIA` check → P6 and its H6 row fail, while P6c still passes;
   - always use the generic #8 text, even on a checkpoint parent → P8b and its H6 checkpoint row fail, while P8bc still passes;
   - issue the PUT before awaiting the preflight → H1's ordering assertion fails;
   - drop `include: ['checkpoints']` → H7 fails.
3. **Dist probe.** `pnpm build`, then run a scratch `.mjs` script under `$PAPERCLIP_RUN_SCRATCH_DIR` that imports `file:///<abs>/dist/server.js` with a stubbed `fetch` implementing the fake's three routes. Call `server._registeredTools['submit_rubric_assessment'].handler` for `score_changed`, `GRADEBOOK NOT UPDATED` and one refusal, and quote the three outputs plus the PUT count for the refusal (0).
4. `git diff --stat` before committing. On Windows, check for CRLF whole-file rewrites in the markdown files.

## Step 8 — PR and handoff

- **Title**: `fix(rubrics): make submit_rubric_assessment work and verify its gradebook effect`
- **Body**:
  - link the design and the probe evidence (§Appendix A);
  - **disclose the input-shape change explicitly (decision Q1)**: `association_id` and `data` are removed, and `assignment_id`, `user_id`, `grade_effect` and `criteria` are required. The old shape never succeeded against Canvas, so no working caller breaks. The release-please "Bug Fixes" line will be the only notice most users see, so repeat the shape change in the PR body and in the changelog context;
  - state that `RubricsModule.submitAssessment` is unchanged except for the `@deprecated` marker, with removal only at a future major (decision Q2);
  - list deviations from the design, if any;
  - list the RED tests vs the tests that are green by construction (nine; see the RED-check table in Step 5);
  - include the injection results and the dist probe output;
  - add the #327 sequencing note (decision Q4);
  - note that the repo-wide 401 wording (decision Q5) is out of scope and needs a separate follow-up ticket.
- Hand off to QA for code review.

## Rollback

- **Code**: `git revert -m 1 <merge-sha>` restores the previous tool, client and manifest in one commit; release-please then cuts a patch. There is no config, persisted state or migration to unwind.
- **What a revert does not undo**: grades and rubric assessments that v2 wrote to Canvas in the interim. They are real Canvas writes; find them with `get_gradebook_history_feed` (grader = the token's user) if needed.
- **After revert**: the tool is back to the pre-change state, where every call fails with a 404 (§1.1). That is harmless but useless. If v2 must be pulled faster than a release cycle, deployers have no per-tool kill switch (`CANVAS_DESTRUCTIVE_TOOLS=block` covers only the seven delete tools), so the fastest path is pinning the previous npm version.

## Size

About 700–900 changed lines, roughly 60% of them tests. Everything above is a single PR. If QA prefers two, the only safe split point is Steps 1–2 (types and client, with no tool change) followed by Steps 3–7. Shipping docs or the skill before the tool would describe parameters that do not exist yet.
