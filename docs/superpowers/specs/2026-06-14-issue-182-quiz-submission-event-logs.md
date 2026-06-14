# Quiz Submission Event Logs — MCP Tool Design

**Date**: 2026-06-14
**Issue**: [bruchris/canvas-lms-mcp#182](https://github.com/bruchris/canvas-lms-mcp/issues/182)
**Status**: Design — awaiting CTO review

## Purpose

Add a `get_quiz_submission_events` tool that surfaces the event timeline for a Classic Quiz submission — giving an AI assistant the raw, ordered log of behavioral events (page blurs, question answers, session transitions) so the assistant can narrate them in plain language instead of leaving the instructor (or student) to decode the Canvas UI's event list unaided.

This is a read-only, instructor-or-student-token operation against an existing Canvas endpoint. No new behavioral recording or detection logic is introduced.

---

## Design unknowns (retired)

### 1. Classic Quizzes vs New Quizzes scope

**Decision: Classic Quizzes only in V1; document the New Quizzes gap.**

The Canvas REST API exposes quiz submission events exclusively for Classic Quizzes at:

```
GET /api/v1/courses/:course_id/quizzes/:quiz_id/submissions/:submission_id/events
```

New Quizzes does not expose an equivalent endpoint via the public Canvas REST API. New Quizzes session state and audit logs are surfaced through an LTI result store that requires an active LTI session, not a token-based REST call. There is no publicly documented REST equivalent for New Quizzes event logs as of this writing.

**V1 scope**: Classic Quizzes only. The tool's description will state "Classic Quizzes only; New Quizzes does not expose event logs via the Canvas REST API." The `get_quiz` tool response includes `quiz_type`; a model can use that to gate whether to call this tool. No error mapping changes are needed for the New Quizzes absence — a caller that passes a New Quizzes quiz ID will receive a Canvas 404, which the existing generic 404 handler already covers.

If Canvas later exposes New Quizzes event logs via a stable REST endpoint, a follow-up issue should extend this tool or add a separate `get_new_quiz_submission_events` with the correct path prefix (analogous to the new-quizzes domain split in the spec at `docs/superpowers/specs/2026-05-13-new-quizzes-tools.md`).

### 2. PII / FERPA: does the events payload need pseudonymizer wrapping?

**Decision: No pseudonymizer wrapping required for V1; rationale documented here.**

The Canvas `quiz_submission_events` envelope contains:

```json
{
  "quiz_submission_events": [
    {
      "event_type": "page_focused",
      "created_at": "2026-01-15T10:01:00Z",
      "event_data": []
    },
    {
      "event_type": "question_answered",
      "created_at": "2026-01-15T10:02:11Z",
      "event_data": [{ "quiz_question_id": "5678", "answer": "3" }]
    }
  ]
}
```

The event objects contain `event_type`, `created_at`, and `event_data` (a small domain-specific payload). They do NOT contain:

- A `CanvasUser` object or any of its PII fields (`name`, `email`, `login_id`, etc.)
- A `participants` array
- A `user_name` field

The pseudonymizer rule in `CLAUDE.md` and the FERPA spec (`docs/superpowers/specs/2026-05-25-ferpa-pseudonymization.md`) requires wrapping only when the response contains a `CanvasUser`, a `participants` array, or a `user_name` field. The events payload satisfies none of these triggers.

**Key reasoning**: The tool is scoped by `submission_id`, which the caller chose explicitly. The student's identity is known to the caller before the call; the events payload adds behavioral sequence, not identity revelation. This is the same disposition as the existing `get_quiz_submission_answers` tool (also not wrapped), which returns answer content scoped to a known submission. Canvas's own permission enforcement restricts this endpoint to users with view permissions on the submission (instructors, and the submitting student viewing their own attempt).

**FERPA note to document in the tool description**: "Events are scoped to a single quiz submission. Canvas enforces access permissions on this endpoint — only instructors and the submitting student can retrieve these events. Do not use event logs as the sole basis for academic-integrity conclusions; present them alongside context and invite the student to explain."

This note is informational only. It is NOT a pseudonymizer control. The tool description is the correct place for usage guidance; the pseudonymizer is the correct place for identity-field scrubbing. These are separate concerns.

If a future version of the Canvas API adds student identity fields (e.g., `user_name` embedded in the event envelope), wrapping will be required at that point. The CI coverage test (`tests/pseudonym/coverage.test.ts`) will catch this only if a type annotation includes such a field — implementation must ensure the `CanvasQuizSubmissionEvent` type accurately reflects the real Canvas response and does not silently include an embedded user.

### 3. Framing: neutral tool, not a cheating detector

**Decision: Neutral framing throughout; no "academic integrity" language in the tool itself.**

The tool name, description, and output shape use neutral terms: "event log," "events timeline," "page focus/blur." The tool description does NOT say "academic integrity check," "cheating detection," or "suspicious behavior." The plain-language narration is the responsibility of the calling AI model, not the tool.

The tool surfaces what Canvas records. Canvas's own documentation calls these events "audit data," not integrity evidence. Our tool description will acknowledge this explicitly (see the FERPA note above).

---

## Tool contract

### Tool name

`get_quiz_submission_events`

Rationale: follows the existing verb pattern (`get_quiz_submission_answers`, `list_quiz_submissions`). Grouped in the quizzes domain.

### Zod input schema

```ts
{
  course_id: z.number().describe('The Canvas course ID'),
  quiz_id: z.number().describe('The Canvas quiz ID (Classic Quizzes only)'),
  submission_id: z.number().describe('The quiz submission ID'),
  attempt: z.number().int().positive().optional()
    .describe('Submission attempt number (1-based). Omit for the most recent attempt.'),
}
```

`attempt` maps to the `?attempt=N` query parameter on the Canvas events endpoint. Canvas defaults to the latest attempt when the parameter is omitted.

### Canvas endpoint

```
GET /api/v1/courses/:course_id/quizzes/:quiz_id/submissions/:submission_id/events
```

Query parameters: `attempt` (optional integer).

Response envelope: `{ quiz_submission_events: CanvasQuizSubmissionEvent[] }`

The endpoint is NOT paginated — Canvas returns all events for the attempt in a single response. Use `client.request<CanvasQuizSubmissionEventsResponse>()` (not `paginate` or `paginateEnvelope`).

### Output shape

The tool returns the array extracted from the envelope:

```ts
CanvasQuizSubmissionEvent[]
```

Returning the array directly (not the envelope) is consistent with how `getSubmissionAnswers` strips the `quiz_submission_questions` envelope key.

### MCP annotations

```ts
annotations: {
  readOnlyHint: true,
  openWorldHint: true,
}
```

No `destructiveHint` — this is a pure read. No `idempotentHint` — the hint is only meaningful for write operations.

---

## Type additions

Add to `src/canvas/types.ts` under a new block after the existing `// --- Quizzes ---` types:

```ts
// --- Quiz Submission Events ---

export interface CanvasQuizSubmissionEvent {
  event_type: string
  created_at: string
  event_data: Array<Record<string, string>> | null
}

export interface CanvasQuizSubmissionEventsResponse {
  quiz_submission_events: CanvasQuizSubmissionEvent[]
}
```

**Type notes**:

- `event_type` covers the full Canvas event vocabulary: `session_started`, `question_answered`, `question_flagged`, `question_unflagged`, `page_blurred`, `page_focused`. It is typed as `string` (not a union) to handle future Canvas events without a type update.
- `event_data` is `Array<Record<string, string>> | null`. For most events the array is empty; for `question_answered` it contains `[{ quiz_question_id: "N", answer: "M" }]`. The `null` case covers events where Canvas omits the field rather than returning `[]` — the implementation must handle both.
- Do NOT add a `user_id` or user object to this type. If Canvas begins returning one, the implementation spec must be revisited for pseudonymizer wrapping at that time.

---

## Canvas client module changes

### Location

`src/canvas/quizzes.ts` — add a new method to the existing `QuizzesModule` class. No new module file is needed; the events endpoint is a sub-resource of quiz submissions, already in scope for this class.

### Method signature

```ts
async getSubmissionEvents(
  courseId: number,
  quizId: number,
  submissionId: number,
  attempt?: number,
): Promise<CanvasQuizSubmissionEvent[]>
```

### Implementation sketch

```ts
async getSubmissionEvents(
  courseId: number,
  quizId: number,
  submissionId: number,
  attempt?: number,
): Promise<CanvasQuizSubmissionEvent[]> {
  const params: Record<string, string> = {}
  if (attempt !== undefined) {
    params.attempt = String(attempt)
  }
  const response = await this.client.request<CanvasQuizSubmissionEventsResponse>(
    `/api/v1/courses/${courseId}/quizzes/${quizId}/submissions/${submissionId}/events`,
    { params },
  )
  return response.quiz_submission_events ?? []
}
```

**Why `?? []`**: Canvas may return `{ quiz_submission_events: null }` for a submission with no recorded events (e.g., a submission created via the API rather than the quiz player). Returning `[]` is safer than throwing.

**`client.request` params passing**: Verify the `CanvasHttpClient.request()` signature accepts a `params` field in the options argument (see `src/canvas/client.ts`). If not, use URLSearchParams and append to the path string. The implementation must match the actual client signature — this spec does not prescribe the mechanic, only the intent.

---

## Tool module changes

### Location

`src/tools/quizzes.ts` — add a new `ToolDefinition` to the array returned by `quizTools()`.

### Tool description (exact text)

```
Get the event log for a Classic Quiz submission in chronological order. Events include
session_started, question_answered, question_flagged, page_blurred, and page_focused.
Use this to understand the timeline of a student's attempt. Classic Quizzes only —
New Quizzes does not expose event logs via the Canvas REST API. Events are scoped to a
single submission; Canvas enforces access permissions (instructors and the submitting
student only). Do not use event logs as the sole basis for academic-integrity conclusions;
present them with context.
```

### Handler sketch

```ts
{
  name: 'get_quiz_submission_events',
  description: '...', // see above
  inputSchema: {
    course_id: z.number().describe('The Canvas course ID'),
    quiz_id: z.number().describe('The Canvas quiz ID (Classic Quizzes only)'),
    submission_id: z.number().describe('The quiz submission ID'),
    attempt: z.number().int().positive().optional()
      .describe('Attempt number (1-based). Omit for the most recent attempt.'),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  handler: async (params) => {
    const course_id = params.course_id as number
    const quiz_id = params.quiz_id as number
    const submission_id = params.submission_id as number
    const attempt = params.attempt as number | undefined
    return canvas.quizzes.getSubmissionEvents(course_id, quiz_id, submission_id, attempt)
  },
}
```

No pseudonymizer call in the handler — see design unknown §2.

---

## Test plan

### Canvas client tests — `tests/canvas/quizzes.test.ts`

Add to the existing test file (do not create a new file):

1. **Happy path — with events**: mock `client.request` to return
   ```json
   {
     "quiz_submission_events": [
       { "event_type": "session_started", "created_at": "2026-01-01T10:00:00Z", "event_data": [] },
       { "event_type": "question_answered", "created_at": "2026-01-01T10:01:00Z",
         "event_data": [{ "quiz_question_id": "9", "answer": "2" }] },
       { "event_type": "page_blurred", "created_at": "2026-01-01T10:05:00Z", "event_data": [] }
     ]
   }
   ```
   Assert: method returns all 3 events in order; endpoint called is
   `/api/v1/courses/1/quizzes/2/submissions/3/events` with no `attempt` param.

2. **With attempt param**: mock the same response; call with `attempt: 2`. Assert the request includes `attempt=2` in query params.

3. **Empty log case**: mock returns `{ "quiz_submission_events": [] }`. Assert method returns `[]`.

4. **Null envelope case**: mock returns `{ "quiz_submission_events": null }`. Assert method returns `[]` (the `?? []` guard).

5. **Error propagation**: mock `client.request` to throw `CanvasApiError` with status 403. Assert the error propagates (not caught at client layer).

### Tool tests — `tests/tools/quizzes.test.ts`

Add to the existing test file:

1. **Annotations**: assert `get_quiz_submission_events` has `readOnlyHint: true` and `openWorldHint: true`.

2. **Successful call**: mock `canvas.quizzes.getSubmissionEvents` to return a 2-event array. Call the tool with valid params. Assert the tool returns those 2 events.

3. **With attempt**: call the tool with `attempt: 1`. Assert `getSubmissionEvents` was called with `attempt = 1`.

4. **No attempt**: call without `attempt`. Assert `getSubmissionEvents` was called with `attempt = undefined`.

5. **Error mapping — 403**: mock `getSubmissionEvents` to throw `CanvasApiError({ status: 403 })`. Assert the tool returns the standard "You don't have permission" error text (existing `formatError` mapping).

6. **Error mapping — 404**: mock `getSubmissionEvents` to throw `CanvasApiError({ status: 404 })`. Assert the standard "not found" message.

7. **Empty log**: mock returns `[]`. Assert tool returns an empty array (not an error).

### Pseudonymizer coverage test

No addition to `PSEUDONYMIZER_WRAPPED_TOOLS` is required. The `tests/pseudonym/coverage.test.ts` test must continue to pass unchanged. The implementation must NOT add `get_quiz_submission_events` to `PSEUDONYMIZER_WRAPPED_TOOLS` — doing so incorrectly would imply the tool wraps its response, which it does not.

---

## Implementation breakdown — subtasks

Both subtasks are Developer-sized (Sonnet). The type addition and client method are small enough to combine with the tool addition in a single PR.

### Subtask A — Types + client method

- Add `CanvasQuizSubmissionEvent` and `CanvasQuizSubmissionEventsResponse` to `src/canvas/types.ts`.
- Add `getSubmissionEvents()` to `QuizzesModule` in `src/canvas/quizzes.ts`.
- Add client tests (cases 1–5 above) to `tests/canvas/quizzes.test.ts`.

### Subtask B — Tool definition + tests

- Add the `get_quiz_submission_events` tool to `src/tools/quizzes.ts`.
- Add tool tests (cases 1–7 above) to `tests/tools/quizzes.test.ts`.
- Confirm `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.
- Confirm `PSEUDONYMIZER_WRAPPED_TOOLS` is unchanged (coverage test passes).

Subtask B depends on Subtask A being merged (or combined into one PR).

---

## Open questions for CTO review

1. **`attempt` parameter default**: Canvas returns the latest attempt when `attempt` is omitted. Should we expose this as the default (current spec), or always require an explicit attempt number so callers are unambiguous about which attempt they're querying? Defaulting to "latest" is more ergonomic; requiring explicit is more precise for audit trails.

2. **Event vocabulary**: the known event types are `session_started`, `question_answered`, `question_flagged`, `question_unflagged`, `page_blurred`, `page_focused`. Canvas may emit additional types for proctored quizzes (e.g. camera events). The current spec types `event_type: string` (open). Confirm this is preferable to a narrower union that we'd have to maintain.

3. **Single PR vs two PRs**: the change touches ~5 source lines in `types.ts`, ~15 lines in `quizzes.ts`, ~10 lines in `src/tools/quizzes.ts`, and ~40 lines of tests. This fits comfortably in a single PR. Confirm one-PR approach is fine.

---

## Acceptance check

- [x] Design-first flag is present in the issue.
- [x] Design unknown §1 (Classic vs New Quizzes) retired: Classic only, gap documented.
- [x] Design unknown §2 (PII/FERPA) retired: no pseudonymizer wrap required; reasoning explicit.
- [x] Design unknown §3 (framing) retired: neutral language, guidance note in tool description.
- [x] Exact tool name, Zod schema, endpoint, output shape, and MCP annotations specified.
- [x] Type additions specified with rationale.
- [x] Test plan covers happy path, empty log, null envelope, attempt param, and error mapping.
- [x] No new package dependencies.
- [x] Pseudonymizer coverage test unaffected.
