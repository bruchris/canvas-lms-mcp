# Preserving 64-bit Canvas identifiers without JavaScript precision loss

- **Date:** 2026-10-05
- **Issue:** BRU-2730 (parent BRU-2726, CTO Product Research 2026-10-05)
- **Status:** Proposed — design only. No source change is made by this document.
- **Base:** `origin/main` @ `5740739` (canvas-lms-mcp 1.31.1), `zod` 4.6.5, `@modelcontextprotocol/sdk` 1.30.0, Node 22
- **Canvas sources pinned at:** `instructure/canvas-lms` @ `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`, `instructure/switchman` @ `bceec0a0b2d2932597250b88fdc9253e70fcd8b0`
- **Evidence tags:** `[D]` official docs · `[S]` read from pinned source · `[P]` executed in a probe · `[W]` observed on our own MCP wire

## 0. Recommendation

**Split this into two independent migrations, ship the input side first, and do not send `Accept: application/json+canvas-string-ids` until the response side is normalized. The header is not a drop-in: with it on and nothing else changed, `explain_grade` reports a different course grade — 47.5% becomes 92.5% on identical Canvas data, with no error raised `[P]` (§2.3).**

1. **The input defect is live, silent and cheap to fix (Phase 1).** `get_course({course_id: 9007199254740993})` succeeds today and fetches `/api/v1/courses/9007199254740992` — a different object, no warning `[W]`. 196 ID parameters are declared `z.number()`, which accepts any finite number. Fix: one canonical input type that rejects unsafe numbers and accepts canonical decimal strings. Purely additive for every call that works today.
2. **20 ID parameters are already safe and the brief does not say so.** Zod 4's `.int()` enforces the safe-integer range: `z.number().int()` rejects `9007199254740992` with `too_big` `[P]` (§1, correction 2). Those 20 fail *loudly* today. The defect is confined to the 196 that omit `.int()`.
3. **The response defect cannot be fixed by types.** `JSON.parse` destroys the value before any TypeScript or Zod sees it `[P]`. The Accept header is the *only* fix, and sending it is a behaviour change, not a typing change.
4. **Canvas's own stringifier has misses, so we need our own normalization pass regardless (Phase 2).** `StringifyIds` matches only keys ending `_id` / `_ids` `[S]`. Six ID-bearing fields in `src/canvas/types.ts` do not match and stay numeric — including `rules.never_drop`, which is what produces the grade divergence in §2.3.
5. **Normalize to one representation — a decimal string — never to a `string | number` union flowing through the codebase.** With `CanvasId = string | number` on both sides, `a === b` compiles and is silently `false` `[P]`. 13 `===` sites and 18 `Map`/`Set<number>` sites would become bugs the compiler cannot catch (§4.4).
6. **Versioning:** Phase 1 is a `feat` minor with a release note. Phase 2 ships behind an opt-in config flag, also minor. Phase 3 (default-on) changes response ID types for every consumer and is the only part that needs a major — or a permanent flag. Open question 1.

Estimated size: Phase 0 **XS** (1 PR), Phase 1 **M** (2 PRs), Phase 2 **L** (3 PRs), Phase 3 **S** (1 PR, plus a release decision).

## 1. Corrections to the brief

Each of these changes the design, so they come first. The brief is right that the risk is real; it is wrong about where the risk sits and about how much of the surface is affected.

| # | The brief says | Evidence | Consequence |
| - | --- | --- | --- |
| 1 | "the shared Canvas HTTP client does not request the string-ID media type" | Correct, and worse than stated: `src/canvas/client.ts` sends **no `Accept` header at all**, and the header block is written out **three times** — once in `request()`, once in `paginate()`, once in `paginateEnvelope()`, because the paginators call `fetch` directly instead of going through `request()` `[S]`. | §5 has three insertion points, not one. A one-line fix in `request()` would leave every list tool unchanged, which is most of the read surface. |
| 2 | "validates most MCP ID inputs with `z.number()`" | 196 ID-named params are `z.number()` with no `.int()`; **20** use `z.number().int()`, which in Zod 4.6.5 rejects `9007199254740992` with `too_big` and publishes `minimum: -9007199254740991, maximum: 9007199254740991` in its JSON Schema `[P]` `[W]`. | The 20 already fail loudly. Scope the input migration to the 196, and the remedy is the pattern the 20 already use — not a novel mechanism. |
| 3 | Implied: accepting `string | safe integer` is an untested compatibility risk for clients | We **already publish** `{"type":["number","string"]}` on ID inputs: 38 such nodes across `list_submissions.student_ids`, `list_course_users.user_ids`, `list_course_enrollments.user_id` and 4 more call sites, plus 1 `anyOf` and 4 `oneOf`, in 165 tools `[W]`. | The construct is in production and has been for months. It was added for Canvas's `"self"`/`"all"` sentinels rather than for precision, but it settles the client-compatibility question empirically (§9). |
| 4 | "structured-output schemas" (implies a large surface) | Exactly **5** tools declare an `output` contract, all in `src/tools/pages.ts`: `list_pages`, `get_page`, `create_page`, `update_page`, `delete_page` `[W]`. | §7 is small. One ID field (`page_id`) is involved, and `src/tools/output/entities.ts` already carries a compile-time bridge that *forces* the schema to follow the type (§7.2). |
| 5 | Inventory omits the pseudonymizer | Widening the ID fields produces 5 type errors in `src/pseudonym/pseudonymizer.ts` `[P]` (§4.5). | The PII layer keys on `user_id`. It belongs in the inventory, and its coverage gate (`src/pseudonym/coverage.ts`) is a Phase 2 checkpoint. |
| 6 | Implied: Canvas module method signatures are part of the same change | Widening all 129 response ID fields produces **zero** errors in `src/canvas/*.ts` `[P]`. Those modules take `number` *parameters* and interpolate them into template strings; widening *response* types does not touch them. | The response-side and input-side migrations are **independent** and can ship in either order, in separate PRs, without a flag day. This is the single most useful fact for phasing. |

A claim in the brief I could **not** support, and am therefore not designing around: that the competitor lead (`semyonfox/canvas-mcp`) implies demand or a reference implementation. I did not read its design, per the issue's instruction, and nothing in this document derives from it.

## 2. Is the risk real, and how real

### 2.1 The magnitude question `[S]`

Canvas IDs are signed 64-bit: `lib/api.rb:197` sets `MAX_ID = ((2**63) - 1)` = `9223372036854775807`, `MAX_ID_LENGTH = 19`, and `ID_REGEX = /\A\d{1,19}\z/`. The official overview states it directly: "All integer ids in Canvas are 64 bit integers… To force all ids to strings add the request header `Accept: application/json+canvas-string-ids`… preventing problems with languages (particularly JavaScript) that can't properly process large integers" (`doc/api/README.md:28–31`) `[D]`.

But `2**63-1` is the *type* bound, not the reachable one. The reachable one comes from sharding. `switchman/lib/switchman/shard.rb:6` sets `IDS_PER_SHARD = 10_000_000_000_000` (1e13), and `#global_id_for` (line 672) computes `local_id + shard_id * IDS_PER_SHARD` `[S]`. Therefore:

| Shard | Global ID range | Exactly representable in a JS `number`? |
| - | --- | --- |
| 1 | `10_000_000_000_001` … | Yes — `10000000000001` round-trips exactly `[P]` |
| 900 | `9_000_000_000_000_000` … `9_009_999_999_999_999` | **Partly.** Unsafe once `local_id > 7_199_254_740_991` |
| ≥ 901 | `≥ 9_010_000_000_000_000` | **No.** `9010000000000001` parses as `9010000000000000` `[P]` |

So the first unsafe global ID is on shard 900, and **every object on shard 901 or higher has a globally unsafe ID**. A single-shard self-hosted Canvas has zero exposure; a multi-shard hosted instance has exposure proportional to its shard count.

**Honest framing: the defect is structural and reachable, not demonstrated against a specific live instance.** I did not run against a live Canvas (out of scope). What is demonstrated is that *if* such an ID reaches us, every layer loses it silently, and that is what the rest of this document is about. Do not cite this section as "we have affected users"; cite it as "the ID space makes it reachable and we handle it wrongly".

### 2.2 The input defect, on our own wire `[W]`

Through `InMemoryTransport` + a real `Client` + `createCanvasMCPServer`, with `listTools()` called first so the SDK's validator cache is armed:

| Call | Result |
| --- | --- |
| `get_course({course_id: 9007199254740993})` | **No error.** Fetched `GET /api/v1/courses/9007199254740992` — a different object. |
| `get_course({course_id: "9007199254740993"})` | `-32602 Invalid input: expected number, received string at course_id`. No request issued. |

Two things follow. First, the loss happens **upstream of our code**: the transport's `JSON.parse` has already rounded `…93` to `…92` before Zod runs, so we cannot detect the original value — we can only detect that the value is unsafe and *refuse*. Second, today a caller has **no way at all** to address such an object, because the string form is rejected. Accepting strings is therefore purely additive.

### 2.3 The response defect, and why the header is not a drop-in `[P]`

`StringifyIds.recursively_stringify_ids` converts a value only when the key matches `/(^|_)id$/i` (scalar) or `/(^|_)ids$/i` **and the value is an Array**, and only when the value is an `Integer` (`gems/stringify_ids/lib/stringify_ids.rb`) `[S]`. Ported faithfully to JS and run over a representative payload:

```
before  { id: 7, course_id: 7, position: 3, points_possible: 10,
          rules: { drop_lowest: 1, never_drop: [101, 102] },
          student_ids: [5, 6], assignment_visibility: [9, 10],
          courseId: 7, nested: [{ user_id: 4, score: 95.5 }] }

after   { id: "7", course_id: "7", position: 3, points_possible: 10,
          rules: { drop_lowest: 1, never_drop: [101, 102] },     <-- unchanged
          student_ids: ["5", "6"], assignment_visibility: [9, 10], <-- unchanged
          courseId: 7,                                            <-- unchanged
          nested: [{ user_id: "4", score: 95.5 }] }
```

`src/tools/grade-engine.ts` builds `new Set(group.rules?.never_drop ?? [])` at line 220 and tests `neverDrop.has(assignment.id)` at line 110. Under the header, the set holds numbers and `assignment.id` is a string, so `.has()` is always `false` and every pinned assignment silently becomes droppable.

Executed end to end — same fixture, same tool, same arguments, the **only** variable being whether the stringifier ran:

| | dropped assignments | earned / possible | `computed_percentage` | error? |
| - | --- | --- | --- | --- |
| Header **off** | `[102]` | 95 / 200 | **47.5** | none |
| Header **on** | `["101"]` | 185 / 200 | **92.5** | none |

A 45-point difference in a student's reported course grade, no error, no log line. `explain_grade` and `project_grade` share this engine. **This is the finding that sets the phase ordering: the header must land after the normalization, never with it or before it.**

### 2.4 One place string IDs are already the *correct* form `[S]`

Not every consequence is a cost. BRU-2550 §B1 (`docs/superpowers/specs/2026-09-15-bru-2550-rubric-assessment-grade-effects.md:81`) measured that a **numeric** `user_id` in a JSON request body makes `Api::ID_REGEX.match?(42)` raise `TypeError: no implicit conversion of Integer into String`, unrescued, so Canvas returns **500**. Canvas's ID parsing expects strings. Sending IDs as canonical decimal strings in JSON bodies is therefore strictly safer than sending them as numbers, and §6.4 makes it the rule.

## 3. Inventory

Mechanically derived: a TypeScript AST walk over `src/canvas/types.ts` collecting every property whose declared type admits `number`, classified by Canvas's two key regexes. The walk aborts if it finds fewer than 50 numeric fields or misses `id` / `course_id` / `user_id` / `assignment_id`, so a broken traversal cannot pass as an empty result.

**283 numeric-typed fields. 130 become strings under the header. 153 do not.**

### 3.1 Fields the header converts (130)

By field name, with occurrence counts:

`id` ×61 · `user_id` ×9 · `course_id` ×8 · `assignment_id` ×5 · `context_id` ×4 · `quiz_id` ×4 · `course_section_id` ×3 · `group_id` ×3 · `account_id` ×2 · `assignment_group_id` ×2 · `author_id` ×2 · `grader_id` ×2 · `grading_standard_id` ×2 · `group_category_id` ×2 · `root_account_id` ×2 · `student_ids` ×2 · `submission_id` ×2 · `assessment_id` · `assessor_id` · `asset_id` · `content_id` · `custom_grade_status_id` · `enrollment_term_id` · `folder_id` · `group_ids` · `module_id` · `nonxlist_course_id` · `page_id` · `parent_account_id` · `parent_folder_id` · `role_id` · `rubric_id`

All 130 are genuine identifiers. **The over-match risk is zero on today's types**: no field whose name matches `(^|_)ids?$` is a quantity. That matters because it means a key-pattern policy is safe here, and does not need a hand-maintained exception list on the convert side.

### 3.2 Fields the header does **not** convert, that are nevertheless identifiers (6)

This is the set a header-only change would miss, and it is why §4.3 proposes our own normalization pass.

| Field | Declared | What it holds | Consequence if left numeric |
| --- | --- | --- | --- |
| `CanvasAssignmentGroup.rules.never_drop` | `number[]` | assignment IDs | **The §2.3 grade divergence.** |
| `CanvasAssignment.assignment_visibility` | `number[]` | user IDs | Differentiated-assignment visibility checks silently empty. |
| `CanvasGradebookHistoryGrader.assignments` | `number[]` | assignment IDs | Gradebook-history joins silently miss. |
| `CanvasOutcomeRollup.links.{course,user,section}` | `number` | IDs | Rollup → entity joins silently miss. Note the sibling types `CanvasOutcomeResult.links` and `CanvasOutcomeRollupScore.links` are *already* typed `string \| number`, which is pre-existing evidence that Canvas's outcomes endpoints return these as strings on some paths. |
| `CanvasDashboardCard.courseId` | `number` | course ID | camelCase; `(^|_)id$` requires `^id` or `_id`, and `courseId` matches neither even case-insensitively `[P]`. |
| `CanvasQuizSubmissionQuestion.answer` | `string \| number \| …` | an answer ID for choice questions | Already widened, so already heterogeneous. |

### 3.3 Fields explicitly excluded — numeric quantities, not identifiers (147)

Required by the acceptance criteria, and the exclusion is by *category* so it survives new fields:

- **Points and scores:** `points_possible` ×11, `points` ×5, `score`, `current_score`, `final_score`, `entered_score`, `kept_score`, `max_score`, `min_score`, `current_points`, `points_deducted`, `mastery_points`
- **Ordering:** `position` ×8, `indent`
- **Counts:** `*_count` (`needs_grading_count`, `question_count`, `files_count`, `folders_count`, `members_count`, `message_count`, `unread_count`, `submission_count`, `appointment_count`, `participant_count`, `requirement_count`, `requirement_completed_count`, `items_count`), `total_*`, `size` ×3, `total_items`, `total_modules`, `total_students`, `views`, `page_views`
- **Time and durations:** `time_limit`, `extra_time` ×2, `seconds_late`, `total_activity_time`, `time_multiplier`
- **Weights and percentages:** `group_weight`, `weight`, `percent`, `late_submission_deduction`, `late_submission_minimum_percent`, `missing_submission_deduction`
- **Statistics:** `mean`, `median` ×2, `first_quartile`, `third_quartile`, `lower_q`, `upper_q`, `min`, `max`, `max_page_views`, `max_participations`
- **Quotas:** `storage_quota_mb`, `storage_quota_used_mb`, `default_storage_quota_mb`, `default_group_storage_quota_mb`, `default_user_storage_quota_mb`
- **Attempt and rule counts:** `attempt` ×2, `allowed_attempts`, `extra_attempts` ×3, `drop_lowest`, `drop_highest`, `calculation_int`, `max_appointments_per_participant`, `min_appointments_per_participant`
- **Tardiness tallies:** `late` ×2, `missing` ×2, `on_time` ×2, `floating` ×2

The clearest illustration of why this has to be field-level and not type-level: inside one `rules` object, `drop_lowest` and `drop_highest` are **counts** and `never_drop` is a **list of IDs**. Same object, same `number` type, opposite treatment.

### 3.4 Input surface (`src/tools/`)

| Declaration | Count | Behaviour on `9007199254740992` |
| --- | --- | --- |
| `z.number()` (incl. `.optional()`) | **196** | Accepted, silently rounded `[P]` |
| `z.number().int()[.positive()]` | **20** | Rejected, `too_big` `[P]` |
| `z.string()` | **5** | 4 New Quizzes `item_id` / `correct_choice_id`, 1 rubric `criterion_id`. Genuinely opaque string IDs; leave alone. |
| `z.union([z.number(), z.string()])` | 7 call sites | Already accept strings — but for Canvas's `"self"` / `"all"` sentinels, not for precision (§4.2). |

`z.number()` also accepts `1.5` and `1e21` `[P]`, so these 196 params have no integrality check at all, not merely a missing range check.

### 3.5 Other affected surfaces

- `src/canvas/client.ts` — 3 duplicated header blocks; `response.json()` on all 3 paths.
- `src/canvas/query.ts` — `CanvasQueryPrimitive` **already** includes `string`, and `appendCanvasQuery` already does `String(item)`. **No change needed** for string IDs (§6.2).
- `src/pseudonym/pseudonymizer.ts` — 5 widening errors; keys on `user_id`.
- `src/tools/output/entities.ts` — the compile-time bridge; 1 widening error (§7.2).
- `docs/generated/tool-manifest.json` — does **not** embed schema shapes. Each entry carries `name`, `title`, `domain`, `description`, `annotations`, `access`, `primaryAudience`, `relatedWorkflows` and a boolean `structuredOutput`. So neither the Phase 1 input-schema change nor the Phase 2c output widening requires regeneration; only a *description* change or a tool newly gaining an output contract does. Open question 5 is the case that would drag this file in.
- Tests — only **15** new type errors, all in `tests/tools/submissions-awaiting-grading.test.ts` `[P]`. Note `tsconfig.json` excludes `tests/`, so test code is not typechecked in CI; the real test cost is runtime fixture updates, which is scoped per PR in §8.

## 4. The canonical identifier contract

### 4.1 Decision: normalize to a decimal string, do not propagate a union

Three candidates were considered. The deciding measurement is that with `type CanvasId = string | number` on **both** sides of a comparison, `a === b` is legal TypeScript and `false` at runtime when the representations differ `[P]`. The compiler catches the *asymmetric* cases (a widened ID flowing into a `number` parameter — 99 of the 103 errors) and is blind to the symmetric ones. Our codebase has, by grep:

- **18** `Map<number, …>` / `Set<number>` keyed on Canvas IDs
- **13** `===` comparisons between a Canvas-sourced ID and another ID
- **2** arithmetic uses of `.id` (`resolved.sort((a, b) => a.id - b.id)` at `src/tools/quiz-question-responses.ts:263`)
- **4** `Number(...)` / `parseInt(...)` applied to an ID

A pervasive union would turn 15 of those (13 `===` plus 2 symmetric Map lookups) into defects with no compiler signal. A single canonical representation makes them correct by construction, and makes the arithmetic sites fail to compile — which is exactly where a human decision is wanted.

**Therefore:**

```
/** A Canvas identifier in canonical form: a decimal string, no sign, no
 *  leading zeros, 1..19 digits, value in [1, 2**63-1]. */
export type CanvasId = string

/** What the WIRE may carry, used only in src/canvas/types.ts before
 *  normalization. Never let this escape the HTTP client boundary. */
export type CanvasWireId = string | number
```

A nominal brand on `CanvasId` was considered and is **not** recommended for Phase 1: it would force an explicit construction call at all ~200 call sites at once, which defeats the phasing. Revisit in Phase 3. Open question 4.

### 4.2 Input normalization and rejection rules

One exported builder, used for all 196 params:

```
canvasIdInput()                       // required ID
canvasIdInput().optional()
canvasIdInput({ sentinels: ['self'] })      // Canvas's "self"
canvasIdList({ sentinels: ['self', 'all'] }) // student_ids / user_ids
```

Accept rules:

1. **Number** — accepted iff `Number.isSafeInteger(v) && v >= 1`. This is exactly `z.number().int().positive()` in Zod 4.6.5, verified `[P]`; do not hand-roll it.
2. **String** — accepted iff it matches `/^[1-9][0-9]{0,18}$/` **and** `BigInt(s) <= 9223372036854775807n`. Both bounds are derived from `lib/api.rb`, not chosen (`ID_REGEX = /\A\d{1,19}\z/`, `MAX_ID = 2**63-1`) `[S]`.
3. **Sentinels** — only the literals a call site explicitly declares. `"self"` and `"all"` are the only ones in use.
4. **Output of parsing is always the canonical decimal string.** `92` → `"92"`.

Rejection message must name the offending value and tell the caller what to do, e.g.
`course_id must be a Canvas ID: a positive integer at or below 9007199254740991, or a decimal string for larger IDs (received 9007199254740992). Pass large IDs as strings, e.g. "9010000000000001".`

Boundary table — these are the compatibility test cases:

| Input | Verdict | Why |
| --- | --- | --- |
| `1` | accept → `"1"` | |
| `9007199254740991` | accept → `"9007199254740991"` | `Number.MAX_SAFE_INTEGER`, exact |
| `9007199254740992` | **reject** | `2**53`; first value a JS number cannot distinguish from its neighbour |
| `9007199254740993` | **reject** | arrives as `…992`; the original is unrecoverable |
| `"9007199254740992"` | accept | exact as a string |
| `"9223372036854775807"` | accept | `= MAX_ID` |
| `"9223372036854775808"` | **reject** | `> MAX_ID`; Canvas cannot hold it |
| `"9010000000000001"` | accept | the shard-901 case from §2.1 |
| `0`, `"0"`, `-7`, `"-7"` | **reject** | no Canvas object has a non-positive ID |
| `"007"` | **reject** | Canvas tolerates leading zeros (`\d{1,19}` then `.to_i`), **we do not** — one object must have exactly one canonical string, or `Map` keys fork and §4.1 is defeated |
| `7.5`, `"7.0"`, `"1e3"`, `" 7"`, `"7 "`, `"1_000"` | **reject** | not canonical decimal |
| `"self"` | accept **only** where declared | |

### 4.3 Response normalization

Applied once, in the HTTP client, to every parsed body, on all three request paths:

```
normalizeCanvasIds(value)  // in-place walk, Integer -> canonical string
```

Key policy = Canvas's two regexes (`/(^|_)id$/i` scalar, `/(^|_)ids$/i` on arrays) **plus** an explicit, commented allowlist of the §3.2 misses: `never_drop`, `assignment_visibility`, `assignments` (on `CanvasGradebookHistoryGrader` only), `links.{course,user,section}`, `courseId`, `answer` (on `CanvasQuizSubmissionQuestion` only).

Three properties this must have, each because the alternative is a measured failure mode:

- **It must run whether or not the header was sent.** Then `never_drop` and friends are normalized in both modes, the §2.3 divergence cannot occur, and the header becomes a pure precision improvement rather than a semantic change.
- **The allowlist must be path-scoped, not name-scoped**, for `assignments` and `answer`. A bare name match on `assignments` would stringify unrelated nested assignment *objects*' sibling keys; a bare `answer` match would stringify free-text answers. The over-match risk on the two regexes is zero (§3.1); it is **not** zero on the allowlist.
- **It must be measured for cost before Phase 2 merges.** A walk over every response body on a 1000-page paginated read is the one part of this design whose cost I have not measured. Open question 3.

### 4.4 What the migration must not do

- **No `as number` casts to silence the 103 type errors.** Each one is a site where an ID meets numeric code; the fix is to make the consumer string-keyed, not to re-narrow.
- **No `Number(id)` to make a `Map` work.** That reintroduces the rounding at the exact point the design exists to remove it.
- **No mechanical find-and-replace of `z.number()` → `canvasIdInput()`.** It would strip the `"self"` / `"all"` sentinels from the 7 union call sites and break tools that work today, and it would wrongly convert the 5 genuine `z.string()` IDs, and it must not touch `.int()` params that are *quantities* rather than identifiers (`teacher_limit`, `per_page`-style limits) even though they look identical in a diff.

### 4.5 Measured blast radius of the response-side widening `[P]`

Codemod: widen all 129 ID-typed fields in `src/canvas/types.ts` to `CanvasWireId`, then typecheck. Baseline is 0 errors.

| | Errors |
| --- | --- |
| `src/` total | **103** across 18 files |
| `src/tools/quiz-question-responses.ts` | 25 |
| `src/tools/student-search.ts` | 10 |
| `src/tools/student.ts` | 9 |
| `src/tools/link-audit.ts` | 7 |
| `src/tools/accessibility-audit.ts` | 7 |
| `src/tools/quiz-accommodations.ts` | 6 |
| `src/tools/course-setup.ts` | 6 |
| `src/tools/files.ts` | 5 |
| `src/pseudonym/pseudonymizer.ts` | 5 |
| 9 more files | 4 or fewer each |
| `src/canvas/*.ts` | **0** — see correction 6 |
| `tests/` | 15, all in one file |

By kind: 61 `TS2345` (ID into a `number` parameter), 38 `TS2322` (assignment), 2 arithmetic, 1 overload, 1 the `entities.ts` bridge. **This is a transcript, not an estimate** — the codemod ran, and `types.ts` was restored to byte-identical afterwards.

## 5. Where to send the Accept header

Canvas gates on `request.headers["Accept"]&.include?("application/json+canvas-string-ids")` — a **substring** test, so `Accept: application/json+canvas-string-ids, application/json` works and a plain `application/json` fallback can be kept in the same header (`application_controller.rb:2977`) `[S]`.

| Path | Send it? | Why |
| --- | --- | --- |
| `CanvasHttpClient.request()` | **Yes** | 144 `/api/v1` call sites route through here or the paginators. |
| `CanvasHttpClient.paginate()` | **Yes** | Separate `fetch`; `Link`-header URLs are followed with the same header block, so the header must be inside the loop. |
| `CanvasHttpClient.paginateEnvelope()` | **Yes** | Same. |
| `/api/quiz/v1` (New Quizzes, 12 call sites) | **No** | `json_cast` is an `ApplicationController` concern, and a code search for `quiz/v1` under `config/` at the pinned SHA returns 0 matches, so these are served by the separate New Quizzes service `[S]`. Our types already reflect that it answers differently: `CanvasNewQuizItem.id` is `string` while `CanvasNewQuiz.id` is `number`. Exclude by path prefix, with a comment, and confirm against a live instance before relying on it. Open question 2. |
| `/login/oauth2/*` | **No** | Uses its own `fetchImpl` in `src/auth/oauth/canvas-oauth.ts`, not `CanvasHttpClient`. Naturally excluded; no action. |
| File-upload flows | **No change** | The multi-step upload POSTs to an S3-style URL returned by Canvas; it is not a Canvas JSON render path. Verify in Phase 2 that `src/canvas/files.ts` upload steps do not pick up the header via `request()`. |

One caveat worth recording, because it bounds what the header can promise: `ApplicationController#render` applies `json_cast` only `unless json.is_a?(String)` `[S]`. A controller that renders pre-serialized JSON bypasses stringification entirely. I did not enumerate which Canvas endpoints do that. Treat the header as best-effort, which is a further argument for §4.3 running unconditionally.

## 6. Serialization rules

Identifiers remain exact end to end because, after §4.2/§4.3, every identifier in the process **is already a string**. Concretely:

1. **URL path segments** — `` `/api/v1/courses/${courseId}` ``. With a canonical string this is exact. With a number it is lossy at the template: `` `${9007199254740993}` `` yields `"9007199254740992"` `[P]`. No code change beyond the type.
2. **Query parameters** — no change required. `CanvasQueryPrimitive` already admits `string`, and `appendCanvasQuery` already calls `String(value)`; a string ID passes through byte-exact, including the `key[]=` array form `[P]`.
3. **Form bodies** — `new URLSearchParams({ id: '9010000000000001' })` is exact. Numbers are lossy for the same reason as (1).
4. **JSON bodies** — IDs **must** be emitted as JSON strings, and this is independently required: a numeric `user_id` in a JSON body makes Canvas raise an unrescued `TypeError` and return 500 (§2.4) `[S]`. `JSON.stringify({ id: '9010000000000001' })` → `{"id":"9010000000000001"}` `[P]`.
5. **Response bodies** — `response.json()` is `JSON.parse`, so precision is lost before anything we control. Only the Accept header (§5) prevents it; §4.3 then makes the representation uniform.
6. **Structured output** — §7.
7. **Non-identifiers are untouched.** `points_possible`, `position`, `score`, counts, weights, quotas, durations and statistics stay `number` in both directions (§3.3). Timestamps stay `z.string()` per the existing output-contract rule.

## 7. Response and structured-output compatibility

### 7.1 Which fields change shape

Public TypeScript: the 130 fields in §3.1 go from `number` to `string` (after normalization; `CanvasWireId` exists only inside the client). Consumers of the independently importable `CanvasClient` see a type change on every ID. That is the breaking part of Phase 2/3.

Text content: the 165 tools serialize their results with `JSON.stringify`, so IDs appear as `"id": "123"` instead of `"id": 123`. For an LLM consumer this is immaterial. For a programmatic consumer doing `typeof x.id === 'number'` it is breaking.

### 7.2 Structured output is small, and already self-enforcing

Only 5 tools declare an `output` contract, all in `pages`, and the only ID in them is `page_id: z.number()` in `src/tools/output/entities.ts`. That file carries a compile-time bridge, `SchemaAcceptsCanvasType<S, T>`, which asserts every schema field's type against the hand-written Canvas interface. Widening `CanvasPage.page_id` makes it fail to compile — observed as `TS2344 … does not satisfy the constraint 'true'` `[P]`. **The schema cannot be forgotten.** That is the mechanism to lean on rather than a checklist.

Two Zod facts that constrain the fix `[P]`:

- A `z.number()` output field **hard-rejects** a string ID (`invalid_type`). So the header cannot precede the schema widening, for the 5 `pages` tools, independently of the §2.3 grade bug.
- `z.union([z.number(), z.string()])` accepts both and emits `{"type":["number","string"]}` in output mode. Use the union on output during Phase 2 (so a client validator accepts either), and narrow to `z.string()` only if and when Phase 3 makes strings unconditional.

### 7.3 Versioning

| Phase | Change | Semver | Note required |
| - | --- | --- | --- |
| 1 | Input params accept strings; reject unsafe/non-integral numbers. Published input schemas change from `{"type":"number"}` to `anyOf[{integer, bounded}, {string, pattern}]`. | **minor** (`feat`) | Yes — prominently. A caller passing `1.5`, `1e21` or an unsafe integer now gets an error. Every such call was already hitting the wrong object or a Canvas 404, so this is a bug fix, not a regression; it is still observable behaviour and belongs in the release note. |
| 2 | Response normalization + Accept header, **behind an opt-in config flag, default off**. | **minor** (`feat`) | Yes. Document the flag, the ID type change it causes, and that it is the mode to use on multi-shard hosted Canvas. |
| 3 | Flag defaults on. | **major**, or keep the flag permanently | Decision for the board. Open question 1. |

## 8. Phased implementation plan

Each phase is independently shippable and independently revertable. Phase 1 and Phase 2 do not depend on each other (correction 6), so they can run in parallel if two agents are free — but Phase 2's PRs are strictly ordered among themselves.

### Phase 0 — XS, 1 PR: stop the bleeding on the 20 that already work

Nothing to build. Add `tests/canvas/id-precision.test.ts` asserting the §2.2 wire behaviour **as it is today**, i.e. a characterization test that records the defect, plus the 20 `.int()` params rejecting `2**53`. Red-first is impossible here by construction; label these as characterization tests in the PR so `+N tests` is not read as `+N red`.

### Phase 1 — M, 2 PRs: the input side

**PR 1a — the canonical input type.** Add `src/canvas/id.ts` with `canvasIdInput()`, `canvasIdList()`, `normalizeCanvasIdInput()` and the §4.2 rules. Tests: the full boundary table from §4.2 as a table-driven test, every row red-first against a stub that returns the input unchanged. Plus a sentinel test, and a test asserting the emitted JSON Schema shape (so §9's compatibility claim is gated, not merely argued).

**PR 1b — adopt it across the 196 params.** Mechanical in volume, non-mechanical in judgement: see §4.4 for the three things a codemod gets wrong. Required:
- A coverage test that fails if any ID-named param in any tool is declared `z.number()` without going through `canvasIdInput()`. Enumerate from the **real registry** via `tools/list` on both server configurations (default and the role-filtered one), not from the default config only — an earlier guard in this repo was blind to 2 of 165 tools for exactly that reason.
- An anti-vacuity floor on that enumeration, split per configuration so re-narrowing the guard fails attributably.
- Handler updates where a handler currently relies on receiving a `number` (e.g. `src/tools/grading-standards.ts:169` casts `params.grading_standard_id as number | null`).

### Phase 2 — L, 3 PRs, strictly ordered: the response side

**PR 2a — normalization, no header.** Add `normalizeCanvasIds()` and call it on all three client paths **unconditionally**. Widen the 130 fields to `CanvasWireId` inside `types.ts` only, and export the 130 as `CanvasId` (string) post-normalization. Fix all 103 type errors per §4.4 — no casts. Tests:
- The §2.3 grade scenario as a regression test, asserting `47.5` both with and without a stringified payload. Inject the bug (drop `never_drop` from the allowlist) and show exactly that test going red and nothing else.
- A fixture round-trip for each of the 6 §3.2 misses.
- A test asserting the 147 excluded quantities are **unchanged** by the walk, with `drop_lowest` / `never_drop` in the same object as the headline case.
- A cost measurement for the walk (open question 3), reported in the PR body.

**PR 2b — the header, behind a flag.** `CANVAS_STRING_IDS=true` (byte-exact `=== 'true'`, no normalization of the flag value — every trim/lowercase step widens the set of strings that accidentally enable it). Exclude `/api/quiz/v1` by path prefix. Tests: the header is present on all three paths and on followed `Link` URLs; absent for `/api/quiz/v1`; absent when the flag is off. Prove against the built `dist/`, not just `src/`.

**PR 2c — structured output + docs.** Widen `page_id` in `entities.ts` to the union per §7.2, add fixtures with a value above `2**53`, update `README.md` and `docs/` for the flag. Check the lint script's file scope first: `prettier --check src/ tests/` deliberately excludes `README.md`, and reflowing it has previously broken `tests/docs/tool-count-consistency.test.ts`.

### Phase 3 — S, 1 PR: default-on

Flip the flag's default after at least one minor release of field exposure. Needs the §7.3 release decision first.

### Compatibility tests required in every phase

Values used must be above `Number.MAX_SAFE_INTEGER`, and the canonical fixture should be the shard-901 case `9010000000000001` so the test name explains *why* the value is large. Required assertions:

1. Input: `"9010000000000001"` reaches the URL byte-exact, through a real `Client` over `InMemoryTransport`, with `listTools()` called first to arm the SDK validator cache. A probe that skips `listTools()` goes green while the payload is broken for every real client.
2. Input: `9007199254740992` is rejected, with the message naming the value.
3. Pagination: the exact ID survives a followed `Link` URL.
4. JSON body: the ID is emitted as a JSON **string** (§2.4).
5. Response: a stringified payload round-trips to `"9010000000000001"`, and the same payload unstringified round-trips to the same canonical string.
6. Negative control for every "no request was made" assertion: the same call under a permissive configuration must show the request *was* attempted, or the safety test passes on a server that is broken for an unrelated reason.

## 9. MCP / JSON Schema client compatibility

**The answer is empirical, not predictive: we already ship this construct.** `tools/list` on `origin/main` @ `5740739` publishes 38 `{"type":[...]}` union nodes, 1 `anyOf` and 4 `oneOf` across 165 tools, including on ID inputs (`list_submissions.student_ids/items`, `list_course_users.user_ids/items`, `list_course_enrollments.user_id`) `[W]`. It has shipped for months with no reported client incompatibility.

Two shapes are available and they are not equivalent:

| Shape | Emitted JSON Schema | Assessment |
| --- | --- | --- |
| `z.union([z.number(), z.string()])` | `{"type":["number","string"]}` | What we ship today. Maximally compatible, but publishes **no** bounds and no pattern, so it tells a client nothing about what is valid. |
| `z.union([z.number().int(), z.string().regex(...)])` | `{"anyOf":[{"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991},{"type":"string","pattern":"^[1-9][0-9]{0,18}$"}]}` | **Recommended.** Self-documenting, and the bounds are already published by the 20 `.int()` params, so neither keyword is new to our surface. |

Host-specific risks, with what is and is not known:

- **Draft dialect.** This repo installs a schema-dialect compatibility shim (`installSchemaDialectCompat`) after issue #341, because a client rejected a construct emitted under one dialect. Phase 1 must assert that the new ID schema is **byte-identical** under `draft-7` and `draft-2020-12` by asking the SDK's own converter for both forms and diffing — not by maintaining a keyword allowlist. Pair it with a construct that *does* diverge (a `z.tuple`) so the comparison cannot be vacuous.
- **Strict validators.** `Ajv2020({strict: true})` rejects `type: [a, b]` under `strictTypes`. That is Ajv's opinion, not the standard, and it already applies to our 38 existing nodes; the `anyOf` form above avoids it entirely, which is a further reason to prefer it.
- **Unknown.** Whether any specific host coerces a JSON number in tool arguments before the server sees it. Our own wire shows the SDK does not — it hands the handler whatever `JSON.parse` produced `[W]` — but a host that re-serializes arguments through its own pipeline could round a large number before it reaches the transport. In that case the string form is the *only* reliable path, which is an argument for documenting "pass large IDs as strings" in the tool descriptions rather than relying on numeric input at all. Open question 5.

## 10. Rollback

- **Phase 1** — revert PR 1b alone and the 196 params return to `z.number()`; PR 1a is additive and can stay. No data or on-disk state is involved. Published input schemas revert to `{"type":"number"}`, a widening, so no client breaks on the way back.
- **Phase 2** — PR 2b is a flag flip: setting `CANVAS_STRING_IDS` to anything other than `true` restores the current wire immediately, with no redeploy of code. PR 2a is **not** flag-gated by design (that is the point — the normalization must hold in both modes), so rolling it back means reverting the response ID types, which is a type-level breaking change in the reverse direction. Treat PR 2a as the commitment point.
- **Phase 3** — reverting the default is a one-line change, but by then consumers may depend on string IDs; a revert is itself breaking. This is why Phase 3 wants the release decision up front.
- **Not rollback-able:** any ID that was already written to Canvas via a rounded value. There is no audit trail of past rounding, and nothing in this plan can reconstruct it. Phase 0's characterization test is the closest thing to a record.

## 11. Open questions

These are decisions I did not make. Each changes behaviour, a public contract, or a release.

1. **Does Phase 3 ship as a major, or does the flag become permanent?** Default-on changes every ID's type for every consumer of the published types, the structured output and the text payload. A permanent flag avoids a major but leaves two supported shapes forever. **CTO / board.**
2. **Does `/api/quiz/v1` honour the header?** §5 excludes it on the basis of a 0-match code search plus our own heterogeneous types, which is suggestive, not conclusive. Settling it needs one request against a live instance with New Quizzes enabled — out of scope here. If it *does* honour it, the exclusion becomes a bug. **Needs a live instance.**
3. **What does the normalization walk cost on a large paginated response?** The one unmeasured item in this design. It must be measured in PR 2a and reported, not assumed. If it is material, the alternative is a per-field normalization at the ~130 declaration sites, which is more code but zero per-response cost. **Lead Developer, in PR 2a.**
4. **Brand `CanvasId` nominally, now or in Phase 3?** A brand makes "a raw string used as an ID" a compile error, which is the strongest version of §4.1 — at the cost of an explicit construction at every call site in one PR. Recommended for Phase 3, not Phase 1.
5. **Do we tell callers in the tool descriptions to pass large IDs as strings?** 196 description strings, and `docs/generated/tool-manifest.json` embeds every description, so this drags a frequently-contended generated file into the diff. Worth doing only if §9's host-coercion risk is judged real. **CTO.**
6. **Should `0` be accepted as an ID?** I reject it (§4.2). Canvas's `ID_REGEX` would accept `"0"`, and I know of no Canvas object with id 0, but I did not prove none exists.

## Appendix A — Reproducing the measurements

All probes ran in a worktree at `origin/main` @ `5740739` and were deleted before this PR; the artifacts are in the run's scratch directory. Each is a few dozen lines and can be rebuilt from the descriptions below.

| Claim | How |
| --- | --- |
| Zod behaviour table (§3.4, §4.2) | A vitest probe under `tests/scratch-probe/`, `safeParse` of 6 values against 6 schema forms, results collected into an object and `writeFileSync`'d — vitest swallows `console.log` even on pass, and `include` is `tests/**/*.test.ts`, so a probe outside `tests/` silently finds no test files. |
| Wire round trip (§2.2) | `InMemoryTransport.createLinkedPair()` + a real `Client` + `createCanvasMCPServer`, `globalThis.fetch` stubbed to record URLs, `listTools()` called before `callTool` to arm the validator cache. |
| Published schema census (§1 correction 3, §9) | `pnpm build`, then a CJS script that walks every `inputSchema`/`outputSchema` from `tools/list`, aborting if fewer than 100 tools are found. |
| ID inventory (§3) | TypeScript AST walk over `src/canvas/types.ts` collecting `PropertySignature` nodes whose type admits `number`, classified by the two `StringifyIds` regexes. Aborts on fewer than 50 fields or on missing `id`/`course_id`/`user_id`/`assignment_id`. |
| Widening blast radius (§4.5) | The same AST walk, emitting back-to-front slice-based edits (never `String.prototype.replace` — `$'` in a replacement string is a pattern and splices the rest of the file in). Baseline `tsc --noEmit` is 0; `types.ts` restored from a byte copy afterwards and re-verified at 0. |
| Grade divergence (§2.3) | The `StringifyIds` algorithm ported to TypeScript from the pinned Ruby, applied to a fixture served through the stubbed `fetch`, calling the real `explain_grade` twice with the stringifier as the only variable. The assignments fixture must be nested inside the `assignment_groups` response — `grade-engine` fetches them via `include[]=assignments`, and a flat `/assignments` route is never requested, which makes a naive fixture produce an empty, vacuous comparison. |
