---
issue: 240
---

# Grade-by-Question Quiz Review — MCP Tool Design

**Date**: 2026-07-09
**Issue**: [bruchris/canvas-lms-mcp#240](https://github.com/bruchris/canvas-lms-mcp/issues/240)
**Status**: Design — awaiting CTO review

## Purpose

Add a read-only `get_quiz_question_responses` tool that pivots Classic Quiz results by
**question** instead of by student — for a given quiz, return each question alongside every
student's answer to it, so an instructor can grade essay/short-answer/file-upload questions
consistently across the whole class instead of paging through SpeedGrader one student at a time.

The tool composes three already-wrapped Canvas client methods (`quizzes.get`,
`quizzes.listQuestions`, `quizzes.listSubmissions`, `quizzes.getSubmissionAnswers`) with no new
Canvas endpoint and no new package dependency. It performs the fan-out and the pivot in the tool
handler.

---

## Design unknowns (retired)

### 1. Classic Quizzes vs New Quizzes scope

**Decision: Classic Quizzes only in V1; gate explicitly rather than let Canvas 404 opaquely.**

`GET /api/v1/quiz_submissions/:id/questions` is a Classic Quizzes endpoint. New Quizzes
(`quiz_type: 'quizzes.next'`) exposes student responses through a separate LTI-based item/response
API (`/api/quiz/v1/...`, already the domain split used by `src/tools/new-quizzes.ts` /
`src/tools/new-quiz-accommodations.ts`), not through this endpoint.

Following the precedent set in `docs/superpowers/specs/2026-06-16-issue-191-quiz-accommodations.md`
and `src/tools/quiz-accommodations.ts` (`CLASSIC_QUIZ_TYPES` allow-list, not a `!== 'quizzes.next'`
deny-list — an allow-list is future-proof against new/unrecognized `quiz_type` values), this tool
fetches the quiz first via `canvas.quizzes.get(course_id, quiz_id)` and checks:

```ts
const CLASSIC_QUIZ_TYPES = new Set(['assignment', 'practice_quiz', 'graded_survey', 'survey'])
```

If `quiz.quiz_type` is not in this set, the handler throws a plain `Error` (not `CanvasApiError`)
with a message naming the actual `quiz_type` and pointing at the New Quizzes gap, e.g.:

```
This tool only supports Classic Quizzes (assignment, practice_quiz, graded_survey, survey).
Quiz 42 has quiz_type "quizzes.next" (New Quizzes), which exposes responses through a different
API not covered by this tool.
```

`formatError()` (`src/tools/errors.ts`) already returns `error.message` for plain `Error` instances
that don't match its network-error heuristics, so no changes to `errors.ts` are needed — this
mirrors how `set_student_quiz_accommodation` throws plain `Error` for input-validation failures.

A follow-up `get_new_quiz_question_responses` (or equivalent) against the New Quizzes item API is
out of scope here, exactly as `docs/superpowers/specs/2026-06-14-issue-182-quiz-submission-event-logs.md`
§1 scoped New Quizzes event logs out of that tool.

### 2. Question-type scope (auto-graded vs manually-graded)

**Decision: return every question type by default; attach a per-question `needs_manual_grading`
flag computed from `question_type`, not from an uncertain per-answer "correct" signal.**

```ts
const MANUALLY_GRADED_QUESTION_TYPES = new Set(['essay_question', 'file_upload_question'])
```

`essay_question` and `file_upload_question` are the two Classic Quiz types Canvas never
auto-grades. (`short_answer_question` is auto-graded by exact text match in Classic Quizzes, so it
is not included, even though the issue's user story mentions "short-answer" colloquially — the
tool still returns short-answer responses, just with `needs_manual_grading: false`.) This value is
identical for every response to a given question, so it is attached once per question group, not
per response — recomputing it per-student would be both wasteful and misleading (it is a property
of the question, not the individual answer).

No input flag filters question types in V1 — the issue's own "design unknowns" section frames this
as "decide whether to include auto-graded types too," and the simplest, least-surprising default is
"return everything, let the caller filter client-side by `needs_manual_grading` or `question_type`
in the response." Adding a `manually_graded_only` boolean is easy to bolt on later as a
non-breaking optional input if real usage shows it's needed — not adding it now avoids
over-scoping a V1 tool whose primary lever for narrowing output is already `question_id`.

### 3. Per-question score breakdown ("points_awarded")

**Decision: do not fabricate a per-question `points_awarded`; surface `correct` only when Canvas
actually returns it, and document the gap explicitly.**

The issue's proposed contract sketch lists `points_possible` / `points_awarded` per response. Two
different Canvas data sources are involved here and they must not be conflated:

- `points_possible` **is** reliably available — it's a property of the *question*
  (`CanvasQuizQuestion.points_possible` from `listQuestions()`), not the answer, so it's attached
  once per question group (matching `needs_manual_grading` above).
- A per-*response* awarded-points breakdown is not reliably exposed by
  `GET /quiz_submissions/:id/questions` for manually-graded question types (that's the entire
  reason grade-by-question review is needed — Canvas has not yet scored those answers). For
  auto-graded types, Canvas's classic quiz-submission-questions payload has historically included a
  `correct` field once a quiz is graded, but this repo's current `CanvasQuizSubmissionQuestion` type
  (`src/canvas/types.ts`) does not model it, and its exact shape (boolean vs. tri-state) is not
  independently confirmed in this codebase. **CLAUDE.md requires tests to never hit a live Canvas
  instance, so there is no way to verify the live shape during implementation** — committing to a
  guess and correcting it later (the same path already taken twice in this codebase: see the
  "Post-implementation correction" block atop
  `docs/superpowers/specs/2026-06-14-issue-182-quiz-submission-event-logs.md`, and the tri-state
  `event_type`/`event_data` fixes it records) is the only workable process here, not an open
  research task for the implementor.

  V1 commits to `correct?: boolean | null` on `CanvasQuizSubmissionQuestion` (optional, so it
  degrades to `undefined`/passthrough if Canvas omits it entirely for a given question/workflow
  state) and surfaces it verbatim as `correct: response.correct ?? null` per response. No
  `points_awarded` field is invented from thin air. If a real Canvas instance later proves this
  field name or shape wrong, fix it in a follow-up PR with a "Post-implementation correction" note
  at the top of this spec (matching the #182 precedent) — this is expected maintenance, not a sign
  the V1 PR was incomplete.

- **Related, equally unverifiable, and just as load-bearing: the join key.** The pivot's entire
  correctness depends on `CanvasQuizSubmissionQuestion.id` (from `getSubmissionAnswers`) living in
  the same ID space as `CanvasQuizQuestion.id` (from `listQuestions`) — i.e. that Canvas's
  per-submission answer record's `id` really is the quiz's question ID, not some other
  submission-question-specific identifier. This is what `tests/canvas/quizzes.test.ts`'s existing
  fixture (`{ id: 1, quiz_id: 1, answer: '4', flagged: false }`, matched against a `quiz_id: 1`
  question) already assumes, and what `include[]=quiz_question` is documented to support, but it is
  not independently confirmed against a live response either. If this assumption is wrong, the
  failure mode is silent: `groups.get(answer.id)` returns `undefined`, the `if (!group) continue`
  guard swallows the mismatch, and every `responses[]` array simply comes back empty with no error
  — mocked tests alone cannot catch this since the test fixtures construct matching IDs by
  construction. Flag this explicitly to the implementor as the single highest-risk assumption in
  this spec, worth a one-line comment in the shipped code (e.g. `// Assumes CanvasQuizSubmissionQuestion.id === CanvasQuizQuestion.id; see spec design unknown #3.`) so a future
  "answers aren't matching to questions" bug report points straight back here.

- Grading remains via the already-shipped `score_quiz_question` tool; this tool is read-only review,
  not a new grading pathway.

### 4. Payload size / bounding the fan-out

**Decision: no artificial cap on submission count in V1, matching `list_quiz_submissions`'s
existing unbounded behavior; use `question_id` to narrow the *displayed* output, and tolerate
per-submission failures instead of aborting the whole call.**

`getSubmissionAnswers(quizSubmissionId)` returns *all* of a student's answers regardless of
`question_id` — Canvas has no server-side per-question filter on this endpoint, so passing
`question_id` cannot reduce the number of Canvas calls made (one call per completed submission is
unavoidable to build the pivot); it only reduces what's returned to the caller after the fact. This
is consistent with the issue's own acceptance criteria language ("compose already-wrapped
endpoints; no new Canvas endpoint required").

Rather than add a `max_submissions` cap (which would need a `truncated` flag and a defensible
default, both unrequested by the issue), V1 follows the same posture as the already-shipped
`list_quiz_submissions` tool it composes: no cap, no pagination surfaced to the caller (the Canvas
client's `paginate`/`paginateEnvelope` already fully page internally). If real usage on very large
quizzes (1000+ students, the scenario cited in the issue's evidence) proves this too slow or too
large a payload, a follow-up can add `question_id`-only server-side... option is not possible
(no such Canvas parameter exists), so the real follow-up lever would be a submission-count cap —
deliberately deferred rather than speculatively designed now.

Per-submission fan-out failures ARE tolerated: one broken submission fetch must not 500 the whole
grade-by-question view. Each `getSubmissionAnswers` call is wrapped individually; failures are
collected into a `submissions_failed` array of quiz-submission IDs (visible, not silently dropped —
same "no silent truncation" principle used throughout this codebase) rather than aborting the
`Promise.all`.

Only submissions in a workflow state where answers exist are scanned:

```ts
const RESPONDED_WORKFLOW_STATES = new Set(['complete', 'pending_review'])
```

`untaken` submissions have no answers; `pending_review` is included because that's exactly the
workflow state of an in-progress essay-grading attempt — excluding it would defeat the tool's
purpose.

---

## Tool contract

### Tool name

`get_quiz_question_responses`

Rationale: follows the existing plural/verb pattern in the quizzes domain
(`get_quiz_submission_answers`, `get_quiz_submission_events`) while making clear this pivots across
*all* submissions, not one.

### Zod input schema

```ts
{
  course_id: z.number().int().positive().describe('The Canvas course ID'),
  quiz_id: z.number().int().positive().describe('The Canvas quiz ID (Classic Quizzes only)'),
  question_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Scope the result to a single question ID (from list_quiz_questions). ' +
        'Omit to return every question on the quiz, each with every student\'s response.',
    ),
}
```

### Canvas calls (no new endpoint)

In order, per invocation:

1. `canvas.quizzes.get(course_id, quiz_id)` — `GET /courses/:id/quizzes/:id` — to read `quiz_type`
   and `title` and gate Classic vs New Quizzes (design unknown §1).
2. `canvas.quizzes.listQuestions(course_id, quiz_id)` — `GET /courses/:id/quizzes/:id/questions` —
   the question dictionary (text, type, position, points_possible). If `question_id` is given and
   not found in this list, throw a plain `Error`: `` `Question ${question_id} not found on quiz ${quiz_id}.` ``.
3. `canvas.quizzes.listSubmissions(course_id, quiz_id)` — `GET /courses/:id/quizzes/:id/submissions`
   — one row per student's quiz submission (`user_id`, submission `id`, `workflow_state`, `attempt`).
   Filter to `RESPONDED_WORKFLOW_STATES` (design unknown §4).
4. For each filtered submission, `canvas.quizzes.getSubmissionAnswers(submission.id)` —
   `GET /quiz_submissions/:id/questions` — fanned out with `Promise.allSettled`, one call per
   submission. Rejected settlements are collected into `submissions_failed` (their `submission.id`),
   fulfilled ones are pivoted into the per-question `responses[]` arrays.
5. `canvas.users.listStudents(course_id)` — `GET /courses/:id/users?enrollment_type[]=student` — the
   student roster, to resolve `user_id → name` for the pseudonymizer join (see FERPA section below).
   Fetched once, not per-submission.

### Output shape

```ts
interface QuizQuestionResponsesResult {
  quiz_id: number
  quiz_title: string
  question_count: number // length of `questions` below (1 if question_id was given and found)
  questions: Array<{
    question_id: number
    question_text: string
    question_type: string
    position: number
    points_possible: number
    needs_manual_grading: boolean
    responses: Array<{
      user_id: number
      user_name: string | null // pseudonymized when enabled; null if not on the student roster
      quiz_submission_id: number
      attempt: number
      answer: string | number | string[] | Record<string, unknown> | null
      correct: boolean | null // null when Canvas hasn't graded / doesn't report it (see §3)
      flagged: boolean
    }>
  }>
  submissions_scanned: number // count of submissions in a responded workflow state
  submissions_failed: number[] // quiz_submission_ids whose answers could not be fetched
}
```

**Naming deviation from the issue's sketch**: the issue's proposed contract names this field
`answer_text`, implying a normalized display string. This spec uses `answer` instead and types it as
Canvas's raw union, because Canvas's actual answer shape is not uniformly textual — matching and
multiple-answer questions return arrays/objects, not plain strings — so a `_text` suffix would
misleadingly promise a string that isn't always there. Essay/short-answer/file-upload answers (the
issue's primary motivating case) are already plain strings under this shape, so no information is
lost for the tool's main use case; a normalized-to-string projection is left as a non-breaking
follow-up if real usage shows callers want one.

If `question_id` is provided, `questions` has at most one element (the matching question); if
`question_id` is omitted, `questions` covers every question on the quiz, ordered by `position`.

### MCP annotations

```ts
annotations: {
  readOnlyHint: true,
  openWorldHint: true,
}
```

No `destructiveHint` (pure read). No `audience` override — inherits the `quizzes`-adjacent domain's
`educator` default (see Catalog registration below); this is squarely an instructor grading
workflow, unlike `get_quiz_submission_events`, which explicitly opts into `shared` because a
student reviews their own attempt.

---

## Type additions — `src/canvas/types.ts`

Widen the existing `CanvasQuizSubmissionQuestion` interface (it currently under-models real Canvas
responses for multi-select/matching question types) and add the `correct` field from design
unknown §3:

```ts
export interface CanvasQuizSubmissionQuestion {
  id: number
  quiz_id: number
  answer: string | number | string[] | Record<string, unknown> | null
  correct?: boolean | null
  flagged: boolean
}
```

This is a backward-compatible widening: existing callers of `getSubmissionAnswers` /
`get_quiz_submission_answers` that only ever read `answer` as `string | number | null` still
type-check, since those are still valid members of the widened union, and `correct` is optional.

No other type changes are needed — `CanvasQuiz`, `CanvasQuizQuestion`, `CanvasQuizSubmission`,
and `CanvasUser` are used as-is.

---

## Canvas client module changes

None beyond the type widening above. `QuizzesModule` (`src/canvas/quizzes.ts`) already exposes
`get`, `listQuestions`, `listSubmissions`, and `getSubmissionAnswers` with the exact signatures this
tool needs; `UsersModule.listStudents` (`src/canvas/users.ts`) already exists. No new client method,
no new endpoint.

---

## Tool module changes

### Location

New file: `src/tools/quiz-question-responses.ts`, exporting
`quizQuestionResponseTools(canvas: CanvasClient, pseudonymizer?: Pseudonymizer): ToolDefinition[]`.

A new file (rather than adding to `src/tools/quizzes.ts`) matches two related precedents: the
dedicated-file-per-cross-cutting-tool pattern used by `src/tools/attention.ts`,
`src/tools/link-audit.ts`, and `src/tools/submissions-awaiting-grading.ts` (none of these fold their
tools into an existing domain file); and, specifically for the `pseudonymizer` dependency, the
`getTools(canvas, pseudonymizer?)` signature already used by `attention.ts` and
`submissions-awaiting-grading.ts` (`link-audit.ts`'s tools carry no PII and so take no
`pseudonymizer` parameter — it's cited only for the file-organization precedent, not the
pseudonymizer one). This also avoids changing `quizTools()`'s existing signature
(`(canvas) => ToolDefinition[]`, no `pseudonymizer` param today).

### Handler sketch

```ts
import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { CanvasQuizSubmissionQuestion } from '../canvas/types'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'

const CLASSIC_QUIZ_TYPES = new Set(['assignment', 'practice_quiz', 'graded_survey', 'survey'])
const MANUALLY_GRADED_QUESTION_TYPES = new Set(['essay_question', 'file_upload_question'])
const RESPONDED_WORKFLOW_STATES = new Set(['complete', 'pending_review'])

interface QuestionResponse {
  user_id: number
  user_name: string | null
  quiz_submission_id: number
  attempt: number
  answer: CanvasQuizSubmissionQuestion['answer']
  correct: boolean | null
  flagged: boolean
}

interface QuestionGroup {
  question_id: number
  question_text: string
  question_type: string
  position: number
  points_possible: number
  needs_manual_grading: boolean
  responses: QuestionResponse[]
}

export function quizQuestionResponseTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
  return [
    {
      name: 'get_quiz_question_responses',
      description:
        "Review every student's answer to one or all questions in a Classic Quiz, pivoted by " +
        'question instead of by student — for grading essay/short-answer/file-upload questions ' +
        'consistently across a class instead of paging through SpeedGrader one student at a time. ' +
        'Classic Quizzes only (quiz_type: assignment, practice_quiz, graded_survey, survey) — New ' +
        'Quizzes exposes responses through a different API. Omit question_id to get every question; ' +
        'provide it to scope to one. Each question reports needs_manual_grading (true for essay and ' +
        'file-upload questions). Scans one Canvas API call per completed/pending-review submission; ' +
        'a failed per-submission fetch is recorded in submissions_failed rather than aborting the call.',
      inputSchema: {
        course_id: z.number().int().positive().describe('The Canvas course ID'),
        quiz_id: z.number().int().positive().describe('The Canvas quiz ID (Classic Quizzes only)'),
        question_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Scope the result to a single question ID (from list_quiz_questions). ' +
              "Omit to return every question with every student's response.",
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const quizId = params.quiz_id as number
        const questionId = params.question_id as number | undefined

        const quiz = await canvas.quizzes.get(courseId, quizId)
        if (!CLASSIC_QUIZ_TYPES.has(quiz.quiz_type)) {
          throw new Error(
            `This tool only supports Classic Quizzes (assignment, practice_quiz, graded_survey, ` +
              `survey). Quiz ${quizId} has quiz_type "${quiz.quiz_type}" (New Quizzes), which ` +
              `exposes responses through a different API not covered by this tool.`,
          )
        }

        let questions = await canvas.quizzes.listQuestions(courseId, quizId)
        if (questionId !== undefined) {
          questions = questions.filter((q) => q.id === questionId)
          if (questions.length === 0) {
            throw new Error(`Question ${questionId} not found on quiz ${quizId}.`)
          }
        }
        questions.sort((a, b) => a.position - b.position)

        const allSubmissions = await canvas.quizzes.listSubmissions(courseId, quizId)
        const submissions = allSubmissions.filter((s) =>
          RESPONDED_WORKFLOW_STATES.has(s.workflow_state),
        )

        const students = await canvas.users.listStudents(courseId)
        const anonymizedStudents = pseudonymizer?.isEnabled()
          ? await pseudonymizer.anonymizeUsers(courseId, students)
          : students
        const nameById = new Map(anonymizedStudents.map((u) => [u.id, u.name]))

        const settled = await Promise.allSettled(
          submissions.map((s) => canvas.quizzes.getSubmissionAnswers(s.id)),
        )

        const answersBySubmission = new Map<number, CanvasQuizSubmissionQuestion[]>()
        const submissionsFailed: number[] = []
        settled.forEach((outcome, i) => {
          const submission = submissions[i]
          if (outcome.status === 'fulfilled') {
            answersBySubmission.set(submission.id, outcome.value)
          } else {
            submissionsFailed.push(submission.id)
            console.error(
              `get_quiz_question_responses: failed fetching answers for quiz submission ` +
                `${submission.id} (course ${courseId}, quiz ${quizId}):`,
              outcome.reason,
            )
          }
        })

        const groups = new Map<number, QuestionGroup>(
          questions.map((q) => [
            q.id,
            {
              question_id: q.id,
              question_text: q.question_text,
              question_type: q.question_type,
              position: q.position,
              points_possible: q.points_possible,
              needs_manual_grading: MANUALLY_GRADED_QUESTION_TYPES.has(q.question_type),
              responses: [],
            },
          ]),
        )

        for (const submission of submissions) {
          const answers = answersBySubmission.get(submission.id)
          if (!answers) continue
          for (const answer of answers) {
            const group = groups.get(answer.id)
            if (!group) continue // not one of the (possibly question_id-filtered) target questions
            group.responses.push({
              user_id: submission.user_id,
              user_name: nameById.get(submission.user_id) ?? null,
              quiz_submission_id: submission.id,
              attempt: submission.attempt,
              answer: answer.answer,
              correct: answer.correct ?? null,
              flagged: answer.flagged,
            })
          }
        }

        return {
          quiz_id: quiz.id,
          quiz_title: quiz.title,
          question_count: groups.size,
          questions: [...groups.values()],
          submissions_scanned: submissions.length,
          submissions_failed: submissionsFailed,
        }
      },
    },
  ]
}
```

**Input casting**: `params.X as T` matches the existing no-runtime-parse pattern throughout
`src/tools/quizzes.ts` and `src/tools/quiz-accommodations.ts`.

**Why `Promise.allSettled` over the shared `fanOut()` helper**: `fanOut()`
(`src/tools/fan-out.ts`) models an applied/skipped/failed envelope purpose-built for **write**
operations — `set_student_quiz_accommodation` (`src/tools/quiz-accommodations.ts`) uses it and does
catch per-item errors internally, but its three-bucket applied/skipped/failed shape (plus a
`notFound` list of requested-but-absent IDs) doesn't fit a pure-read tool where every completed
submission is simply "in scope," with no skip semantics and no caller-requested-ID-list to validate
against. Note this is the opposite tradeoff from `list_student_quiz_accommodations`
(same file, a **read** tool) which explicitly chose to let any per-quiz read failure abort the whole
call rather than tolerate partial failure — this tool makes the opposite choice (tolerate, via
`submissions_failed`) because a single bad submission answer-fetch out of potentially hundreds
should not blank out an otherwise-complete grade-by-question view.

---

## Catalog registration — `src/tools/catalog.ts`

Add the import:

```ts
import { quizQuestionResponseTools } from './quiz-question-responses'
```

Add a new domain registration entry. Verify the current file order before inserting — as of this
writing the registration array runs `..., quizzes, new_quizzes, files, ...` (NOT `rubrics`, which
appears earlier, before `quizzes`). Insert the new entry immediately after `new_quizzes` and before
`files`:

```ts
{
  domain: 'quiz_question_responses',
  defaultPrimaryAudience: 'educator',
  getTools: quizQuestionResponseTools,
},
```

`getTools` here is typed `(canvas: CanvasClient, pseudonymizer?: Pseudonymizer) => ToolDefinition[]`
in `ToolDomainRegistration` already, so `quizQuestionResponseTools`'s two-argument signature matches
without further changes to `catalog.ts`'s types.

---

## FERPA / pseudonymizer coverage

**Decision: wrap this tool.** Each response entry carries a `user_name` field — one of the three
explicit triggers in `CLAUDE.md` ("a `CanvasUser`, a `participants` array, or a `user_name` field")
and in `docs/superpowers/specs/2026-05-25-ferpa-pseudonymization.md` §"Tools that surface student
PII". This is a deliberate contrast with the already-shipped `get_quiz_submission_answers` and
`get_quiz_submission_events`, which are correctly *not* wrapped because they carry no
student-identifying field (scoped only by an opaque `submission_id` the caller already holds) — this
new tool is different because it aggregates *across* submissions and therefore must attach identity
to make the pivot useful.

Implementation:

1. Add `'get_quiz_question_responses'` to `PSEUDONYMIZER_WRAPPED_TOOLS` in
   `src/pseudonym/coverage.ts`, under a new `// src/tools/quiz-question-responses.ts` comment block.
   **Also add it to `EXPECTED_PII_BEARING_TOOLS` in `tests/pseudonym/coverage.test.ts`** — that test
   file maintains its own independent hand-copied set that the test diffs against
   `PSEUDONYMIZER_WRAPPED_TOOLS`; updating only `coverage.ts` and skipping the test file's set makes
   `tests/pseudonym/coverage.test.ts` fail (`onlyInWrap: ['get_quiz_question_responses']`). Both
   files must change together.
2. The handler sketch above already performs the wrap: it fetches the student roster via
   `canvas.users.listStudents(courseId)` (this endpoint has no `enrollments` field on its returned
   `CanvasUser` objects, so `classifyRole()` — see `src/pseudonym/roles.ts` — will classify each as
   `'unknown'`, not `'student'`; that's fine, not a bug, because `shouldPseudonymize('unknown')` is
   also `true` under the codebase's conservative "unknown → treat as student" default documented at
   the top of `roles.ts` — the correct behavior here rests on that conservative default, not on any
   claim that the roster is "known" to be students), conditionally routes it through
   `pseudonymizer.anonymizeUsers(courseId, students)` when enabled, and joins the resulting
   `user.id → user.name` map onto each response row. `user_id` itself is never scrubbed (Canvas user
   IDs are not FERPA-directly-identifying in isolation and are required as the stable join key; see
   `docs/superpowers/specs/2026-05-25-ferpa-pseudonymization.md`'s "fields that get pseudonymized"
   scope, which documents that `id` is preserved while name/contact fields are rewritten).
3. A `user_id` from `list_quiz_submissions` that doesn't appear in the roster fetch gets
   `user_name: null` rather than a fabricated value — this is intentional, not a bug, and should be
   covered by a test case. Note this is NOT expected to happen for TA/teacher preview attempts (those
   carry a `workflow_state` like `preview`, already excluded by `RESPONDED_WORKFLOW_STATES` before
   the roster join runs); the realistic case is a student who has since been deactivated or removed
   from the default active-enrollment scope that `listStudents()` queries.

---

## Manifest regeneration

Adding a new tool changes the total tool count. After implementation:

1. Run `pnpm generate:manifests` and commit the regenerated `docs/generated/tool-manifest.json`
   (and any sibling generated artifact it touches).
2. Bump `tests/tools/registry.test.ts` line 380 — `expect(tools).toHaveLength(143)` →
   `expect(tools).toHaveLength(144)`.
3. Bump `tests/discovery/manifests.test.ts` line 38 — `expect(manifest.tools).toHaveLength(143)` →
   `expect(manifest.tools).toHaveLength(144)`.

---

## Test plan

New file: `tests/tools/quiz-question-responses.test.ts` (mocked Canvas responses only, per
CLAUDE.md — never hit a live Canvas instance).

### Canvas client — no new test file needed

No new `QuizzesModule`/`UsersModule` method was added, so no new `tests/canvas/*.test.ts` cases are
strictly required. Optionally add one case to `tests/canvas/quizzes.test.ts` asserting
`getSubmissionAnswers` still round-trips a mock payload that includes the new optional `correct`
field, to guard the type widening.

### Tool tests — `tests/tools/quiz-question-responses.test.ts`

Build a `buildMockCanvas()` helper (following `tests/tools/quizzes.test.ts`'s structural pattern —
a fake `CanvasClient` with `vi.fn()` per method) with `quizzes.get`, `quizzes.listQuestions`,
`quizzes.listSubmissions`, `quizzes.getSubmissionAnswers`, and `users.listStudents` all as
`vi.fn()`. Do not copy that file's specific mock literals (`mockQuizSubmission`, `mockQuestion`,
`mockSubQuestion`) verbatim — they include fields absent from the real `src/canvas/types.ts`
interfaces (an existing, CI-invisible discrepancy since `tsconfig.json` excludes `tests/` from
typecheck). Build fresh fixtures matching the interfaces shown in this spec's "Type additions"
section instead.

1. **Annotations**: `get_quiz_question_responses` has `readOnlyHint: true`, `openWorldHint: true`,
   no `destructiveHint`, and resolves to the `educator` audience (no `audience` override present).
2. **Pivot, no `question_id`**: 2 questions (`Q1` essay, `Q2` multiple_choice), 2 completed
   submissions with distinct answers to each. Assert `questions` has 2 entries in `position` order,
   each with 2 `responses`, `needs_manual_grading: true` for `Q1` and `false` for `Q2`.
3. **Scoped to one `question_id`**: same fixture, call with `question_id: <Q2's id>`. Assert
   `questions` has exactly 1 entry (`Q2`) and `question_count: 1`.
4. **Unknown `question_id`**: call with a `question_id` absent from `listQuestions()`'s result.
   Assert the tool returns `isError: true` with a message containing "not found".
5. **New Quizzes rejection**: mock `quizzes.get` to return `quiz_type: 'quizzes.next'`. Assert
   `isError: true` with a message naming the quiz's actual type and mentioning "New Quizzes"; assert
   `listQuestions`/`listSubmissions`/`getSubmissionAnswers` were never called (fail fast before any
   further Canvas calls).
6. **Workflow-state filtering**: submissions fixture includes one `untaken` and one `complete`.
   Assert `submissions_scanned` counts only the `complete` one and `getSubmissionAnswers` was called
   once, not twice.
7. **`pending_review` included**: a submission with `workflow_state: 'pending_review'` is scanned
   (not skipped) — this is the state of an essay awaiting grading, the tool's core use case.
8. **Per-submission failure tolerance**: 2 completed submissions; mock
   `getSubmissionAnswers` to reject for one and resolve for the other. Assert the tool still returns
   `isError` unset (success), the resolved submission's answers appear in the pivot, and
   `submissions_failed` contains exactly the rejected submission's `quiz_submission_id`.
9. **`correct` passthrough**: mock an answer with `correct: true` and one with `correct` omitted.
   Assert the response rows show `correct: true` and `correct: null` respectively.
10. **Pseudonymizer disabled (default)**: no `pseudonymizer` argument passed to
    `quizQuestionResponseTools`. Assert `user_name` equals the raw mock student name.
11. **Pseudonymizer enabled**: pass a mock `Pseudonymizer` whose `isEnabled()` returns `true` and
    `anonymizeUsers()` returns students with rewritten `name` fields. Assert the tool's `user_name`
    values reflect the pseudonymized names, not the raw ones, and that `listStudents` (not
    `listCourseUsers`) was the roster source used.
12. **Unrostered submitter**: a submission's `user_id` has no matching entry in the
    `listStudents()` mock (simulating a TA/teacher preview attempt). Assert that response row has
    `user_name: null` rather than throwing or fabricating a name.
13. **Tool count**: bump the tools-count assertion in the top-level catalog/registry tests
    (`tests/tools/registry.test.ts`, `tests/discovery/manifests.test.ts`) per the Manifest
    regeneration section above.

### Pseudonymizer coverage test

`tests/pseudonym/coverage.test.ts` maintains its own hand-copied `EXPECTED_PII_BEARING_TOOLS` set
that it diffs against `PSEUDONYMIZER_WRAPPED_TOOLS` — **this test file itself must be edited**:
add `'get_quiz_question_responses'` to `EXPECTED_PII_BEARING_TOOLS` (`tests/pseudonym/coverage.test.ts`)
in the same commit as the `PSEUDONYMIZER_WRAPPED_TOOLS` addition in `src/pseudonym/coverage.ts`.
Forgetting either half fails this test.

### Audience coverage test

`tests/tools/audience-coverage.test.ts` requires every tool resolve to a non-empty audience; since
no `audience` override is set on this tool, it resolves to the `quiz_question_responses` domain's
`defaultPrimaryAudience: 'educator'` and needs no additional test-file changes.

---

## Implementation breakdown — subtasks

Single PR is appropriate — the change touches one new type field (~2 lines), one new tool file
(~140 lines including the description string), one catalog registration (~5 lines), one coverage
list entry (~2 lines), and one new test file (~150–200 lines). This is well under the ~15-file
bail-out threshold.

1. Widen `CanvasQuizSubmissionQuestion` in `src/canvas/types.ts` (design unknown §3).
2. Add `src/tools/quiz-question-responses.ts` with the `get_quiz_question_responses` tool.
3. Register the new domain in `src/tools/catalog.ts`.
4. Add `'get_quiz_question_responses'` to `PSEUDONYMIZER_WRAPPED_TOOLS` in
   `src/pseudonym/coverage.ts` AND to `EXPECTED_PII_BEARING_TOOLS` in
   `tests/pseudonym/coverage.test.ts` (both, in the same commit).
5. Run `pnpm generate:manifests`; bump the two `toHaveLength(143)` → `144` assertions.
6. Add `tests/tools/quiz-question-responses.test.ts` covering the 13 cases above.
7. Confirm `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.

---

## Open questions for CTO review

1. ~~**Manually-graded flag source**~~ — **Resolved**: `needs_manual_grading` is derived from
   `question_type` membership in `MANUALLY_GRADED_QUESTION_TYPES` (essay, file upload), not from an
   uncertain per-answer Canvas field. Already encoded above; no CTO input needed.
2. **`correct` field shape and the answer/question join key**: design unknown §3 commits to
   `correct?: boolean | null` and to `CanvasQuizSubmissionQuestion.id === CanvasQuizQuestion.id` as
   the pivot's join key, both unverifiable against a live Canvas instance under this project's
   mocked-tests-only constraint. If either assumption proves wrong once real usage surfaces it
   (silently empty `responses[]` arrays would be the symptom for the join key; a different field
   name/shape would be the symptom for `correct`), fix it in a follow-up PR with a
   "Post-implementation correction" note at the top of this spec, matching the precedent already set
   by `docs/superpowers/specs/2026-06-14-issue-182-quiz-submission-event-logs.md`. No spec re-review
   is needed to ship V1 on these best-effort assumptions — flagging here only so the CTO can weigh in
   if a different level of pre-emptive caution (e.g. shipping `correct` as `unknown` instead of
   `boolean | null`) is preferred.
3. **No submission-count cap**: confirmed acceptable to ship without one in V1 (design unknown §4),
   consistent with the already-shipped `list_quiz_submissions` tool's unbounded behavior. Flag here
   in case the CTO wants a cap added proactively rather than reactively.

---

## Acceptance check

- [x] Design-first flag is present in the issue.
- [x] Design unknown §1 (Classic vs New Quizzes) retired: Classic only, explicit gate, gap
      documented.
- [x] Design unknown §2 (question-type scope) retired: all types returned by default,
      `needs_manual_grading` computed per question.
- [x] Design unknown §3 (per-question scoring and join key) retired: no fabricated
      `points_awarded`; `correct` and the `id`-based question/answer join key are both committed to
      as best-effort V1 assumptions with a documented post-implementation-correction path, rather
      than left as an open "verify live" task the implementor cannot actually perform.
- [x] Design unknown §4 (payload size / fan-out bounding) retired: no artificial cap, per-submission
      failure tolerance via `submissions_failed`, workflow-state filtering documented.
- [x] Exact tool name, Zod schema, Canvas calls, output shape, and MCP annotations specified.
- [x] Type additions specified with rationale and backward-compatibility note.
- [x] Test plan covers pivot correctness, `question_id` scoping (found/not-found), Classic/New
      Quizzes gating, workflow-state filtering, per-submission failure tolerance, `correct`
      passthrough, and both pseudonymizer-off and pseudonymizer-on behavior including an unrostered
      submitter.
- [x] No new package dependencies.
- [x] Pseudonymizer coverage explicitly required and specified (`user_name` trigger), unlike the
      sibling `get_quiz_submission_answers`/`get_quiz_submission_events` tools which correctly
      remain unwrapped — including the easy-to-miss second registration in
      `tests/pseudonym/coverage.test.ts`'s `EXPECTED_PII_BEARING_TOOLS`.
- [x] Manifest regeneration and both tool-count assertion bumps called out explicitly.
