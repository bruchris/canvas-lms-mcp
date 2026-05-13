# Canvas New Quizzes — MCP Tool Design

**Date**: 2026-05-13
**Issue**: [bruchris/canvas-lms-mcp#124](https://github.com/bruchris/canvas-lms-mcp/issues/124)
**Paperclip**: BRU-1044
**Status**: Design — awaiting CTO review

## Purpose

Add MCP tools for Canvas **New Quizzes** (the strategic successor to Classic Quizzes), enabling AI agents to create and update quizzes and quiz items via the dedicated `/api/quiz/v1/...` API surface. This unblocks Fjordbyte Canvas Integration's AI-generated quiz feature, which currently calls the Canvas API directly and wants to migrate to MCP for consistency once these tools land.

This spec covers **design only**. Implementation is broken into Developer-sized subtasks at the end.

## Scope

### In-scope (V1)

Eight tools across one new domain module:

| Tool | Verb | Endpoint |
|---|---|---|
| `create_new_quiz` | POST | `/api/quiz/v1/courses/:course_id/quizzes` |
| `update_new_quiz` | PATCH | `/api/quiz/v1/courses/:course_id/quizzes/:assignment_id` |
| `delete_new_quiz` | DELETE | `/api/quiz/v1/courses/:course_id/quizzes/:assignment_id` |
| `list_new_quiz_items` | GET | `/api/quiz/v1/courses/:course_id/quizzes/:assignment_id/items` |
| `get_new_quiz_item` | GET | `/api/quiz/v1/courses/:course_id/quizzes/:assignment_id/items/:item_id` |
| `create_new_quiz_item` | POST | `/api/quiz/v1/courses/:course_id/quizzes/:assignment_id/items` |
| `update_new_quiz_item` | PATCH | `/api/quiz/v1/courses/:course_id/quizzes/:assignment_id/items/:item_id` |
| `delete_new_quiz_item` | DELETE | `/api/quiz/v1/courses/:course_id/quizzes/:assignment_id/items/:item_id` |

(8 tools total — the table above breaks them out so the read/write split is visible.)

Supported item types in V1: `multiple-choice`, `true-false`, `essay`, `matching`, `numeric`. Canvas's New Quizzes interaction-type identifiers map as follows:

| Friendly name | New Quizzes `interaction_type_slug` |
|---|---|
| Multiple choice | `choice` |
| True/false | `true-false` |
| Essay | `essay` |
| Short answer (free response) | `essay` (short variant via UI; same interaction type) |
| Matching | `matching` |
| Numeric | `numeric` |

> Canvas exposes essay and short-answer through the same `essay` interaction type — the difference is presentation hints, not API shape. We surface both via the same `essay` slug and let the caller's `interaction_data` decide.

### Deferred to follow-up

- **Item types**: `hot-spot`, `categorization`, `file-upload`, `formula`, `ordering`, `matching` with rich media, `stimulus` (passage) items. These need richer schema design and likely deserve their own subtasks; not blocking Fjordbyte's V1.
- **Item banks** (`/api/quiz/v1/courses/:course_id/item_banks`): out of scope per board direction. Filed as a follow-up if Fjordbyte hits the rate-limit ceiling on bulk item creation.
- **New Quizzes submissions and grading** (`/sessions`, `/results`): out of scope; Classic-quiz scoring already exists and Fjordbyte hasn't asked for New Quizzes submission flow.
- **LTI launch flows**: out of scope. Fjordbyte handles auth separately.
- **Quiz duplication** (`POST .../quizzes/:id/duplicate`): out of scope; agents can re-create via `create_new_quiz` if needed.

## 1. Architectural fit

### Module location

- Canvas client module: `src/canvas/new-quizzes.ts`, alongside `src/canvas/quizzes.ts` (Classic).
- Tool module: `src/tools/new-quizzes.ts`, alongside `src/tools/quizzes.ts`.
- Types: extend `src/canvas/types.ts` with a `// --- New Quizzes ---` section (mirrors the existing `// --- Files ---` style).
- Tests: `tests/canvas/new-quizzes.test.ts` and `tests/tools/new-quizzes.test.ts`.

### Naming

Keep the `new_quiz` / `new_quiz_item` naming in tool names. Don't shorten to `quiz` — Classic quiz tools own that namespace and collisions would confuse LLM callers. Tool descriptions explicitly say "New Quizzes (LTI)" so agents pick the right family.

### Facade integration

Add a `newQuizzes: NewQuizzesModule` field to `CanvasClient` in `src/canvas/index.ts`, following the existing pattern (one-liner construction + assignment in the constructor). Use camelCase to match `peerReviews`, `gradebookHistory`.

### HTTP path prefix

The Canvas HTTP client takes `baseUrl` like `https://school.instructure.com` (no `/api/v1`) and modules pass the full endpoint path starting with `/api/v1/...`. New Quizzes endpoints start with `/api/quiz/v1/...` and slot in transparently — no changes to `CanvasHttpClient`. Verified against `src/canvas/client.ts:49-93`.

### Pagination

New Quizzes API uses standard Canvas `Link: rel="next"` pagination. `list_new_quiz_items` uses `client.paginate<T>()` (the plain-array variant, not the envelope variant) — New Quizzes responses are bare JSON arrays, unlike Classic submissions which wrap in `{quiz_submissions: [...]}`.

## 2. Tool-by-tool Zod input schemas

All schemas use `z.number()` for IDs (consistent with existing tools). The `item_body` shape is the leading design question; see § 2.6.

### 2.1 `create_new_quiz`

```ts
{
  course_id: z.number().describe('The Canvas course ID'),
  title: z.string().describe('Title of the quiz'),
  instructions: z.string().optional().describe('HTML instructions shown before the quiz starts'),
  points_possible: z.number().optional().describe('Total points; defaults to sum of item points'),
  due_at: z.string().datetime().optional().describe('ISO-8601 due date'),
  unlock_at: z.string().datetime().optional().describe('ISO-8601 unlock time'),
  lock_at: z.string().datetime().optional().describe('ISO-8601 lock time'),
  shuffle_answers: z.boolean().optional(),
  one_at_a_time_type: z.enum(['question', 'none']).optional()
    .describe('Show one question at a time (none = show all)'),
  allowed_attempts: z.number().int().optional().describe('-1 for unlimited'),
  grading_type: z.enum(['points', 'percent', 'pass_fail', 'letter_grade']).optional(),
  assignment_group_id: z.number().optional(),
}
```

Returns the created New Quiz (assignment-shaped; Canvas exposes New Quizzes through Assignments + a quiz-specific record).

### 2.2 `update_new_quiz`

Same as `create_new_quiz` but `course_id` and `assignment_id` are required, every other field is optional (PATCH semantics). No partial-validation gymnastics needed — Zod's `.optional()` does the right thing.

### 2.3 `delete_new_quiz`

```ts
{ course_id: z.number(), assignment_id: z.number() }
```

Returns `{ success: true }` on 204.

### 2.4 `list_new_quiz_items`

```ts
{ course_id: z.number(), assignment_id: z.number() }
```

Returns `CanvasNewQuizItem[]`.

### 2.5 `get_new_quiz_item`

```ts
{ course_id: z.number(), assignment_id: z.number(), item_id: z.number() }
```

### 2.6 `create_new_quiz_item`

This is the rich one. New Quizzes items have a `entry` (the item body) and a `entry_type` (always `"Item"` in V1; stimuli/passages deferred). The `entry` contains `interaction_type_slug` and `interaction_data` whose shape depends on the type.

Top-level schema:

```ts
{
  course_id: z.number(),
  assignment_id: z.number(),
  position: z.number().int().optional().describe('1-based position; appended if omitted'),
  points_possible: z.number().describe('Points awarded for a fully correct answer'),
  item: z.discriminatedUnion('interaction_type_slug', [
    multipleChoiceSchema,
    trueFalseSchema,
    essaySchema,
    matchingSchema,
    numericSchema,
  ]),
}
```

Per-type schemas (these are the user-facing simplification — we transform to Canvas's wire format inside the client module):

```ts
const multipleChoiceSchema = z.object({
  interaction_type_slug: z.literal('choice'),
  title: z.string().optional(),
  item_body: z.string().describe('HTML question stem'),
  choices: z.array(z.object({
    id: z.string().describe('Stable choice identifier (caller-generated, e.g. "a")'),
    item_body: z.string().describe('HTML choice text'),
  })).min(2),
  correct_choice_id: z.string().describe('id of the correct choice'),
  scoring_algorithm: z.enum(['Equivalence', 'PartialDeep']).default('Equivalence'),
})

const trueFalseSchema = z.object({
  interaction_type_slug: z.literal('true-false'),
  item_body: z.string(),
  correct_answer: z.boolean(),
})

const essaySchema = z.object({
  interaction_type_slug: z.literal('essay'),
  item_body: z.string(),
  rich_text: z.boolean().default(true).describe('Allow rich text editor'),
  word_count_min: z.number().int().optional(),
  word_count_max: z.number().int().optional(),
})

const matchingSchema = z.object({
  interaction_type_slug: z.literal('matching'),
  item_body: z.string(),
  matches: z.array(z.object({
    question: z.string(),
    answer: z.string(),
  })).min(2),
  distractors: z.array(z.string()).optional().describe('Wrong-answer distractor pool'),
})

const numericSchema = z.object({
  interaction_type_slug: z.literal('numeric'),
  item_body: z.string(),
  answers: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('exact'), value: z.number(), margin: z.number().default(0) }),
    z.object({ kind: z.literal('range'), min: z.number(), max: z.number() }),
    z.object({ kind: z.literal('precision'), value: z.number(), precision: z.number().int() }),
  ])).min(1),
})
```

**Why a friendly schema, not Canvas's wire format?** New Quizzes' raw payloads are deeply nested and field-named like `properties.shuffle_rules.choices.to_lock`. Zod-validating that surface forces LLM callers to reproduce Canvas's internal model. The client module owns the translation:

```ts
// in src/canvas/new-quizzes.ts
private toWireItem(input: ZodCreateItem): CanvasNewQuizWireItem {
  switch (input.item.interaction_type_slug) {
    case 'choice': return this.choiceToWire(input)
    // ...
  }
}
```

This keeps `inputSchema` legible to LLMs while still producing a valid Canvas request. The translation layer is the testable seam.

### 2.7 `update_new_quiz_item`

Same `item` discriminated union as `create_new_quiz_item`, but `item` itself becomes `.optional()` (PATCH may only update `position` or `points_possible`).

### 2.8 `delete_new_quiz_item`

```ts
{ course_id: z.number(), assignment_id: z.number(), item_id: z.number() }
```

## 3. Error handling

### New Quizzes LTI not enabled

When the LTI tool isn't enabled on the instance, the Canvas API returns **HTTP 401 or 404** with a body shaped like:

```json
{ "errors": [{ "message": "Tool not configured" }] }
```

The existing `CanvasApiError` already captures `.status`, `.endpoint`, `.message`. We add tool-layer awareness in `src/tools/index.ts`'s `formatError()`:

```ts
// existing logic
if (error.status === 404 && error.endpoint.startsWith('/api/quiz/v1/')) {
  return {
    isError: true,
    content: [{
      type: 'text',
      text: 'New Quizzes is not enabled on this Canvas instance. Ask a Canvas admin to enable the "New Quizzes" LTI tool, or use the Classic quiz tools (list_quizzes / get_quiz) instead.',
    }],
  }
}
```

A 401 on a New Quizzes endpoint is ambiguous (could be token issue OR LTI not configured). Keep the existing "token is invalid or expired" message for 401 — but extend it to suggest the LTI check as a secondary cause: "Canvas token is invalid or expired (if the token works for other tools, the New Quizzes LTI may not be enabled on this instance)."

### Item validation errors

Canvas returns **400 Bad Request** with a body listing field paths (`properties.choices.0.id` etc.). Pass through `body.message` / `body.errors[0].message` unchanged — Canvas's error text is more specific than anything we'd synthesize. Our client already does this; no change needed.

### Rate limits

Canvas New Quizzes is more aggressive about throttling than v1 (item creation in tight loops can return **403** with `Rate Limit Exceeded`). Map this in `formatError()` to a clear message recommending sequential calls with backoff. The MCP server itself does **not** add a retry layer in V1 — see § 6.

## 4. MCP annotations

| Tool | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
|---|---|---|---|---|
| `list_new_quiz_items` | true | — | — | true |
| `get_new_quiz_item` | true | — | — | true |
| `create_new_quiz` | — | true | — | true |
| `update_new_quiz` | — | true | true | true |
| `delete_new_quiz` | — | true | true | true |
| `create_new_quiz_item` | — | true | — | true |
| `update_new_quiz_item` | — | true | true | true |
| `delete_new_quiz_item` | — | true | true | true |

Rationale for `idempotentHint`:

- `update_*` is idempotent in the HTTP sense (PATCH the same payload twice yields the same end-state).
- `delete_*` is idempotent (delete a missing item → 404, which is the same end-state as a successful delete).
- `create_*` is **not** idempotent — repeating creates duplicate items, since New Quizzes doesn't expose a caller-supplied uniqueness key. The Classic `score_quiz_question` tool sets `idempotentHint: true`; we follow that precedent only for PATCH/DELETE.

## 5. Per-request auth

The existing per-request auth flow in `src/http.ts:60-76` accepts `X-Canvas-Token` per request, with `baseUrl` locked to server config (SSRF protection). Issue #124 mentioned `X-Canvas-Base-URL` as a per-request header — that is **not** currently supported and shouldn't be added as part of this task (out of scope; the SSRF lockdown is intentional).

**Confirmed**: New Quizzes works with the same Canvas API token. No new auth code required. The same `createCanvasMCPServer({ token, baseUrl })` factory wires up the new tools. The new domain module receives the same `CanvasHttpClient` instance the existing modules use, so per-request token rotation in the HTTP transport "just works".

## 6. Rate-limit guidance

**Decision**: V1 = document, don't automate. No batch helpers, no retry layer.

Reasoning:

1. Canvas's rate limits are bursty (token bucket per user, refills quickly). Sequential calls from an LLM agent are already paced by inference latency — in practice this is unlikely to saturate.
2. Adding a retry/backoff layer in the MCP server makes failure modes opaque to the calling agent. An LLM that gets a clean "rate limited, wait and retry" error can decide whether to back off, switch to item-bank import, or surface to the user. A silent retry hides that decision.
3. A batch-create helper tool (`bulk_create_new_quiz_items`) would need to define partial-failure semantics (atomic rollback? best-effort with error list?) that we don't yet have product clarity on.

**What we ship in V1**:

- Tool description for `create_new_quiz_item` includes: "Canvas may rate-limit rapid sequential creates. Call these tools serially (not in parallel). If you need to create more than ~50 items, consider chunking and pausing between batches."
- `formatError()` maps 403 with `Rate Limit Exceeded` to a clear text message that includes "retry after a few seconds".
- README "Best practices" section gets a "Bulk operations" bullet pointing to this guidance.

If Fjordbyte (or other consumers) hits ceilings in production we can revisit with concrete data — file as a follow-up issue. Item banks + `import` endpoints are the right primitive for true bulk authoring, and they're already deferred.

## 7. Test strategy

Mirror `tests/canvas/quizzes.test.ts` and `tests/tools/quizzes.test.ts` exactly. Use `vi.spyOn(client, 'request' | 'paginate')` with mocked responses; no real Canvas calls.

### Client tests (`tests/canvas/new-quizzes.test.ts`)

- **GET shapes**: `list` (paginate `/api/quiz/v1/courses/:c/quizzes/:a/items`), `get` (single request to `.../items/:i`).
- **Path correctness**: every test asserts the exact endpoint string passed to `client.request` / `client.paginate`, including `/api/quiz/v1/` prefix.
- **POST/PATCH body translation**: for each of the 5 V1 item types, a test that calls `createItem({ item: { interaction_type_slug: 'choice', ... } })` and asserts the wire-format JSON body matches Canvas's expected shape (snapshot test or explicit `toMatchObject`).
- **DELETE returns void**: existing `request<T>` returns `undefined` on 204; assert no throw and `success: true` from the tool layer.

### Tool tests (`tests/tools/new-quizzes.test.ts`)

- **Annotation presence**: assert each tool's `annotations` object has the expected hints (catches regressions on `destructiveHint`).
- **Zod validation**: missing required fields → tool returns validation error, no Canvas call made.
- **Error mapping**: when client throws `CanvasApiError` with `.status: 404` and `.endpoint: '/api/quiz/v1/...'`, the tool returns the "New Quizzes not enabled" message (not the generic "not found" message).
- **Per-type round-trip**: for each of 5 item types, build the input → translate → assert wire body. Same coverage as client tests but at the tool boundary.

### What we don't test in V1

- Real rate-limit handling (no retry layer to test).
- Item types beyond the V1 set (no code to test).
- Submission/grading flow (out of scope).

## 8. Type additions

New types in `src/canvas/types.ts` under a `// --- New Quizzes ---` block:

```ts
export interface CanvasNewQuiz {
  id: number
  title: string
  instructions: string | null
  points_possible: number
  due_at: string | null
  unlock_at: string | null
  lock_at: string | null
  published: boolean
  // Canvas returns the assignment_id (since New Quizzes are assignment-backed)
  assignment_id: number
}

export interface CanvasNewQuizItem {
  id: string
  position: number
  points_possible: number
  entry_type: 'Item' | 'Stimulus'
  entry: {
    interaction_type_slug: string
    item_body: string
    // Canvas wire-format payload — opaque to most callers; only useful for
    // round-tripping or admin/debug. The tool layer translates to/from a
    // friendlier shape for the discriminated-union input.
    interaction_data: Record<string, unknown>
    properties: Record<string, unknown>
    scoring_data?: Record<string, unknown>
    scoring_algorithm?: string
    feedback?: Record<string, unknown>
  }
}
```

Keep these intentionally narrow — Canvas's full New Quizzes schema has 30+ optional fields per item. We expose what V1 callers actually use; expand as follow-ups land.

## 9. Implementation breakdown — subtasks

All subtasks route to **Developer (Sonnet)** per the architecture being well-defined in this spec. Lead Developer is only needed if a subtask uncovers an ambiguity that needs reasoning, in which case it bounces back as a comment.

### Subtask A — Client module (`src/canvas/new-quizzes.ts`)

- Add types to `src/canvas/types.ts` (`CanvasNewQuiz`, `CanvasNewQuizItem`).
- Implement `NewQuizzesModule` with methods: `create`, `update`, `delete`, `listItems`, `getItem`, `createItem`, `updateItem`, `deleteItem`.
- Implement private translators: `toWireItem(input)` returning `interaction_data` / `properties` / `scoring_data` per Canvas's spec for each of the 5 V1 types.
- Wire into `CanvasClient` facade (`src/canvas/index.ts`): import, field, constructor assignment.
- Tests in `tests/canvas/new-quizzes.test.ts` covering all methods + all 5 type translations.

**Estimated**: 1 PR, ~400 LoC including tests. Developer-sized.

### Subtask B — Tool module (`src/tools/new-quizzes.ts`)

- Define discriminated-union schemas for the 5 item types.
- Implement all 8 tool definitions with correct annotations.
- Register in `src/tools/index.ts` via `getAllTools(canvas)`.
- Extend `formatError()` in `src/tools/index.ts` to handle the New Quizzes LTI-not-enabled case (404 on `/api/quiz/v1/`).
- Tests in `tests/tools/new-quizzes.test.ts`.

**Estimated**: 1 PR, ~500 LoC including tests. Depends on Subtask A's facade wiring. Developer-sized.

### Subtask C — Documentation

- README: add 8 tools to the inventory table, bump headline count.
- README: "Best practices → Bulk operations" subsection covering rate-limit guidance.
- Update spec link in README if a top-level index exists.

**Estimated**: small PR. Developer-sized.

### Subtask D — Tool count reconciliation (optional, fold into C if drift policy already exists)

The 2026-05-08 weekly tech-debt scan flagged recurring tool-count drift across registry/README/package.json/spec. If 8 new tools land, the next drift round is predictable. Subtask C above handles README + package.json. The original 2026-04-12 spec headline isn't updated (it documents the V1 baseline, not the current state). No action needed unless CTO wants a "source of truth" refactor — file separately if so.

## 10. Open questions for CTO review

1. **Item-type V1 set**: spec lists MCQ / T-F / essay / matching / numeric. Issue #124 also mentions "short answer" — confirmed as the same `essay` interaction_type per § 1. Confirm matching is in scope (it's the most complex of the 5; safe to drop and defer if the goal is to minimize V1 surface).
2. **`scoring_algorithm` exposure**: I'm defaulting MCQ to `Equivalence` (exact match) and exposing `PartialDeep` as an option. Most LLM-generated quizzes won't need partial credit; consider whether to expose at all in V1 or default-and-hide.
3. **`bulk_create_new_quiz_items` deferral**: confirmed deferred per § 6, but Fjordbyte's RAG-generated quizzes may regularly create 20-50 items. Want to greenlight a follow-up issue now or wait for evidence of rate-limit pain?
4. **Spec naming**: the 2026-04-12 root design spec doesn't list New Quizzes as an in-scope domain. Should this spec be linked from the root design (via "Subsequent specs" or similar), or treated as a freestanding addendum?

## 11. Acceptance for this design task

- [x] Design doc committed on a feature branch
- [ ] Reassigned to CTO `in_review`
- [ ] CTO approves design (or requests changes)
- [ ] On approval, Lead Developer files implementation subtasks A/B/C routed to Developer
