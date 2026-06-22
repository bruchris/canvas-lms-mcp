---
issue: 210
---

# Course Submission File Manifest — `list_course_submission_files` MCP Tool Design

**Date**: 2026-06-22
**Issue**: [bruchris/canvas-lms-mcp#210](https://github.com/bruchris/canvas-lms-mcp/issues/210)
**Status**: Design — awaiting CTO review

---

## Purpose

Add a single read-only tool, `list_course_submission_files`, that walks every assignment in a
Canvas course and produces a flat manifest of every file attachment students have submitted.
Each entry contains the original filename (Canvas `display_name`), a file ID usable with the
existing `download_file` tool, a time-limited download URL, content type, size, and the
pseudonymized student identity.

The primary use case is archiving years of student work before a Free-For-Teacher account is
concluded — Canvas's native course exports deliberately exclude student submission data.

This is **read-only composition of existing modules**. No new Canvas endpoints are required;
`CanvasSubmission.attachments[]` already carries `display_name` + `url`. No new canvas module
is created.

---

## Design unknowns (retired)

### 1. Time-limited attachment URLs — flagging and re-fetch path

**Decision: always include a top-level `url_expiry_note` string in the output, and always
include the `file_id` field so callers can re-fetch via `download_file`.**

Canvas submission attachment URLs are signed and expire (typically within one hour of the
API call that generated them). The manifest is therefore a snapshot, not a persistent download
list.

Handling:

- Every manifest response includes:
  ```
  url_expiry_note: "Attachment download URLs are time-limited (typically 1 hour). Use file_id with the download_file tool to re-fetch a fresh URL."
  ```
- The `file_id` field is always present in every file entry so callers can call
  `download_file` without re-scanning the course.
- No per-entry TTL field is included (Canvas does not expose it via the REST API).

### 2. Scale / pagination — cap with explicit truncation, no silent drops

**Decision: expose a `max_files` input (default 500, max 2 000). When the manifest would exceed
`max_files` entries, stop accumulating, set `truncated: true`, and include a `truncation_note`.
Never silently drop data.**

Large courses can have many assignments × many students × multiple attempts. The server's
`maxPaginationPages` config already limits how many Canvas API pages are fetched, but the tool
layer also applies a file-count cap so callers get a bounded, predictable response.

- Default `max_files: 500` balances usability against response size.
- When `truncated: true`:
  - `truncation_note` = `"Results truncated at {max_files} files. Re-run with assignment_ids or student_ids filters to retrieve the remaining files."`
  - `total_files` reflects the count of returned entries (≤ max_files), not the full course total.
  - `total_submissions_scanned` reflects how many submission records were processed before the
    cap was hit — useful for the caller to understand coverage.
- When `truncated: false`, both counts are exact for the applied filters.

To retrieve a full course with > 500 file submissions: call the tool repeatedly with
`assignment_ids` narrowed to subsets, or increase `max_files` up to 2 000.

### 3. Pseudonymization — per-student stable pseudonyms covering the manifest shape

**Decision: call `pseudonymizer.anonymizeUser(courseId, submission.user)` for each submission
that has an embedded `user` object; surface `user_name` (pseudonymized) and `user_id` (unchanged
numeric Canvas ID). Add `list_course_submission_files` to `PSEUDONYMIZER_WRAPPED_TOOLS`.**

The manifest returns `{ user_id: number, user_name: string }` per file entry. `user_name` is
sourced from `submission.user.name` (embedded via `include: ['user']`). This is direct student
PII — the FERPA trigger.

Pseudonymization is applied when `CANVAS_PSEUDONYMIZE_STUDENTS` is enabled. The existing
`anonymizeUser(courseId, CanvasUser)` method returns the same `Student N` pseudonym across
all submissions for the same student within a course, ensuring consistent per-student grouping
even after names are replaced.

The `user_id` field is the raw Canvas numeric ID — it is not altered by the pseudonymizer.
This allows an instructor to use the ID as a stable per-student folder key for organizing
downloaded files.

If a submission has no embedded `user` object (e.g., Canvas omitted it due to permissions), the
entry falls back to `user_id: submission.user_id` and `user_name: null` with a `_warning` field
of `"user data unavailable"`.

### 4. Scope boundary — submission file attachments only

**Decision: `list_course_submission_files` covers only student file attachments
(`CanvasSubmission.attachments[]`). Submission body text, online-URL submissions, and media
recordings are out of scope. Course content (pages, quizzes, modules) is already covered by
`create_content_export` + `get_course_structure`.**

The `attachments_only` input (default `true`) skips submissions whose `attachments` array is
empty or absent. When `attachments_only: false`, the tool still emits only attachment-based
file entries; the flag merely controls whether to count non-file submissions in
`total_submissions_scanned`.

---

## Canvas API call

**One paginated call** (plus one parallel assignments call when needed):

| # | Endpoint | Purpose | CanvasClient method |
|---|----------|---------|---------------------|
| 1 | `GET /api/v1/courses/:id/students/submissions` | All submissions with user + assignment name embedded | `canvas.submissions.listForStudents(courseId, { student_ids: ['all'], include: ['user', 'assignment'], assignment_ids?, workflow_state? })` |

`include: ['user']` embeds the submitting user on each record (for pseudonymization).
`include: ['assignment']` embeds the assignment name on each record (to avoid a separate
assignments list call).

**Why one call instead of assignments + per-assignment submissions:**

The bulk `/students/submissions` endpoint with `student_ids[]=all` pages across every
student-assignment pair in one pass. A "for each assignment → list submissions" approach would
issue O(assignments) sequential API calls, which is slower and risks hitting Canvas rate limits
for large courses.

**Filters applied at the Canvas API layer (not client-side):**

- `student_ids[]`: when the caller provides `student_ids`, passed directly.
- `assignment_ids[]`: when the caller provides `assignment_ids`, passed directly.
- `workflow_state`: when provided, passed directly.

---

## Tool contract (`src/tools/submission-files.ts`)

### Export signature

```ts
export function submissionFileTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[]
```

### Tool name

`list_course_submission_files`

### Zod input schema

```ts
z.object({
  course_id: z.number().int().positive().describe(
    'Canvas course ID.'
  ),
  assignment_ids: z.array(z.number().int().positive()).optional().describe(
    'Restrict to these assignment IDs. Omit to scan all assignments.'
  ),
  student_ids: z.array(z.number().int().positive()).optional().describe(
    'Restrict to these student user IDs. Omit to include all students. ' +
    'When CANVAS_PSEUDONYMIZE_STUDENTS is enabled, pass the real Canvas user_id after resolving the pseudonym via resolve_pseudonym.'
  ),
  workflow_state: z.enum(['submitted', 'graded', 'pending_review', 'unsubmitted']).optional().describe(
    'Only include submissions in this workflow state. Omit to include all states.'
  ),
  attachments_only: z.boolean().default(true).describe(
    'When true (default), skip submissions that have no file attachments. ' +
    'When false, count all submissions in total_submissions_scanned but still only emit file entries.'
  ),
  max_files: z.number().int().min(1).max(2000).default(500).describe(
    'Maximum number of file entries to return (1–2 000). Default 500. ' +
    'When the limit is hit, truncated is set to true.'
  ),
})
```

### Annotations

```ts
{
  readOnlyHint: true,
  openWorldHint: true,
}
```

### Output shape

```ts
{
  course_id: number,
  total_files: number,                // count of entries in files[]
  total_submissions_scanned: number,  // submissions processed before cap or end
  truncated: boolean,
  truncation_note: string | null,     // non-null only when truncated === true
  url_expiry_note: string,            // always present
  files: Array<{
    assignment_id: number,
    assignment_name: string | null,   // from submission.assignment?.name
    user_id: number,                  // raw Canvas user_id (stable for folder naming)
    user_name: string | null,         // display_name; pseudonymized when CANVAS_PSEUDONYMIZE_STUDENTS=true
    original_filename: string,        // attachment.display_name (the human-readable name)
    file_id: number,                  // attachment.id — pass to download_file for a fresh URL
    download_url: string,             // attachment.url — time-limited
    content_type: string,
    size: number,                     // bytes
    submitted_at: string | null,
    _warning?: string,                // present only when user data was unavailable
  }>
}
```

---

## Handler algorithm

```
async function handler(params):
  courseId = params.course_id
  maxFiles = params.max_files ?? 500
  attachmentsOnly = params.attachments_only ?? true

  // Fetch all submissions (paginated, filtered at API level)
  submissions = await canvas.submissions.listForStudents(courseId, {
    student_ids: params.student_ids ?? ['all'],
    assignment_ids: params.assignment_ids,
    workflow_state: params.workflow_state,
    include: ['user', 'assignment'],
  })

  files = []
  submissionsScanned = 0
  truncated = false

  for sub of submissions:
    submissionsScanned++

    if attachmentsOnly && (!sub.attachments || sub.attachments.length === 0):
      continue

    // Resolve user identity
    let userId = sub.user_id
    let userName: string | null = null
    let warning: string | undefined

    if sub.user:
      const resolvedUser = pseudonymizer?.isEnabled()
        ? await pseudonymizer.anonymizeUser(courseId, sub.user)
        : sub.user
      userId = resolvedUser.id
      userName = resolvedUser.name
    else:
      warning = 'user data unavailable'

    // Emit one entry per attachment
    for att of (sub.attachments ?? []):
      if files.length >= maxFiles:
        truncated = true
        break
      files.push({
        assignment_id: sub.assignment_id,
        assignment_name: sub.assignment?.name ?? null,
        user_id: userId,
        user_name: userName,
        original_filename: att.display_name,
        file_id: att.id,
        download_url: att.url,
        content_type: att.content_type,
        size: att.size,
        submitted_at: sub.submitted_at,
        ...(warning !== undefined && { _warning: warning }),
      })

    if truncated: break

  return {
    course_id: courseId,
    total_files: files.length,
    total_submissions_scanned: submissionsScanned,
    truncated,
    truncation_note: truncated
      ? `Results truncated at ${maxFiles} files. Re-run with assignment_ids or student_ids filters to retrieve the remaining files.`
      : null,
    url_expiry_note: 'Attachment download URLs are time-limited (typically 1 hour). Use file_id with the download_file tool to re-fetch a fresh URL.',
    files,
  }
```

---

## Pseudonymizer integration

`list_course_submission_files` returns `user_name` sourced from `submission.user.name` — direct
student PII.

```ts
const resolvedUser = (pseudonymizer?.isEnabled() && sub.user)
  ? await pseudonymizer.anonymizeUser(courseId, sub.user)
  : sub.user
```

`anonymizeUser` allocates a stable `Student N` pseudonym per user per course; it is called once
per submission record (not once per attachment), so a student with 5 file attachments on one
submission still receives the same pseudonym regardless of call order.

Add `'list_course_submission_files'` to `PSEUDONYMIZER_WRAPPED_TOOLS` in
`src/pseudonym/coverage.ts`:

```ts
// src/tools/submission-files.ts
'list_course_submission_files',
```

---

## Catalog registration (`src/tools/catalog.ts`)

New domain entry (append to `toolDomainCatalog`):

```ts
{
  domain: 'submission_files',
  defaultPrimaryAudience: 'educator',
  getTools: submissionFileTools,
}
```

`src/tools/index.ts` does **not** need to be edited — tools are wired automatically through the
catalog's `getAllTools()` loop.

---

## Test plan (`tests/submission-files.test.ts`)

All tests use mocked Canvas responses — no real Canvas instance is hit. Mock
`canvas.submissions.listForStudents` as a `vi.fn()` returning the fixture data.

### Fixture A — basic two-assignment, two-student course

**Mock submissions**:
- Sub 1: `{ assignment_id: 10, assignment: { id: 10, name: 'Essay' }, user_id: 100, user: { id: 100, name: 'Alice' }, submitted_at: '2026-01-10T12:00:00Z', attachments: [{ id: 501, display_name: 'essay.docx', url: 'https://canvas.example.com/files/501/download', content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 24576 }] }`
- Sub 2: `{ assignment_id: 10, assignment: { id: 10, name: 'Essay' }, user_id: 101, user: { id: 101, name: 'Bob' }, submitted_at: '2026-01-11T09:30:00Z', attachments: [{ id: 502, display_name: 'essay_final.pdf', url: 'https://canvas.example.com/files/502/download', content_type: 'application/pdf', size: 98304 }] }`
- Sub 3: `{ assignment_id: 20, assignment: { id: 20, name: 'Project' }, user_id: 100, user: { id: 100, name: 'Alice' }, submitted_at: '2026-02-01T15:00:00Z', attachments: [{ id: 503, display_name: 'project.zip', url: 'https://canvas.example.com/files/503/download', content_type: 'application/zip', size: 204800 }] }`
- Sub 4: `{ assignment_id: 20, assignment: { id: 20, name: 'Project' }, user_id: 101, user: { id: 101, name: 'Bob' }, submitted_at: '2026-02-02T10:00:00Z', attachments: [] }` ← no attachments

**Assertions** (with `attachments_only: true`, default):
1. `result.total_files === 3` (Sub 4 skipped — no attachments)
2. `result.total_submissions_scanned === 4` (all 4 submissions processed)
3. `result.truncated === false`
4. `result.files[0].original_filename === 'essay.docx'`
5. `result.files[0].file_id === 501`
6. `result.files[0].assignment_name === 'Essay'`
7. `result.url_expiry_note` contains `'file_id'`

### Fixture B — `attachments_only: false`

Same mock as Fixture A.

**Assertions**:
1. `result.total_files === 3` (still only 3 file entries — Sub 4 has no attachments)
2. `result.total_submissions_scanned === 4` (all 4 counted even though one had no files)

### Fixture C — truncation at `max_files`

**Mock**: 6 submissions, each with 1 attachment; `max_files: 3`, `attachments_only: true`.

**Assertions**:
1. `result.total_files === 3`
2. `result.truncated === true`
3. `result.truncation_note` matches `/Re-run with assignment_ids or student_ids/`
4. `result.total_submissions_scanned === 4`
   — Tracing the algorithm: subs 1–3 each push one file (files=[1,2,3]); on sub 4 the inner
   loop finds `files.length (3) >= maxFiles (3)` before pushing, sets `truncated = true` and
   breaks; the outer `if truncated: break` exits. So 4 submissions were scanned.

### Fixture D — FERPA pseudonymization

With `CANVAS_PSEUDONYMIZE_STUDENTS=true` (inject mock env into pseudonymizer):
- Pseudonymizer maps user_id 100 → `'Student 0'`, user_id 101 → `'Student 1'`

**Assertions** (using Fixture A data):
1. `result.files[0].user_name === 'Student 0'` (Alice → Student 0)
2. `result.files[0].user_id === 100` (numeric id unchanged)
3. `result.files[1].user_name === 'Student 1'` (Bob → Student 1)

### Fixture E — missing `user` on submission

**Mock**: one submission with `user: undefined` (Canvas omitted the field), `user_id: 200`,
`attachments: [{ id: 601, display_name: 'hw.pdf', ... }]`.

**Assertions**:
1. `result.files[0].user_id === 200`
2. `result.files[0].user_name === null`
3. `result.files[0]._warning === 'user data unavailable'`

### Fixture F — `assignment_ids` + `student_ids` filters passed through

**Assertions** (spy on `listForStudents`):
1. When `assignment_ids: [10, 20]` is passed → `listForStudents` called with
   `opts.assignment_ids = [10, 20]`
2. When `student_ids: [100]` is passed → `listForStudents` called with
   `opts.student_ids = [100]` (not `['all']`)
3. When neither is passed → `listForStudents` called with `opts.student_ids = ['all']`

### Fixture G — empty course (no submissions)

**Mock**: `listForStudents` returns `[]`.

**Assertions**:
1. `result.total_files === 0`
2. `result.files` is an empty array
3. `result.truncated === false`
4. `result.url_expiry_note` is present (always emitted)

### Fixture H — multiple attachments per submission

**Mock**: one submission with 3 attachments.

**Assertions**:
1. `result.total_files === 3`
2. All 3 entries share the same `user_id`, `user_name`, `assignment_id`
3. `original_filename` values are distinct per attachment

---

## Tool description (MCP tool.description)

```
List every file attachment submitted by students across all assignments in a course.
Returns a manifest — one entry per file — including the original filename, a file ID for
re-fetching via download_file, and content type and size. Useful for bulk-archiving student
work before a course expires or a Free-For-Teacher account is concluded.

Outputs are bounded by max_files (default 500). When the limit is hit, truncated is true
and truncation_note explains how to retrieve the rest using assignment_ids or student_ids filters.

Download URLs are time-limited (typically 1 hour). Use the returned file_id with download_file
to get a fresh URL at download time.

When CANVAS_PSEUDONYMIZE_STUDENTS is enabled, user_name is replaced with a stable per-course
pseudonym (e.g. "Student 0"). user_id (the raw numeric Canvas ID) is always returned and can
be used as a stable per-student folder key.

Filters: assignment_ids (subset of assignments), student_ids (subset of students),
workflow_state (e.g. "submitted", "graded").
```

---

## File changes summary

| File | Change |
|------|--------|
| `src/tools/submission-files.ts` | **New** — `submissionFileTools()` with `list_course_submission_files` ToolDefinition |
| `src/tools/catalog.ts` | Add `import { submissionFileTools } from './submission-files'` at top + append `submission_files` domain entry (`educator` audience) |
| `src/pseudonym/coverage.ts` | Add `'list_course_submission_files'` to `PSEUDONYMIZER_WRAPPED_TOOLS` |
| `tests/submission-files.test.ts` | **New** — fixtures A–H with mocked Canvas responses |

**4 files total. No new canvas module. No new package dependencies.**

`src/canvas/index.ts`, `src/canvas/submissions.ts`, and `src/tools/index.ts` require **no
changes**. `submissionFileTools` accepts `(canvas: CanvasClient, pseudonymizer?: Pseudonymizer)`
and composes `canvas.submissions.listForStudents()` directly from the existing `SubmissionsModule`.
The tool is registered via the catalog and wired automatically.

---

## Open questions for CTO review

None — all design unknowns are retired above. The spec is implementation-ready.
