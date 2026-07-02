---
issue: 230
---

# Student Submission Feedback — `get_my_submission_feedback` MCP Tool Design

**Date**: 2026-07-02
**Issue**: [bruchris/canvas-lms-mcp#230](https://github.com/bruchris/canvas-lms-mcp/issues/230)
**Status**: Design — awaiting CTO review

---

## Purpose

Give a student a single tool call to see the feedback comments (instructor and peer-review)
left on their own submissions — today `get_my_submissions` (`src/tools/student.ts:36`) calls
`canvas.submissions.listMy(courseId)` without `include[]=submission_comments`, so comments are
silently dropped. There is no student-facing equivalent of the instructor-side triage tool
(`list_submission_comments_needing_attention`, `src/tools/attention.ts`).

This spec adds one new read-only tool, `get_my_submission_feedback`, to the existing
`src/tools/student.ts` module (domain `student`, `defaultPrimaryAudience: 'student'`,
`src/tools/catalog.ts:163-166`). No new Canvas domain, no new package dependency.

---

## Design unknowns (retired)

### 1. Enrich `get_my_submissions` vs. a dedicated tool

**Decision: dedicated tool, per the issue's own recommendation (Option B).** `get_my_submissions`
(`src/tools/student.ts:36-49`) is left completely unchanged — same name, same input schema, same
`canvas.submissions.listMy(course_id)` call with no `include`. A dedicated tool gives a clean,
low-noise output shape purpose-built for "what feedback do I have" instead of overloading the
existing generic submissions list with a new `include` input and a growing response shape.

**Tool name: `get_my_submission_feedback`** (the issue's first-listed candidate; matches this
module's existing `get_my_*` naming family).

### 2. Pseudonymizing peer-reviewer comment authors

This is the one unknown that required real design work, because the existing pseudonymizer has a
documented gap for exactly this case.

**The gap.** `Pseudonymizer.anonymizeSubmission` (`src/pseudonym/pseudonymizer.ts:176-200`)
pseudonymizes `submission.user` (the submission owner) and then calls the private
`anonymizeSubmissionComments` (line 334), whose own doc-comment states the constraint plainly:
"rewrites `submission_comments[].author_name` for authors that **already have a pseudonym in the
per-course map**". It never assigns a **fresh** pseudonym to a comment author it hasn't seen
before. For a peer reviewer who is commenting on someone else's submission (not their own), that
peer's user_id was never passed through `anonymizeSubmission`/`anonymizeUser` as a `submission.user`
or enrollment owner anywhere in this student-scoped call path, so their pseudonym would never get
allocated — the real name would leak through unpseudonymized. This is the FERPA spec's own caveat
(`docs/superpowers/specs/2026-05-25-ferpa-pseudonymization.md:113`): "`submission_comments[].author_id`
and `author_name` ... when the author is a student (peer feedback)" is called out as a case the
current code does not fully solve.

**Role classification without a roster call.** Determining "is this comment author staff or a
peer?" ordinarily needs the course roster (`canvas.enrollments.listForCourse`, which
`classifyRole` in `src/pseudonym/roles.ts:31-53` consumes). But this is a **student-scoped** tool
— the caller's own Canvas token may not have `read_roster` permission in a course where the
instructor has disabled the People page for students, and a 403 there would break the whole tool.
We do not call `enrollments.listForCourse` at all. Instead we classify each comment using fields
already present on the `CanvasSubmission` object itself (`src/canvas/types.ts:258-298`):

```ts
type CommentAuthorRole = 'self' | 'teacher' | 'peer'

function classifyCommentAuthor(
  comment: CanvasSubmissionComment,
  submission: CanvasSubmission,
): CommentAuthorRole {
  if (comment.author_id === submission.user_id) return 'self'
  if (submission.grader_id != null && comment.author_id === submission.grader_id) return 'teacher'
  return 'peer'
}
```

- `self` — the submission owner (the calling student) commenting on their own work, e.g. a
  follow-up question. Never treated as "feedback" (see Unknown 2b below).
- `teacher` — the comment author matches `submission.grader_id`, the Canvas-recorded grader for
  the current grade. Not pseudonymized (staff).
- `peer` — everyone else. **Conservative default**, matching this codebase's stated principle in
  `src/pseudonym/roles.ts:17-29` and the FERPA spec's "Role detection" section
  (`2026-05-25-ferpa-pseudonymization.md:251`): *"unknown → student → pseudonymize. False
  positives (a teacher accidentally pseudonymized) are visible, fixable, and not a privacy
  incident. False negatives (a student accidentally exposed) are a privacy incident."*

**Known, accepted limitation** (documented in the tool description): a second teacher/TA who
comments without being the recorded `grader_id` (e.g. co-teaching, or a comment left before a
grade was ever posted so `grader_id` is null) is classified `peer` and gets pseudonymized. This
is the safe-direction error per the principle above and is the same class of documented,
accepted heuristic gap as Signal A's own "group submissions" and "peer-review-after-student-
comment" limitations (`2026-06-12-instructor-needs-attention.md:37-40`). A roster-based
refinement is a fast-follow if real-world use shows this misfires often.

**Pre-warming peer pseudonyms.** Once a comment is classified `peer`, we must ensure its author
has a pseudonym allocated in the course's map *before* calling `anonymizeSubmission` (which only
looks up the map, never populates it). We do this with the already-public
`Pseudonymizer.anonymizeUser` (`src/pseudonym/pseudonymizer.ts:122-132`), called with **no**
`enrollments` argument:

```ts
await pseudonymizer.anonymizeUser(courseId, { id: comment.author_id, name: comment.author_name })
```

With no enrollments passed, `classifyRole({}, undefined)` sees an empty list and returns
`'unknown'` (`roles.ts:36`), and `shouldPseudonymize('unknown')` is `true` (`roles.ts:59-61`) — so
`anonymizeUser` allocates and persists a pseudonym for that peer's user_id into the exact same
per-course map (`pseudonyms/<host>/<courseId>.json`) that every other tool in this codebase reads
and writes. The returned `CanvasUser` from this warming call is discarded — its only purpose is
the side effect of `assignPseudonym` (`pseudonymizer.ts:275-312`) persisting the map entry. The
subsequent call to `pseudonymizer.anonymizeSubmission(courseId, submission)` then finds that
entry and correctly rewrites the comment's `author_name` via the **unmodified**
`anonymizeSubmissionComments`. `teacher`-classified authors are never warmed, so they keep their
real name (no entry exists for them unless they were separately pseudonymized elsewhere, an
accepted edge case already implicit in the shared-map design). `pseudonymizer.ts` itself is
**not modified** — this is composed entirely from its two existing public methods, keeping the
change local to `src/tools/student.ts` and out of shared code three other tools depend on.

**Self-author pseudonymization.** `submission.user` (the caller, matched by `self`-classified
comments too) is pseudonymized like any other tool when the flag is on, per the FERPA spec's own
precedent for this exact tool family (`2026-05-25-ferpa-pseudonymization.md:159`, "Dashboard /
Student tools" — *"We do not silently exempt them — the operator chose the flag; we respect
it."*). No special-casing needed; `anonymizeSubmission` already does the right, documented thing.

### 3. Peer-review assignment/completion status

**Decision: out of scope for v1, deferred to a fast-follow**, matching the issue's own framing.
`list_peer_reviews` / `get_submission_peer_reviews` (`src/tools/peer-reviews.ts`) require
`assignment_id` + `submission_id` inputs the caller doesn't have up front and would force an
additional per-submission fan-out, pushing this tool well past its S–M sizing. This tool covers
only comments already left on a submission (Canvas's own `submission_comments`), not the separate
peer-review *assignment* workflow.

---

## Canvas client changes (`src/canvas/submissions.ts`)

Extend `listMy` (currently `listMy(courseId: number): Promise<CanvasSubmission[]>`, line 130-135)
to accept an optional `include`, mirroring the existing `ListSubmissionsOptions` /
`ListStudentSubmissionsOptions` pattern. **Additive and backward-compatible**: `get_my_submissions`
calls `canvas.submissions.listMy(course_id)` with no second argument, so its query string
(`student_ids=self` only, no `include`) is byte-for-byte unchanged.

```ts
export interface ListMySubmissionsOptions {
  include?: ReadonlyArray<SubmissionListInclude>
}

async listMy(
  courseId: number,
  opts: ListMySubmissionsOptions = {},
): Promise<CanvasSubmission[]> {
  const params: CanvasQueryParams = { student_ids: ['self'] }
  if (opts.include && opts.include.length > 0) params.include = opts.include
  return this.client.paginate<CanvasSubmission>(
    `/api/v1/courses/${courseId}/students/submissions`,
    params,
  )
}
```

No other Canvas client file changes. `courses.list({ enrollment_state: 'active' })`
(`src/canvas/courses.ts:58-68`) is reused as-is for the "omit `course_id`" scan path — already
called by `get_my_courses` (`src/tools/student.ts:8-18`) for exactly this purpose.

---

## Tool module changes (`src/tools/student.ts`)

### Signature change

`studentTools` must accept the pseudonymizer. `src/tools/catalog.ts` already invokes every
domain's `getTools` as `registration.getTools(canvas, pseudonymizer)`
(`src/tools/index.ts:26-30`) — the extra argument is silently ignored today because
`studentTools`'s signature doesn't declare it. No `catalog.ts` change is needed, only:

```ts
export function studentTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
```

### New include constant

```ts
const MY_SUBMISSION_FEEDBACK_INCLUDE = [
  'submission_comments',
  'user',
  'assignment',
  'course',
  'read_status',
] as const satisfies ReadonlyArray<SubmissionListInclude>
```

`'user'` is requested for the same reason Signal A requests it
(`2026-06-12-instructor-needs-attention.md:69`): it must be present so `anonymizeSubmission`
pseudonymizes `submission.user` before the comment-author rewrite runs. `'course'` gives
`submission.course.name` for the output without a second Canvas call, in both the single-course
and all-active-courses scan modes.

### New types (local to `student.ts`, not exported)

```ts
type CommentAuthorRole = 'self' | 'teacher' | 'peer'

interface FeedbackComment {
  id: number
  author_role: CommentAuthorRole
  author_name: string
  comment: string
  created_at: string
}

interface SubmissionFeedback {
  course_id: number
  course_name: string | null
  assignment_id: number
  assignment_name: string | null
  submission_id: number
  workflow_state: string
  score: number | null
  read_status: 'read' | 'unread' | null
  feedback_author_roles: CommentAuthorRole[] // deduped, excludes 'self'
  latest_feedback_comment: FeedbackComment
  comments: FeedbackComment[] // full thread, chronological, includes 'self' comments
  html_url: string | null
}
```

### Helper functions

```ts
function classifyCommentAuthor(
  comment: CanvasSubmissionComment,
  submission: CanvasSubmission,
): CommentAuthorRole {
  if (comment.author_id === submission.user_id) return 'self'
  if (submission.grader_id != null && comment.author_id === submission.grader_id) return 'teacher'
  return 'peer'
}

function toFeedbackComment(
  comment: CanvasSubmissionComment,
  role: CommentAuthorRole,
): FeedbackComment {
  return {
    id: comment.id,
    author_role: role,
    author_name: comment.author_name,
    comment: comment.comment,
    created_at: comment.created_at,
  }
}
```

### Handler

```ts
{
  name: 'get_my_submission_feedback',
  description:
    "List the authenticated student's own submissions that carry feedback comments from an " +
    'instructor or a peer reviewer — comments left by the student themselves do not count as ' +
    'feedback and submissions with no non-self comments are omitted. Omit `course_id` to scan ' +
    "every active course. Sorted most-recent-feedback-first. Comment author role is best-effort: " +
    "'teacher' is only identified when the author is the submission's recorded grader; other " +
    "non-self authors are labeled 'peer', including any staff member who comments without being " +
    'the recorded grader.',
  inputSchema: {
    course_id: z
      .number()
      .optional()
      .describe('The Canvas course ID. Omit to scan all of the student\'s active courses.'),
    unread_only: z
      .boolean()
      .optional()
      .describe(
        "Only include submissions the student hasn't opened yet (Canvas read_status). " +
          'Defaults to false.',
      ),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  handler: async (params) => {
    const courseIdParam = params.course_id as number | undefined
    const unreadOnly = (params.unread_only as boolean | undefined) ?? false

    const courseIds =
      courseIdParam !== undefined
        ? [courseIdParam]
        : (await canvas.courses.list({ enrollment_state: 'active' })).map((c) => c.id)

    const perCourse = await Promise.all(
      courseIds.map(async (courseId) => ({
        courseId,
        submissions: await canvas.submissions.listMy(courseId, {
          include: MY_SUBMISSION_FEEDBACK_INCLUDE,
        }),
      })),
    )

    let submissionsScanned = 0
    const candidates: Array<{ courseId: number; submission: CanvasSubmission }> = []
    for (const { courseId, submissions } of perCourse) {
      for (const submission of submissions) {
        submissionsScanned += 1
        const comments = submission.submission_comments ?? []
        if (comments.length === 0) continue
        const hasFeedback = comments.some(
          (c) => classifyCommentAuthor(c, submission) !== 'self',
        )
        if (!hasFeedback) continue
        if (unreadOnly && submission.read_status !== 'unread') continue
        candidates.push({ courseId, submission })
      }
    }

    if (pseudonymizer?.isEnabled()) {
      const peerAuthors = new Map<string, { courseId: number; id: number; name: string }>()
      for (const { courseId, submission } of candidates) {
        for (const comment of submission.submission_comments ?? []) {
          if (classifyCommentAuthor(comment, submission) === 'peer') {
            peerAuthors.set(`${courseId}:${comment.author_id}`, {
              courseId,
              id: comment.author_id,
              name: comment.author_name,
            })
          }
        }
      }
      await Promise.all(
        [...peerAuthors.values()].map((p) =>
          pseudonymizer.anonymizeUser(p.courseId, { id: p.id, name: p.name }),
        ),
      )
    }

    const findings: SubmissionFeedback[] = []
    for (const { courseId, submission } of candidates) {
      const roles = new Map<number, CommentAuthorRole>()
      for (const c of submission.submission_comments ?? []) {
        roles.set(c.id, classifyCommentAuthor(c, submission))
      }

      const resolved = pseudonymizer?.isEnabled()
        ? await pseudonymizer.anonymizeSubmission(courseId, submission)
        : submission

      const comments = (resolved.submission_comments ?? []).map((c) =>
        toFeedbackComment(c, roles.get(c.id) ?? 'peer'),
      )
      const feedbackComments = comments.filter((c) => c.author_role !== 'self')
      const latest = feedbackComments.reduce((a, b) =>
        a.created_at >= b.created_at ? a : b,
      )

      findings.push({
        course_id: courseId,
        course_name: resolved.course?.name ?? null,
        assignment_id: resolved.assignment_id,
        assignment_name: resolved.assignment?.name ?? null,
        submission_id: resolved.id,
        workflow_state: resolved.workflow_state,
        score: resolved.score,
        read_status: resolved.read_status ?? null,
        feedback_author_roles: [...new Set(feedbackComments.map((c) => c.author_role))],
        latest_feedback_comment: latest,
        comments,
        html_url: resolved.html_url ?? null,
      })
    }

    findings.sort((a, b) =>
      a.latest_feedback_comment.created_at < b.latest_feedback_comment.created_at ? 1 : -1,
    )

    return {
      courses_scanned: courseIds.length,
      submissions_scanned: submissionsScanned,
      findings_count: findings.length,
      findings,
    }
  },
},
```

Notes:
- `hasFeedback`/`unreadOnly` filtering happens **before** pseudonymization, using raw
  `comment.author_id`/`submission.read_status` — ids and read state are never touched by the
  pseudonymizer, so filtering order doesn't affect correctness, but doing it first avoids warming
  pseudonyms for peers on submissions that get filtered out anyway (e.g. by `unread_only`).
- `roles` is computed from the **pre-pseudonymization** comment list (author_id is stable across
  pseudonymization — only names change) and then joined back to the post-pseudonymization
  `resolved.submission_comments` by comment `id`, which `anonymizeSubmissionComments` preserves
  unchanged (`pseudonymizer.ts:339-347` only rewrites `author_name`, never `id`).
- `latest_feedback_comment` uses ISO-8601 string comparison (`created_at >= created_at`), matching
  Signal A's existing sort code path — safe because Canvas always returns `created_at` as
  zero-padded ISO-8601 UTC.
- Register this as the fifth entry in `studentTools`'s returned array, after
  `get_my_upcoming_assignments` — no `audience` override needed; it inherits the `student` domain
  default.

---

## Catalog, FERPA/pseudonymizer, and audience impact

- **Catalog (`src/tools/catalog.ts`)**: no changes. The `student` domain registration
  (line 162-166) is untouched — same `domain`, same `defaultPrimaryAudience: 'student'`, same
  `getTools: studentTools` reference (only `studentTools`'s own signature gains the
  `pseudonymizer` parameter, which the catalog already passes).
- **FERPA / pseudonymizer**: `get_my_submission_feedback` returns `user_name`-shaped fields
  (`author_name`) and **must** be wrapped. Add it to two places:
  1. `src/pseudonym/coverage.ts` — add `'get_my_submission_feedback'` to
     `PSEUDONYMIZER_WRAPPED_TOOLS`, under a new `// src/tools/student.ts` comment block.
  2. `tests/pseudonym/coverage.test.ts` — add the same string to the mirrored
     `EXPECTED_PII_BEARING_TOOLS` set (line ~10-30). Both are required —
     `tests/pseudonym/coverage.test.ts` fails if either is missing (per its own file-header
     comment).
- **Audience**: no change needed. `get_my_submission_feedback` inherits `student` from the domain
  default, matching every other tool in `src/tools/student.ts`.
- **Tool count**: `tests/tools/registry.test.ts:377` — `expect(tools).toHaveLength(141)` becomes
  `142`.

---

## Manifest regeneration (`docs/generated/tool-manifest.json`)

Run `pnpm generate:manifests` after implementing the tool and commit the resulting diff: a new
`get_my_submission_feedback` entry, and `toolCount` incrementing from `141` to `142`
(`docs/generated/tool-manifest.json:4`). Per the established convention
(`2026-07-01-issue-227-quiz-link-audit.md:370-374`), **do not hand-edit** the generated JSON —
`tests/discovery/manifests.test.ts` does a full deep-equal against a freshly generated manifest.

---

## Test plan

All tests use mocked Canvas responses; no live Canvas calls.

### Canvas client test — `tests/canvas/submissions.test.ts`

- `listMy(courseId)` with no `opts` still calls `client.paginate` with exactly
  `{ student_ids: ['self'] }` — locks in the backward-compatible default (no `include` key at
  all when omitted).
- `listMy(courseId, { include: [...] })` calls `client.paginate` with
  `{ student_ids: ['self'], include: [...] }`.

### Tool tests — `tests/tools/student.test.ts` (modify existing file)

1. Tool count: `studentTools(buildMockCanvas())` has length **5** (was 4).
2. Names: `get_my_submission_feedback` appears as the 5th entry, after
   `get_my_upcoming_assignments`.
3. Annotations: `get_my_submission_feedback` has `{ readOnlyHint: true, openWorldHint: true }`,
   same as every other tool in this file's existing "all student tools have read-only
   annotations" test (that test iterates all tools, so it covers the new one automatically once
   the mock canvas satisfies every handler's dependencies).
4. `buildMockCanvas()` additions: extend `submissions.listMy` to a `vi.fn()` returning
   submission fixtures with `submission_comments`/`user`/`assignment`/`course`/`read_status`
   populated (see fixtures below); `courses.list` already exists in this file's mock
   (`vi.fn().mockResolvedValue([mockCourse])`) — reused for the all-courses scan path.

**New fixtures** (course id `1`, assignment id `20`, submission id `100`, submission owner
`user_id: 5`):

```ts
const teacherComment: CanvasSubmissionComment = {
  id: 900,
  author_id: 7, // matches gradedSubmission.grader_id
  author_name: 'Dr. Chen',
  comment: 'Nice improvement on the thesis statement.',
  created_at: '2026-06-30T14:02:00Z',
}
const peerComment: CanvasSubmissionComment = {
  id: 901,
  author_id: 55, // not user_id, not grader_id
  author_name: 'Jordan (peer reviewer)',
  comment: 'I think question 3 could use a source.',
  created_at: '2026-06-29T09:00:00Z',
}
const selfComment: CanvasSubmissionComment = {
  id: 902,
  author_id: 5, // === submission.user_id
  author_name: 'Alex Rivera',
  comment: 'Is this graded against the new rubric?',
  created_at: '2026-06-28T08:00:00Z',
}

const feedbackSubmission: CanvasSubmission = {
  id: 100,
  assignment_id: 20,
  user_id: 5,
  grader_id: 7,
  submitted_at: '2026-06-25T10:00:00Z',
  graded_at: '2026-06-30T14:00:00Z',
  score: 88,
  grade: 'B+',
  body: null,
  url: null,
  attempt: 1,
  workflow_state: 'graded',
  read_status: 'unread',
  html_url: 'https://school.instructure.com/courses/1/assignments/20/submissions/5',
  user: { id: 5, name: 'Alex Rivera', short_name: 'Alex', sortable_name: 'Rivera, Alex' },
  assignment: { id: 20, name: 'Essay 2', course_id: 1, due_at: null, points_possible: 100 },
  course: { id: 1, name: 'Intro to CS', course_code: 'CS101', workflow_state: 'available' },
  submission_comments: [selfComment, peerComment, teacherComment],
}

const noFeedbackSubmission: CanvasSubmission = {
  id: 101,
  assignment_id: 21,
  user_id: 5,
  submitted_at: '2026-06-20T10:00:00Z',
  graded_at: null,
  score: null,
  grade: null,
  body: null,
  url: null,
  attempt: 1,
  workflow_state: 'submitted',
  read_status: 'read',
  submission_comments: [selfComment], // only self — not "feedback"
}

const noCommentsSubmission: CanvasSubmission = {
  id: 102,
  assignment_id: 22,
  user_id: 5,
  submitted_at: '2026-06-15T10:00:00Z',
  graded_at: null,
  score: null,
  grade: null,
  body: null,
  url: null,
  attempt: 1,
  workflow_state: 'submitted',
  submission_comments: [],
}
```

**Test cases** (`describe('get_my_submission_feedback')`):

5. **Filters out submissions with no feedback**: mock `listMy` to resolve
   `[feedbackSubmission, noFeedbackSubmission, noCommentsSubmission]`; call
   `{ course_id: 1 }`. Assert `result.findings_count === 1`, `result.submissions_scanned === 3`,
   and the one finding has `submission_id: 100`.
6. **Role classification**: on the single finding, assert `comments` contains all three roles —
   `{ id: 902, author_role: 'self' }`, `{ id: 901, author_role: 'peer' }`,
   `{ id: 900, author_role: 'teacher' }` — and `feedback_author_roles` equals
   `['peer', 'teacher']` or `['teacher', 'peer']` order-independent (assert as a `Set`).
7. **`latest_feedback_comment` picks the newest non-self comment**: assert
   `latest_feedback_comment.id === 900` (the teacher comment, `2026-06-30`, newer than the peer
   comment's `2026-06-29`) — proving the self comment (`2026-06-28`, oldest) is correctly
   excluded from the "latest feedback" computation even though it's chronologically not the
   newest anyway (add a second fixture variant where the self comment IS the newest to prove
   exclusion, not just recency, drives the result).
8. **`unread_only` filter**: build a second submission identical to `feedbackSubmission` but
   `read_status: 'read'`; call `{ course_id: 1, unread_only: true }`; assert only the `unread`
   one appears.
9. **`course_id` omitted scans active courses**: mock `canvas.courses.list` to resolve two
   courses (`1`, `2`); mock `submissions.listMy` to return `[feedbackSubmission]` for course 1
   and `[]` for course 2. Call `{}`. Assert `canvas.courses.list` called with
   `{ enrollment_state: 'active' }`; assert `canvas.submissions.listMy` called twice, with
   `(1, { include: [...] })` and `(2, { include: [...] })`; assert
   `result.courses_scanned === 2`.
10. **No active courses**: `canvas.courses.list` resolves `[]`; call `{}`; assert
    `result.findings_count === 0` and `canvas.submissions.listMy` is never called.
11. **`html_url`/`score`/`workflow_state`/`course_name`/`assignment_name` pass through**: assert
    the finding's `course_name === 'Intro to CS'`, `assignment_name === 'Essay 2'`,
    `score === 88`, `workflow_state === 'graded'`,
    `html_url === 'https://school.instructure.com/courses/1/assignments/20/submissions/5'`.
12. **Pseudonymizer off (default)**: no `Pseudonymizer` passed (or `makePseudonymizer(false)`,
    see pattern below); assert `teacherComment`/`peerComment`/`selfComment` author names pass
    through unchanged.
13. **Pseudonymizer on — peer gets pseudonymized, teacher does not**: using the real
    `Pseudonymizer` class against a temp dir (same pattern as
    `tests/tools/attention.test.ts:410-420` — `mkdtemp`/`rm` in `beforeEach`/`afterEach`,
    `new Pseudonymizer({ baseUrl: 'https://school.instructure.com', rootDir: tmpDir, env: {
    CANVAS_PSEUDONYMIZE_STUDENTS: 'true' } })`): call the tool once; assert the `peer`-role
    comment's `author_name` is rewritten to `'Student 1'`-shaped stable pseudonym (not
    `'Jordan (peer reviewer)'`); assert the `teacher`-role comment's `author_name` is still
    `'Dr. Chen'` (unchanged); assert the `self`-role comment's `author_name` matches whatever
    `submission.user`'s pseudonym resolved to (same pseudonym reused for the self comment, per
    the shared-map behavior described in Design unknown 2).
14. **Pseudonym stability across two calls**: call the tool twice against the same `tmpDir`;
    assert the peer's pseudonym is identical both times (same map, same user_id → same
    pseudonym, per `assignPseudonym`'s existing-entry short-circuit).
15. **Ungraded submission (`grader_id: null`) — non-self author defaults to `peer`**: a
    submission with `grader_id: null` (or omitted) and a non-self comment; assert that comment
    classifies `peer`, not `teacher` — locks in the documented conservative-default behavior from
    Design unknown 2.
16. **`propagates CanvasApiError`**: `canvas.submissions.listMy` rejects with
    `new CanvasApiError('Forbidden', 403, '/api/v1/courses/1/students/submissions')`; assert the
    tool's handler rejects with `CanvasApiError` (matches this file's existing per-tool error
    propagation tests).

### Pseudonymizer coverage test — `tests/pseudonym/coverage.test.ts`

- Add `'get_my_submission_feedback'` to `EXPECTED_PII_BEARING_TOOLS`.
- `buildMinimalCanvas()`'s existing `submissions: { listMy: list, ... }` and
  `courses: { list, ... }` entries already satisfy every Canvas method this tool calls — no
  mock-shape changes needed there.

### Registry test — `tests/tools/registry.test.ts`

- `buildFullMockCanvas()` needs no changes: `submissions.listMy: async () => []` already exists
  (line ~29) and accepts (and ignores) the new optional second argument; `courses.list` already
  exists.
- Update the tool-count assertion: `expect(tools).toHaveLength(141)` → `142`.

### Manifest test — `tests/discovery/manifests.test.ts`

No test-file changes. Passes once `pnpm generate:manifests` is run and the diff committed.

### Audience coverage test — `tests/tools/audience-coverage.test.ts`

No changes — it uses a generic `Proxy`-based mock canvas and iterates `getAllTools()`
dynamically; the new tool is covered automatically since it resolves to the `student` domain
default.

---

## Implementation checklist for the implementor

1. `src/canvas/submissions.ts` — add `ListMySubmissionsOptions`; extend `listMy(courseId, opts =
   {})` as specified. No other Canvas client changes.
2. `src/tools/student.ts`:
   - Add `pseudonymizer?: Pseudonymizer` parameter to `studentTools`.
   - Add `MY_SUBMISSION_FEEDBACK_INCLUDE`, the `CommentAuthorRole`/`FeedbackComment`/
     `SubmissionFeedback` types, `classifyCommentAuthor`/`toFeedbackComment` helpers, and the
     `get_my_submission_feedback` tool definition, as specified above.
3. `src/pseudonym/coverage.ts` — add `'get_my_submission_feedback'` to
   `PSEUDONYMIZER_WRAPPED_TOOLS` with a new `// src/tools/student.ts` comment block.
4. `tests/canvas/submissions.test.ts` — 2 new cases for `listMy`'s `include` param (see Test
   plan).
5. `tests/tools/student.test.ts` — extend `buildMockCanvas()`, add the fixtures and 12 new test
   cases (numbered 5–16 in this spec's Test plan, appended after the existing 4 top-level tests
   and per-tool `describe` blocks).
6. `tests/pseudonym/coverage.test.ts` — add `'get_my_submission_feedback'` to
   `EXPECTED_PII_BEARING_TOOLS`.
7. `tests/tools/registry.test.ts` — bump the tool-count assertion `141` → `142`.
8. Run `pnpm generate:manifests` and commit the resulting `docs/generated/tool-manifest.json` /
   `manifest.json` diff.
9. No changes to `src/tools/catalog.ts`, `src/tools/index.ts`, `src/tools/peer-reviews.ts`,
   `src/pseudonym/pseudonymizer.ts`, `src/pseudonym/roles.ts`, `tests/tools/audience-coverage.test.ts`,
   or `tests/discovery/manifests.test.ts` (beyond the regenerated JSON artifact).

---

## Acceptance check

- [x] `**design-first**` flag present in issue #230; this spec retires both listed design
  unknowns plus the peer-review-status scoping question.
- [x] Design unknown 1 (enrich vs. dedicated tool): retired — dedicated tool
  `get_my_submission_feedback`, `get_my_submissions` completely unchanged.
- [x] Design unknown 2 (peer-author pseudonymization): retired — exact role-classification
  heuristic (`self`/`teacher` via `grader_id`/`peer` conservative default), exact pre-warming
  mechanism using only existing public `Pseudonymizer` methods (`anonymizeUser` +
  `anonymizeSubmission`, no changes to `pseudonymizer.ts`), and the accepted limitation
  explicitly documented (non-grader staff comments classify as `peer`).
- [x] Design unknown 3 (peer-review assignment/completion status): explicitly deferred to a
  fast-follow, with the reason (existing peer-review tools need inputs this tool doesn't have,
  would blow the S–M sizing).
- [x] No new package dependencies; no new Canvas API domain — reuses
  `courses/:id/students/submissions` (`listMy`) and `courses.list`, both already wrapped.
  No roster call (`enrollments.listForCourse`) — avoids a student-token permission risk.
- [x] Exact tool name, Zod input schema, output shape (`SubmissionFeedback`/`FeedbackComment`),
  sort order (most-recent-feedback-first, self-comments excluded from the "latest" computation),
  and full handler implementation specified.
- [x] FERPA: both required registration points called out (`src/pseudonym/coverage.ts` and the
  mirrored `tests/pseudonym/coverage.test.ts` set) — CI (`tests/pseudonym/coverage.test.ts`)
  fails until both are updated, per CLAUDE.md's pseudonymizer rule.
- [x] Audience: inherits `student` domain default, no override, no catalog change.
- [x] Test plan: Canvas-client-level tests for the `listMy` extension, 12 new tool-level tests
  (fixtures, role classification, `unread_only`, cross-course scan, pseudonymization on/off,
  stability, ungraded-submission edge case, error propagation), coverage-test and registry-test
  updates, manifest regeneration called out explicitly.
- [x] Implementation checklist enumerates every file touched and every file explicitly untouched.
