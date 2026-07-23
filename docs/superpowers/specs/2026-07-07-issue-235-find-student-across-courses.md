---
issue: 235
---

# Find a Student Across Courses — `find_student_across_courses` MCP Tool Design

**Date**: 2026-07-07
**Issue**: [bruchris/canvas-lms-mcp#235](https://github.com/bruchris/canvas-lms-mcp/issues/235)
**Status**: Design — awaiting CTO review

---

## Purpose

Give an instructor a single tool call to answer "which of my courses — including past terms —
was this student enrolled in?" Today that requires opening every course roster by hand, and
Canvas's own cross-course user search (`GET /accounts/:id/users`) requires admin scope most
instructors don't have.

This spec adds one new read-only tool, `find_student_across_courses`, in a new file
`src/tools/student-search.ts` (new domain `student_search`, `defaultPrimaryAudience: 'educator'`).
It composes two already-wrapped Canvas client methods —
`CoursesModule.list` (`src/canvas/courses.ts:58`) and `UsersModule.listCourseUsers`
(`src/canvas/users.ts:75`) — with no new Canvas client method and no new endpoint. No new package
dependency.

---

## Design unknowns (retired)

### 1. PII / pseudonymization tension — does a name search defeat pseudonymization?

**Decision: no special-casing. Follow the exact precedent already shipped for `search_users` and
`list_course_users`.** Both of those tools accept a `search_term` that is often literally the
student's real name, and both still route their output through `pseudonymizer.anonymizeUsers`
unconditionally when `CANVAS_PSEUDONYMIZE_STUDENTS` is enabled. `search_users`'s own test proves
the name-search case directly (`tests/tools/users.test.ts:242-247` — calling it with
`search_term: 'alice'` still returns `name: 'Student N'`); `list_course_users`'s adjacent test
(`tests/tools/users.test.ts:260-267`) doesn't happen to pass a `search_term`, but its handler
(`src/tools/users.ts:167-169`) calls `pseudonymizer.anonymizeUsers(course_id, users)`
unconditionally on every returned user regardless of what filters produced them — so the same
conclusion holds by code inspection, not just by that one test's exact inputs. This is not a gap
to fix; it is the accepted, tested behavior of this codebase for exactly this situation.

The reasoning it rests on: the pseudonymizer's job is to keep the **response** from carrying a
real name/email/login the caller didn't already have — it is not, and cannot be, responsible for
redacting the caller's own input. The caller typed the name into `search_term` themselves; Canvas
needs the real string server-side to match against roster records (our post-hoc pseudonymization
never renames the underlying Canvas record). `find_student_across_courses` sends `search_term`
to Canvas unpseudonymized (required for the match to work) and pseudonymizes every **returned**
user object the same way `list_course_users` already does. The tool's response never echoes the
input `search_term` back as a labeled field, so there is no "you searched for Jane Doe, here is
Jane Doe" round-trip to worry about — see Unknown 3's output shape.

**Known, accepted limitation** (state in the tool description): with pseudonymization on, a
teacher who no longer remembers the student's real name and only has a previously-issued pseudonym
("Student 7") cannot search by that pseudonym — Canvas's `search_term` matches the real stored
name. This mirrors the same limitation already implicit in `search_users`/`list_course_users` and
is out of scope here (a pseudonym-to-real-name reverse lookup already exists via
`Pseudonymizer.reverseLookup`, gated by `CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP`, and is a separate
tool concern, not this one's).

### 2. Per-course pseudonym scoping vs. a cross-course result

`Pseudonymizer.assignPseudonym` keys its map by `` `${host}/${courseId}` ``
(`src/pseudonym/pseudonymizer.ts:280`) — pseudonyms are deliberately **scoped per course**, so the
same real student can surface as `"Student 3"` in one course's map and `"Student 7"` in another.
That is by design (the FERPA spec explicitly avoids a single cross-course fake identity so a
pseudonym alone can't be used to correlate a student across courses). A tool whose entire purpose
is cross-course correlation must not paper over that scoping with a single hoisted display name.

**Decision: put the (possibly pseudonymized) display name *inside* each per-course match entry,
never hoisted to a single top-level name.** The join key across courses is `user_id` — Canvas's
real, never-pseudonymized numeric ID (`applyPseudonymToUser`, `src/pseudonym/pseudonymizer.ts:424`,
rewrites `name`/`email`/`login_id`/etc. but never `id`) — so grouping matches by `user_id` is
correct and stable regardless of the pseudonymization flag. See Unknown 3 for the exact shape.

### 3. Output shape

```ts
interface FindStudentMatchedCourse {
  course_id: number
  course_name: string
  term: string | null
  enrollment_state: string
  last_activity_at: string | null
  user_name: string // possibly pseudonymized, scoped to this course
}

interface FindStudentMatch {
  user_id: number
  matched_courses: FindStudentMatchedCourse[]
}

interface FindStudentAcrossCoursesResult {
  include_concluded: boolean
  courses_found: number // instructor's teaching courses matching the state filters, pre-cap
  courses_scanned: number // courses actually queried (== courses_found unless truncated)
  truncated: boolean
  courses_failed: Array<{ course_id: number; status: number | null; message: string }>
  matches_count: number
  matches: FindStudentMatch[]
}
```

No field echoes the raw `search_term` input (see Unknown 1). `course_name`/`term` are course
metadata, not student PII, so they are never pseudonymized. `enrollment_state` here is the
**student's** enrollment state in that course (`active`, `completed`, `inactive`, etc. — Canvas's
`CourseUserEnrollmentState`), letting the instructor tell a current student from a past-term one
per matched course.

### 4. Enumerating "the caller's teaching courses" — no new Canvas endpoint

Canvas's `GET /api/v1/courses` (`CoursesModule.list`) always returns each course's `enrollments`
field — the *calling* user's own enrollment(s) in that course — independent of the `include[]`
parameter (this is a native, undocumented-by-`include` Canvas behavior, distinct from
`CanvasUser.enrollments`, which *does* require `include: ['enrollments']`). `CanvasCourse.enrollments?:
CanvasEnrollment[]` (`src/canvas/types.ts:27`) is already typed for this; no client change needed.

**Decision:** call `courses.list()` and filter client-side to courses where at least one entry in
that course's own `enrollments` array has `type` in `['TeacherEnrollment', 'TaEnrollment']`
(`INSTRUCTOR_ENROLLMENT_TYPES`, local to the new file — deliberately narrower than
`STAFF_TYPES` in `src/pseudonym/roles.ts:13`, which also includes `DesignerEnrollment`; a designer
role does not imply the "which of my courses had this student" instructor persona this issue
describes, so it's excluded).

**Defensive fallback:** if a returned course's `enrollments` array is missing or empty (should not
happen per documented Canvas behavior, but the type marks it optional), **include** that course
rather than silently dropping it — a false-positive extra course scanned is a wasted API call; a
false-negative dropped course is a real course silently missing from the instructor's search
results, which is the worse failure mode.

**Flagged implementation risk:** the "every course entry always carries the caller's own
`enrollments`" claim is standard, long-documented Canvas API behavior, but nothing else in this
repo currently exercises it — there is no existing test fixture or code path to independently
confirm it against this codebase's own conventions. Because the fallback above is
*include-on-missing*, if this assumption turns out to be wrong in some Canvas configuration (e.g.
`enrollments` omitted for other reasons), the role filter would silently degrade to "every visible
course" rather than "teaching courses only," with no signal to the caller that filtering didn't
happen. The implementor should verify this against a real Canvas response (or the existing
`tests/canvas/courses.test.ts` fixtures, if any construct one) before relying on it, and, if it
does not hold, escalate rather than ship the silent fallback as-is — this is called out again in
Open Questions.

### 5. `include_concluded` — two `list()` calls, not one

`CoursesModule.list`'s `enrollment_state?: 'active' | 'invited_or_pending' | 'completed'`
(`src/canvas/courses.ts:40`) accepts a **single** value, not an array, and Canvas excludes
`completed` enrollments from the result unless explicitly requested — this is the actual Canvas
behavior the issue's evidence describes ("no way to search across courses ... including past
enrollments"). There is no single call that returns both.

**Decision:** when `include_concluded` is true (**default true** — per the issue, "the whole point
is past terms"), call `courses.list()` twice — once with no `enrollment_state` (Canvas default:
active + invited_or_pending) and once with `enrollment_state: 'completed'` — and merge the two
course lists, de-duplicating by course `id` (union each course's `enrollments` array on collision,
though a real double-hit should be rare). When `include_concluded` is false, skip the second call
entirely (fewer Canvas calls, matching the caller's stated intent to only see current courses).

This is **not** the course's own `workflow_state` (`CourseWorkflowState`, e.g. `'completed'` as a
course-level `state[]` filter) — that concept, and Canvas's separate "course marked complete"
idea, is irrelevant here; a concluded *term* almost always leaves the course `workflow_state` at
`'available'` while only the enrollment itself becomes `'completed'`. The spec deliberately does
not touch course `state[]` at all.

### 6. Bounding the fan-out

**Decision:** optional `max_courses` input, default **200**. After the Unknown 4 role filter and
Unknown 5 merge, if the resulting course count exceeds `max_courses`, sort courses by
`term.start_at` **descending** (most recent term first; a course with no `term.start_at` sorts to
the end, since a missing start date is less useful to search first) and take the first
`max_courses`. Set `truncated: true` and report both `courses_found` (pre-cap) and
`courses_scanned` (post-cap, `== min(courses_found, max_courses)`) — never silently drop courses
without surfacing the flag, per this repo's stated no-silent-truncation convention (e.g.
`list_course_submission_files`'s cap-and-flag treatment in `src/tools/submission-files.ts`).

### 7. Per-course fan-out mechanics — `Promise.all` with per-course tolerance, not the shared `fanOut` helper

`src/tools/fan-out.ts`'s `fanOut()` helper exists, but its own doc comment scopes it to "the
canonical result envelope shared by every apply X across a course **write** tool" — its
`applied`/`skipped`/`failed` vocabulary describes whether a write mutation happened, which doesn't
fit a read/search fan-out, and it iterates **sequentially** (a `for` loop), which is the wrong
default for potentially scanning up to 200 courses over HTTP.

**Decision:** mirror `get_my_submission_feedback`'s existing all-courses scan
(`src/tools/student.ts:175-206`) instead: fan out with `Promise.all`, wrapping each per-course
call so a rejected promise's course ID is preserved (`Promise.allSettled` would drop the
association), and collect failures into `courses_failed` rather than failing the whole call — one
course 403ing (e.g. an instructor role without roster read in one section) must not hide matches
in every other course.

Per course: `canvas.users.listCourseUsers(courseId, { search_term, enrollment_type: ['student'],
enrollment_state: ['active', 'completed', 'inactive', 'invited', 'rejected'], include:
['enrollments'] })`. `enrollment_state` is passed explicitly as "all states" (rather than omitted)
because Canvas's default for this endpoint only returns `active` and `invited` — the same
"concluded enrollments are excluded by default" pattern as Unknown 5, this time on the
users-in-course endpoint. `include: ['enrollments']` is required to read
`last_activity_at`/`enrollment_state` per Unknown 8.

**Explicit design note — this is intentionally independent of `include_concluded`.**
`include_concluded` (Unknown 5) controls which *courses* get scanned at all (does the instructor's
own concluded/past-term teaching enrollment count). The per-course `enrollment_state` list above
controls which *student* enrollment rows are matched **within** a course that's already being
scanned. These are two different axes on purpose: a currently-active course can still contain a
student whose own enrollment is `'completed'` or `'inactive'` (e.g. they withdrew, or completed
early under a self-paced structure), and the instructor asking "was this student ever in my
current courses" should see that row regardless of `include_concluded`. So `include_concluded:
false` narrows the *course* scan to active-only, while the *student*-enrollment-state list stays
"all states" in every case — it is not a bug that a `'completed'` student enrollment can surface
inside an `include_concluded: false` call, as long as the *course* itself is currently active.

### 8. Where `last_activity_at` and `enrollment_state` come from

`CanvasUser` has no `last_activity_at` field itself — only `CanvasEnrollment` does
(`src/canvas/types.ts:120`). Requesting `include: ['enrollments']` on `listCourseUsers`
(Unknown 7) populates each matched `CanvasUser.enrollments[]` with that user's enrollment(s) in
**this** course only (Canvas scopes this include to the course being queried, not the user's
global enrollment history) — so `user.enrollments[0]` (or the entry matching `type ===
'StudentEnrollment'` if a user has more than one enrollment row, e.g. multiple sections) supplies
both `enrollment_state` and `last_activity_at` for that course's match entry. If `enrollments` is
unexpectedly empty for a returned user (should not happen given the include was requested), fall
back to `enrollment_state: 'unknown'` / `last_activity_at: null` rather than throwing — a partial
row is more useful than dropping the match.

`term` comes from `CanvasCourse.term.name` (`CoursesModule.list`'s default include already covers
this — `DEFAULT_LIST_INCLUDE = ['term']`, `src/canvas/courses.ts:52`) captured once per course
during Unknown 4/5, not re-fetched per match.

### 9. Audience and domain

**New domain, not folded into `users.ts`.** This composes `courses` + `users` client modules
across many courses — the same shape of decision already made for `attention.ts`, `link-audit.ts`,
and `submissions-awaiting-grading.ts` (each got its own file + catalog domain rather than being
appended to an existing single-Canvas-module tool file), rather than `users.ts`'s existing
single-course, single-endpoint tools. New domain `student_search`, `defaultPrimaryAudience:
'educator'` (this is an instructor-facing lookup tool; no `audience` override needed on the tool
itself).

---

## Canvas API calls

| # | Endpoint | Purpose | Client method |
|---|----------|---------|----------------|
| 1 | `GET /api/v1/courses` (default `enrollment_state`) | Active/pending teaching courses | `canvas.courses.list({})` |
| 2 | `GET /api/v1/courses?enrollment_state=completed` | Concluded teaching courses (only if `include_concluded`) | `canvas.courses.list({ enrollment_state: 'completed' })` |
| 3 | `GET /api/v1/courses/:id/users` (× N courses, concurrent) | Name/login/email search scoped to students in each course | `canvas.users.listCourseUsers(courseId, {...})` |

No new endpoints; both client methods already exist as read above (`src/canvas/courses.ts:58`,
`src/canvas/users.ts:75`) and need **no signature changes**.

---

## Tool contract

### File location

New file: `src/tools/student-search.ts`.

### Export signature

```ts
export function studentSearchTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[]
```

Returns a single-element array (one tool). Matches the existing per-domain export convention
(`userTools`, `attentionTools`, etc.).

### Tool name

`find_student_across_courses` (fixed by the issue).

### Zod input schema

```ts
inputSchema: {
  search_term: z
    .string()
    .min(2)
    .describe('Student name, login, or email to search for (at least 2 characters)'),
  include_concluded: z
    .boolean()
    .optional()
    .describe('Also search courses with a concluded (completed) enrollment. Default true.'),
  max_courses: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Cap on the number of teaching courses scanned, most recent term first. Default 200.',
    ),
}
```

### Annotations

```ts
annotations: { readOnlyHint: true, openWorldHint: true }
```

### Output shape

See Unknown 3.

### Algorithm (annotated pseudocode)

```ts
const searchTerm = params.search_term as string
const includeConcluded = (params.include_concluded as boolean | undefined) ?? true
const maxCourses = (params.max_courses as number | undefined) ?? 200

// 1. Enumerate teaching courses (Unknowns 4 & 5).
const activeCourses = await canvas.courses.list({})
const concludedCourses = includeConcluded
  ? await canvas.courses.list({ enrollment_state: 'completed' })
  : []
const byId = new Map<number, CanvasCourse>()
for (const c of [...activeCourses, ...concludedCourses]) {
  const existing = byId.get(c.id)
  if (!existing) {
    byId.set(c.id, c)
  } else {
    byId.set(c.id, { ...existing, enrollments: [...(existing.enrollments ?? []), ...(c.enrollments ?? [])] })
  }
}
const teachingCourses = [...byId.values()].filter(
  (c) => (c.enrollments ?? []).length === 0 // defensive fallback: include (Unknown 4)
    || c.enrollments!.some((e) => INSTRUCTOR_ENROLLMENT_TYPES.has(e.type)),
)

// 2. Bound the fan-out (Unknown 6).
const coursesFound = teachingCourses.length
const sorted = [...teachingCourses].sort((a, b) => {
  const aTime = a.term?.start_at ? new Date(a.term.start_at).getTime() : -Infinity
  const bTime = b.term?.start_at ? new Date(b.term.start_at).getTime() : -Infinity
  return bTime - aTime
})
const truncated = coursesFound > maxCourses
const coursesToScan = truncated ? sorted.slice(0, maxCourses) : sorted

// 3. Fan out the per-course search (Unknown 7), Promise.all with per-course tolerance.
const coursesFailed: Array<{ course_id: number; status: number | null; message: string }> = []
const perCourseMatches: Array<{ course: CanvasCourse; users: CanvasUser[] }> = []
const results = await Promise.all(
  coursesToScan.map(async (course) => {
    try {
      const users = await canvas.users.listCourseUsers(course.id, {
        search_term: searchTerm,
        enrollment_type: ['student'],
        enrollment_state: ['active', 'completed', 'inactive', 'invited', 'rejected'],
        include: ['enrollments'],
      })
      return { ok: true as const, course, users }
    } catch (err) {
      return { ok: false as const, course, err }
    }
  }),
)
for (const r of results) {
  if (r.ok) perCourseMatches.push({ course: r.course, users: r.users })
  else
    coursesFailed.push({
      course_id: r.course.id,
      status: r.err instanceof CanvasApiError ? r.err.status : null,
      message: r.err instanceof CanvasApiError ? r.err.message : String(r.err),
    })
}

// 4. Pseudonymize per course (Unknowns 1 & 2 — per-course map, never hoisted).
const resolvedByCourse = new Map<number, CanvasUser[]>()
for (const { course, users } of perCourseMatches) {
  resolvedByCourse.set(
    course.id,
    pseudonymizer?.isEnabled() ? await pseudonymizer.anonymizeUsers(course.id, users) : users,
  )
}

// 5. Group by real user_id across courses (Unknown 2/3).
const byUser = new Map<number, FindStudentMatch>()
for (const { course, users: rawUsers } of perCourseMatches) {
  const resolved = resolvedByCourse.get(course.id)!
  rawUsers.forEach((rawUser, i) => {
    const resolvedUser = resolved[i]
    const enrollment = rawUser.enrollments?.find((e) => e.type === 'StudentEnrollment') ?? rawUser.enrollments?.[0]
    const entry = byUser.get(rawUser.id) ?? { user_id: rawUser.id, matched_courses: [] }
    entry.matched_courses.push({
      course_id: course.id,
      course_name: course.name,
      term: course.term?.name ?? null,
      enrollment_state: enrollment?.enrollment_state ?? 'unknown',
      last_activity_at: enrollment?.last_activity_at ?? null,
      user_name: resolvedUser.name,
    })
    byUser.set(rawUser.id, entry)
  })
}
const matches = [...byUser.values()]

return {
  include_concluded: includeConcluded,
  courses_found: coursesFound,
  courses_scanned: coursesToScan.length,
  truncated,
  courses_failed: coursesFailed,
  matches_count: matches.length,
  matches,
}
```

`INSTRUCTOR_ENROLLMENT_TYPES = new Set(['TeacherEnrollment', 'TaEnrollment'])`, module-local
constant (Unknown 4).

Note: iterating `rawUsers`/`resolved` by index (step 5) relies on
`pseudonymizer.anonymizeUsers` preserving array order and length 1:1 with its input — true today
(`src/pseudonym/pseudonymizer.ts:134-144` maps over the input in order, pushing exactly one output
per input) — the implementor should keep this invariant in mind if `anonymizeUsers` is ever
changed to filter or reorder.

---

## Pseudonymizer integration

- `find_student_across_courses` surfaces `CanvasUser`-derived `user_name` fields → **must** be
  wrapped.
- Add `'find_student_across_courses'` to `PSEUDONYMIZER_WRAPPED_TOOLS` in
  `src/pseudonym/coverage.ts`, under a new `// src/tools/student-search.ts` comment block.
- Add the same string to `EXPECTED_PII_BEARING_TOOLS` in `tests/pseudonym/coverage.test.ts`.
- Uses only the existing public `anonymizeUsers` method — no changes to `pseudonymizer.ts` or
  `roles.ts`.

---

## Catalog registration (`src/tools/catalog.ts`)

Add the import and a new domain entry (alphabetically near `student`/`submissions_*`, matching
this file's loose grouping — exact position doesn't matter to any test):

```ts
import { studentSearchTools } from './student-search'
// ...
{
  domain: 'student_search',
  defaultPrimaryAudience: 'educator',
  getTools: studentSearchTools,
},
```

---

## Error handling

| Scenario | Handling |
|---|---|
| `search_term` shorter than 2 chars | Zod validation rejects before the handler runs (standard MCP input-validation error) |
| Caller has zero teaching courses | `courses_found: 0`, `courses_scanned: 0`, `matches: []` — not an error |
| A course's `listCourseUsers` call 403s/404s/network-fails | Caught per-course; recorded in `courses_failed`; other courses' matches still returned |
| Zero matches across all scanned courses | `matches_count: 0`, `matches: []` — not an error |
| `max_courses` exceeded | `truncated: true`, `courses_scanned < courses_found`, most-recent-term-first courses kept |

---

## Test plan (`tests/tools/student-search.test.ts`, new file)

All tests use mocked Canvas responses; no live Canvas calls.

`buildMockCanvas()` needs `courses.list` and `users.listCourseUsers` as `vi.fn()`s.

### Fixture A — two teaching courses, one concluded

```ts
const activeCourse: CanvasCourse = {
  id: 1,
  name: 'Intro to CS',
  course_code: 'CS101',
  workflow_state: 'available',
  term: { id: 10, name: 'Fall 2026', start_at: '2026-08-25T00:00:00Z', end_at: null },
  enrollments: [{ id: 501, course_id: 1, user_id: 900, type: 'TeacherEnrollment', role: 'TeacherEnrollment', enrollment_state: 'active' }],
}
const concludedCourse: CanvasCourse = {
  id: 2,
  name: 'Data Structures',
  course_code: 'CS201',
  workflow_state: 'available',
  term: { id: 9, name: 'Spring 2026', start_at: '2026-01-12T00:00:00Z', end_at: '2026-05-01T00:00:00Z' },
  enrollments: [{ id: 502, course_id: 2, user_id: 900, type: 'TeacherEnrollment', role: 'TeacherEnrollment', enrollment_state: 'completed' }],
}
```

### Fixture B — a matched student appearing in both courses

```ts
const janeInCourse1: CanvasUser = {
  id: 5,
  name: 'Jane Doe',
  enrollments: [{ id: 601, course_id: 1, user_id: 5, type: 'StudentEnrollment', role: 'StudentEnrollment', enrollment_state: 'active', last_activity_at: '2026-07-01T00:00:00Z' }],
}
const janeInCourse2: CanvasUser = {
  id: 5,
  name: 'Jane Doe',
  enrollments: [{ id: 602, course_id: 2, user_id: 5, type: 'StudentEnrollment', role: 'StudentEnrollment', enrollment_state: 'completed', last_activity_at: '2026-04-20T00:00:00Z' }],
}
```

### Fixture C — a non-teaching course (e.g. the caller also enrolled as a student elsewhere)

```ts
const studentCourse: CanvasCourse = {
  id: 3,
  name: 'Faculty Development Seminar',
  course_code: 'FAC100',
  workflow_state: 'available',
  term: { id: 10, name: 'Fall 2026', start_at: '2026-08-25T00:00:00Z', end_at: null },
  enrollments: [{ id: 503, course_id: 3, user_id: 900, type: 'StudentEnrollment', role: 'StudentEnrollment', enrollment_state: 'active' }],
}
```

**Test cases:**

1. **Tool count / name**: `studentSearchTools(buildMockCanvas())` has length 1; name is
   `find_student_across_courses`.
2. **Annotations**: `{ readOnlyHint: true, openWorldHint: true }`.
3. **Default `include_concluded: true` makes two `courses.list` calls**: mock `courses.list` to
   resolve `[activeCourse]` on the no-args call and `[concludedCourse]` on the
   `{ enrollment_state: 'completed' }` call; mock `listCourseUsers` to resolve
   `[janeInCourse1]` for course 1 and `[janeInCourse2]` for course 2; call
   `{ search_term: 'Jane' }`; assert `canvas.courses.list` called twice — once with `{}`, once
   with `{ enrollment_state: 'completed' }`.
4. **`include_concluded: false` skips the second call**: same setup; call
   `{ search_term: 'Jane', include_concluded: false }`; assert `canvas.courses.list` called
   exactly once.
5. **Filters out non-teaching courses**: `courses.list` resolves `[activeCourse, studentCourse]`;
   assert `canvas.users.listCourseUsers` is called only with course id `1`, never `3`.
6. **Fallback when `enrollments` missing**: a course with `enrollments: undefined`; assert it is
   still scanned (Unknown 4's defensive-inclusion fallback).
7. **Groups a match across courses by `user_id`**: using Fixture A + B, call
   `{ search_term: 'Jane' }`; assert `matches_count === 1`; the single match has `user_id: 5` and
   `matched_courses` with exactly 2 entries, one per course, each with the right
   `course_id`/`course_name`/`term`/`enrollment_state`/`last_activity_at`.
8. **`listCourseUsers` called with the right options per course**: assert
   `canvas.users.listCourseUsers` called with
   `(1, { search_term: 'Jane', enrollment_type: ['student'], enrollment_state: ['active', 'completed', 'inactive', 'invited', 'rejected'], include: ['enrollments'] })`.
9. **Zero matches**: `listCourseUsers` resolves `[]` for every course; assert
   `matches_count === 0`, `matches: []` — not an error.
10. **Zero teaching courses**: `courses.list` resolves `[]` for both calls; assert
    `courses_found: 0`, `courses_scanned: 0`, `matches: []`; `listCourseUsers` never called.
11. **Per-course failure tolerance**: two teaching courses; course 1's `listCourseUsers` resolves
    normally with a match, course 2's rejects with
    `new CanvasApiError('Forbidden', 403, '/api/v1/courses/2/users')`; assert `matches_count === 1`
    (course 1's match still present), `courses_failed` has one entry
    `{ course_id: 2, status: 403, message: 'Forbidden' }`.
12. **`max_courses` truncation, most-recent-term-first**: three teaching courses with distinct
    `term.start_at` values (2024, 2025, 2026); call `{ search_term: 'Jane', max_courses: 2 }`;
    assert `truncated: true`, `courses_found: 3`, `courses_scanned: 2`; assert
    `canvas.users.listCourseUsers` was called for the 2026 and 2025 courses only, never the 2024
    one.
13. **Course with no `term.start_at` sorts last under truncation**: a course with
    `term: undefined` mixed with two dated courses and `max_courses: 2`; assert the undated course
    is the one dropped.
14. **Missing `enrollments` on the matched user falls back gracefully**: a matched `CanvasUser`
    with `enrollments: []`; assert the resulting match entry has `enrollment_state: 'unknown'`,
    `last_activity_at: null` — does not throw.
15. **Pseudonymizer off (default)**: no `Pseudonymizer` passed; assert `user_name` in the result
    is the real name (`'Jane Doe'`).
16. **Pseudonymizer on**: using the real `Pseudonymizer` class against a temp dir (pattern from
    `tests/tools/users.test.ts:189-195` — `mkdtemp`/`rm` in `beforeEach`/`afterEach`), call the
    tool with `search_term: 'Jane'` against Fixture A/B; assert both `matched_courses` entries'
    `user_name` match `/^Student \d+$/` (each course's own scoped pseudonym — assert they are
    **not required to be equal to each other**, proving Unknown 2's per-course scoping is
    preserved rather than silently unified).
17. **`search_term` is never echoed in the output**: assert the top-level result object has no
    `search_term` key (Unknown 1/3).
18. **Propagates a non-`CanvasApiError` correctly logged, still recorded as failed**: a course's
    `listCourseUsers` rejects with a plain `Error('boom')`; assert it appears in `courses_failed`
    with that message rather than throwing out of the handler.

### Pseudonymizer coverage test — `tests/pseudonym/coverage.test.ts`

Add `'find_student_across_courses'` to `EXPECTED_PII_BEARING_TOOLS`.

### Registry test — `tests/tools/registry.test.ts`

`buildFullMockCanvas()` needs `courses.list` and `users.listCourseUsers` — both already exist in
this file's shared mock (used by other course/user tools). Bump
`expect(tools).toHaveLength(143)` → `144`.

### Manifest test — `tests/discovery/manifests.test.ts`

Bump the separately-hardcoded `expect(manifest.tools).toHaveLength(143)` (line 38) to `144`. Run
`pnpm generate:manifests` and commit the regenerated `docs/generated/tool-manifest.json` diff
(do not hand-edit the generated JSON — the file's other assertion does a full deep-equal against
a freshly generated manifest).

### Audience coverage test — `tests/tools/audience-coverage.test.ts`

No changes — it iterates `getAllTools()` dynamically; the new tool resolves to the
`student_search` domain default (`'educator'`) automatically.

---

## Tool description (MCP `tool.description`)

> Search the caller's teaching courses — active and, by default, concluded (past-term) ones —
> for a student by name, login, or email, and report every matching course with the student's
> enrollment state and last activity. Set `include_concluded: false` to only search current
> courses. `max_courses` bounds how many of the caller's courses are scanned (most recent term
> first); when exceeded, `truncated: true` is set rather than silently dropping courses. A course
> that errors during the scan is skipped and reported in `courses_failed` rather than failing the
> whole call.

---

## File changes summary

| File | Change |
|---|---|
| `src/tools/student-search.ts` | New — `studentSearchTools`, `find_student_across_courses` |
| `src/tools/catalog.ts` | New `student_search` domain entry |
| `src/pseudonym/coverage.ts` | Add `'find_student_across_courses'` to `PSEUDONYMIZER_WRAPPED_TOOLS` |
| `tests/tools/student-search.test.ts` | New — full test plan above |
| `tests/pseudonym/coverage.test.ts` | Add to `EXPECTED_PII_BEARING_TOOLS` |
| `tests/tools/registry.test.ts` | Bump tool count `143` → `144` |
| `tests/discovery/manifests.test.ts` | Bump hardcoded count `143` → `144` |
| `docs/generated/tool-manifest.json` | Regenerate via `pnpm generate:manifests` |

8 files total: 7 hand-edited (2 of them new — `student-search.ts` and
`student-search.test.ts`) + 1 generated (`tool-manifest.json`, via `pnpm generate:manifests`, not
hand-edited). No new Canvas client module, no changes to `src/canvas/courses.ts`,
`src/canvas/users.ts`, `src/pseudonym/pseudonymizer.ts`, or `src/pseudonym/roles.ts`.

---

## Open questions for CTO review

- **Verify the "`/courses` always returns the caller's own `enrollments`" assumption before
  implementing** (Unknown 4): this is standard documented Canvas behavior but is not exercised
  anywhere else in this repo today, and the spec's own defensive fallback would silently degrade
  the teacher-only filter to "every visible course" if the assumption doesn't hold in practice.
  The implementor should confirm this against a real Canvas response (or existing
  `tests/canvas/courses.test.ts` fixtures, if any construct one with `enrollments` populated)
  before relying on it — this is the one part of the spec resting on an external behavior rather
  than something verifiable purely by reading this repo's own code.
- **`INSTRUCTOR_ENROLLMENT_TYPES` scope** (Unknown 4): this spec excludes `DesignerEnrollment` from
  the "teaching courses" filter, on the reasoning that a designer role doesn't imply the
  roster-search persona the issue describes. If designers should also get this tool, that's a
  one-line change to the `Set` literal — flagging in case the CTO's intent differs.
- **`max_courses` default of 200**: chosen as a round number comfortably above what a typical
  multi-year instructor accumulates, while still bounding worst-case concurrent fan-out. No signal
  in the issue about an expected real-world course count per instructor; open to tuning.
- Everything else — output shape, pseudonymization behavior, fan-out mechanics, and test plan — is
  considered implementation-ready as specified above.
