---
issue: BRU-1966
---

# Student Assignment Submission — `submit_assignment` + `upload_submission_file` Design (with integrity gating)

**Date**: 2026-07-30
**Issue**: Paperclip BRU-1966 (origin: CTO Product Research BRU-1964)
**Status**: Design — awaiting CTO review. **No implementation until this spec is approved.**

---

## Purpose and competitive context

We have no student write path for the single most important student action in Canvas:
submitting an assignment. As of origin/main `b1b663f` (2026-07-30), the live manifest
(`docs/generated/tool-manifest.json`) records **155 tools: 112 read / 43 write**, audiences
**89 educator / 41 shared / 13 student / 12 admin** — and all 13 student-audience tools are
read-only. The 9 shared write tools (`post_discussion_entry`, `send_conversation`,
`upload_file`, `create_calendar_event`, …) already cover most other student write needs; the
genuine gap is assignment submission.

vishalsachdev/canvas-mcp shipped "Tier 1 student write tools with per-course faculty gate" on
2026-07-30 (their issue #170 → PR #185), driven by a student-filed feature request. Their
gating model presumes their deployment model (hosted/institutional); §Q2 evaluates why it does
not transfer to ours.

This spec answers the six design questions from BRU-1966 and, if approved, hands a mechanical
implementation checklist to a follow-up build task.

---

## Decision summary

| #   | Question                               | Decision                                                                                                                                                                                                                         |
| --- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Build or not                           | **Build**, default-off — §Q1                                                                                                                                                                                                     |
| 2   | Gating model                           | Registration-level opt-in: `CANVAS_ENABLE_ASSIGNMENT_SUBMISSION` env / `--enable-assignment-submission` CLI flag. vishalsachdev's per-course faculty allowlist rejected as non-transferable — §Q2                                |
| 3   | Submission types                       | `online_text_entry`, `online_url`, `online_upload` only; the other three types and all on-behalf-of params excluded — §Q3                                                                                                        |
| 4   | Upload interplay                       | New `upload_submission_file` tool + `FilesModule.uploadToSubmission()` reusing the existing step-2/3 upload machinery; documented two-step workflow — §Q4                                                                        |
| 5   | Audience / annotations / pseudonymizer | New gated catalog domain `assignment_submission` with `defaultPrimaryAudience: 'student'`; `destructiveHint: true` + `openWorldHint: true` on both tools; pseudonymizer **N/A** (own-data, `get_my_submissions` precedent) — §Q5 |
| 6   | Public RFC                             | **Yes** — time-boxed 7-day GitHub Discussion RFC opened at CTO spec approval; implementation may start during the window but merges only after it closes — §Q6                                                                   |

---

## Verified Canvas API facts (Instructure developer docs, fetched 2026-07-30)

`POST /api/v1/courses/:course_id/assignments/:assignment_id/submissions`
(<https://developerdocs.instructure.com/services/canvas/resources/submissions>) — stable, not
beta. Verified parameter facts this design depends on:

- `submission[submission_type]` (required): `online_text_entry` | `online_url` |
  `online_upload` | `media_recording` | `basic_lti_launch` | `student_annotation`.
- Type-paired payloads: `submission[body]` (text entry, "HTML document snippet" sanitized
  server-side like web-UI submissions), `submission[url]` (http/https only; also used by
  `basic_lti_launch`), `submission[file_ids][]` (upload, "previously uploaded files"),
  `submission[media_comment_id]`/`[media_comment_type]` (media),
  `submission[annotatable_attachment_id]` (annotation).
- `comment[text_comment]` — optional textual comment alongside the submission.
- **`submission[user_id]` and `submission[submitted_at]` require grading permission** —
  these are the submit-on-behalf-of and timestamp-backdating params. We exclude both by
  design (§Q3).
- Permissions: _"You must be actively enrolled as a student in the course/section to do
  this. Concluded and pending enrollments are not permitted."_ Canvas enforces this
  server-side; the submission is attributed to the token holder.
- Returns a `Submission` object on success.

Submission file upload (the `online_upload` prerequisite):
`POST /api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id/files` —
"the first step in uploading a file to a submission as a student", following the standard
Canvas file-upload workflow (the same 3-step flow `FilesModule.upload` already implements
for course files). We use `self` for `:user_id` per the Canvas-wide user-id path convention;
the docs page shows only the `:user_id` placeholder, so the implementation's error message
for a 404 on this endpoint should mention the numeric-id fallback (resolve via
`GET /api/v1/users/self`) in case a self-hosted instance mishandles `self` here.

---

## Q1 — Build or not: **build, default-off**

**Recommendation: build.** The academic-integrity concern is real but attaches to the wrong
step to justify "no":

1. **The tool automates transmission, not authoring.** The integrity-relevant act — having
   an AI write the work — happens before any submission and is entirely unaffected by
   whether this tool exists. A student with our MCP server already drafts with the
   assistant and pastes into Canvas; `submit_assignment` changes the last 10 seconds of
   that workflow, not the first 10 hours.
2. **Canvas holds the enforcement surface, and we don't weaken it.** Active student
   enrollment is required server-side; the submission is attributed to the token holder;
   plagiarism tooling (Turnitin etc.) runs on API submissions exactly as on web-UI
   submissions. We additionally exclude the two grading-permission params
   (`submission[user_id]`, `submission[submitted_at]`) so the tool cannot even express
   submit-on-behalf-of or backdating (§Q3).
3. **Refusing is incoherent with what we already ship.** `post_discussion_entry` posts to
   graded discussions and `send_conversation` messages instructors — both are
   student-reachable shared writes with the same "an agent acted in a course" character.
   Drawing the line at assignment submission specifically would be a symbolic refusal, not
   a risk reduction.
4. **Legitimate demand is concrete.** Assistive-technology users; submitting
   already-prepared work; verifying a submission actually went through (pairs with the
   existing `get_my_submissions` / `get_missing_submissions`); vishalsachdev's version was
   student-requested and shipped 2026-07-30.
5. **Building it lets us set the consent norm.** The feature will exist in the ecosystem
   either way (it already does, in the 168★ competitor). Our version can model what a
   consent-first, local-first design looks like: default-off, layered confirmation, no bulk
   operations, no on-behalf-of.

**Why default-off rather than always-on:** agentic submission removes the natural
review-before-submit checkpoint the web UI forces; a submission is **irreversible** (Canvas
has no unsubmit API) and consumes a limited attempt where `allowed_attempts` is set;
institutional AI policies differ, and an explicit opt-in shifts that judgment to the human
who is accountable for it. An always-registered write tool in every default install is an
attractive nuisance; a flag the user must set is documented intent.

---

## Q2 — Gating model

### Deployment reality first

We are local-first: the user runs the binary, holds their own token, and Canvas enforces
real permissions server-side. Any gate we ship is client-side and user-flippable. **The gate
is therefore consent/intent UX, not security** — the issue says this and the design embraces
it: the gate's job is to make agentic submission a deliberate, documented choice, not to
pretend to prevent a determined user from doing what their own token already permits.

### vishalsachdev's per-course faculty allowlist: evaluated and rejected

Their model — faculty opt in per course, students get write tools only in opted-in courses —
presumes an **institution-operated hosted server** where server-side configuration is
controlled by faculty and out of students' reach. That control plane does not exist in our
deployment model: the "server operator" _is_ the student. A per-course allowlist file on the
student's own machine would be config theater — it implies faculty control we cannot
deliver, and a reviewer reading our README would reasonably conclude we're claiming an
enforcement property we don't have. There is also no Canvas API surface a local server could
query for "faculty permits MCP submission in this course", so the allowlist could not even
be faculty-fed. If we ever ship a hosted/institutional mode, a server-side per-course gate
becomes meaningful and can be revisited; it is out of scope here.

### Chosen mechanism

- **`CANVAS_ENABLE_ASSIGNMENT_SUBMISSION`** env var, parsed with the same truthy-set
  semantics as `CANVAS_PSEUDONYMIZE_STUDENTS` (`true`/`1`/`yes`/`on`, case-insensitive,
  trimmed — `isEnvTruthy`, `src/pseudonym/pseudonymizer.ts:60-66`), plus a **valueless CLI
  flag `--enable-assignment-submission`** (either source enables; CLI cannot disable an
  env-var enable — same "env then CLI" additive precedence shape as the rest of `cli.ts`).
- **Registration-level, not runtime-level.** When off, the two tools are absent from
  `tools/list` entirely — no noise in every educator's and unopted student's tool surface,
  no attractive nuisance, and consistent with the codebase's established position that the
  tool surface is dynamic per config (role filtering, conditional `resolve_pseudonym`).
  Rejected alternative: always-register with a handler that errors when unconfigured —
  that's a worse UX (model sees a tool it can never successfully call) for zero consent
  value.
- **HTTP transport: process-level env only — deliberately NOT a per-request header.**
  `X-Canvas-Role` is per-request because role is a harmless UX filter where client control
  is fine (`src/http.ts:75-86`). This gate expresses _operator_ intent; a client-controlled
  header would let any connecting client self-enable, which defeats the gate's purpose in
  exactly the hosted scenarios where it matters most. A hosted operator who wants
  submission on sets the env var for the process.
- **Layered consent, in order:** (1) the explicit opt-in flag; (2) the MCP host's own
  approval prompt for destructive tools (`destructiveHint: true` — both tools); (3) tool
  description text that instructs the assistant to confirm the exact assignment and content
  with the user before calling (§Tool definitions); (4) fully explicit parameters — no
  defaults, no bulk submit, one assignment per call.
- **Considered and rejected: a required `confirm: true` input param.** The calling model
  fills tool arguments; a self-attesting boolean adds friction without adding consent — the
  human-facing checkpoint is the host's destructive-tool prompt, which we get via the
  annotation. (If a future MCP elicitation/confirmation primitive becomes broadly
  supported, that would be the right upgrade path.)

---

## Q3 — Scope: submission types and parameters

**In scope (v1):**

| Type                | Payload               | Notes                                                                                 |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------- |
| `online_text_entry` | `body` (HTML snippet) | Canvas sanitizes server-side like web-UI submissions                                  |
| `online_url`        | `url`                 | http/https enforced by Canvas; we also validate scheme client-side for a better error |
| `online_upload`     | `file_ids` (≥1)       | Requires prior `upload_submission_file` call(s) — §Q4                                 |

Plus optional `comment` → `comment[text_comment]` (benign, matches the web UI's
"Comments…" box on submission).

**Out of scope, with reasons:**

- `media_recording` — requires a `media_comment_id` from Canvas's media-services
  (Kaltura/Notorious) upload flow, which we do not wrap anywhere; out until that
  infrastructure exists.
- `basic_lti_launch` — submits an LTI launch URL for external-tool assignments; niche,
  hard to validate, no observed demand. Defer until asked for.
- `student_annotation` — requires `annotatable_attachment_id` and the annotation work
  itself happens interactively in Canvas's DocViewer; an agent cannot produce the artifact,
  so the tool call would be meaningless.
- **`submission[user_id]`, `submission[submitted_at]` — excluded by design, permanently.**
  These are the grading-permission on-behalf-of/backdating params. Excluding them is the
  one place this design hard-codes an integrity position: this tool submits _your own_ work
  _now_, full stop. (Instructor submit-on-behalf-of is a legitimate but separate feature;
  if ever built it belongs in an educator-audience tool with its own design review, not as
  params here.)
- `submission[group_comment]` — only meaningful with group assignments + comments; defer.

Resubmission: Canvas treats a second POST as a new attempt where allowed. We do not block
it, but the tool description warns that submissions are not retractable and may consume
limited attempts, and the response's `attempt` field makes what happened visible.

---

## Q4 — Upload interplay (`online_upload` two-step workflow)

**The existing `upload_file` tool is not a substitute.** It targets
`POST /api/v1/courses/:course_id/files` (`src/canvas/files.ts:56`) — the course-files
context, which student tokens generally cannot write to (`manage_files` is a
teacher/designer permission). Student submission uploads use the assignment-scoped endpoint
verified above, which is permitted precisely because it writes to the student's own
submission context.

### Canvas client change (`src/canvas/files.ts`)

`FilesModule.upload` is currently: step 1 (announce upload to
`/api/v1/courses/:id/files`) → step 2 (POST bytes to `upload_url`, no auth header, with
the self-hosted relative-URL fix from #259) → step 3 (confirm/redirect handling, JSON
parse, file-id validation). Steps 2–3 are context-independent. Refactor:

- Extract steps 2–3 into a private `completeUpload(uploadInfo: CanvasFileUploadInfo):
Promise<CanvasFile>` method (pure move — behavior, error messages, and the #259 URL
  resolution unchanged; the existing `upload` tests keep passing untouched, which is the
  proof the refactor is pure).
- `upload(...)` = existing step 1 + `completeUpload`.
- New `uploadToSubmission(courseId: number, assignmentId: number, name: string,
contentBase64: string, contentType: string): Promise<CanvasFile>` = same base64
  validation as `upload`, step 1 against
  `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/self/files`
  (no `parent_folder_path` — Canvas controls placement for submission uploads), then
  `completeUpload`.

### Documented workflow (in both tools' descriptions)

1. `upload_submission_file(course_id, assignment_id, name, content_base64, content_type)`
   once per file → each returns a `CanvasFile` with `id`.
2. `submit_assignment(course_id, assignment_id, submission_type: 'online_upload',
file_ids: [...])` with the collected ids.

Files uploaded to a submission context can only be attached to that assignment's
submission by the uploading user — a mismatched `file_ids` reference fails server-side
with a Canvas 400, which `formatError` surfaces.

---

## Q5 — Audience, annotations, pseudonymizer, and catalog mechanics

### New gated catalog domain

`src/tools/catalog.ts` gains one registration:

```ts
{
  domain: 'assignment_submission',
  defaultPrimaryAudience: 'student',
  gate: 'assignmentSubmission',
  getTools: assignmentSubmissionTools,
}
```

with a new optional field on `ToolDomainRegistration`:

```ts
/** Feature-flag key that must be enabled for this domain to register. Omitted = always on. */
gate?: keyof ToolFeatureFlags
```

and in `src/tools/types.ts`:

```ts
export interface ToolFeatureFlags {
  /** CANVAS_ENABLE_ASSIGNMENT_SUBMISSION / --enable-assignment-submission */
  assignmentSubmission?: boolean
}
```

### Plumbing (mirrors the `role` param end-to-end)

- `getAllTools(canvas, pseudonymizer?, role?, features?: ToolFeatureFlags)`
  (`src/tools/index.ts`): filter `toolDomainCatalog` to registrations whose `gate` is
  unset or enabled in `features`, _before_ the existing flatMap; `registerAllTools` gains
  and forwards the same param.
- `CanvasMCPServerConfig` (`src/server.ts`) gains `enableAssignmentSubmission?: boolean`,
  forwarded as `{ assignmentSubmission: config.enableAssignmentSubmission }`.
- `src/cli.ts`: parse `CANVAS_ENABLE_ASSIGNMENT_SUBMISSION` (env) and
  `--enable-assignment-submission` (valueless flag) into the config. The truthy-set
  helper is 4 lines; lift `isEnvTruthy` + `TRUTHY_ENV_VALUES` out of
  `src/pseudonym/pseudonymizer.ts` into a new `src/env.ts` exporting `isEnvTruthy`, and
  import it from both call sites (pseudonymizer behavior unchanged; its existing tests
  prove it).
- `src/stdio.ts` / `src/http.ts`: forward the config field to `createCanvasMCPServer`
  (`src/http.ts` reads it once at handler-creation from the default config — per-request
  override deliberately not offered, §Q2).

### Role-filter interplay (intended behavior, worth stating)

Audience `student` means `ROLE_VISIBILITY` (`src/tools/roles.ts`) hides these tools from
`teacher` and `admin` roles even when the gate is on — correct, since the tools act on the
caller's own enrollment and are useless to staff (and staff tokens fail the endpoint's
active-student-enrollment check anyway). With no role configured (default), gate-on
registers them for everyone, matching the existing "no role = full surface" behavior.

### Annotations

Both tools: `destructiveHint: true`, `openWorldHint: true` (no `readOnlyHint`, no
`idempotentHint` — resubmission creates a new attempt; re-upload creates a new file).
This satisfies `getAccess`'s exactly-one-of invariant in `src/discovery/manifests.ts` and
classifies both as `write` in the manifest.

### Pseudonymizer: N/A — confirmed

The response in both cases is the caller's **own** data (their submission / their uploaded
file), containing no third-party `CanvasUser`, `participants`, or `user_name` fields. We
do not request any `include` on the submit POST, so no `submission_comments` (the one
place grader/peer names could ride in) appear. Precedent: `get_my_submissions` returns the
same shape and is deliberately **not** in `PSEUDONYMIZER_WRAPPED_TOOLS`
(`src/pseudonym/coverage.ts`), while `get_my_submission_feedback` is wrapped only because
it explicitly pulls comment authors. **No change** to `src/pseudonym/coverage.ts` or
`tests/pseudonym/coverage.test.ts`.

### Manifest and the tool-count surfaces (known recurring drift bug — handled explicitly)

`buildToolManifest` (`src/discovery/manifests.ts`) iterates `toolDomainCatalog` directly,
not `getAllTools` — so the manifest **includes gated tools automatically** and needs no
generator change. This is the right outcome: the manifest is the documented tool surface,
and undocumented opt-in tools would be undiscoverable. The opt-in requirement is stated in
each tool's `description` (first sentence), so the manifest self-documents the gate
without a schema change (adding a `gate` field to `ToolManifestEntry` was considered and
deferred — additive schema churn for information the description already carries).

Count impact, all enforced by `tests/docs/tool-count-consistency.test.ts` (#268), which
derives every number from the regenerated manifest:

- `toolCount` 155 → **157**; split 112 read / 43 write → **112 read / 45 write**.
- Role-visibility counts: student 54 → **56**; teacher 130 and admin 142 unchanged.
- Surfaces that must be updated to match (the test fails on each until done): README.md
  (intro line, split sentence, role table incl. the `~157` unset row), `docs/index.html`
  (meta description, hero lede, ledger, feat #02 blurb), `package.json` `description`,
  `manifest.json` (MCPB bundle). Recommended README phrasing: **"157 tools (112 read /
  45 write; the 2 assignment-submission write tools are opt-in via
  `CANVAS_ENABLE_ASSIGNMENT_SUBMISSION`)"** — the parenthetical keeps the headline number
  honest about the default surface.
- Runtime default registration stays **155** (`tests/tools/registry.test.ts:397`
  unchanged); a new assertion covers 157 with the flag on.

README also gains a short "Student assignment submission (opt-in)" section: what the flag
enables, the two-step upload workflow, the irreversibility warning, and one sentence on why
it's off by default.

---

## Tool definitions

New module `src/tools/assignment-submission.ts`, exporting
`assignmentSubmissionTools(canvas: CanvasClient): ToolDefinition[]` (no pseudonymizer
param needed). Input schemas follow the house flat-`Record<string, z.ZodType>` shape;
cross-field rules are enforced in the handler (the schema record cannot express them) with
error strings that tell the model exactly what to fix.

### `submit_assignment`

```ts
{
  name: 'submit_assignment',
  description:
    'Submit the authenticated student\'s own work to an assignment. Opt-in tool: only ' +
    'available when the server was started with CANVAS_ENABLE_ASSIGNMENT_SUBMISSION. ' +
    'IMPORTANT: before calling, show the user exactly what will be submitted (assignment ' +
    'name, submission type, and full content/URL/file list) and get their explicit ' +
    'confirmation — submissions cannot be retracted and may consume a limited attempt. ' +
    'Submits as the token holder only; submitting on behalf of another user is not ' +
    'supported. For online_upload, first upload each file with upload_submission_file ' +
    'and pass the returned file ids.',
  inputSchema: {
    course_id: z.number().describe('The Canvas course ID'),
    assignment_id: z.number().describe('The Canvas assignment ID'),
    submission_type: z
      .enum(['online_text_entry', 'online_url', 'online_upload'])
      .describe('Must be one of the assignment\'s allowed submission_types'),
    body: z.string().optional()
      .describe('The submission text/HTML. Required iff submission_type is online_text_entry'),
    url: z.string().optional()
      .describe('The submission URL (http/https). Required iff submission_type is online_url'),
    file_ids: z.array(z.number()).optional()
      .describe('File IDs from prior upload_submission_file calls. Required (non-empty) iff submission_type is online_upload'),
    comment: z.string().optional()
      .describe('Optional text comment to attach alongside the submission'),
  },
  annotations: { destructiveHint: true, openWorldHint: true },
  handler: async (params) => { /* validate → canvas.submissions.submit(...) */ },
}
```

Handler validation (before any network call; each failure returns a plain `Error` whose
message the generic tool wrapper surfaces):

- `online_text_entry` → `body` must be a non-empty string; `url`/`file_ids` must be absent.
- `online_url` → `url` must parse as http/https; `body`/`file_ids` must be absent.
- `online_upload` → `file_ids` must be a non-empty array; `body`/`url` must be absent.
- Mismatch message pattern: `"submission_type 'online_url' requires 'url' and does not
accept 'body' or 'file_ids'"`.

### `upload_submission_file`

```ts
{
  name: 'upload_submission_file',
  description:
    'Upload a file to the authenticated student\'s own submission area for one assignment, ' +
    'as step 1 of an online_upload submission (step 2: pass the returned file id to ' +
    'submit_assignment). Opt-in tool: only available when the server was started with ' +
    'CANVAS_ENABLE_ASSIGNMENT_SUBMISSION. Content must be base64-encoded. This uploads ' +
    'only — nothing is submitted until submit_assignment is called.',
  inputSchema: {
    course_id: z.number().describe('The Canvas course ID'),
    assignment_id: z.number().describe('The Canvas assignment ID'),
    name: z.string().describe('The filename, including extension'),
    content_base64: z.string().describe('The file content, base64-encoded'),
    content_type: z.string().describe('The MIME type, e.g. application/pdf'),
  },
  annotations: { destructiveHint: true, openWorldHint: true },
  handler: async (params) => { /* canvas.files.uploadToSubmission(...) */ },
}
```

### Canvas client: `SubmissionsModule.submit` (`src/canvas/submissions.ts`)

```ts
export interface SubmitAssignmentParams {
  submission_type: 'online_text_entry' | 'online_url' | 'online_upload'
  body?: string
  url?: string
  file_ids?: ReadonlyArray<number>
  comment?: string
}

async submit(
  courseId: number,
  assignmentId: number,
  params: SubmitAssignmentParams,
): Promise<CanvasSubmission> {
  const submission: Record<string, unknown> = { submission_type: params.submission_type }
  if (params.body !== undefined) submission.body = params.body
  if (params.url !== undefined) submission.url = params.url
  if (params.file_ids !== undefined) submission.file_ids = params.file_ids
  const payload: Record<string, unknown> = { submission }
  if (params.comment !== undefined) payload.comment = { text_comment: params.comment }
  return this.client.request<CanvasSubmission>(
    `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions`,
    { method: 'POST', body: JSON.stringify(payload) },
  )
}
```

(JSON body with nested objects matches the existing write-method style, e.g. `grade` at
`src/canvas/submissions.ts:102-115`.)

Error mapping: no `formatError` changes — 401/403/404 already read correctly here (403 =
"not actively enrolled as a student" surfaces as the permission message; Canvas 400s for
wrong-type-for-assignment pass through with Canvas's own error body).

---

## Q6 — Public RFC: **yes, time-boxed, in parallel**

Open a GitHub Discussion RFC (the RFC #85 pattern) when the CTO approves this spec, **not**
before — the Discussion should present a settled design, and this spec is the artifact to
link.

- **Why yes:** academic integrity is the one area where an open-source education tool's
  legitimacy depends on visible deliberation. Educators are the majority of our tool
  surface (89 of 155 tools) and of our plausible institutional audience; giving them a
  documented place to object _before_ the feature merges is cheap insurance and turns the
  gating design into public documentation. It is also a competitive differentiator: the
  competitor shipped student writes without visible community consultation; deliberate
  process is consistent with the posture our FERPA/pseudonymization work established.
- **Why time-boxed:** an open-ended RFC is a stall. **7 days** from posting; proceed unless
  substantive objections arrive. Implementation may start as soon as the CTO approves this
  spec (the build task is independent of RFC feedback in the common case); the
  implementation PR **merges only after the window closes**, so feedback can still shape it
  cheaply.
- Content: link this spec; state the default-off gate, the excluded on-behalf-of params,
  and the three-type scope; ask two concrete questions ("does default-off + host
  confirmation match how your institution would want this to behave?", "is there a reason
  to exclude any of the three types?").

---

## Test plan (for the follow-up implementation task; mocked Canvas only, per CLAUDE.md)

**`tests/canvas/submissions.test.ts`** — `submit`:

1. `online_text_entry`: POSTs to the exact endpoint with `{ submission: { submission_type,
body } }` and no `comment` key when omitted.
2. `online_url` + `comment`: payload carries `submission.url` and `comment.text_comment`.
3. `online_upload`: payload carries `submission.file_ids` array.
4. Propagates `CanvasApiError` (403).

**`tests/canvas/files.test.ts`** — `uploadToSubmission`: 5. Step-1 POST hits `/api/v1/courses/1/assignments/20/submissions/self/files` with
`{ name, content_type, size }` and **no** `parent_folder_path`; steps 2–3 flow through
the shared `completeUpload` (assert via the same fetch-mock pattern as the existing
`upload` tests, including the relative-`upload_url` case from #259). 6. Invalid base64 rejects before any network call. 7. Existing `upload` tests pass unchanged (proof the extraction is pure).

**`tests/tools/assignment-submission.test.ts`** (new): 8. `assignmentSubmissionTools` returns exactly `['upload_submission_file',
   'submit_assignment']`, both `{ destructiveHint: true, openWorldHint: true }`. 9. Gate: `getAllTools(mock)` excludes both; `getAllTools(mock, undefined, undefined,
   { assignmentSubmission: true })` includes both with `audience: 'student'`. 10. Role interplay: gate on + role `teacher` → excluded; gate on + role `student` →
included; gate off + role `student` → excluded. 11. Handler validation: the 5 mismatch cases (missing `body`, missing `url`, non-http(s)
`url`, empty/missing `file_ids`, cross-type extras present) reject without calling the
canvas mock. 12. Happy paths: three types call `canvas.submissions.submit` with exactly the right
params; `comment` passes through; `upload_submission_file` calls
`canvas.files.uploadToSubmission` and returns its result. 13. `CanvasApiError` propagation for both tools.

**Existing suites:** 14. `tests/tools/registry.test.ts` — `:397` stays 155 (default); add a
157-with-`features` assertion. 15. `tests/tools/audience-coverage.test.ts` — pass all-gates-on `features` to its
`getAllTools` call so gated tools are audience-checked (one-line change; otherwise the
new tools silently escape the coverage gate). 16. `tests/tools/role-filter.test.ts` — computes counts relatively; verify it passes with
no edits (its `getAllTools` calls default to gate-off, so counts are unchanged). 17. `tests/discovery/manifests.test.ts` — regenerate via `pnpm generate:manifests`; bump
the separately hard-coded `toHaveLength(155)` → 157. 18. `tests/docs/tool-count-consistency.test.ts` — no edits; it fails until README,
`docs/index.html`, `package.json`, and `manifest.json` are updated per §Q5. 19. `tests/pseudonym/coverage.test.ts` — no edits (§Q5 pseudonymizer N/A). 20. CLI: `tests/cli.test.ts` (or the existing cli test file) — env var truthy/absent, flag
present/absent, and env+flag combos set `enableAssignmentSubmission` correctly.

---

## Implementation checklist (for the follow-up build task — do NOT start before CTO approval)

1. `src/env.ts` (new) — `isEnvTruthy` + `TRUTHY_ENV_VALUES` lifted from
   `src/pseudonym/pseudonymizer.ts`; pseudonymizer imports it.
2. `src/canvas/files.ts` — extract `completeUpload`; add `uploadToSubmission`.
3. `src/canvas/submissions.ts` — `SubmitAssignmentParams` + `submit`.
4. `src/tools/types.ts` — `ToolFeatureFlags`.
5. `src/tools/assignment-submission.ts` (new) — both tool definitions per §Tool
   definitions.
6. `src/tools/catalog.ts` — `gate?: keyof ToolFeatureFlags` on `ToolDomainRegistration`;
   register the `assignment_submission` domain with `defaultPrimaryAudience: 'student'`,
   `gate: 'assignmentSubmission'`.
7. `src/tools/index.ts` — `features` param on `getAllTools`/`registerAllTools`; gate
   filter before the flatMap.
8. `src/server.ts` — `enableAssignmentSubmission?: boolean` on config, forwarded.
9. `src/cli.ts` — env + valueless flag parsing.
10. `src/stdio.ts`, `src/http.ts` — forward the config field.
11. Tests 1–20 above (new files: `tests/tools/assignment-submission.test.ts`).
12. `pnpm generate:manifests`; commit the regenerated
    `docs/generated/tool-manifest.json` (never hand-edit).
13. Doc/count surfaces: README.md (intro, split, role table, new opt-in section),
    `docs/index.html`, `package.json` description, `manifest.json` (MCPB) — until
    `tests/docs/tool-count-consistency.test.ts` is green.
14. Full validation: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
15. After CTO approves this spec: open the RFC Discussion (§Q6) the same day the build
    task starts; implementation PR merges only after the 7-day window closes.

---

## Acceptance check (BRU-1966's six questions)

- [x] **Q1 Build or not** — explicit recommendation: build, default-off, with the
      integrity reasoning stated in both directions (§Q1).
- [x] **Q2 Gating model** — default-off registration-level env/CLI opt-in;
      vishalsachdev's per-course faculty allowlist independently evaluated against our
      deployment model and rejected with reasons, not copied (§Q2).
- [x] **Q3 Scope** — the issue's suggested three types adopted; each exclusion justified;
      on-behalf-of/backdating params permanently excluded as a design position (§Q3).
- [x] **Q4 Upload interplay** — two-step workflow specced against the existing files
      domain machinery; `upload_file` explicitly shown to be a non-substitute; endpoint
      verified (§Q4).
- [x] **Q5 Audience/annotations/pseudonymizer** — `student` audience via new gated
      domain; `destructiveHint`/`openWorldHint`; pseudonymizer confirmed N/A with in-repo
      precedent; manifest/count surfaces enumerated against the live 155 = 112/43 baseline,
      landing at 157 = 112/45 (§Q5).
- [x] **Q6 RFC** — yes, time-boxed 7 days, opened at spec approval, merge-gating only
      (§Q6).
- [x] Tool-count references in this spec match the live manifest at origin/main
      `b1b663f` (155 = 112 read / 43 write) — the known stale-count bug class checked
      explicitly.
