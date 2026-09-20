# Rubric assessment gradebook effects: explicit intent, preflight, verified postconditions

- **Task**: BRU-2550 (parent: BRU-2547 CTO Product Research, finding 2 of Product Research 2026-09-14)
- **Date**: 2026-09-15
- **Status**: Design only. No runtime source change is included in this PR.
- **Revision**: 2026-09-19. Folds in the QA findings F1–F5 (BRU-2592) and the CTO decisions Q1–Q6 (BRU-2593); §10 now records the decisions.
- **Base**: `origin/main` @ `db2c5e2` (v1.29.3), 165 tools (117 read / 48 write)
- **Canvas source**: `instructure/canvas-lms` `master` @ `1c9f0bb8013e` (the public mirror's HEAD when this was written; that commit is dated 2026-04-30)
- **Implementation plan**: [`docs/superpowers/plans/2026-09-15-bru-2550-rubric-assessment-grade-effects.md`](../plans/2026-09-15-bru-2550-rubric-assessment-grade-effects.md)
- **Probe script**: [`2026-09-15-bru-2550-assets/canvas-source-probe.rb`](2026-09-15-bru-2550-assets/canvas-source-probe.rb)

Every claim about Canvas carries one of four evidence tags:

| Tag | Meaning |
| --- | --- |
| **[D]** | Official REST documentation (developerdocs.instructure.com, fetched 2026-09-15) |
| **[S]** | Source reading at the pinned SHA; not executed |
| **[P]** | Executed. The Canvas method body was extracted verbatim from the pinned SHA and run under real Rails 8.1 parameter parsing with the model layer stubbed (Appendix A). This proves how Canvas's code interprets a request. It does not prove what a given hosted instance runs. |
| **[W]** | Wire capture of the request our shipped code actually sends |

No real Canvas instance was used.

---

## 0. Summary

1. **The shipped `submit_rubric_assessment` cannot create a rubric assessment.** It posts `{"rubric_assessment":{"data":[…]}}` with no student identifier. Canvas raises `ActiveRecord::RecordNotFound`, and our error mapper turns that into *"Course/assignment/submission not found — check the ID"* **[W][P]**. The input schema has no `user_id` at all. The request has been in this shape since the initial implementation (`eb76b3f`, 2026-04-12), and a unit test asserts this broken body.
2. **The brief's failure mode ("assessment stored, grade unchanged") is therefore not reachable through our tool today.** It becomes reachable the moment someone fixes the request. That is why the request fix and the gradebook contract have to ship together, and why a narrow "just add `user_id`" patch is the unsafe option (§9-A).
3. **Recommendation:** keep the tool name and rebuild it on the Submissions API rubric path. The new tool has three parts:
   - a required `grade_effect` intent (`apply_rubric_score` | `assessment_only`);
   - a preflight of two reads that **refuses without writing** in every combination where Canvas would do something other than what was asked;
   - a postcondition computed from Canvas's own post-write submission, so that a success result is only ever issued with evidence.
4. **A combined rubric + `posted_grade` request is not safe.** When the rubric is used for grading, Canvas applies the posted grade first and then overwrites it with the rubric total in the same request **[S][P]**. The competitor lead's claim that including `posted_grade` "sidesteps all four gates" is false (§5). It is not offered.
5. **The implementation is narrow and fully specified**, so a separate plan is included: one PR, of which about 60% is tests.

## 0.1 Live-state gate

| Check | Command | Result |
| --- | --- | --- |
| Existing design for rubric grade effects | `grep -rli "use_for_grading\|use_rubric_for_grading" docs/superpowers/` | **0 files** (before this PR): no prior design mentions the flag at all |
| History of the write path | `git log --format='%h %ad %s' --date=short -- src/canvas/rubrics.ts src/tools/rubrics.ts` | `e5ad732` (#280, titles only), `e53946e` (#106, `create_rubric`), `eb76b3f` (#5, initial). `submitAssessment` is unchanged since `eb76b3f` |
| Issues reporting a rubric write failure | `gh issue list --state all --search rubric` | 4 results, all unrelated (#230, #186, #75, #78) |
| Open PRs on the same files | `gh pr view 327 --json files,state,headRefOid,mergeStateStatus,statusCheckRollup` | **#327** (external, `chiptoe-svg`, open since 2026-08-28): adds `include[]` to `get_rubric` to expose association IDs. It overlaps all 6 files the implementation touches; there is no functional dependency (§3.1, Q4). Re-checked 2026-09-19: still `OPEN` at `e3f50ebd36cf7b74545d0dc18882eb3dcbd33827`, `BEHIND` `main`, no checks. Its only CI run is `action_required`, waiting for a maintainer to approve a first-time-contributor workflow |

---

## 1. Corrections to the brief and to the lead

### 1.1 The tool never produced a request Canvas accepts

Wire capture **[W]**: the real handler was called through `createCanvasMCPServer` with `fetch` stubbed.

```text
POST https://canvas.example.com/api/v1/courses/100/rubric_associations/5/rubric_assessments
Content-Type: application/json
{"rubric_assessment":{"data":[{"criterion_id":"_1001","points":4,"comments":"Good"},…]}}
→ tool result: {"isError":true,"content":[{"text":"Course/assignment/submission not found — check the ID"}]}
```

Canvas's handling of that body **[P]** (probe A1, A2):

- `RubricAssessmentsController#update` calls `resolve_user_id`, which reads `params[:rubric_assessment][:user_id]`. That is `nil`, so `raise ActiveRecord::RecordNotFound if user_id.blank?` fires, and `api_error_json` renders 404 `The specified resource does not exist.` **[S]**.
- Even past that guard, `RubricAssociation#assess` would find no `criterion_<id>` keys. The result is `replace_ratings: false`, zero stored criteria and score `nil`. It would also raise on the missing `assessment_type` **[S]**.

Five documentation surfaces describe parameters or fields that do not exist:

- `skills/canvas-grading-pass/SKILL.md` §2 (line 26): "check `rubric_id` in the assignment object from `get_assignment`". Canvas's assignment serializer emits no `rubric_id`. It emits `rubric` and `rubric_settings.id`, which is the *rubric's* ID, and `use_rubric_for_grading` (pinned `lib/api/v1/assignment.rb:330–362`) **[S]**;
- `skills/canvas-course-qc/SKILL.md` §5 (line 74): "If `rubric_id` is null on an assignment … flag it as a missing rubric". It reads the same absent field, so it cannot distinguish an attached rubric from a missing one;
- the grading-pass skill's §4c (`rubric_id`, `rubric_association_id`, `graded_anonymously`);
- the same skill's §4a (`get_rubric_assessment` "with course ID, rubric ID, and submission ID");
- `docs/workflows/educator-assignment-review.md`, which says the write "overwrites prior rubric values for the targeted criteria". In fact the write replaces **all** criteria (§2.4).

**Consequence:** no rubric assessment, and therefore no silent grade change, has been written through this server. The contract change in §6 breaks no working caller.

### 1.2 "Add the missing fields" is not a safe fix either

On the endpoint we use today, the two obvious in-place fixes behave differently **[P]**:

| Probe | Body | Canvas outcome |
| --- | --- | --- |
| B1 | JSON with numeric `user_id: 42` (what `JSON.stringify` of our `number` input produces) | `Api::ID_REGEX.match?(42)` raises `TypeError: no implicit conversion of Integer into String`, which is unrescued, so **500** |
| B2 / C1 | JSON with string `"42"`, or form-encoded as documented **[D]** | Accepted |

A fix that works (C1) still leaves four problems:

- It needs a rubric **association** ID that no read tool exposes. `rubric_settings.id` on the assignment is the **rubric** ID **[S]**; #327 would add the lookup.
- It reaches `RubricAssessment#update_artifact` without an upfront authorization check on grading rights (§2.3).
- On non-assignment associations the controller itself notes a crash **[S]**.
- It leaves every gate in §2 silent.

### 1.3 The lead's "four gates" undercount what an agent must know

The lead (competitor issue `vishalsachdev/canvas-mcp#374`, treated as untrusted) names `use_for_grading`, grading rights, checkpoint parents and `ignore_for_scoring`. All four re-derive correctly. Re-deriving from source adds eight more behaviours, and each one changes the design:

| # | Behaviour | Evidence | Design consequence |
| --- | --- | --- | --- |
| a | Omitted criteria are **deleted**, and the score is the sum of only the criteria sent | [P] E | Require every criterion (§3.3) |
| b | Unknown criterion keys are **silently dropped** if at least one key is valid; they are rejected only if none is | [P] G1, G2 | Validate IDs locally |
| c | On the Submissions path, a rubric assessment sent to an assignment with no active rubric is **silently ignored** | [P] I | Refuse when there is no rubric |
| d | If no scored criterion has points, the rubric score is `nil`, and `update_artifact` calls `grade_student(score: nil)`, which **clears** an existing grade | [P] J row 3; clearing is [S] `save_grade_to_submission` | Refuse `apply` with no points |
| e | Applying a score to an **excused** submission un-excuses it (`submission.excused = opts[:excused] && score.blank?`) | [S] | Refuse `apply` when excused |
| f | Group assignments not graded individually **fan out** to every member | [S] `assess` | Refuse group-graded assignments in v1 (Q3) |
| g | Late-policy deductions make `score` differ from the rubric total; `entered_score` is the pre-deduction value | [S] `SUBMISSION_JSON_METHODS` | Compare `entered_score` |
| h | Canvas answers authorization failures with **401**, which our `formatError` reports as "token is invalid or expired" | [S] `render_unauthorized_action` → `render_json_unauthorized`, `status: :unauthorized` | Special-case the write's 401 (§3.6) |

### 1.4 `posted_grade` in the same request does not sidestep the flag

See §5.

---

## 2. Canvas behaviour, re-derived

### 2.1 What the official docs do and do not say

- **Rubrics, "Create a single rubric assessment"** **[D]**:
  - it documents `rubric_assessment[user_id]` and `rubric_assessment[assessment_type]` ("'grading', 'peer_review', or 'provisional_grade'");
  - it documents `rubric_assessment[criterion_id][points|comments]`, keyed "ex: criterion_123";
  - it documents `rubric_association[use_for_grading]` only as "Whether or not the associated rubric is used for grade calculation".
- **Submissions, "Grade or comment on a submission"** **[D]**: documents `rubric_assessment[criterion_id][points|rating_id|comments]`, keyed by the bare criterion ID.
- **Assignments** **[D]**: the Assignment object documents `use_rubric_for_grading` and `rubric[].ignore_for_scoring`.
- **Not documented anywhere:**
  - that writing an assessment can change, or fail to change, the grade;
  - the grading-right or checkpoint conditions;
  - the whole-assessment replacement.
- **Not in the Assignment object doc:** `has_sub_assignments` (source only, §2.5).

### 2.2 The two write endpoints

| | `POST /courses/:c/rubric_associations/:a/rubric_assessments` (today) | `PUT /courses/:c/assignments/:a/submissions/:u` with `rubric_assessment` only (recommended) |
| --- | --- | --- |
| Identifies the student by | body `rubric_assessment[user_id]` (JSON integer → 500, B1) | URL path |
| Needs an association ID | yes (no read tool exposes it; #327 would) | no |
| Criterion key format | `criterion_<id>` | bare `<id>`; the controller prefixes `criterion_` **[S]** |
| `assessment_type` | caller-supplied (required) | forced to `"grading"` **[S]** |
| Authorization before the write | `user_can_assess_for?`, which also passes for peer reviewers and self-assessors **[S]** | `authorized_action(@submission, :grade)`, returning 401 before any assessment or grade write **[S]** |
| No valid criterion keys | nothing stored, no error | 400 `invalid rubric_assessment` [P] G1 |
| No active rubric on the assignment | n/a (the association *is* the rubric) | **silently ignored**, 200 [P] I |
| Response | assessment JSON with `artifact` | submission JSON after `@submission.reload` **[S]**; no `rubric_assessment` |
| Grade side effect | `update_artifact` (§2.3) | same `assess` → `update_artifact` **[S]** |

### 2.3 When a rubric write changes the grade

`RubricAssessment#update_artifact` runs `after_save`. Its body was executed across all 24 combinations of four inputs:
- `use_for_grading`;
- the assessor's `:grade` right;
- `checkpoints_parent?`;
- the score relation: differs, already equal, or rubric score `nil`.

The result **[P]** (probe J, full table in Appendix A):

> `grade_student` is called **only** when `use_for_grading ∧ assessor has :grade ∧ ¬checkpoints_parent ∧ submission.score ≠ rubric score`. It is called with `score: 9.0` when they differ, and with **`score: nil`** when the rubric score is empty. In every other combination the assessment is saved and the grade is untouched, with no error.

On the recommended endpoint, the grading-right gate cannot fail silently. The chain is **[S]**:

- the endpoint first requires `Submission` `:grade`;
- that right is `can_grade?`, which returns `:cant_manage_grades` for any user without course `manage_grades` before it can reach `:success`;
- `update_artifact` checks `Assignment` `:grade`, which is granted by exactly course `manage_grades` (`abstract_assignment.rb` policy).

So a caller who gets past authorization holds the right that `update_artifact` checks. A caller who doesn't gets a 401 and nothing is written.

### 2.4 How the rubric score is computed

This is `RubricAssociation#assess`, executed **[P]** against a rubric with criteria `_1001` (5 pts), `_1002` (5 pts) and `_1003` (2 pts, `ignore_for_scoring`):

| Probe | Sent | Stored criteria | Score |
| --- | --- | --- | --- |
| D | all three: 4, 5, 2 | all three; `_1003` flagged `ignore_for_scoring` | **9.0** (`_1003` excluded) |
| E | `_1001: 4` only | **only `_1001`**; the others are erased | **4.0** |
| F | `_1001` comments only | `_1001` | **nil** |
| F2 | all three `points: null` | all three, unscored | **nil** |
| G2 | `_1001: 4` + `bogus: 5` | `_1001` (`bogus` silently dropped) | 4.0 |
| H | `_1001: 0`, `_1002: 0` | both | **0.0** (zero counts as a score) |

Outcome-aligned criteria are capped at the criterion's maximum unless the course enables the `outcome_extra_credit` feature (`assessment_points`) **[S]**. That flag is not readable through the API we use.

### 2.5 Which gates are observable before writing

| Gate | Observable? | Where |
| --- | --- | --- |
| Rubric attached and active | yes | `GET assignment`: `rubric` and `use_rubric_for_grading` are emitted only when `active_rubric_association?` **[S]** |
| `use_for_grading` | yes | `use_rubric_for_grading` is literally `assignment.rubric_association.use_for_grading` **[S][D]** |
| `ignore_for_scoring` | yes | `rubric[].ignore_for_scoring` **[S][D]** |
| Checkpoints parent | yes, **only with `include[]=checkpoints`** | `has_sub_assignments` is emitted only when the course has `discussion_checkpoints_enabled`, which is the other half of `checkpoints_parent?` (`has_sub_assignments? && context.discussion_checkpoints_enabled?`). An absent field means "not a checkpoints parent" **[S]** |
| Moderated grading | yes | `moderated_grading` **[S]** |
| Group grading | yes | `group_category_id`, `grade_group_students_individually` **[S]** |
| Excused, prior score, late deduction | yes | `GET submission`: `excused`, `score`, `entered_score`, `points_deducted` **[S]** |
| Grading right, closed grading period, moderation in progress | **no**, but enforced before the write on the recommended endpoint (§2.3) | 401 from the write |
| `outcome_extra_credit` | no | — |
| Association ID | not on the assignment (`rubric_settings.id` is the rubric's ID) **[S]** | `GET rubric?include[]=assignment_associations` [D], which the recommended design does not need |

New Quizzes assignments are serialized by a different serializer (`use_quiz_json?`) **[S]**. If it omits `rubric`, the preflight refuses with `NO_RUBRIC`, so the check fails closed.

---

## 3. Recommended contract

### 3.1 Endpoint

`PUT /api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id` with a JSON body containing **only** `rubric_assessment`. It is chosen over the rubric-associations endpoint for the reasons in §2.2:
- the student is identified in the URL (no B1 trap);
- no association lookup is needed (so there is no dependency on #327);
- authorization is enforced before the write;
- `assessment_type` is fixed to `grading`;
- a request with no valid criterion keys is rejected.

Its one silent failure, the missing rubric (probe I), is covered by the preflight.

### 3.2 Input schema

```ts
{
  course_id: z.number().describe('The Canvas course ID'),
  assignment_id: z.number().describe('The Canvas assignment ID'),
  user_id: z.number().describe('The Canvas user ID of the student being assessed'),
  grade_effect: z
    .enum(['apply_rubric_score', 'assessment_only'])
    .describe(
      'Whether this write may change the gradebook score. "apply_rubric_score" requires the rubric to be used for grading; "assessment_only" requires that it is not.',
    ),
  criteria: z
    .array(
      z.object({
        criterion_id: z.string().min(1).describe('Rubric criterion id (e.g. "_1234"), from get_assignment rubric[].id'),
        points: z.number().min(0).nullable().describe('Points for this criterion, or null to leave it unscored'),
        rating_id: z.string().optional().describe('Optional rating id. Display only: Canvas scores from points, not from the rating'),
        comments: z.string().optional().describe('Optional comment for this criterion'),
      }),
    )
    .min(1)
    .describe('One entry for every criterion in the assignment rubric'),
}
```

- `grade_effect` has **no default**. The caller must state intent on every call.
- `points` is required but nullable, so an unscored criterion is an explicit choice. Omission is not an option because Canvas deletes what is omitted.
- `rating_id` alone does not score: Canvas only derives points from a rating when `get_score_from_rating` is set, which this path never sets **[S]**.
- Negative points are rejected at input. A rubric has no legitimate negative rating, and a sign error would lower a real grade.

### 3.3 Preflight: refusals issued before any write

The tool reads `GET assignment?include[]=checkpoints` and `GET submission?include[]=rubric_assessment` in parallel. Then it applies these checks in order; the first failure throws and **no write request is sent**:

| # | Code | Refuse when | Why (evidence) |
| --- | --- | --- | --- |
| 1 | `NO_RUBRIC` | assignment has no `rubric` | Canvas would silently ignore the assessment ([P] I) |
| 2 | `MODERATED` | `moderated_grading` | provisional grading is out of scope |
| 3 | `GROUP_GRADED` | `group_category_id` set and not `grade_group_students_individually` | the write would fan out to the whole group ([S], Q3) |
| 4 | `DUPLICATE_CRITERIA` | a criterion ID repeats | ambiguous |
| 5 | `UNKNOWN_CRITERIA` | an ID is not in the rubric | Canvas would drop it silently ([P] G2) |
| 6 | `MISSING_CRITERIA` | a rubric criterion is absent | Canvas would delete it ([P] E) |
| 7 | `OUTCOME_CLAMP` | an outcome-aligned criterion (`outcome_id`) has points above its maximum | Canvas may silently cap it ([S] `assessment_points`) |
| 8 | `USE_FOR_GRADING_ON` | `assessment_only` and `use_rubric_for_grading` is true | Canvas would overwrite the score ([P] J row 1). **Not on a checkpoint parent**: there Canvas does not grade today ([P] J rows 4–6) and #10 refuses `apply_rubric_score` as well. So when `has_sub_assignments` is true, #8 fires with its own checkpoint wording (§3.6, 8b), which claims no score effect and recommends no retry |
| 9 | `USE_FOR_GRADING_OFF` | `apply_rubric_score` and `use_rubric_for_grading` is not true | Canvas would not change the score ([P] J rows 13–24) |
| 10 | `CHECKPOINTS` | `apply_rubric_score` and `has_sub_assignments` | Canvas skips grading checkpoint parents ([P] J rows 4–6) |
| 11 | `EXCUSED` | `apply_rubric_score` and the submission is `excused` | applying a score un-excuses ([S]) |
| 12 | `NO_POINTS` | `apply_rubric_score` and no non-ignored criterion has points | Canvas would clear the score ([P] J row 3) |

The resulting permission matrix is short enough for an agent to hold:

| | rubric used for grading | rubric **not** used for grading |
| --- | --- | --- |
| `apply_rubric_score` | allowed (unless checkpoints, excused or no points) | refused (#9) |
| `assessment_only` | refused (#8; checkpoint wording 8b on a checkpoint parent) | allowed |

`assessment_only` is refused on a checkpoints parent with grading enabled. Canvas would not grade it *today*, but the source comment says `use_for_grading` "will be respected, when support for rubrics on checkpoints has been fleshed-out". The simple rule (#8) survives that Canvas change; a checkpoint exception would not.

On such a parent **both** effects are refused: `assessment_only` by #8 and `apply_rubric_score` by #10. The two messages must therefore not contradict each other. The generic #8 text says Canvas "would replace the student's score" and recommends `apply_rubric_score`. Both statements are wrong on a checkpoint parent, because Canvas does not replace the score today and `apply_rubric_score` is refused there too. So the checkpoint case has its own text (8b in §3.6). It says only that Canvas does not currently apply rubric scores to checkpointed assignments, that this may change, that both effects are therefore refused, and that the checkpoints are graded in Canvas.

**Deliberate non-gates and known limits (v1 positions).**

- **Anonymous grading: no refusal gate.** Nothing in the Submissions `update` path rejects or alters an assignment for being anonymously graded; only the separate `update_anonymous` endpoint is keyed by anonymous ID, and this tool does not use it **[S]**. One observed side effect is kept and not gated. When `apply_rubric_score` makes Canvas write the grade, `update_artifact` passes `graded_anonymously: @graded_anonymously_set` (`rubric_assessment.rb:223`). That value is `nil` on this path, because the Submissions controller never passes `graded_anonymously` to `assess`, and `save_grade_to_submission` assigns the key whenever it is present (`abstract_assignment.rb:2533`). Together they **reset the submission's `graded_anonymously` flag** **[S]**. The score is unaffected, and the tool neither reads nor reports the flag.
- **`OUTCOME_CLAMP` (#7) is a known fail-closed limitation.** It refuses an outcome-aligned criterion whose points exceed its maximum, including in courses that enable `outcome_extra_credit`, where Canvas would accept those points. That flag is not readable through the API we use (§2.5), and the refusal message offers no override. v1 accepts this. Allowing extra credit later is additive: it needs a readable signal and a new input, and it loosens the refusal without changing any other row.

**Permissions are not preflighted.** No API read decides them conclusively (§2.5), and the write endpoint enforces them before writing. A dedicated permission read would add a request that could still be wrong.

### 3.4 Write

```json
PUT /api/v1/courses/100/assignments/10/submissions/42
{"rubric_assessment":{"_1001":{"points":4,"comments":"Good"},"_1002":{"points":null},"_1003":{"points":2,"rating_id":"r9"}}}
```

The body has no `submission` key, so no posted grade, excusal or status change is sent, and no `comment` key. `null` points are sent as JSON `null` (unscored, [P] F2). Optional keys are omitted when undefined.

### 3.5 Postcondition and outcome

Definitions:

- **`entered(s)`** = `s.entered_score ?? s.score ?? null`. Use `entered_score` because late-policy deductions make `score` lower than the value `grade_student` set, on every late submission **[S]**. Comparing `score` would report "not updated" for every late student.
- **`sameScore(a, b)`**: both `null` → equal; one `null` → different; otherwise `|a − b| < 1e-4`. The tolerance follows `Rubric::POINTS_POSSIBLE_PRECISION = 4` **[S]**.
- **`afterWrite`** is the PUT response. It is the submission as reloaded at the end of *our* request **[S]**, so later writers cannot affect it.
- **`readBack`** is `GET submission?include[]=rubric_assessment`, issued after the PUT.
- **`rubricScore`** is the sum of `readBack.rubric_assessment[id].points` over requested criteria that are not `ignore_for_scoring` and have non-null points. It is `null` if there are none. Summing the *stored* points reproduces `assess` exactly, including any outcome cap Canvas applied ([P] D, F, H).

Rules:

1. **Ratings verified** means that for every requested criterion, the stored points equal the sent points (`null` ↔ absent or null; numbers use `sameScore`). If not, the tool throws `ASSESSMENT_NOT_VERIFIED`.
2. **`apply_rubric_score`**:
   - If `sameScore(entered(afterWrite), rubricScore)` is false, the tool throws **`GRADEBOOK_NOT_UPDATED`**. This is the brief's "assessment stored, grade unchanged" case.
   - Otherwise the outcome is `score_already_matched` if `sameScore(entered(before), entered(afterWrite))`, else `score_changed`.
3. **`assessment_only`**:
   - If `sameScore(entered(before), entered(afterWrite))` is false, or `excused` changed, the tool throws **`UNEXPECTED_GRADEBOOK_CHANGE`**.
   - Otherwise the outcome is `score_untouched`.
4. **`concurrent_change_detected`** is `!sameScore(entered(afterWrite), entered(readBack))`. It is reported and never changes the outcome.

A success result can therefore only claim a gradebook change when Canvas's own post-write submission shows the *entered* score equal to the rubric total **and** different from the value read before the write.

**Late submissions: Canvas gates on `score`, the tool compares `entered_score`.** Canvas's own gate is the early return in `update_artifact`, `artifact.score == score` (`rubric_assessment.rb:210`). It compares the *final* score, which is after the late deduction, with the rubric total. `entered_score` is `score + (points_deducted || 0)` (`submission.rb:1904`). The tool compares `entered(…)` because that is the value `grade_student` sets, and it cannot mirror Canvas's gate. On a late submission the two therefore disagree in two cases **[S]**, pinned by K13 and K14 in the plan:

| Case | Submission before | Rubric total | What Canvas does **[S]** | What the tool reports |
| --- | --- | --- | --- | --- |
| A | entered 10, deducted 1, score 9 | 9 | `9 == 9` returns early. The entered score stays 10 | `entered(afterWrite)` 10 ≠ 9 → `GRADEBOOK_NOT_UPDATED`. This is the fail-safe direction, and the message reports entered 10, final 9 and total 9 |
| B | entered 9, deducted 1, score 8 | 9 | `8 ≠ 9` re-grades with 9. The submission comes back as entered 9, deducted 1, score 8 | `entered` 9 = 9 and unchanged → `score_already_matched` |

From the observable submission alone the tool cannot tell whether Canvas re-graded in case B, because the result is identical either way. In case A it can only see that the entered score is not the rubric total. **So the messages state observed values only. They never say whether Canvas re-graded, and they never say what Canvas "did not apply".** When `score_after` differs from `entered_score_after`, they add the final score.

Two alternatives were rejected. Matching on `afterWrite.score` alone reports `GRADEBOOK_NOT_UPDATED` after a correct re-grade of any late student (case B: 8 ≠ 9). Accepting *either* value as a match would report success in case A, although the entered score is still 10.

### 3.6 Result and error surfaces

**Success** (`structuredContent`, server-authored, so strict):

```ts
z.strictObject({
  outcome: z.enum(['score_changed', 'score_already_matched', 'score_untouched']),
  grade_effect: z.enum(['apply_rubric_score', 'assessment_only']),
  message: z.string(),
  rubric: z.strictObject({
    score: z.number().nullable(),
    criteria_saved: z.number(),
    ignored_for_scoring: z.array(z.string()),
  }),
  gradebook: z.strictObject({
    use_rubric_for_grading: z.boolean(),
    entered_score_before: z.number().nullable(),
    entered_score_after: z.number().nullable(),
    score_after: z.number().nullable(), // after late-policy deductions
    grade_after: z.string().nullable(),
    graded_at_after: z.string().nullable(),
    posted_at_after: z.string().nullable(),
    concurrent_change_detected: z.boolean(),
  }),
})
```

The result carries no user identity, so no pseudonymization wrapping is needed. It never echoes criterion comments.

**`message` templates:**

- `score_changed`: `Rubric assessment saved. The entered gradebook score changed from {before|no score} to {after}, the rubric total.`
- `score_already_matched`: `Rubric assessment saved. The entered gradebook score was already {after}, equal to the rubric total, and it is unchanged.`
- `score_untouched`: `Rubric assessment saved. The entered gradebook score was not changed ({after|no score}).`
- Suffix when `score_after` and `entered_score_after` are both non-null and differ (a late-policy deduction is in effect), on all three outcomes: ` The student's final score is {score_after} after a late-policy deduction.`
- Suffix when `posted_at_after` is null: ` Canvas has not posted this grade to the student (posted_at is empty).`
- Suffix when a concurrent change is detected: ` The score read back afterwards was {readBack}, so another change landed right after this write.`

**Errors.** Every non-success is thrown as a `ToolOutcomeError` subclass and rendered **verbatim**; see plan Step 4 for why `formatError` must check it first. The prefixes are stable so that agents and tests can key on them.

Refusals (nothing was sent to Canvas):

- `NOT WRITTEN: this assignment has no rubric attached for grading. Canvas would accept the request and silently ignore the assessment.`
- `NOT WRITTEN: this is a moderated assignment. This tool does not write provisional rubric grades; use SpeedGrader.`
- `NOT WRITTEN: this group assignment grades all group members together, so Canvas would apply the assessment to every member. This tool assesses one student at a time; use SpeedGrader.`
- `NOT WRITTEN: criterion {ids} appears more than once.`
- `NOT WRITTEN: {ids} are not criteria of this assignment's rubric, and Canvas would silently drop them. Valid criterion ids: {ids}.`
- `NOT WRITTEN: every rubric criterion must be included, because Canvas replaces the whole assessment and deletes criteria that are left out. Missing: {ids}. Use points: null to leave a criterion unscored.`
- `NOT WRITTEN: criterion {id} is aligned to a learning outcome and worth at most {max} points; Canvas caps it at {max} unless the course enables outcome extra credit.`
- **#8, generic** (`has_sub_assignments` is not true): `NOT WRITTEN: this assignment's rubric is used for grading, so Canvas would replace the student's score with the rubric total. If that is intended, use grade_effect "apply_rubric_score". To save the rubric without changing the score, a teacher must first turn off "Use this rubric for assignment grading" in Canvas.`
- **#8b, checkpoint parent** (`has_sub_assignments` is true; same code `USE_FOR_GRADING_ON`): `NOT WRITTEN: this is a checkpointed assignment and its rubric is set to be used for grading. Canvas does not currently apply rubric scores to checkpointed assignments, but may in future, so this tool refuses both grade effects here. Grade the checkpoints in Canvas.` It must not claim that Canvas replaces the score today, and it must not mention `apply_rubric_score`, which #10 refuses on the same assignment.
- `NOT WRITTEN: this assignment's rubric is not used for grading, so Canvas would save the assessment but leave the score unchanged. Use grade_effect "assessment_only", then set the score with grade_submission if the user wants it changed.`
- `NOT WRITTEN: this is a checkpointed assignment. Canvas does not apply rubric scores to checkpointed assignments, so the score would not change. Grade the checkpoints in Canvas.`
- `NOT WRITTEN: this student is excused on this assignment, and applying a rubric score would remove the excusal. Confirm with the user and un-excuse the student in Canvas first if that is intended.`
- `NOT WRITTEN: no scored criterion has points, so the rubric total is empty and Canvas would clear the student's current score. Provide points for at least one scored criterion.`

Write-time failures:

- `WRITE UNAUTHORIZED: Canvas refused the grading write (HTTP 401) after accepting the preflight reads with the same token, so this is a permission problem, not an expired token. Common causes: the account lacks Manage Grades in this course, the assignment is unpublished, the student's grading period is closed, or moderation is in progress. Canvas checks this before saving, so no rubric assessment or grade was saved.`
- `WRITE OUTCOME UNKNOWN: Canvas returned {status | no response} for the rubric write, so it is not known whether anything was saved. State read back now: score {x | empty}, rubric assessment {with N criteria | absent | could not be read}. Do not retry until the user has reviewed this.`
- `ASSESSMENT NOT VERIFIED: Canvas accepted the rubric write and reported score {x} immediately after it, but the verification read failed, so the saved criteria could not be checked. Confirm with get_rubric_assessment before reporting the grade.`
- `ASSESSMENT NOT VERIFIED: Canvas accepted the rubric write, but the saved points differ from what was sent for {ids} (sent {a}, saved {b}). Review with get_rubric_assessment.`

Postcondition failures:

- `GRADEBOOK NOT UPDATED: the rubric assessment was saved, but the entered gradebook score is not the rubric total. The entered score after the write is {entered_after | empty}{ (final score {score_after} after a late-policy deduction)}; the rubric total is {R | empty}. Do not tell the user the grade changed to the rubric total.` The parenthesised clause appears only when `score_after` and `entered_score_after` differ. The message reports what was observed. It does not say what Canvas did.
- `UNEXPECTED GRADEBOOK CHANGE: the rubric assessment was saved and Canvas changed the student's entered score from {before} to {after} (excused {b} → {a}), although grade_effect was "assessment_only". This tool did not undo it. Tell the user before doing anything else.`

The tool **never** issues a corrective grade write. Undoing a grade is a separate user decision.

### 3.7 Tool description (verbatim)

```text
Save a rubric assessment for one student's submission, and say whether it may change the gradebook score.

grade_effect "apply_rubric_score": the student's score becomes the rubric total. Only allowed when the assignment's rubric is used for grading (get_assignment: use_rubric_for_grading = true).
grade_effect "assessment_only": criterion points and comments are saved and the score is left alone. Only allowed when the rubric is NOT used for grading — otherwise Canvas would overwrite the score.

Include every criterion of the assignment's rubric exactly once (criterion ids from get_assignment's rubric). Canvas replaces the whole assessment and deletes criteria you leave out; use points: null to leave one unscored. Criteria marked ignore_for_scoring are saved but do not count toward the total.

Before writing, the tool reads the assignment and submission and refuses, without writing, whenever Canvas would do something other than what you asked. After writing, it reads the submission back. Tell the user the grade changed only when outcome is "score_changed"; an error starting "GRADEBOOK NOT UPDATED" means the assessment was saved but the score was not.
```

---

## 4. Races, partial success and errors

### 4.1 Preflight → write (time-of-check/time-of-use)

The two reads and the write are separate requests, and this endpoint has no conditional-write precondition **[S]**. Suppose a teacher changes "use this rubric for grading", edits the rubric, or excuses the student inside that window (two round trips). The write then follows the new state, and the §3.5 postcondition reports the mismatch as `GRADEBOOK_NOT_UPDATED` or `UNEXPECTED_GRADEBOOK_CHANGE` **after** it has happened. This residual risk is accepted and documented: Canvas offers no lock, and the window is milliseconds against a teacher-scale action.

### 4.2 Concurrent graders

The outcome is computed from the PUT response, which is Canvas's post-reload view inside our own request **[S]**. It is not taken from the read-back, so a grader who writes a second later cannot flip our outcome. That grader is surfaced as `concurrent_change_detected: true`.

### 4.3 Write errors and what was saved

| Write response | Raised where **[S]** | Assessment or grade saved? | Tool behaviour |
| --- | --- | --- | --- |
| 401 | `authorized_action(@submission, :grade)`, before `assess` | No. A placeholder submission row may be created by `find_or_create_by!`; that row holds no grade. | `WRITE UNAUTHORIZED`, no read-back |
| 400 `invalid rubric_assessment` | before `assess` | No | `formatError`; unreachable after preflight #5/#6 |
| 404 | assignment or user lookup | No | `formatError` |
| other 4xx | no path after `assess` returns 4xx for this body | No (source reading, not exhaustive) | `formatError`, no read-back |
| 5xx, network failure, timeout | e.g. an `Assignment::GradeError` raised inside `update_artifact` is **not** rescued on this path and falls through to `rescue_action_in_public` | **Unknown.** The `after_save` exception should roll back the assessment save, but that is not executed here. | `WRITE OUTCOME UNKNOWN`, one read-back, no retry |
| 200, read-back fails | — | Yes (the write was accepted) | `ASSESSMENT NOT VERIFIED`, quoting the PUT response's score |

**Partial success within one student** occurs in exactly one observable form: the assessment is saved and the grade is not applied. The contract makes that the `GRADEBOOK_NOT_UPDATED` error, and never a success.

**Partial success across students** (group fan-out, where a later member's grade write can raise after earlier members were saved in separate transactions **[S]**) is excluded by refusal #3.

### 4.4 Retries and idempotency

For an assignment's grading association, grading-type assessments are unique per submission (`assessments_unique_per_asset?`) **[S]**. A retry with identical input rewrites the same row, and the second call reports `score_already_matched`. `idempotentHint: true` stays accurate. Retries are still never automatic after `WRITE OUTCOME UNKNOWN`: the user decides.

### 4.5 A manual grade does not survive the next rubric save

With grading enabled, **any** later save of that submission's rubric assessment re-applies the rubric total whenever it differs from the current score **[P]** (J row 1). That includes a save from this tool, from SpeedGrader, or from anyone else, and it overwrites a score entered by hand. The docs and skill must say so plainly: when the rubric is used for grading, the rubric *is* the grade, and `grade_submission` afterwards is a temporary override.

### 4.6 Posting is not visibility

A score change does not mean the student can see it. The result reports `posted_at_after` raw, and the message states when it is empty. The tool never claims student visibility.

---

## 5. Is a combined rubric + `posted_grade` request safe? No.

`SubmissionsApiController#update` runs the steps in this order for a single request **[S]**:

1. `grade_student(@user, grade: posted_grade)` commits the posted grade.
2. Then `@assignment.rubric_association.assess(… assessment_type: "grading")` runs.
3. `assess` saves the assessment, and `update_artifact` fires: when `use_for_grading` is on and the rubric total differs from the score just posted, it calls `grade_student(score: rubric_total)` **[P]** J row 1.

Consequences:

| Rubric used for grading? | Result of one request with both |
| --- | --- |
| Yes, totals differ | **The posted grade is silently replaced by the rubric total.** The response is 200. |
| Yes, totals equal | Both agree |
| No | The posted grade stays; the assessment is saved |
| No active rubric | The posted grade lands; **the rubric part is silently ignored** ([P] I) |
| `assess` raises after step 1 | The posted grade is already committed; the assessment is not saved. Partial success, which our read-only error surface could not describe **[S]** |

The lead says that including `submission[posted_grade]` "sidesteps all four gates and the flag never matters". For `use_for_grading: true` the flag decides *which of the two values survives*. **The combined request is not offered.** `grade_submission` stays grade-only, and the rubric tool never sends `submission`. The supported patterns are:

- **Rubric not used for grading, and the teacher wants both:** `submit_rubric_assessment` with `assessment_only`, then `grade_submission`. That is two explicit writes, each reported separately.
- **Rubric used for grading:** `submit_rubric_assessment` with `apply_rubric_score`. The rubric total is the grade.

---

## 6. Compatibility and migration

| Surface | Impact |
| --- | --- |
| MCP input schema | Breaking in shape: `association_id` and `data` are removed; `assignment_id`, `user_id`, `grade_effect` and `criteria` are required. **No working caller exists** (§1.1). Legacy args fail input validation before any Canvas request (plan H13). A client with a cached tool list sends the old shape and gets a required-field error until it refreshes. **The eventual PR body and changelog context must disclose this shape change explicitly (Q1).** The release-please "Bug Fixes" line will be the only notice most users see. |
| Tool name, annotations, audience, role filtering | Unchanged (`destructiveHint`, `idempotentHint`, `openWorldHint`; educator) |
| Tool count and manifests | Unchanged at 165 / 117 / 48. The `submit_rubric_assessment` description is regenerated. |
| `canvas-lms-mcp/canvas` library export | `RubricsModule.submitAssessment` is kept **byte-identical except for the `@deprecated` JSDoc marker**, and removed only at a future major release (Q2); `assessSubmission` is added. Optional fields are added to `CanvasAssignment`; `'checkpoints'` is added to `AssignmentGetInclude`. All additive. |
| Structured output | New `output` contract plus fixture (CLAUDE.md step 8) |
| Pseudonymization | Not a PII tool; there is no identity in the result |
| Provenance fencing | Already applies generically: destructive tools reject marker-bearing inputs |
| `CANVAS_DESTRUCTIVE_TOOLS` | Unaffected; that policy covers only the seven delete tools |
| Docs and skill | `docs/educator-guide.md`, `docs/workflows/educator-assignment-review.md`, `skills/canvas-grading-pass/SKILL.md` (plan Step 6) |
| Release | `fix(rubrics): …`, which is a patch (Q1, decided) |
| PR #327 | Textual overlap in all six of its files and no functional dependency. If it merges first, its `get_rubric` wording ("association IDs needed for rubric assessment writes") must be corrected in the same implementation PR. Preferred order is #327 first, then rebase; the safety fix does not wait indefinitely for it (Q4). |

## 7. Test strategy (full list in the plan)

- **A fetch-level stateful fake of Canvas**, exercising the real `CanvasClient` so that the wire shape is under test. The request shape is what broke (§1.1). The fake models §2.2 through §2.4 and has a **`gradeWrite: 'never'` knob that models Canvas accepting the assessment without changing the grade**, which is exactly what the brief asks for. A self-test pins the fake to the probe results (D, E, G1, G2, I), so it cannot drift more permissive than Canvas.
- **A pure decision module** (`preflight` and `classify`), tested as tables. Every refusal row has a **control row** that flips one condition and does write. Without the controls, a module that refuses everything would pass.
- **Every "nothing was written" assertion counts PUT requests and has a paired control that issues one.**
- **An MCP boundary test** calls `listTools()` first (that arms client-side output validation) before asserting that `structuredContent` validates.
- **Named injection checks** prove individual tests are load-bearing: `formatError` ordering, `score` vs `entered_score`, the missing-criteria check, PUT-before-preflight, and a dropped `include[]=checkpoints`.

## 8. Rollback

A single `git revert` of the implementation merge restores the previous tool, client and manifest. There is no configuration, persisted state or migration to unwind. A revert does **not** undo grades or assessments that the new tool wrote to Canvas in the meantime; `get_gradebook_history_feed` lists them. After a revert the tool is back to failing every call with 404 (§1.1), which is harmless. There is no per-tool kill switch today, so the fastest field mitigation is pinning the previous npm version. Details are in the plan.

## 9. Alternatives considered

| | Option | Why not |
| --- | --- | --- |
| A | Patch the existing endpoint in place (form-encode, add `user_id` and `assessment_type`) | It makes every silent gate in §2 reachable for the first time, without preflight or postcondition. It needs an association ID lookup (#327). It skips the upfront grading authorization. |
| B | Warn only: report `use_rubric_for_grading` in the result, with no refusal | The warning arrives after an irreversible grade write |
| C | Let the tool toggle `use_for_grading` to match intent (`PUT rubric_associations/:id`) | That is a course-wide teacher setting affecting every student and SpeedGrader, and it also rewrites the assignment's `points_possible` (`update_assignment_points`) **[S]**. An agent must not change it as a side effect. |
| D | Remove or disable the tool | Viable containment, but the tool is harmless today (it always returns 404), and the rebuild gives educators the capability safely. It remains the fallback if the implementation is not funded. |
| E | Offer rubric + `posted_grade` in one call | §5 |
| F | Keep the rubric-associations endpoint and add #327's lookup | Solves only the ID problem; B1, the silent grading-right path and the no-error cases remain |

## 10. Decisions (CTO, 2026-09-19)

All six questions raised in the first revision are decided. The plan encodes each one.

- **Q1 — Release type: `fix(rubrics):` (patch).** The old contract never succeeded against Canvas, so no integration can break, and `fix(rubrics)!:` would force 2.0.0 for a tool nobody could use. The required input-shape change (`association_id` and `data` removed; `assignment_id`, `user_id`, `grade_effect` and `criteria` required) must be disclosed clearly in the eventual PR body and changelog context (§6).
- **Q2 — `RubricsModule.submitAssessment`: keep it byte-identical except for an `@deprecated` marker.** It is public library API (`./canvas` export). It is removed only at a future major release. It is not made to throw.
- **Q3 — Group-graded assignments: refused in v1 (#3).** Later support is additive: it needs a fan-out postcondition across N submissions and its own design.
- **Q4 — Sequencing with external PR #327.** #327 is still `OPEN` at `e3f50eb…`, `BEHIND`, and has no checks, because its first-time-contributor workflow still needs maintainer approval (§0.1). The preferred order is #327 first, then rebase the implementation onto it. **The safety fix must not wait indefinitely for #327.** If #327 cannot be unblocked in time, the fix ships first and the contributor is asked to drop "needed for rubric assessment writes" when they rebase. Neither PR is altered by this design.
- **Q5 — Repo-wide 401 wording: out of scope.** `formatError` maps every 401 to "token is invalid or expired", but Canvas uses 401 for authorization failures on every write tool (§1.3-h). This design special-cases only the rubric write. Applying the rule to all write tools (a 401 after a successful read with the same token means a permission problem) changes user-visible text on every write tool and needs its own tests. **A separate follow-up ticket is required.**
- **Q6 — `assessment_only` on checkpoint parents with grading enabled: refused (#8)**, so the rule survives Canvas finishing checkpoint rubric support (§3.3). The refusal uses the non-contradictory checkpoint wording 8b (§3.6), because the generic #8 text would state false Canvas behaviour there and point to an effect that #10 also refuses.

---

## Appendix A — Probe evidence

**Runtime:** Ruby 3.3.12 (portable RubyInstaller), actionpack 8.1.3.1, rack 3.2.7.

**Source:** method bodies extracted **at runtime** from the pinned files, then `eval`'d:
- `RubricAssessmentsController#resolve_user_id`;
- the `RubricAssociation#assess` criteria loop and `#assessment_points`;
- the `SubmissionsApiController#update` `rubric_assessment` block;
- `RubricAssessment#update_artifact`;
- `Api::ID_REGEX`.

**Pinning:** every file compared byte-identical to `?ref=1c9f0bb8013e`.

**Request parsing:** bodies were parsed by `ActionDispatch::Request#request_parameters`. The A1 body is the wire capture from our own client.

**Stubs:** models, database and permissions.

```text
A1 shipped body → user_id blank → raise ActiveRecord::RecordNotFound (Canvas API renders 404)
A2 shipped body past that guard → {"replace_ratings":false,"score":null,"stored_criteria":[]}
B1 JSON numeric user_id → TypeError: no implicit conversion of Integer into String (→ 500)
B2 JSON string user_id → user_id resolved to 42
C1 documented form body → user_id resolved to 42
C2 form body → score 9.0; _1003 ignore_for_scoring
D  submissions API, all criteria → score 9.0; _1003 ignore_for_scoring
E  partial (_1001 only) → score 4.0; stored_criteria [_1001] only
F  comments only → score null
F2 all points null → score null; three criteria stored unscored
G1 unknown id only → 400 {"message":"invalid rubric_assessment"}
G2 known + unknown → score 4.0; unknown dropped
H  zero points → score 0.0
I  no active rubric association → rubric_assessment NOT processed (no error raised)
J  update_artifact, 24 combinations → grade_student called in exactly 2:
   use_for_grading ∧ grade right ∧ ¬checkpoints_parent, score 80 vs rubric 9.0  → grade_student(score: 9.0)
   use_for_grading ∧ grade right ∧ ¬checkpoints_parent, score 80 vs rubric nil  → grade_student(score: nil)
   all 22 others → not called
```

**The harnesses are not vacuous.** Every negative result has a positive control inside the same harness:
- `resolve_user_id`: A1 fails and C1 resolves;
- the submissions block: I is not processed and D is;
- `update_artifact`: 22 rows do not call `grade_student` and 2 do.

## Appendix B — Reproducing

Nothing here contacts a real Canvas instance. Step 1 replaces `fetch` entirely. Step 2 reads public source from GitHub.

1. **Wire capture.** Run the committed script [`2026-09-15-bru-2550-assets/capture-wire.ts`](2026-09-15-bru-2550-assets/capture-wire.ts) from the repository root, on a tree where the tool still takes the legacy input (`origin/main` @ `db2c5e2`, or this docs-only branch):

   ```bash
   WORK=<output dir outside the repo> pnpm exec tsx docs/superpowers/specs/2026-09-15-bru-2550-assets/capture-wire.ts
   ```

   The script builds the real server with a **dummy token** (a literal, never read from the environment), replaces `fetch` with a stub that answers Canvas's 404 body and aborts on any host other than `canvas.example.com`, calls the real `submit_rubric_assessment` handler, and writes `{calls, result}` to `$WORK/wire.json`. It drops the `Authorization` header from the record, so `wire.json` holds no credential. After the implementation PR merges, the legacy args are rejected by input validation, no request is sent, and the script exits non-zero: check out `db2c5e2` to reproduce.
2. Download the five Canvas files at the pinned SHA into `$WORK/cv/`:
   - `rubric_association.rb`
   - `rubric_assessments_controller.rb`
   - `submissions_api_controller.rb`
   - `lib_api.rb` (from `lib/api.rb`)
   - `model_rubric_assessment.rb` (from `app/models/rubric_assessment.rb`)

   Use `gh api "repos/instructure/canvas-lms/contents/<path>?ref=1c9f0bb8013ed69c4f2efe11fd483025469b7e6c" -H "Accept: application/vnd.github.raw"`.
3. **Run the probe only inside a disposable container.** `canvas-source-probe.rb` `eval`s Ruby that it has just extracted from the files fetched in step 2, so never run it directly on a developer machine or a CI runner. Copy `canvas-source-probe.rb` into `$WORK/`, then:

   ```bash
   docker run --rm -v "$WORK:/work" ruby:3.3-slim bash -c 'gem install actionpack -v 8.1.3.1 --no-document && ruby /work/canvas-source-probe.rb'
   ```

   `actionpack` is pinned to **8.1.3.1**, the version Appendix A records. Any Ruby ≥ 3.2 works inside the container. Without Docker, use an equally disposable VM.
4. The output should match Appendix A, and the script writes it to `$WORK/ruby-probe.json`.
