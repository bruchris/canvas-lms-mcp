# Instructor "Needs Attention" Tooling: Submission-Comment Triage + At-Risk Student Report

**Date**: 2026-06-12
**Issue**: BRU-1591 (design) — sourced from the 18th product research run (BRU-1589/Notion 2026-06-12)
**Status**: Design proposal, awaiting CTO decision

## TL;DR — Recommendation

**Ship both tools, Signal A first, as two sequential implementation subtasks.** Two independent tools in one new tool module (`src/tools/attention.ts`), composing Canvas endpoints we already wrap plus two small additive client methods. No new Canvas domain, no new dependencies.

|                        | Tool                                         | One-line contract                                                                                  |
| ---------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Signal A (ship first)  | `list_submission_comments_needing_attention` | Course-wide triage list of submissions whose most recent comment is an unaddressed student comment |
| Signal B (ship second) | `list_students_needing_attention`            | Ranked at-risk report per student from inactivity, missing/late submissions, and low current score |

- **Client additions**: `SubmissionsModule.listForStudents()` (instructor-scope bulk submissions endpoint — we only wrap the `student_ids=self` variant today) and `AnalyticsModule.getStudentSummaries()` (`GET /courses/:id/analytics/student_summaries`, one call for per-student tardiness + activity).
- **Pseudonymization**: both tools route through existing `anonymizeSubmission` / `anonymizeEnrollment` and are added to `PSEUDONYMIZER_WRAPPED_TOOLS`. Numeric Canvas IDs are preserved by design, so a follow-up `comment_on_submission(course_id, assignment_id, user_id)` targets the right student even with pseudonyms on.
- **Differentiator**: neither competitor (vishalsachdev, DMontgomery40) has a proactive "what needs my attention?" workflow tool; Instructure gates the at-risk equivalent behind the IgniteAI paid program.

## The four unknowns, retired

### 1. "Needs attention" definition (Signal A): author/timestamp heuristic vs `read_state`

**Decision: author/timestamp heuristic is primary; `read_status` is an optional narrowing filter, not the foundation.**

A submission is flagged iff its **most recent submission comment is authored by the submitter** (`comment.author_id === submission.user_id`) **and** the submission is ungraded (`graded_at` null) **or** the comment is newer than `graded_at`. This matches the reported pain exactly ("student comments after grading, instructor never sees it") and self-clears: when the instructor replies with a comment or re-grades, the latest-comment-author or timestamp condition flips and the finding disappears.

Why not build on `read_state`:

- `submission.read_status` (already typed on `CanvasSubmission`, available via `include[]=read_status` on both list endpoints) is the **whole-submission** read flag for the current user. Canvas marks it read when the instructor opens the submission in SpeedGrader — it does not distinguish "saw the new comment" from "saw the submission once, weeks ago".
- Canvas's per-item read state (`PUT .../submissions/:user_id/read/comment`) has **no bulk/read GET counterpart**, so a course-wide scan cannot use it without N×M requests.

We therefore expose `unread_only?: boolean` (default `false`): when `true`, additionally require `read_status === 'unread'`. It is a precision filter for instructors who actively work their SpeedGrader queue, with the heuristic as the safety net for everyone else.

**Bulk endpoint confirmation**: `GET /api/v1/courses/:course_id/students/submissions` documents `submission_comments`, `assignment`, `user`, and `read_status` among its `include[]` values, and accepts `student_ids[]=all` for users with permission to view all grades (teachers/TAs/admins). We already call this endpoint in `SubmissionsModule.listMy()` (`student_ids=['self']`) — the new method is the same route with instructor parameters. Perf envelope: responses paginate at `per_page=100`; a 40-student × 20-assignment course is ~800 submission records ≈ 8 pages ≈ 8 sequential requests through the existing `client.paginate()` machinery. Acceptable for an on-demand triage tool; the `assignment_ids` input bounds the scan for very large courses. The implementation must verify against a real instance that comments arrive on the bulk route (test fixture from a live capture); if an instance quirk ever drops them, the fallback is per-assignment `submissions.list()` loops — slower but already shipped.

**Known limitations (documented in the tool description, accepted for v1)**:

- Group submissions: a comment from a non-submitter group member has `author_id !== submission.user_id` and is treated like a grader response. Group-aware triage is a follow-up if requested.
- A peer-review comment landing after a student's question hides the student's comment from the "latest comment" check. Rare in practice; same follow-up bucket.

### 2. At-risk signal selection & thresholds (Signal B)

**Decision: four signals from two already-cheap calls; thresholds are caller-supplied with sensible defaults; output is structured findings ranked by signal count.**

Data sources (two paginated requests total, regardless of course size):

1. `enrollments.listForCourse(course_id, { type: ['StudentEnrollment'], state: ['active'], include: ['grades'] })` — already wrapped; yields `last_activity_at`, `total_activity_time`, `grades.current_score` per student.
2. **New** `AnalyticsModule.getStudentSummaries(course_id)` → `GET /api/v1/courses/:course_id/analytics/student_summaries` — yields per-student `page_views`, `participations`, and `tardiness_breakdown { total, on_time, late, missing, floating }`. This is the purpose-built Canvas endpoint for exactly this report; it avoids N per-student `analytics/users/:id/activity` calls (our existing `get_student_analytics` is the N+1 shape and stays untouched).

Signals and defaults (each threshold overridable via input):

| Signal                | Condition                                               | Default | Input field       |
| --------------------- | ------------------------------------------------------- | ------- | ----------------- |
| `inactive`            | `last_activity_at` null or older than N days            | 7 days  | `inactive_days`   |
| `missing_submissions` | `tardiness_breakdown.missing >= N`                      | 1       | `min_missing`     |
| `late_pattern`        | `tardiness_breakdown.late >= N`                         | 3       | `min_late`        |
| `low_score`           | `grades.current_score < N` (skipped when score is null) | 70      | `score_threshold` |

Risk level is derived, not predicted: `high` = 3+ signals, `medium` = 2, `low` = 1; students with zero signals are omitted. Every finding carries the per-signal evidence (value vs threshold), and the response echoes `thresholds_used` so the model can explain _why_ a student is listed — a deliberate contrast to IgniteAI's opaque dropout score, and the honest framing for a tool that reports facts rather than predictions.

**Degradation**: course analytics can be disabled per institution/course (the endpoint 404s). The tool must not fail outright: it falls back to enrollment-derived signals only (`inactive`, `low_score`), sets `analytics_available: false` in the response, and notes the two skipped signals.

### 3. Pseudonymization

Both tools return student PII and **must** be wrapped (CLAUDE.md rule) and added to `PSEUDONYMIZER_WRAPPED_TOOLS` in `src/pseudonym/coverage.ts` (which makes `tests/pseudonym/coverage.test.ts` enforce registration).

- **Signal A**: each raw `CanvasSubmission` passes through `pseudonymizer.anonymizeSubmission(course_id, s)` **before** projection into findings. Two implementation constraints discovered in the current pseudonymizer:
  - `anonymizeSubmissionComments` only rewrites `author_name` for authors that already have a pseudonym in the per-course map, and `anonymizeSubmission` assigns the submitter's pseudonym from the embedded `user` object first. The tool therefore **always requests `include[]=user`** so assignment happens before comment-author rewrite — never relying on a previous tool call having populated the map.
  - `applyPseudonymToUser` preserves the numeric `user.id` and rewrites only name/contact fields (verified in `src/pseudonym/pseudonymizer.ts`). Findings key on `user_id`, so pseudonyms are stable across calls (per-course persisted map) and a follow-up `comment_on_submission` with that `user_id` reaches the right student. This retires the round-trip concern from the brief.
- **Signal B**: each enrollment passes through `pseudonymizer.anonymizeEnrollment(course_id, e)` (rewrites embedded `user`, nulls `sis_user_id`) before projection. The `student_summaries` rows are joined by numeric id and contain no names, so the enrollment path is the only PII source.
- Findings expose `user_name` from the post-anonymization `user.name` — display name when the flag is off, stable pseudonym when on.

### 4. One tool, two, or a shared "attention" facet?

**Decision: two independent tools, one shared module (`src/tools/attention.ts`), Signal A first.**

- Two tools because the questions are different ("which submissions need a reply?" is per-assignment triage with a follow-up write action; "which students are at risk?" is a course-health report) and merging them would force a union input schema and a worse model-facing description.
- One module because they share the instructor-attention framing, the pseudonymizer wiring, and likely a couple of small projection helpers. Registered in `getAllTools()` as `...attentionTools(canvas, pseudonymizer)`.
- Signal A first: highest community confidence (5+ distinct users), simplest data path, and it pairs with the existing `comment_on_submission` for a complete loop (triage → reply) in one conversation.

## Tool contracts

### `list_submission_comments_needing_attention`

> List submissions where the most recent comment is from the student and has not been addressed by grading or a reply — i.e. comments the instructor has likely not seen. Returns a triage list, oldest-unaddressed first. Requires instructor/TA permissions in the course.

**Inputs** (Zod):

| Field            | Type                                | Notes                                                                                                                         |
| ---------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `course_id`      | `number` (required)                 | The Canvas course ID                                                                                                          |
| `assignment_ids` | `number[]` (optional)               | Scope the scan to specific assignments (the brief's `assignment_id?` generalized — the bulk endpoint takes an array natively) |
| `unread_only`    | `boolean` (optional, default false) | Additionally require the submission's `read_status` to be `unread` for the caller                                             |

**Annotations**: `readOnlyHint: true`, `openWorldHint: true`.

**Data path**: one paginated call to `canvas.submissions.listForStudents(course_id, { student_ids: ['all'], assignment_ids?, include: ['submission_comments', 'user', 'assignment', 'read_status'] })`.

**Algorithm**: for each submission with comments, take the most recent comment by `created_at`. Flag iff `author_id === submission.user_id` AND (`graded_at` is null OR `created_at > graded_at`). When `unread_only`, also require `read_status === 'unread'`. `unaddressed_comment_count` = length of the trailing run of submitter-authored comments.

**Output shape**:

```jsonc
{
  "course_id": 101,
  "scanned_submissions": 740,
  "findings_count": 3,
  "findings": [
    {
      "assignment_id": 9001,
      "assignment_name": "Essay 2",
      "user_id": 4242, // numeric ID preserved under pseudonymization
      "user_name": "Adjective Animal", // pseudonym when FERPA flag on
      "reason": "student_comment_after_grading", // | "student_comment_ungraded"
      "graded_at": "2026-06-01T10:00:00Z",
      "score": 88,
      "workflow_state": "graded",
      "read_status": "unread",
      "unaddressed_comment_count": 2,
      "latest_student_comment": {
        "id": 555,
        "comment": "I think question 3 was graded against the old rubric?",
        "created_at": "2026-06-03T08:12:00Z",
      },
      "html_url": "https://school.instructure.com/courses/101/assignments/9001/submissions/4242",
    },
  ],
}
```

Findings sort ascending by `latest_student_comment.created_at` — longest-waiting student first.

### `list_students_needing_attention`

> Report students who may need instructor attention based on inactivity, missing or late submissions, and low current score. Each finding lists the exact signals that fired and the thresholds used — this is a factual report, not a prediction. Requires instructor/TA permissions in the course.

**Inputs** (Zod): `course_id` (required number) plus the four optional threshold fields from the table in Unknown 2, each with the stated default.

**Annotations**: `readOnlyHint: true`, `openWorldHint: true`.

**Data path**: `enrollments.listForCourse()` (grades include) + `analytics.getStudentSummaries()`, joined on user id; analytics failure degrades as described in Unknown 2.

**Output shape**:

```jsonc
{
  "course_id": 101,
  "students_scanned": 38,
  "analytics_available": true,
  "thresholds_used": { "inactive_days": 7, "min_missing": 1, "min_late": 3, "score_threshold": 70 },
  "findings": [
    {
      "user_id": 4242,
      "user_name": "Adjective Animal",
      "risk_level": "high", // high = 3+ signals, medium = 2, low = 1
      "signals": [
        {
          "type": "inactive",
          "value": "2026-05-28T09:00:00Z",
          "threshold": "7 days",
          "detail": "No course activity for 15 days",
        },
        {
          "type": "missing_submissions",
          "value": 4,
          "threshold": 1,
          "detail": "4 assignments missing",
        },
        { "type": "low_score", "value": 58.3, "threshold": 70, "detail": "Current score 58.3%" },
      ],
      "last_activity_at": "2026-05-28T09:00:00Z",
      "current_score": 58.3,
      "missing_count": 4,
      "late_count": 1,
    },
  ],
}
```

Findings sort by `risk_level` (high → low), then by signal count descending.

## Canvas client additions (both additive, no breaking changes)

```ts
// src/canvas/submissions.ts — instructor-scope variant of the existing listMy()
export interface ListStudentSubmissionsOptions {
  student_ids?: ReadonlyArray<number | 'all'> // default ['all']
  assignment_ids?: ReadonlyArray<number>
  include?: ReadonlyArray<SubmissionListInclude>
  workflow_state?: SubmissionWorkflowState
}
async listForStudents(courseId: number, opts?: ListStudentSubmissionsOptions): Promise<CanvasSubmission[]>
// GET /api/v1/courses/:courseId/students/submissions  (client.paginate)

// src/canvas/analytics.ts
async getStudentSummaries(courseId: number): Promise<CanvasStudentSummary[]>
// GET /api/v1/courses/:courseId/analytics/student_summaries  (client.paginate)

// src/canvas/types.ts
export interface CanvasStudentSummary {
  id: number
  page_views: number
  max_page_views?: number
  page_views_level?: number
  participations: number
  max_participations?: number
  participations_level?: number
  tardiness_breakdown: {
    total: number
    on_time: number
    late: number
    missing: number
    floating: number
  }
}
```

## Ship order & implementation subtasks (created only after CTO approval)

1. **`feat: list_submission_comments_needing_attention` tool** — `SubmissionsModule.listForStudents()`, `src/tools/attention.ts` (first tool), pseudonym coverage entry, tests (mocked bulk-submissions fixtures incl. pseudonym-stability case and the group-submission false-negative as a documented-behavior test). Est. S–M.
2. **`feat: list_students_needing_attention` tool** — `AnalyticsModule.getStudentSummaries()` + `CanvasStudentSummary` type, second tool in `attention.ts`, coverage entry, tests (mocked enrollments + summaries, threshold overrides, analytics-404 degradation). Est. S–M.

Standard acceptance per subtask: `pnpm typecheck && pnpm lint && pnpm test` green, PR to `main`, QA Track 2, CTO merge. Tool count moves from 117 to 119 registered tools (84 read / 35 write); README tool tables updated in each PR.

## Out of scope (unchanged from the brief)

- Auto-replying to comments or auto-nudging students — read-only stance preserved; both tools pair with the existing `comment_on_submission` / `create_conversation` writes the _instructor_ explicitly invokes.
- Any analytics dashboard or MCP Apps widget (possible later follow-up once the data tools prove out).
- New Canvas API domains, predictive/ML risk scoring, or storing historical snapshots for trend analysis.

## Risks & notes for the CTO decision

- **Bulk-endpoint fixture fidelity** is the one empirical unknown left: implementation task 1 starts by capturing a real `students/submissions?include[]=submission_comments` response to build the test fixture. If comments turn out to be unreliable on that route, the per-assignment fallback changes perf (A requests instead of 1) but not the contract.
- **Permissions**: both tools 403 cleanly for student tokens via the existing `formatError()` mapping; descriptions state the instructor/TA requirement so models don't offer them to student users.
- **Naming**: `list_submission_comments_needing_attention` is long (42 chars) but symmetric with `list_students_needing_attention` and unambiguous. Happy to take a CTO preference (`list_unaddressed_comments` was the runner-up).
