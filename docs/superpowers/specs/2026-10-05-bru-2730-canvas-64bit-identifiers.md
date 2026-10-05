# Preserving 64-bit Canvas identifiers without JavaScript precision loss

- **Date:** 2026-10-05
- **Issue:** BRU-2730 (parent BRU-2726, CTO Product Research 2026-10-05)
- **Status:** Proposed — design only. No source change is made by this document.
- **Revision 2 (2026-10-05, BRU-2735):** revised after QA's first-pass review of PR #382 at head `36e9048` (findings F1–F6, BRU-2734). Every count in this document was re-derived against the base below with a stated rule; see §12 for the correction matrix, and Appendix A for recipes that reproduce each number. Three further defects in my own §4.2 (N1–N3) were found while executing the rules and are corrected here.
- **Revision 3 (2026-10-05, BRU-2737):** revised after QA's second review of PR #382 at head `76cf525` (BRU-2736, findings 1–9). Every count touched by the review was re-derived with an AST walk or grep recipe now stated in Appendix A. §13 maps each finding to its change. Where the re-derivation disagrees with QA, §13 says so and gives the evidence.
- **Revision 4 (2026-10-05, BRU-2739):** revised after QA's re-review of PR #382 at head `f0668e2` (BRU-2738, findings 1–7). §14 maps each finding. Revision 4 also corrects the §3.6 counting rule (`ReadonlyArray` unwrapping, and inline parameter object types, which rule (a) missed); the §3.6 counts are restated there and the superseded figures are listed in §14.
- **Revision 5 (2026-10-05, BRU-2740):** revised after QA's re-review of PR #382 at head `18a48bc` (BRU-2739 follow-up, findings A-C). §15 maps each finding, and records two corrections found while checking them against a fresh AST walk.
- **Revision 6 (2026-10-05, BRU-2741):** revised after QA's round-3 re-review of PR #382 at head `953cd17` (findings A and D; B and C passed). PR #382 merged at `d3d3705` before this revision, so these fixes land as a follow-up on `main`. §16 maps each finding. Finding D reproduces: 15 inline sites, not 11. Finding A's TS2352 does not occur at the handler sites, and the split changes: PR 1c (signatures) lands before PR 1b (schema and cast removal), because the signature widening is compile-clean on its own and the cast retype is not.
- **Base:** `origin/main` @ `5740739` (canvas-lms-mcp 1.31.1), `zod` 4.6.5, `@modelcontextprotocol/sdk` 1.32.0 (the lockfile-resolved version; `package.json` declares the range `^1.30.0`), Node 22
- **Canvas sources pinned at:** `instructure/canvas-lms` @ `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`, `instructure/switchman` @ `bceec0a0b2d2932597250b88fdc9253e70fcd8b0`
- **Evidence tags:** `[D]` official docs · `[S]` read from pinned source · `[P]` executed in a probe · `[W]` observed on our own MCP wire

## 0. Recommendation

**Split this into two independent migrations, ship the input side first, and do not send `Accept: application/json+canvas-string-ids` until the response side is normalized. The header is not a drop-in: with it on and nothing else changed, `explain_grade` reports a different course grade — 47.5% becomes 92.5% on identical Canvas data, with no error raised `[P]` (§2.3).**

1. **The input defect is live, silent and cheap to fix (Phase 1).** `get_course({course_id: 9007199254740993})` succeeds today and fetches `/api/v1/courses/9007199254740992` — a different object, no warning `[W]`. **222** ID-named `z.number()` occurrences inside tool input schemas carry no `.int()`, so they accept any finite number (§3.4 states the counting rule). Fix: one canonical input type that accepts canonical decimal strings and safe positive integers. It is additive for valid IDs and **breaking for invalid ones**: `0`, negatives, fractions, and exponent-form values outside the safe-integer range (`1e21`) pass `z.number()` today and will be rejected with `-32602`. Those values already reach the wrong object or a Canvas 404, but the change is observable and is carried into §4.2 and §7.3.
2. **52 ID-named sites are already safe and the brief does not say so.** Zod 4's `.int()` enforces the safe-integer range: `z.number().int()` rejects `9007199254740992` with `too_big` `[P]` (§1, correction 2). Those fail *loudly* today. The defect is confined to the 222 that omit `.int()`.
3. **The response defect cannot be fixed by types.** `JSON.parse` destroys the value before any TypeScript or Zod sees it `[P]`. The Accept header is the *only* fix, and sending it is a behaviour change, not a typing change.
4. **Canvas's own stringifier has misses, so we need our own normalization pass regardless (Phase 2).** `StringifyIds` matches only keys ending `_id` / `_ids` `[S]`. **12 ID-bearing fields across 8 interface rows** in `src/canvas/types.ts` do not match and stay numeric — including `rules.never_drop`, which is what produces the grade divergence in §2.3.
5. **Normalize to one representation — a decimal string — never to a `string | number` union flowing through the codebase.** With `CanvasId = string | number` on both sides, `a === b` compiles and is silently `false` `[P]`. 14 ID-to-ID `===` / `!==` sites in `src/tools/**` and 18 `Map`/`Set<number>` occurrences in `src/` would become bugs the compiler cannot catch (§4.1).
6. **The compiler will not help on the input side at all, so Phase 1 needs a structural guard, not a behavioural one.** `ToolDefinition.handler` is typed `(params: Record<string, unknown>) => Promise<unknown>` (`src/tools/types.ts:75`) `[S]`, so widening a tool's `inputSchema` produces **zero** `tsc` errors — measured by widening `get_course.course_id` to the recommended union and running `pnpm typecheck`: 0 errors, against a 0-error baseline `[P]`. Handlers already reach values through `as number` casts (`src/tools/courses.ts:129`), so a string ID flows straight through to `src/canvas/`, whose ID parameters are declared `number`. On the wire this *works only after the schema is widened*. Against the base schema (`z.number()`), `get_course({course_id: "9010000000000001"})` is rejected with `-32602` (QA BRU-2738; not re-measured in revision 4). With `get_course.course_id` widened, the same call reaches `GET /api/v1/courses/9010000000000001` byte-exact with no change to `src/canvas/` at all `[W]`. That is the trap: the byte-exact acceptance test goes green while **247 ID declaration sites in `src/canvas/` still admit `number`** (256 sites admit it; §3.6). Phase 1 therefore needs PR 1c and a source-level count-floor guard (§8).
7. **Versioning:** Phase 1 is a `feat` minor with a release note. Phase 2 ships behind an opt-in config flag, also minor. Phase 3 (default-on) changes response ID types for every consumer and is the only part that needs a major — or a permanent flag. Open question 1.

Estimated size: Phase 0 **XS** (1 PR), Phase 1 **M** (3 PRs), Phase 2 **L** (3 PRs), Phase 3 **S** (1 PR, plus a release decision).

## 1. Corrections to the brief

Each of these changes the design, so they come first. The brief is right that the risk is real; it is wrong about where the risk sits and about how much of the surface is affected.

| # | The brief says | Evidence | Consequence |
| - | --- | --- | --- |
| 1 | "the shared Canvas HTTP client does not request the string-ID media type" | Correct, and worse than stated: `src/canvas/client.ts` sends **no `Accept` header at all**, and the header block is written out **three times** — once in `request()`, once in `paginate()`, once in `paginateEnvelope()`, because the paginators call `fetch` directly instead of going through `request()` `[S]`. | §5 has three insertion points, not one. A one-line fix in `request()` would leave every list tool unchanged, which is most of the read surface. |
| 2 | "validates most MCP ID inputs with `z.number()`" | **222** ID-named `z.number()` sites in tool input schemas have no `.int()`; **52** do, and in Zod 4.6.5 those reject `9007199254740992` with `too_big` `[P]`. Of the 52, **46** are `.int().positive()` and publish `exclusiveMinimum: 0, maximum: 9007199254740991`; **6** are bare `.int()` and publish `minimum: -9007199254740991, maximum: 9007199254740991` `[P]` `[W]`. Counting rule in §3.4. | The 52 already fail loudly. Scope the input migration to the 222, and the remedy is the pattern the 52 already use — not a novel mechanism. |
| 3 | Implied: accepting `string | safe integer` is an untested compatibility risk for clients | We **already publish** `{"type":["number","string"]}` on ID inputs: 38 such nodes across `list_submissions.student_ids`, `list_course_users.user_ids`, `list_course_enrollments.user_id` and 4 more call sites, plus 1 `anyOf` and 4 `oneOf`, in 165 tools `[W]`. | The construct is in production and has been for months. It was added for Canvas's `"self"`/`"all"` sentinels rather than for precision, but it settles the client-compatibility question empirically (§9). |
| 4 | "structured-output schemas" (implies a large surface) | Exactly **5** tools declare an `output` contract, all in `src/tools/pages.ts`: `list_pages`, `get_page`, `create_page`, `update_page`, `delete_page` `[W]`. | §7 is small. One ID field (`page_id`) is involved, and `src/tools/output/entities.ts` already carries a compile-time bridge that *forces* the schema to follow the type (§7.2). |
| 5 | Inventory omits the pseudonymizer | Widening the ID fields produces 5 type errors in `src/pseudonym/pseudonymizer.ts` `[P]` (§4.5). | The PII layer keys on `user_id`. It belongs in the inventory, and its coverage gate (`src/pseudonym/coverage.ts`) is a Phase 2 checkpoint. |
| 6 | Implied: Canvas module method signatures are part of the same change | Widening all **130** response ID fields produces **zero** errors in `src/canvas/*.ts` `[P]` (reproduced; recipe in Appendix A). Those modules take `number` *parameters* and interpolate them into template strings; widening *response* types does not touch them. | ~~The response-side and input-side migrations are **independent** and can ship in either order, in separate PRs, without a flag day.~~ **Corrected in revision 2 (QA F1):** the measurement is right, the consequence was not. It licenses only the narrow claim that *response* widening needs no `src/canvas/` change. The **input** migration has the same sink from the other direction — 247 ID declaration sites in `src/canvas/` still admit `number` (256 in all; §3.6) — so the two migrations are independent in their *response-type* work only. The correct phasing fact is that PR 2a does not block PR 1a/1b; PR 1c is new and is Phase 1's own work. |
| 7 | Implied: TypeScript will surface the input-side work | `ToolDefinition.handler` is `(params: Record<string, unknown>) => Promise<unknown>` (`src/tools/types.ts:75`) `[S]`. Widening `get_course.course_id` to the recommended union and running `pnpm typecheck` gives **0** errors against a **0** baseline `[P]`; the existing `params.course_id as number` cast (`src/tools/courses.ts:129`) then carries a `string` into `get(courseId: number)` with no diagnostic, and the URL comes out byte-exact `[W]`. All of this is measured with the schema widened. The base schema rejects the string `"9010000000000001"` with `-32602` (QA BRU-2738), so the byte-exact result is a property of the widened schema, not of the base code. Inside `src/canvas/*.ts` no ID parameter is used in arithmetic, a comparison, or as a `Map`/`Set` key — they are only interpolated or forwarded to `appendCanvasQuery` `[S]`. | Three consequences. (a) QA's F1 "or a `tsc` failure" branch **does not exist**; the failure is silent. (b) There is no runtime bug in `src/canvas/` today, so PR 1c is required for *type honesty on a published API* (`canvas-lms-mcp/canvas` is an exported entry point — a library consumer reading `get(courseId: number)` will pass a number and lose precision) and to satisfy §4.4's no-casts rule (PR 1b) — not to make a wire test pass. (c) The §8 acceptance test 1 is therefore **vacuous as a gate for PR 1c** and must be paired with a source-level guard. |

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

Executed end to end — same fixture, same engine, same arguments, the **only** variable being whether the stringifier ran:

| | pinned | dropped assignments | earned / possible | `computed_percentage` | error? |
| - | --- | --- | --- | --- | --- |
| Header **off** | `[101]` | `[102]` | 95 / 200 | **47.5** | none |
| Header **on** | `[]` | `["101"]` | 185 / 200 | **92.5** | none |

A 45-point difference in a student's reported course grade, no error, no log line. `explain_grade` and `project_grade` share this engine. **This is the finding that sets the phase ordering: the header must land after the normalization, never with it or before it.**

#### 2.3.1 Reproduction recipe (QA F4) `[P]`

Deterministic, offline, and dependency-free: `computeGroupGrade` is exported from `src/tools/grade-engine.ts`, so no `fetch` stub, MCP transport or Canvas instance is involved, and the only variable is the stringifier. Place this at `tests/scratch-probe/grade-hazard.test.ts` in a worktree at the base SHA above and run `pnpm exec vitest run tests/scratch-probe/grade-hazard.test.ts`. (`vitest`'s `include` is `tests/**/*.test.ts`, so a probe outside `tests/` silently finds no test files, and `console.log` is swallowed even on pass — hence `writeFileSync`.)

```ts
import { writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { computeGroupGrade, percentageOf } from '../../src/tools/grade-engine'
import type { CanvasAssignmentGroup, CanvasSubmission } from '../../src/canvas/types'

// Faithful port of StringifyIds.recursively_stringify_ids at the pinned SHA.
const SCALAR = /(^|_)id$/i
const PLURAL = /(^|_)ids$/i
function stringifyIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stringifyIds)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SCALAR.test(k) && Number.isInteger(v)) out[k] = String(v)
      else if (PLURAL.test(k) && Array.isArray(v))
        out[k] = v.map((x) => (Number.isInteger(x) ? String(x) : stringifyIds(x)))
      else out[k] = stringifyIds(v)
    }
    return out
  }
  return value
}

const GROUP = {
  id: 1,
  name: 'Homework',
  group_weight: 100,
  rules: { drop_lowest: 1, never_drop: [101] },
  assignments: [
    { id: 101, name: 'A', points_possible: 100, grading_type: 'points' },
    { id: 102, name: 'B', points_possible: 100, grading_type: 'points' },
    { id: 103, name: 'C', points_possible: 100, grading_type: 'points' },
  ],
}
const SUBS = [
  { id: 1, assignment_id: 101, score: 0, workflow_state: 'graded', excused: false },
  { id: 2, assignment_id: 102, score: 90, workflow_state: 'graded', excused: false },
  { id: 3, assignment_id: 103, score: 95, workflow_state: 'graded', excused: false },
]

function run(stringified: boolean) {
  const group = (stringified ? stringifyIds(GROUP) : GROUP) as CanvasAssignmentGroup
  const subs = (stringified ? stringifyIds(SUBS) : SUBS) as CanvasSubmission[]
  const byId = new Map(subs.map((s) => [s.assignment_id, s]))
  const r = computeGroupGrade(group, byId as never, 'current')
  return {
    dropped: r.items.filter((i) => i.dropped).map((i) => i.assignment.id),
    pinned: r.items.filter((i) => i.pinned).map((i) => i.assignment.id),
    earned: r.earned,
    possible: r.possible,
    computed_percentage: percentageOf(r.earned, r.possible),
  }
}

describe('grade hazard', () => {
  it('records both outcomes', () => {
    writeFileSync(
      'grade-hazard-out.json',
      JSON.stringify({ headerOff: run(false), headerOn: run(true) }, null, 2),
    )
  })
})
```

Observed output, verbatim:

```json
{
  "headerOff": { "dropped": [102], "pinned": [101], "earned": 95,  "possible": 200, "computed_percentage": 47.5 },
  "headerOn":  { "dropped": ["101"], "pinned": [],   "earned": 185, "possible": 200, "computed_percentage": 92.5 }
}
```

Why this fixture and not a simpler one. `computeGroupGrade` sums `possible` over `[...working, ...pinned]`, so a pinned assignment is always counted; three assignments are the minimum that makes "which one got dropped" differ between the two modes rather than merely "how many". Scores `0 / 90 / 95` with `drop_lowest: 1` are chosen so that under the header the dropped item flips from the 90 to the 0 — the single change that moves the reported grade 45 points. `submissionsById` is **not** a second divergence: `grade-explanation.ts:215` keys the map on `sub.assignment_id`, which the header stringifies on both sides of the lookup, so it still matches. `never_drop` is the only miss that bites, which is exactly the §3.2 point.

The end-to-end `explain_grade` figure follows from this without a second measurement: with a single assignment group, the tool's `computed_percentage` is `percentageOf(earned, possible)` over that group. The derivation is `percentageOf` at `src/tools/grade-engine.ts:263–265` (`earned / possible * 100`), which `grade-explanation.ts:30` calls. (Line 238 of `grade-explanation.ts` is the `computeGroupGrade(...)` call in the multi-group loop, not the derivation; revision 2 cited it in error.) The recipe already prints the same arithmetic.

### 2.4 One place string IDs are already the *correct* form `[P]`

Not every consequence is a cost. BRU-2550 §B1 (`docs/superpowers/specs/2026-09-15-bru-2550-rubric-assessment-grade-effects.md:81`) measured that a **numeric** `user_id` in a JSON request body makes `Api::ID_REGEX.match?(42)` raise `TypeError: no implicit conversion of Integer into String`, unrescued, so Canvas returns **500**. The evidence is that BRU-2550 probe, cited from its spec. No pinned Canvas source call site for this path was found in revision 4, so "Canvas's ID parsing expects strings" is a probe result, not a source claim. Sending IDs as canonical decimal strings in JSON bodies is therefore strictly safer than sending them as numbers, and §6 item 4 makes it the rule.

## 3. Inventory

### 3.0 The counting rule (QA F3)

Revision 1 published `283 / 130 / 153` without stating its rule, and those totals do not reproduce — they counted container-typed properties (`rules: {…}`, `links: {…}`, `Array<{ id: number }>`) alongside their own leaves, so some fields were counted twice. The rule below replaces them. It is a syntactic walk, not a type-checker query, so it is reproducible from the file alone.

**Strict leaf rule.** Over `src/canvas/types.ts`, visit every `PropertySignature` of every `InterfaceDeclaration`, and of every `TypeLiteral` reachable through a property's declared type. For each property, *strip* the declared type: unwrap `Array<T>` and `T[]`, unwrap parentheses, and drop `null` / `undefined` union members. For any other generic reference, **descend into its type arguments** (revision 3, QA F1), so that a `TypeLiteral` inside a non-Array argument such as `Record<string, { points?: number | null; … }>` is reached. Then:

- If any surviving constituent is a `TypeLiteral`, the property is a **container**: it is **not counted**, and its own members are visited instead.
- Otherwise, if any surviving constituent is the `number` keyword, the property is a **numeric leaf** and is counted exactly once.
- A property typed `Record<string, number>` is **not** a numeric leaf: the `number` is a map *value type*, not a declared field, and Canvas's stringifier keys on field names. Two properties are affected (`CanvasStudentActivitySummary.page_views` at `types.ts:990`, `CanvasCourseStructure.summary.items_by_type` at `types.ts:605`); counting them gives 263 instead of 261 (measured by the recipe with the `Record` skip disabled).

Classification then applies Canvas's own two regexes from `gems/stringify_ids` `[S]`: a leaf **converts** iff (it is scalar and its name matches `/(^|_)id$/i`) or (it is array-typed and its name matches `/(^|_)ids$/i`).

Anti-vacuity: the walk aborts if it finds fewer than 50 numeric leaves, or if `id`, `course_id`, `user_id` or `assignment_id` is absent from the result — so a traversal that silently stops resolving cannot pass as a clean answer.

**261 numeric leaves. 130 convert under the header. 131 do not.** Of the 131 that do not, **12 are identifiers** (§3.2) and **119 are genuine quantities** (§3.3).

Revision 2's total of 260 was wrong. It was not a rule-boundary effect. The walk did not descend into the type arguments of `CanvasSubmission.rubric_assessment?: Record<string, { points?: number | null; … }>` (`src/canvas/types.ts:290–293`), so that interface's one numeric leaf, `CanvasSubmission.rubric_assessment.points`, was never visited. Adding it moves the total from 260 to 261, the quantity bucket from 118 to 119, and `points` from ×4 to ×5. **Both walks agree exactly on 130 converting fields**, which is the only figure any phase depends on: it is the size of PR 2a's widening, the input to §4.5's codemod, and the §7.1 breaking surface. The change touches only the non-converting bucket, which no phase step consumes.

### 3.1 Fields the header converts (130)

By field name, with occurrence counts:

`id` ×61 · `user_id` ×9 · `course_id` ×8 · `assignment_id` ×5 · `context_id` ×4 · `quiz_id` ×4 · `course_section_id` ×3 · `group_id` ×3 · `account_id` ×2 · `assignment_group_id` ×2 · `author_id` ×2 · `grader_id` ×2 · `grading_standard_id` ×2 · `group_category_id` ×2 · `root_account_id` ×2 · `student_ids` ×2 · `submission_id` ×2 · `assessment_id` · `assessor_id` · `asset_id` · `content_id` · `custom_grade_status_id` · `enrollment_term_id` · `folder_id` · `group_ids` · `module_id` · `nonxlist_course_id` · `page_id` · `parent_account_id` · `parent_folder_id` · `role_id` · `rubric_id`

All 130 are genuine identifiers. **The over-match risk is zero on today's types**: no field whose name matches `(^|_)ids?$` is a quantity. That matters because it means a key-pattern policy is safe here, and does not need a hand-maintained exception list on the convert side.

### 3.2 Fields the header does **not** convert, that are nevertheless identifiers — 12 fields across 8 rows

This is the set a header-only change would miss, and it is why §4.3 proposes our own normalization pass. Revision 1 said "six ID-bearing fields" and QA's review said eight; the strict leaf rule of §3.0 enumerates **12 fields in 8 interface rows**. The four neither count included are the `CanvasOutcomeResult.links` members and `CanvasOutcomeRollupScore.links.outcome` — revision 1 mentioned them in passing (as evidence that Canvas returns these as strings on some paths) without counting them as misses, which is how they went missing from the §4.3 allowlist.

| Row | Fields | Declared | What it holds | Consequence if left numeric |
| --- | - | --- | --- | --- |
| `CanvasAssignmentGroup.rules.never_drop` | 1 | `number[]` | assignment IDs | **The §2.3 grade divergence.** |
| `CanvasAssignment.assignment_visibility` | 1 | `number[]` | user IDs | Differentiated-assignment visibility checks silently empty. |
| `CanvasGradebookHistoryGrader.assignments` | 1 | `number[]` | assignment IDs | Gradebook-history joins silently miss. |
| `CanvasOutcomeRollup.links.{course,user,section}` | 3 | `number` | IDs | Rollup → entity joins silently miss. |
| `CanvasDashboardCard.courseId` | 1 | `number` | course ID | camelCase; `(^|_)id$` requires `^id` or `_id`, and `courseId` matches neither even case-insensitively `[P]`. |
| `CanvasQuizSubmissionQuestion.answer` | 1 | `string \| number \| …` | an answer ID for choice questions | Already widened, so already heterogeneous. |
| `CanvasOutcomeResult.links.{user,learning_outcome,alignment}` | 3 | `string \| number` | user / outcome / alignment IDs | **Added in revision 2.** Already widened, so a consumer is already obliged to handle both — but the representation is non-uniform, which is exactly what §4.1 exists to eliminate. |
| `CanvasOutcomeRollupScore.links.outcome` | 1 | `string \| number` | outcome ID | **Added in revision 2.** Same as above. |

Five of the 12 (`answer`, and the four `string \| number` link members) are already union-typed, so for them PR 2a's job is *normalizing the representation*, not widening the type. The remaining 7 are hard `number` / `number[]` and are the ones that can silently fail a join. Note that the already-widened outcome links are pre-existing evidence that Canvas's outcomes endpoints really do return these as strings on some paths — which is an argument for normalizing rather than for trusting the key regexes.

### 3.3 Fields explicitly excluded — numeric quantities, not identifiers (119)

Required by the acceptance criteria, and the exclusion is by *category* so it survives new fields:

- **Points and scores:** `points_possible` ×11, `points` ×5 (one of them is `CanvasSubmission.rubric_assessment.points`, §3.0), `score` ×5, `current_score`, `final_score`, `entered_score`, `kept_score`, `max_score`, `min_score`, `current_points`, `points_deducted`, `mastery_points`
- **Ordering:** `position` ×8, `indent`
- **Counts:** `*_count` (`needs_grading_count` ×2, `question_count`, `files_count`, `folders_count`, `members_count`, `message_count`, `unread_count` ×2, `submission_count`, `appointment_count`, `participant_count`, `requirement_count`, `requirement_completed_count`, `items_count`), `count` ×2, `size` ×3, `total_items`, `total_modules`, `total_students`, `views`, `page_views`
- **Activity volumes and levels:** `participations` ×2, `participations_level`, `page_views_level`
- **Time and durations:** `time_limit`, `extra_time` ×2, `seconds_late`, `total_activity_time`, `time_multiplier`
- **Weights and percentages:** `group_weight`, `weight`, `percent`, `value` (a grading-scheme cutoff fraction), `late_submission_deduction`, `late_submission_minimum_percent`, `missing_submission_deduction`
- **Statistics:** `mean`, `median` ×2, `first_quartile`, `third_quartile`, `lower_q`, `upper_q`, `min`, `max`, `max_page_views`, `max_participations`
- **Quotas:** `storage_quota_mb`, `storage_quota_used_mb`, `default_storage_quota_mb`, `default_group_storage_quota_mb`, `default_user_storage_quota_mb`
- **Attempt and rule counts:** `attempt` ×2, `allowed_attempts`, `extra_attempts` ×3, `drop_lowest`, `drop_highest`, `calculation_int`, `max_appointments_per_participant`, `min_appointments_per_participant`
- **Tardiness tallies:** `late` ×2, `missing` ×2, `on_time` ×2, `floating` ×2, `total` ×2
- **Not a Canvas field at all:** `CanvasClientConfig.maxPaginationPages` — our own client option, which happens to live in `types.ts`. Out of scope for a different reason than the rest, and worth naming so a future reader does not re-litigate it.

Revision 2 added the last two bullets and the `participations` / `count` / `value` / `total` entries; revision 1's enumeration omitted 10 fields across 7 names. Revision 2 also said the walk finds `points` ×4. With generic descent (§3.0) it finds ×5, and the bullet list above now sums to 119 against the walk's tally (the tally is reproduced by the Appendix A recipe).

The clearest illustration of why this has to be field-level and not type-level: inside one `rules` object, `drop_lowest` and `drop_highest` are **counts** and `never_drop` is a **list of IDs**. Same object, same `number` type, opposite treatment.

### 3.4 Input surface (`src/tools/`)

**Counting rule.** Every `z.number()` `CallExpression` under `src/tools/**/*.ts` that is lexically inside the `inputSchema:` property of a tool definition. Each occurrence is attributed to the **nearest enclosing** property name; an occurrence inside `.array(…)` is tagged as an array *item* and attributed to the array's own property name. ID-named = the attributed name matches `/(^|_)ids?$/i`. Aborts below 100 `inputSchema` sites or 50 ID-named sites.

Under that rule: 318 `z.number()` occurrences in `src/tools/`, of which **308 are inside an `inputSchema`** (the other 10 are a sub-schema constant in `new-quizzes.ts`, one in `grading-standards.ts` and one output field in `output/entities.ts`). Of the 308, **274 are ID-named** and 34 are quantities.

| Declaration | Count | Behaviour on `9007199254740992` |
| --- | --- | --- |
| ID-named `z.number()` with no `.int()` | **222** (206 scalar + 16 array items). This row includes the 7 union number arms of the union row below | Accepted, silently rounded `[P]` |
| ID-named `z.number().int().positive()` | **46** (39 scalar + 7 array items) | Rejected, `too_big` `[P]`. Publishes `exclusiveMinimum: 0, maximum: 9007199254740991` |
| ID-named bare `z.number().int()` | **6** — `grading_period_id` in `assignments.ts:212`, `enrollments.ts:72`, `enrollments.ts:127`, `submissions.ts:75`; `enrollment_term_id` in `enrollments.ts:77`, `enrollments.ts:132` | Rejected, `too_big` `[P]`. Publishes `minimum: -9007199254740991, maximum: 9007199254740991` |
| `z.string()` (standalone, inside `inputSchema`) | **6**: `accounts.ts:115`, `:138` `account_id`; `new-quizzes.ts:189`, `:234`, `:261` `item_id`; `rubrics.ts:76` `criterion_id`. Not counted in the 274 above. | Already strings; not Canvas precision risks. Leave alone (§4.4). |
| `z.string()` outside `inputSchema` | **2**: `new-quizzes.ts:12` `id`, `:17` `correct_choice_id`, both in the New Quizzes sub-schema constant | Out of scope for tool inputs. Listed so that no `z.string()` ID is unaccounted for. |
| `z.union([z.number(), z.string()])` | **7** call sites: `enrollments.ts:123` `user_id`; `outcomes.ts:190`, `:235`, `:296` `user_ids`; `outcomes.ts:337` `student_ids`; `submissions.ts:58` `student_ids`; `users.ts:143` `user_ids`. Already accept strings — but for Canvas's `"self"` / `"all"` sentinels, not for precision (§4.2). | **Subset, not an addition.** The number arm of each site is one of the 222 above; the string arm is one of the 7 nested string branches in §4.4. Not added to the 274. |

Revision 1 published `196` and `20` from a line-oriented grep whose rule was never stated; QA reproduced those same figures with a multi-line grep. The AST rule above supersedes both — a grep counts declaration *lines*, the walk counts `z.number()` *occurrences*, so array items and nested union members are visible to it. The conclusion is unchanged and if anything stronger: **81% of ID-named input sites have no integrality or range check at all.** The bare-`.int()` split matters only for §9, where it decides which JSON Schema keyword each site publishes today; revision 1 attributed the bare form's `minimum` to the recommended schema, which is QA F2.

The first three rows partition the 274 ID-named number occurrences (222 + 46 + 6 = 274). The union row is a subset of the first row and is not added. Revision 2 said "7 call sites", which the re-derivation confirms. QA's list of six union sites omits `enrollments.ts:123`, although QA's own nested-string list includes it (QA BRU-2736 finding 5, §13). The string rows are counted against `inputSchema` scope, as stated above; the two outside it are listed separately.

`z.number()` also accepts `1.5` and `1e21` `[P]`, so these 222 occurrences have no integrality check at all, not merely a missing range check.

### 3.5 Other affected surfaces

- `src/canvas/client.ts` — 3 duplicated header blocks; `response.json()` on all 3 paths.
- `src/canvas/query.ts` — `CanvasQueryPrimitive` **already** includes `string`, and `appendCanvasQuery` already does `String(item)`. **No change needed** for string IDs (§6 item 2).
- `src/pseudonym/pseudonymizer.ts` — 5 widening errors; keys on `user_id`.
- `src/tools/output/entities.ts` — the compile-time bridge; 1 widening error (§7.2).
- `docs/generated/tool-manifest.json` — does **not** embed schema shapes. Each entry carries `name`, `title`, `domain`, `description`, `annotations`, `access`, `primaryAudience`, `relatedWorkflows` and a boolean `structuredOutput`. So neither the Phase 1 input-schema change nor the Phase 2c output widening requires regeneration; only a *description* change or a tool newly gaining an output contract does. Open question 5 is the case that would drag this file in.
- Tests — the figure of **15** new type errors, all in `tests/tools/submissions-awaiting-grading.test.ts`, is **unverified** in revision 4 (QA BRU-2738, finding 7). It came from a probe whose tsconfig is not recorded here, and it was not reproduced. The repo's `tsconfig.json` sets `"exclude": ["node_modules", "dist", "tests"]`, so `pnpm typecheck` never reports test type errors either way. The real test cost is runtime fixture updates, which is scoped per PR in §8.

### 3.6 Canvas module ID parameters — the input side's sink (QA F1) `[S]`

Revision 1 had no inventory of this surface, because correction 6 had (correctly) measured that *response* widening does not touch it, and then over-generalised. The input migration lands here.

**Counting rule (revision 4).** Over every `src/canvas/*.ts` except `types.ts` (30 files; the denominator is 30, not 29): a declaration site counts iff (a) it is a function / method / constructor `Parameter`, or a `PropertySignature` anywhere in the file (interface, type alias, or inline parameter object type such as `params: {…}` or `options?: {…}`), (b) its declared type admits the `number` keyword after unwrapping parentheses, `T[]`, `Array<T>`, `ReadonlyArray<T>` and `readonly T[]`, and dropping `null` / `undefined`, and (c) its name is ID-shaped — `/(^|_)ids?$/i` or camelCase `/[a-z]Ids?$/`. A literal constituent does not stop a site from counting: `number | 'all'` (`submissions.ts:46`) counts, because the `number` keyword survives.

| Site kind | Count | Declared |
| --- | --- | --- |
| Method / function parameters | **216** | non-union `number` |
| Method / function parameters | 1 | `number[]` (`appointment-groups.ts:86`) |
| Properties | **20** | non-union `number` |
| Properties | **10** | `number[]`, `Array<number>` or `ReadonlyArray<number>` |
| Properties | 2 | `number \| string` — already widened |
| Properties | 6 | `number \| string` in an array — already widened (`outcomes.ts:115,:136,:166,:185`, `submissions.ts:30`, `users.ts:29`) |
| Properties | 1 | `'all' \| number` in an array — `submissions.ts:46` |
| **Total sites admitting `number`** | **256** | **247** non-union `number` (236 bare + 11 `number[]`/`Array<number>`/`ReadonlyArray<number>`; the PR 1c target) + 9 already widened. Across 25 of the 30 files; `client.ts`, `concurrency.ts`, `dashboard.ts`, `index.ts` and `query.ts` have none |

**Reconciling the counts (revision 6).** Revisions 2 to 4 wrote 230, 232, 241 and 256 as a chain of additions, which does not close. The walk's variant counts show what each rule point contributes: dropping `ReadonlyArray` unwrapping removes 9 sites (256 → 247); dropping all 15 inline PropertySignatures removes 15 (256 → 241); dropping both leaves 232. No single-flag variant reproduces 230 or 232, so neither is a baseline. The rule points are:

1. **`ReadonlyArray` was not unwrapped** (QA BRU-2738, finding 2). Without it 9 sites are hidden: 6 `number`, 2 `number | string` and 1 `number | 'all'`, including `users.ts:29`, which QA's list of 8 omits.
2. **Rule (a) reached only interface and type-alias properties**, so it missed inline PropertySignatures: properties of type literals that are not interface bodies. Those hold **15** sites. 11 admit `number` or `number[]`: 7 sit in parameter object types (`modules.ts:65` `prerequisite_module_ids?: number[]`, `outcomes.ts:116` `outcome_ids?: number[]`, `outcomes.ts:102` ×2, `:137`, `:141`, `:184`), and 4 sit in response shapes that `analytics.ts` passes as `paginate<{…}>` type arguments (`analytics.ts:29`, `:42`, `:54`, `:66`). The other 4 admit `number | string` (`outcomes.ts:115,:136,:166,:185`). Rule (a) counts all 15, because each is a `PropertySignature` in `src/canvas/`. The 4 response-shape props are not parameters, and widening them needs the `CourseSearchResult` change in §8 PR 1c.
3. **Literal unions** (`submissions.ts:46`): counted, as above.

The PR 1c guard in §8 therefore asserts that none of the 256 sites still admits the `number` keyword, not that 230 are changed.

**Re-measured on the pinned tree (revision 6).** The walk over `src/canvas/*.ts` except `types.ts`, with rule (a), §3.6's name rule and the unwrapping above, finds 256 sites. Fifteen are inline PropertySignatures: 11 admitting `number` or `number[]`, and 4 admitting `number | string` (item 2 above). The same walk on `d3d3705` gives 256 too, since `src/` is identical to `953cd17`. Per-file counts match the list below. Appendix A gives the recipe.

Per-file concentration (all 256 sites): `outcomes.ts` 27, `new-quizzes.ts` 22, `submissions.ts` 22, `modules.ts` 21, `quizzes.ts` 21, `assignments.ts` 16, `peer-reviews.ts` 13, `analytics.ts` 11, `content-migrations.ts` 11, `discussions.ts` 11, `enrollments.ts` 11, `files.ts` 10, `rubrics.ts` 10; the other 12 files have 8 or fewer. Canonical example: `src/canvas/courses.ts:67` — `async get(courseId: number, opts: GetCourseOptions = {})`.

**What actually goes wrong, and what does not.** Nothing, at runtime, today — and that is the problem. §1 correction 7 measures that the compiler is blind, and that a string ID already reaches the URL byte-exact through the existing `as number` casts because every one of these parameters is only *interpolated* into a template or *forwarded* to `appendCanvasQuery`, which calls `String(value)`. No ID parameter in `src/canvas/` is used in arithmetic, in a comparison, or as a `Map` / `Set` key `[S]`. So the cost of omitting this slice is not a broken call; it is:

1. **A published API that lies.** `canvas-lms-mcp/canvas` is an exported entry point and `CanvasClient` is documented as independently usable. A library consumer reading `get(courseId: number)` will pass a `number` — and so will lose precision on exactly the IDs this design exists to preserve, with the fix shipped and enabled. The MCP surface would be fixed while the library surface stayed broken.
2. **240 `as number` casts on ID-named operands that §4.4 forbids** (Appendix A). Phase 1 cannot honour "no `as number` casts to silence type errors" while those casts stay in place after the signatures widen, so PR 1b removes them. Today the casts compile for one reason: `ToolDefinition.handler` takes `Record<string, unknown>` (`src/tools/types.ts:75`), so each operand is `unknown`, and `unknown as number` is legal. A cast from a *typed* `string` is not: `string as number` is TS2352 under `--strict` (probe, §16 A). The casts are therefore unchecked assertions, and `tsc` cannot flag them.
3. **A silent, unbounded omission.** With no compiler signal and no behavioural test that fails, a partially-done migration is indistinguishable from a finished one. Hence the count-floor guard in PR 1c (§8).

## 4. The canonical identifier contract

### 4.1 Decision: normalize to a decimal string, do not propagate a union

Three candidates were considered. The deciding measurement is that with `type CanvasId = string | number` on **both** sides of a comparison, `a === b` is legal TypeScript and `false` at runtime when the representations differ `[P]`. The compiler catches the *asymmetric* cases (a widened ID flowing into a `number` parameter — 99 of the 103 errors) and is blind to the symmetric ones. Our codebase has, by grep:

- **18** `Map<number, …>` / `Set<number>` occurrences in `src/` (`rg -o '(Map|Set)<number' src`). I did not classify each one as ID-keyed.
- **14** `===` / `!==` comparisons in `src/tools/**` where both operands are ID-named (AST recipe, Appendix A). The same rule over all of `src/` gives 20. The other six are OAuth client/grant and local-config identifiers in `src/auth/` and `src/init/`, not Canvas data. Revision 2 said 13.
- **1** ordering or arithmetic use of an ID-named operand: `a.id - b.id` in `resolved.sort((a, b) => a.id - b.id)` at `src/tools/quiz-question-responses.ts:263`. Revision 2 said 2; the recipe finds 1.
- **4** `Number(...)` / `parseInt(...)` applied to an ID-named operand, over `src/` (AST recipe, Appendix A)

A pervasive union would turn the 14 ID-to-ID comparisons in `src/tools/**` into defects with no compiler signal. A single canonical representation makes them correct by construction, and makes the arithmetic sites fail to compile — which is exactly where a human decision is wanted.

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

One exported builder, used for all 222 un-`.int()` ID sites:

```
canvasIdInput()                       // required ID
canvasIdInput().optional()
canvasIdInput({ sentinels: ['self'] })      // Canvas's "self"
canvasIdList({ sentinels: ['self', 'all'] }) // student_ids / user_ids
```

Accept rules:

1. **Number** — accepted iff `Number.isSafeInteger(v) && v >= 1`. This is exactly `z.number().int().positive()` in Zod 4.6.5, verified `[P]`; do not hand-roll it.
2. **String** — accepted iff it matches `/^[1-9][0-9]{0,18}$/` **and** `BigInt(s) <= 9223372036854775807n`. Both bounds are derived from `lib/api.rb`, not chosen (`ID_REGEX = /\A\d{1,19}\z/`, `MAX_ID = 2**63-1`) `[S]`. **The regex check must carry `{ abort: true }` — see N1 below. This is not a style preference.**
3. **Sentinels** — only the literals a call site explicitly declares. `"self"` and `"all"` are the only ones in use. Verified: `"self"` is accepted where declared and rejected where not `[P]`.
4. **Output of parsing is always the canonical decimal string.** `92` → `"92"`, via `.transform((v) => String(v))` on the union. **The emitted JSON Schema must be requested with `io: 'input'` — see N2.**

#### 4.2.1 Three defects in revision 1's rules, found by executing them `[P]`

These were not in QA's findings; they surfaced while building the boundary table, and each would have shipped into PR 1a as written.

**N1 — the composition in rule 2 throws instead of rejecting, and the throw escapes `safeParse`.** Zod 4 runs *all* checks on a string schema and collects issues rather than short-circuiting, so `z.string().regex(DECIMAL).refine((s) => BigInt(s) <= MAX_ID)` calls `BigInt` on values the regex has already rejected. Measured against 13 hostile strings: **7 throw `SyntaxError: Cannot convert … to a BigInt`** (`"7.0"`, `"1e3"`, `"1_000"`, `"Infinity"`, `"NaN"`, and both non-ASCII digit cases) and the throw propagates out of `safeParse` *and* out of the enclosing `z.union`. On the MCP server, the SDK catches that throw and returns an `isError: true` result whose text is the raw internal message (`Cannot convert 7.0 to a BigInt`), reachable by any caller sending `course_id: "7.0"`. The defect is the wrong error class (no `-32602`) plus the leak of internal text. It is not an uncaught process exception (QA BRU-2736, measured through a real `Client`). Three forms were measured; all 13 hostile strings reject cleanly and all 3 good strings accept under each of:

| Form | Rejects all 13 | Emits `pattern` | Verdict |
| --- | - | - | --- |
| `.regex(D).refine(BigInt…)` | no — **7 throw** | yes | **Do not use.** This is what revision 1 prescribed. |
| `.regex(D, { abort: true }).refine(BigInt…)` | yes | yes | **Recommended.** |
| `.regex(D).refine((s) => D.test(s) && BigInt(s) <= MAX)` | yes | yes | Works; the duplicated guard is easy to drop in a later edit. |
| `.refine((s) => D.test(s) && BigInt(s) <= MAX)` (no `.regex`) | yes | **no** | Rejects correctly but publishes no `pattern`, defeating §9. |

PR 1a must include a test that sends each of the 7 throwing inputs through a real `Client` and asserts a `-32602`, not merely that `safeParse` returns `success: false` — a `safeParse` assertion in a `try` block would pass on the broken form.

**N2 — rule 4's transform breaks `toJSONSchema` under its default mode.** With `.transform((v) => String(v))` attached, `z.toJSONSchema(schema)` throws `Transforms cannot be represented in JSON Schema`; it succeeds only with `{ io: 'input' }` `[P]`. We are safe today *by accident*: `@modelcontextprotocol/sdk` 1.32.0 (the lockfile version) converts tool input schemas with `io: opts?.pipeStrategy ?? 'input'` (`dist/esm/server/zod-json-schema-compat.js:23`) `[S]`, and an end-to-end `listTools()` with the transform in place returns the expected `anyOf` for `get_course.course_id` `[W]`. Because that default is the only thing standing between us and a total `tools/list` outage, PR 1a must assert the published schema through a real `Client` — not by calling `toJSONSchema` itself, which would be testing our own call, not the SDK's.

**N3 — the rejection message below is not achievable with a union-level `error`.** A custom `error` on the `z.union` reaches the *string* branch's failures and produces the required text verbatim `[P]`. It does **not** reach the number branch: `z.number().int().positive()` reports its own `too_big` / `too_small` issues directly, so `9007199254740992` yields `Too big: expected int to be <=9007199254740991` — which names neither the received value nor the remedy, and is the single most important message in the design, since it is what a caller hitting the precision bug actually sees. Observed end to end: `MCP error -32602: … Too big: expected int to be <=9007199254740991 at course_id` `[W]`. The builder must therefore set the message on the **number member** (on both its `.int()` and `.positive()` checks) as well as on the union. The string arm's `.refine` range check has the same gap: a union-level `error` does not reach it, so `"9223372036854775808"` (`> MAX_ID`) yields `Invalid input` (QA BRU-2738, reproduced in revision 4 with Zod 4.6.5: without a message on the refine it reports `custom` / `Invalid input`; with `{ error }` on the refine it reports the custom message). The refine needs its own message too.

Rejection message must name the offending value and tell the caller what to do, e.g.
`course_id must be a Canvas ID: a positive integer at or below 9007199254740991, or a decimal string for larger IDs (received 9007199254740992). Pass large IDs as strings, e.g. "9010000000000001".`

#### 4.2.2 Boundary table

These are the compatibility test cases. Every row below was executed against the recommended form (`z.union([z.number().int().positive(), z.string().regex(/^[1-9][0-9]{0,18}$/, { abort: true }).refine(BigInt(s) <= MAX_ID)])`) `[P]`; the codes column is the nested set of Zod issue codes observed (`ZodError.issues`, with each `invalid_union`'s `errors` flattened in), which is what a test should assert on rather than message text. Revision 3 re-ran every row `[P]` against Zod 4.6.5, and two properties of the set matter for the tests:
>
> - **The string arm is not the whole set.** For a hostile string, the number arm also reports `invalid_type`, so a test that asserts only the string leaf (`invalid_format`) is incomplete. Strings that pass the pattern but exceed `MAX_ID` report `custom` alone, because the number arm does not run on them.
> - **The top level depends on the input.** An out-of-range integer (`9007199254740992`, `0`, `-7`) surfaces as a top-level `too_big` / `too_small` with no union wrapper. A non-integer number and every rejected string surface as a top-level `invalid_union`. Revision 2 described every numeric row as `invalid_union`; that holds only for the non-integers (QA BRU-2736 finding 7, §13).

| Input | Verdict | Issue codes (nested set, see note below the table) | Why |
| --- | --- | --- | --- |
| `1` | accept → `"1"` | | |
| `9007199254740991` | accept → `"9007199254740991"` | | `Number.MAX_SAFE_INTEGER`, exact |
| `9007199254740992` | **reject** | `too_big` (top level; no union wrapper) | `2**53`; first value a JS number cannot distinguish from its neighbour |
| `9007199254740993` | **reject** | `too_big` | arrives as `…992`; the original is unrecoverable |
| `0`, `-7` | **reject** | `too_small` | no Canvas object has a non-positive ID |
| `7.5` | **reject** | `invalid_union` ⊃ {`invalid_type`} | not an integer (the number arm reports the *type* as invalid, not the format) |
| `Infinity`, `-Infinity`, `NaN` | **reject** | `invalid_union` ⊃ {`invalid_type`} | **Added in revision 2 (QA F6).** Not reachable over the MCP wire — `JSON.parse('{"course_id":Infinity}')` and the `NaN` form both raise `SyntaxError`, and `JSON.stringify` emits `null` for them `[P]`. They are in the table because the builder is exported and callable in-process, so the contract has to cover them. |
| `"9007199254740992"` | accept | | exact as a string |
| `"9223372036854775807"` | accept | | `= MAX_ID` |
| `"9223372036854775808"` | **reject** | `custom` | `> MAX_ID`; Canvas cannot hold it. Note this is the `.refine`, not the regex — a 19-digit string passes the pattern |
| `"12345678901234567890"` | **reject** | `invalid_union` ⊃ {`invalid_type`, `invalid_format`} | 20 digits; `MAX_ID_LENGTH = 19` |
| `"9010000000000001"` | accept | | the shard-901 case from §2.1 |
| `"0"`, `"-7"` | **reject** | `invalid_union` ⊃ {`invalid_type`, `invalid_format`} | as above |
| `"007"` | **reject** | `invalid_union` ⊃ {`invalid_type`, `invalid_format`} | Canvas tolerates leading zeros (`\d{1,19}` then `.to_i`), **we do not** — one object must have exactly one canonical string, or `Map` keys fork and §4.1 is defeated |
| `"7.0"`, `"1e3"`, `" 7"`, `"7 "`, `"1_000"` | **reject** | `invalid_union` ⊃ {`invalid_type`, `invalid_format`} | not canonical decimal |
| `"+7"` | **reject** | `invalid_union` ⊃ {`invalid_type`, `invalid_format`} | **Added in revision 2 (QA F6).** Explicit sign; `[1-9]` does not match `+` |
| `""` | **reject** | `invalid_union` ⊃ {`invalid_type`, `invalid_format`} | **Added in revision 2 (QA F6).** The pattern requires at least one digit |
| `"Infinity"`, `"NaN"` | **reject** | `invalid_union` ⊃ {`invalid_type`, `invalid_format`} | **Added in revision 2 (QA F6).** The string forms, unlike the numbers, *are* reachable over the wire |
| `"٧٧"` (U+0667 Arabic-Indic) | **reject** | `invalid_union` ⊃ {`invalid_type`, `invalid_format`} | **Added in revision 2 (QA F6).** `[0-9]` in a JS `RegExp` is ASCII-only with or without the `u` flag, so no non-ASCII digit can match. Canvas's `\d` is likewise ASCII-only. |
| `"７"` (U+FF17 fullwidth) | **reject** | `invalid_union` ⊃ {`invalid_type`, `invalid_format`} | **Added in revision 2.** The other common non-ASCII digit family; included because a fullwidth string is what a CJK IME produces, so it is the plausible accident rather than a contrived one |
| `"self"` | accept **only** where declared | `invalid_union` otherwise | Verified both ways `[P]` |

### 4.3 Response normalization

Applied once, in the HTTP client, to every parsed body, on all three request paths:

```
normalizeCanvasIds(value)  // in-place walk, Integer -> canonical string
```

Key policy = Canvas's two regexes (`/(^|_)id$/i` scalar, `/(^|_)ids$/i` on arrays) **plus** an explicit, commented allowlist of all **12** §3.2 misses: `never_drop`, `assignment_visibility`, `assignments` (on `CanvasGradebookHistoryGrader` only), `CanvasOutcomeRollup.links.{course,user,section}`, `courseId`, `answer` (on `CanvasQuizSubmissionQuestion` only), `CanvasOutcomeResult.links.{user,learning_outcome,alignment}`, and `CanvasOutcomeRollupScore.links.outcome`. Revision 1's allowlist had 6 of the 12; the four outcome-link entries added in revision 2 are the ones that would have left two sibling `links` objects normalized differently from a third.

Three properties this must have, each because the alternative is a measured failure mode:

- **It must run whether or not the header was sent.** Then `never_drop` and friends are normalized in both modes, the §2.3 divergence cannot occur, and the header becomes a pure precision improvement rather than a semantic change.
- **The allowlist must be path-scoped, not name-scoped**, for `assignments` and `answer`. A bare name match on `assignments` would stringify unrelated nested assignment *objects*' sibling keys; a bare `answer` match would stringify free-text answers. The over-match risk on the two regexes is zero (§3.1); it is **not** zero on the allowlist.
- **It must be measured for cost before Phase 2 merges.** A walk over every response body on a 1000-page paginated read is the one part of this design whose cost I have not measured. Open question 3.

### 4.4 What the migration must not do

- **No `as number` casts to silence the 103 type errors.** Each one is a site where an ID meets numeric code; the fix is to make the consumer string-keyed, not to re-narrow. **This rule also governs the input side, where the compiler will not enforce it** (§1 correction 7): the 240 `as number` casts on ID-named operands in `src/tools/**` (268 `as number` casts in total; Appendix A) compile whatever the schema says, so PR 1b/1c must be gated by a source-level guard rather than by `tsc`.
- **No `Number(id)` to make a `Map` work.** That reintroduces the rounding at the exact point the design exists to remove it.
- **No mechanical find-and-replace of `z.number()` → `canvasIdInput()`.** It would strip the `"self"` / `"all"` sentinels from the 7 union call sites and break tools that work today, and it would wrongly convert the 6 standalone `z.string()` ID fields in `inputSchema` and the 7 string branches nested in union sites (§3.4), and it must not touch `.int()` params that are *quantities* rather than identifiers (`teacher_limit`, `per_page`-style limits) even though they look identical in a diff.

### 4.5 Measured blast radius of the response-side widening `[P]`

Codemod: widen all **130** header-converted ID leaves in `src/canvas/types.ts` to `CanvasWireId`, then typecheck. Baseline is 0 errors. Revision 1 said 129 here and 130 in §3.1; 130 is correct and is what the codemod edits. Re-run in revision 2 against the base SHA — **130 edits, 103 errors, restored byte-identical, baseline back to 0** — and the recipe is in Appendix A, so this table is no longer an unreproducible transcript (QA F4).

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
| `tests/` | 15, all in one file — **unverified** (§3.5) |

By kind: 61 `TS2345` (ID into a `number` parameter), 38 `TS2322` (assignment), 1 `TS2362` + 1 `TS2363` (arithmetic operands), 1 `TS2769` (overload), 1 `TS2344` (the `entities.ts` bridge) = 103. The tail of "9 more files" is `assignment-overrides.ts` 4, `submissions-awaiting-grading.ts` 4, `attention.ts` 3, `grade-engine.ts` 3, `submission-files.ts` 3, `grade-explanation.ts` 2, `grading-policy.ts` 2, `grade-projection.ts` 1, `output/entities.ts` 1. **This is a transcript, not an estimate** — the codemod ran, and `types.ts` was restored to byte-identical afterwards (asserted by a byte comparison, with the baseline re-verified at 0).

Two things this measurement is *not*. It is not a measure of the input migration — that is §3.6, and the compiler reports **0** there (§1 correction 7). And 6 of the 130 widened leaves are on `*Params` request interfaces rather than response types, so the strictly-response count is 124; the codemod widens all 130 because the §4.1 contract is one representation in both directions.

## 5. Where to send the Accept header

Canvas gates on `request.headers["Accept"]&.include?("application/json+canvas-string-ids")` — a **substring** test, so `Accept: application/json+canvas-string-ids, application/json` works and a plain `application/json` fallback can be kept in the same header (`application_controller.rb:2978`, inside `stringify_json_ids?`, consumed by `json_cast` (defined `:2981`) at `:2983`) `[S]`. Revision 1 cited `:2977`; re-checked by fetching the file at the pinned SHA, where `canvas-string-ids` occurs exactly once, on line 2978 (QA F5).

| Path | Send it? | Why |
| --- | --- | --- |
| `CanvasHttpClient.request()` | **Yes** | 150 non-quiz `request` / `paginate` / `paginateEnvelope` call sites in `src/canvas/*.ts` route through here or through the paginators. 161 call sites in total, 11 of them New Quizzes (Appendix A). Revision 2 said 144. |
| `CanvasHttpClient.paginate()` | **Yes** | Separate `fetch`; `Link`-header URLs are followed with the same header block, so the header must be inside the loop. |
| `CanvasHttpClient.paginateEnvelope()` | **Yes** | Same. |
| `/api/quiz/v1` (New Quizzes, **11** request call sites) | **No** | `json_cast` is an `ApplicationController` concern, and a code search for `quiz/v1` under `config/` at the pinned SHA returns 0 matches, so these are served by the separate New Quizzes service `[S]`. Our types already reflect that it answers differently: `CanvasNewQuizItem.id` is `string` while `CanvasNewQuiz.id` is `number`. Exclude by path prefix, with a comment, and confirm against a live instance before relying on it. Open question 2. Revision 1 said 12; the file has exactly **11** `this.client.request` / `paginate` calls and 11 `/api/quiz/v1` template occurrences, one per call (QA F5). Two further `quiz/v1` string occurrences live in `src/tools/errors.ts` and are not request sites — worth noting, because a grep for the path prefix returns 13. |
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

Each phase is independently shippable and independently revertable. Phase 1 and Phase 2 do not depend on each other — correction 6 as **narrowed in revision 2**: PR 2a's response widening needs no `src/canvas/` signature change, and PR 1c's signature change needs no response widening, so the two touch `src/canvas/` in disjoint ways (types vs. parameters) and can run in parallel if two agents are free. Phase 2's PRs remain strictly ordered among themselves, and Phase 1's are now 1a → 1c → 1b.

### Phase 0 — XS, 1 PR: stop the bleeding on the 52 that already work

Nothing to build. Add `tests/canvas/id-precision.test.ts` asserting the §2.2 wire behaviour **as it is today**, i.e. a characterization test that records the defect, plus the 52 `.int()` sites rejecting `2**53` (§3.4), including all 6 bare-`.int()` sites, so the §9 keyword split is recorded as it stands today. Red-first is impossible here by construction; label these as characterization tests in the PR so `+N tests` is not read as `+N red`.

### Phase 1 — M, 3 PRs: the input side

**PR 1a — the canonical input type.** Add `src/canvas/id.ts` with `canvasIdInput()`, `canvasIdList()`, `normalizeCanvasIdInput()` and the §4.2 rules. Tests: the full §4.2.2 boundary table as a table-driven test, every row red-first against a stub that returns the input unchanged. Plus a sentinel test, and these three, each of which exists because revision 1's rules failed it (§4.2.1):
- The 7 N1 inputs (`"7.0"`, `"1e3"`, `"1_000"`, `"Infinity"`, `"NaN"`, and both non-ASCII digit cases) sent through a real `Client`, asserting a `-32602` **error result** rather than a `safeParse` verdict. Prove it is load-bearing by reverting `{ abort: true }` and showing these 7 — and only these 7 — fail.
- The published schema read back from `listTools()` on a real `Client` with the transform attached (N2), asserting the exact `anyOf` body. Not `z.toJSONSchema` directly: that tests our call, not the SDK's.
- The rejection message for an **unsafe number** (N3), asserting it names the received value and the string remedy. Revert the number-member error and watch only this one fail. Add the same assertion for `"9223372036854775808"` (the string `.refine`, N3), and revert the refine's error to show that case alone fails.

**PR 1b — adopt it across the 222 un-`.int()` ID sites.** Mechanical in volume, non-mechanical in judgement: see §4.4 for the three things a codemod gets wrong. Required:
- A coverage test that fails if any ID-named param in any tool is declared `z.number()` without going through `canvasIdInput()`. Enumerate from the **real registry** via `tools/list` on both server configurations (default and the role-filtered one), not from the default config only — an earlier guard in this repo was blind to 2 of 165 tools for exactly that reason.
- An anti-vacuity floor on that enumeration, split per configuration so re-narrowing the guard fails attributably.
- Handler updates where a handler currently relies on receiving a `number` (e.g. `src/tools/grading-standards.ts:169` casts `params.grading_standard_id as number | null`).
- **Cast removal is in this PR (moved from PR 1c in revision 6; §16 A).** Each `as number` / `as number | null` on an ID-named operand in `src/tools/**` (240 direct casts, Appendix A) becomes `as CanvasId` / `as CanvasId | null`. It needs PR 1c to land first, because the signatures these casts feed must accept `CanvasId`. It is not a bare retype. On top of PR 1c, a naive retype of the 240 gives 27 `tsc` errors in 12 files, all tool-layer locals or helper parameters still typed `number`: `accessibility-audit.ts` ×2, `assignment-overrides.ts` ×3, `course-setup.ts`, `discussions.ts` ×2, `files.ts`, `grade-explanation.ts` ×2, `grade-projection.ts` ×2, `gradebook-history.ts` ×2, `grading-standards.ts`, `link-audit.ts` ×5, `quiz-question-responses.ts` ×3, `student.ts` ×3. This PR fixes them with `CanvasId` on those locals and parameters. The schema half is measured separately: `get_account`'s schema as `z.string()`, with its cast unchanged, gives 0 errors (one tool; the other 221 sites are not probed).

**PR 1c — widen the Canvas module ID parameters (new in revision 2; QA F1; moved before PR 1b in revision 6).** Change the 247 non-union `number` ID declaration sites in §3.6 to `CanvasId`, and normalize the 9 already-widened sites to `CanvasId` / `CanvasId | 'all'` (256 in all). This is the slice revision 1 omitted. Widening is not silent, so five sites need fixing in this PR. `src/canvas/quizzes.ts:127` is a request body typed `Record<string, number>`; it becomes `Record<string, number | string>`. The analytics rows at `analytics.ts:33,:46,:58,:70` are assigned into `CourseSearchResult[]` (`src/canvas/types.ts:1026`), so `CourseSearchResult.id` and `.course_id` widen to `CanvasId`. That is a response type, the one exception to §1 correction 6's separation, and Phase 2 must not widen it again. Measured on the pinned tree: with those five fixes, widening the 256 sites gives `tsc` 0 errors. The PR changes no schema and no cast, so no runtime value changes. It is compile-clean on its own and does not depend on PR 1b. Two properties make this PR unusual and dictate how it is gated:

- **`tsc` reports nothing for the schema widening** (§1 correction 7), so a half-finished PR 1b is invisible there, and
- **no behavioural test can fail**, because a string ID already reaches the URL byte-exact through the existing casts `[W]`.

So the gate is a **source-level AST guard**, not a wire test:
- Fail if any declaration site matching §3.6's rule (revision 4 rule, 256 sites) still admits the `number` keyword — i.e. assert the count is **0**, derived by the same walk, not from a hand-maintained list.
- Pair it with an anti-vacuity floor on the *total* number of ID declaration sites the walk finds (`>= 200`; the walk finds 256), so a traversal that silently stops resolving reports 0 remaining for the wrong reason. Prove the floor is load-bearing by pointing the walk at an empty directory and watching the floor — not the zero-assertion — fail.
- **PR 1b only:** fail if any `as number` / `as number | null` cast remains on an ID-named value in `src/tools/**`, which is §4.4's rule made mechanical. The guard ships with the cast removal it polices. Prove it by restoring one cast and watching exactly that one site be named.
- Add one import-level assertion that the **published** `CanvasClient` signatures accept a string, by `npm pack`-ing the tarball into a throwaway consumer that calls `canvas.courses.get("9010000000000001")` and typechecks. Reading `exports` and the emitted `.d.ts` gets close; only this distinguishes "declared" from "actually reachable through the package entry point", which is the whole justification for this PR.

### Phase 2 — L, 3 PRs, strictly ordered: the response side

**PR 2a — normalization, no header.** Add `normalizeCanvasIds()` and call it on all three client paths **unconditionally**. Widen the 130 fields to `CanvasWireId` inside `types.ts` only, and export the 130 as `CanvasId` (string) post-normalization. Fix all 103 type errors per §4.4 — no casts. Tests:
- The §2.3 grade scenario as a regression test, asserting `47.5` both with and without a stringified payload. Inject the bug (drop `never_drop` from the allowlist) and show exactly that test going red and nothing else.
- A fixture round-trip for each of the **12** §3.2 misses (8 interface rows), with a count-floor assertion on the allowlist so an entry cannot be silently dropped. Revision 1 said 6; see §3.2.
- A test asserting the **119** excluded quantities (§3.3) are **unchanged** by the walk, with `drop_lowest` / `never_drop` in the same object as the headline case.
- A cost measurement for the walk (open question 3), reported in the PR body.

**PR 2b — the header, behind a flag.** `CANVAS_STRING_IDS=true` (byte-exact `=== 'true'`, no normalization of the flag value — every trim/lowercase step widens the set of strings that accidentally enable it). Exclude `/api/quiz/v1` by path prefix. Tests: the header is present on all three paths and on followed `Link` URLs; absent for `/api/quiz/v1`; absent when the flag is off. Prove against the built `dist/`, not just `src/`.

**PR 2c — structured output + docs.** Widen `page_id` in `entities.ts` to the union per §7.2, add fixtures with a value above `2**53`, update `README.md` and `docs/` for the flag. Check the lint script's file scope first: `prettier --check src/ tests/` deliberately excludes `README.md`, and reflowing it has previously broken `tests/docs/tool-count-consistency.test.ts`.

### Phase 3 — S, 1 PR: default-on

Flip the flag's default after at least one minor release of field exposure. Needs the §7.3 release decision first.

### Compatibility tests required in every phase

Values used must be above `Number.MAX_SAFE_INTEGER`, and the canonical fixture should be the shard-901 case `9010000000000001` so the test name explains *why* the value is large. Required assertions:

1. Input: `"9010000000000001"` reaches the URL byte-exact, through a real `Client` over `InMemoryTransport`, with `listTools()` called first to arm the SDK validator cache. A probe that skips `listTools()` goes green while the payload is broken for every real client. **Lands in PR 1b, not 1c, and is explicitly not PR 1c's gate (QA F1).** Measured: with only `get_course.course_id` widened and `src/canvas/` untouched, this assertion already passes — `GET /api/v1/courses/9010000000000001` `[W]`. It proves the *schema* change; §3.6's AST guard is what proves the *signature* change. Writing it as PR 1c's acceptance criterion would hand over a vacuous gate.
2. Input: `9007199254740992` is rejected, with the message naming the value.
3. Pagination: the exact ID survives a followed `Link` URL.
4. JSON body: the ID is emitted as a JSON **string** (§2.4).
5. Response: a stringified payload round-trips to `"9010000000000001"`, and the same payload unstringified round-trips to the same canonical string.
6. Negative control for every "no request was made" assertion: the same call under a permissive configuration must show the request *was* attempted, or the safety test passes on a server that is broken for an unrelated reason.

## 9. MCP / JSON Schema client compatibility

**The answer is empirical, not predictive: we already ship this construct.** A census of every `inputSchema` and `outputSchema` returned by `tools/list`, through a real `Client` against the built `dist/` at `origin/main` @ `5740739` (aborting below 100 tools), finds across **165** tools `[W]`:

| Keyword | Occurrences today |
| --- | - |
| `type: [a, b]` union nodes | 38 |
| `anyOf` | 1 |
| `oneOf` | 4 |
| `exclusiveMinimum` | **49** |
| `maximum` | **69** |
| `minimum` | 22 |
| `pattern` | **6** |
| `type: "integer"` | 67 |

It has shipped for months with no reported client incompatibility.

Two shapes are available and they are not equivalent. The emitted bodies below were re-derived by calling `z.toJSONSchema` on zod 4.6.5 at the pinned base, and the recommended row was then confirmed on the wire by widening one real tool and reading the published schema back from `listTools()` `[W]`:

| Shape | Emitted JSON Schema | Assessment |
| --- | --- | --- |
| `z.union([z.number(), z.string()])` | `{"type":["number","string"]}` | What we ship today on the 7 union sites. Maximally compatible, but publishes **no** bounds and no pattern, so it tells a client nothing about what is valid. |
| `z.union([z.number().int().positive(), z.string().regex(...)])` | `{"anyOf":[{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},{"type":"string","pattern":"^[1-9][0-9]{0,18}$"}]}` | **Recommended.** Self-documenting, and every keyword in it is already published: `exclusiveMinimum` 49×, `maximum` 69×, `pattern` 6×, `anyOf` 1×. Nothing here is new to our surface. |
| `z.union([z.number().int(), z.string().regex(...)])` | `{"anyOf":[{"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991},{"type":"string","pattern":"^[1-9][0-9]{0,18}$"}]}` | Not recommended — admits `0` and negatives, which §4.2 rejects. Shown because this is the body revision 1's table printed while §4.2 prescribed `.positive()`, which is QA F2. |

**Correcting revision 2's own inherited error, and QA's.** Revision 1's table attributed `minimum: -9007199254740991` to the recommended schema; that keyword comes from a **bare** `.int()`, and `.int().positive()` emits `exclusiveMinimum: 0` instead `[P]`. The compatibility conclusion survives, but on different evidence than revision 1 gave: it rests on `exclusiveMinimum` appearing 49 times today, not on `minimum` appearing at all. QA's review added that only **1** of the `.int()` ID params is bare; the AST walk finds **6** (§3.4) — four `grading_period_id` and two `enrollment_term_id`, which a single-line grep misses because all six are multi-line declarations.

Host-specific risks, with what is and is not known:

- **Draft dialect.** This repo installs a schema-dialect compatibility shim (`installSchemaDialectCompat`) after issue #341, because a client rejected a construct emitted under one dialect. Phase 1 must assert that the new ID schema's **body is identical** under `draft-7` and `draft-2020-12`, with the `$schema` keyword excluded, by asking the SDK's own converter for both forms and diffing the results — not by maintaining a keyword allowlist. The `$schema` keyword is *not* identical, and the test does not claim it is: zod 4.6.5's own converter emits `$schema: "http://json-schema.org/draft-07/schema#"` for draft-7 and `$schema: "https://json-schema.org/draft/2020-12/schema"` for 2020-12 (probe, re-run in revision 5 on `z.number().int()`; the SDK converter, which Phase 1 must diff, may differ). The test asserts each dialect's `$schema` value separately. Pair the body diff with a construct that *does* diverge (a `z.tuple`) so the comparison cannot be vacuous.
- **Strict validators.** `Ajv2020({strict: true})` rejects `type: [a, b]` under `strictTypes`. That is Ajv's opinion, not the standard, and it already applies to our 38 existing nodes; the `anyOf` form above avoids it entirely, which is a further reason to prefer it.
- **Unknown.** Whether any specific host coerces a JSON number in tool arguments before the server sees it. Our own wire shows the SDK does not — it hands the handler whatever `JSON.parse` produced `[W]` — but a host that re-serializes arguments through its own pipeline could round a large number before it reaches the transport. In that case the string form is the *only* reliable path, which is an argument for documenting "pass large IDs as strings" in the tool descriptions rather than relying on numeric input at all. Open question 5.

## 10. Rollback

- **Phase 1** — the order is 1a, then 1c, then 1b (§8), so rollback runs in reverse. Revert PR 1b first. That restores `z.number()` on the 222 ID sites and the `as number` casts, which compile against the widened signatures. PR 1a is additive and can stay. PR 1c can revert only after 1b, because its `as CanvasId` casts would then feed `number` signatures, which is the TS2345 measured in §16 A. No data or on-disk state is involved. Published input schemas revert to `{"type":"number"}`, a widening, so no client breaks on the way back.
- **Phase 2** — PR 2b is a flag flip: setting `CANVAS_STRING_IDS` to anything other than `true` restores the current wire immediately, with no redeploy of code. PR 2a is **not** flag-gated by design (that is the point — the normalization must hold in both modes), so rolling it back means reverting the response ID types, which is a type-level breaking change in the reverse direction. Treat PR 2a as the commitment point.
- **Phase 3** — reverting the default is a one-line change, but by then consumers may depend on string IDs; a revert is itself breaking. This is why Phase 3 wants the release decision up front.
- **Not rollback-able:** any ID that was already written to Canvas via a rounded value. There is no audit trail of past rounding, and nothing in this plan can reconstruct it. Phase 0's characterization test is the closest thing to a record.

## 11. Open questions

These are decisions I did not make. Each changes behaviour, a public contract, or a release.

1. **Does Phase 3 ship as a major, or does the flag become permanent?** Default-on changes every ID's type for every consumer of the published types, the structured output and the text payload. A permanent flag avoids a major but leaves two supported shapes forever. **CTO / board.**
2. **Does `/api/quiz/v1` honour the header?** §5 excludes it on the basis of a 0-match code search plus our own heterogeneous types, which is suggestive, not conclusive. Settling it needs one request against a live instance with New Quizzes enabled — out of scope here. If it *does* honour it, the exclusion becomes a bug. **Needs a live instance.**
3. **What does the normalization walk cost on a large paginated response?** The one unmeasured item in this design. It must be measured in PR 2a and reported, not assumed. If it is material, the alternative is a per-field normalization at the ~130 declaration sites, which is more code but zero per-response cost. **Lead Developer, in PR 2a.**
4. **Brand `CanvasId` nominally, now or in Phase 3?** A brand makes "a raw string used as an ID" a compile error, which is the strongest version of §4.1 — at the cost of an explicit construction at every call site in one PR. Recommended for Phase 3, not Phase 1.
5. **Do we tell callers in the tool descriptions to pass large IDs as strings?** Up to 165 tool descriptions, and `docs/generated/tool-manifest.json` embeds every description, so this drags a frequently-contended generated file into the diff. Worth doing only if §9's host-coercion risk is judged real. **CTO.**
6. **Should `0` be accepted as an ID?** I reject it (§4.2). Canvas's `ID_REGEX` would accept `"0"`, and I know of no Canvas object with id 0, but I did not prove none exists.

## 12. Revision 2 correction matrix (QA BRU-2734 → BRU-2735)

QA's first-pass review of PR #382 at head `36e9048` returned CHANGES REQUIRED with findings F1–F6. All six are addressed below; two are addressed in a form that differs from the one QA proposed, and in both cases the difference is a measurement, stated as such. Three further defects (N1–N3) were found in revision 1's own §4.2 while executing its rules.

| # | Finding | Disposition | Where |
| - | --- | --- | --- |
| **F1** | Response widening "never touches `src/canvas/`" is generalised into the input side; no inventory of Canvas module ID parameters; acceptance test 1 unanchored. | **Accepted, and the mechanism corrected.** New §3.6 inventories **230** ID declaration sites typed `number` under a stated rule; §1 correction 6 is struck and narrowed; §1 correction 7 is new; Phase 1 gains **PR 1c**. **Differs from QA on two points, both measured:** (a) QA's third branch, "or a `tsc` failure", does not exist — handlers are `(params: Record<string, unknown>)`, so widening a schema yields **0** `tsc` errors against a 0 baseline `[P]`; the failure is silent. (b) QA's proposed gate — tying the byte-exact test to the slice — would be **vacuous**: with only the schema widened and `src/canvas/` untouched, `"9010000000000001"` already reaches the URL byte-exact `[W]`. PR 1c is therefore gated by a source-level AST guard plus a packed-tarball consumer typecheck. QA's count was 197; the stated rule gives 230. | §1 (6, 7), §3.6, §4.4, §8 (PR 1c, test 1) |
| **F2** | §9's recommended schema is printed with `minimum: -9007199254740991`; the bare-vs-`.positive()` split is not accounted for. | **Accepted in full.** §9's table now shows `exclusiveMinimum: 0, maximum: 9007199254740991` for `.int().positive()`, keeps the bare-`.int()` body as a third, explicitly-not-recommended row, and rests the compatibility conclusion on a census of what we publish today (49 `exclusiveMinimum`, 69 `maximum`, 6 `pattern`, 1 `anyOf` across 165 tools `[W]`) rather than on `minimum`. **One correction to QA:** the bare-`.int()` ID sites number **6**, not 1 — four `grading_period_id`, two `enrollment_term_id`, all multi-line declarations that a line-oriented grep misses. | §1 (2), §3.4, §9 |
| **F3** | The 283 / 153 / 147 totals do not reproduce; the counting rule is unstated; "6 misses" undercounts. | **Accepted; totals replaced and the rule stated.** New §3.0 states the strict leaf rule including the `Record<string, number>` decision; totals are now **261 / 130 / 131**, of which **12 identifiers** and **119 quantities** (revision 3; see §3.0). §3.3's enumeration gained 10 fields across 7 names it had omitted, and `points` is ×5, not the ×4 that revision 2 wrote (§3.0). **Differs from QA:** the ID-bearing non-converting set is **12 fields in 8 rows**, not 8 in 6 — the four neither count included are `CanvasOutcomeResult.links.{user,learning_outcome,alignment}` and `CanvasOutcomeRollupScore.links.outcome`, which revision 1 mentioned in prose without counting, and which is how they were missing from the §4.3 allowlist. Revision 2's 260 was wrong and QA's 261 is right (§3.0); **both walks agree exactly on 130 converting fields**, the only figure any plan step consumes. | §3.0, §3.2, §3.3, §4.3, §8 |
| **F4** | The 47.5 / 92.5 and 103-error numbers exist only in deleted transcripts. | **Accepted; both are now reproducible, and the PR stays design-only.** §2.3.1 carries the complete grade-hazard probe in-line — deterministic, offline, calling the exported `computeGroupGrade` with no `fetch` stub — together with its verbatim output and the reason each fixture value is what it is. The §4.5 codemod was re-run against the base SHA (130 edits → **103** errors, by-file and by-code tables matching, restored byte-identical, baseline re-verified at 0) and its algorithm is a recipe in Appendix A. The regression test itself is deferred to PR 2a, as the task requires. | §2.3.1, §4.5, Appendix A |
| **F5** | `/api/quiz/v1` call-site count; `application_controller.rb` line number. | **Accepted in full.** 12 → **11** request call sites (and a note that a path grep returns 13, two of them in `src/tools/errors.ts`). `:2977` → **`:2978`**, re-fetched at the pinned SHA where the string occurs exactly once. | §5 |
| **F6** | Boundary table lacks `"+7"`, `""`, `Infinity`, `NaN`, a non-ASCII digit row. | **Accepted, and all rows executed rather than reasoned.** §4.2.2 adds those five plus a fullwidth-digit row, a 20-digit row, and the observed Zod leaf code for every rejection. One honest annotation: `Infinity` / `NaN` as **numbers** are unreachable over the MCP wire — `JSON.parse` raises `SyntaxError` on both literals and `JSON.stringify` emits `null` `[P]` — so they are in the table as the exported builder's in-process contract, not as a wire case. The string forms `"Infinity"` / `"NaN"` *are* reachable. | §4.2.2 |
| **N1** | *New.* §4.2 rule 2's `z.string().regex(D).refine(BigInt…)` **throws** `SyntaxError` on 7 of 13 hostile strings, and the throw escapes `safeParse` and the enclosing union — an uncaught exception in input validation reachable by any caller sending `course_id: "7.0"`. | Rule 2 now mandates `{ abort: true }`; four candidate forms are tabulated with what each rejects and emits; PR 1a gains a test that asserts a `-32602` through a real `Client` for each of the 7. | §4.2 (2), §4.2.1, §8 |
| **N2** | *New.* §4.2 rule 4's `.transform(String)` makes `z.toJSONSchema(schema)` throw `Transforms cannot be represented in JSON Schema` under its default mode; we are safe only because SDK 1.30.0 passes `io: 'input'`. | Rule 4 now pins the `io` requirement and cites the SDK line; PR 1a must read the published schema back from `listTools()` rather than calling the converter itself. Confirmed end to end `[W]`. | §4.2 (4), §4.2.1, §8 |
| **N3** | *New.* §4.2's required rejection message is unachievable with a union-level `error`: the number branch reports its own `too_big`, so the caller who actually hits the precision bug sees `Too big: expected int to be <=9007199254740991` — naming neither the value nor the remedy. | The builder must set the message on the number member as well as the union. Measured both ways `[P]` `[W]`. | §4.2.1, §8 |

Not re-run in revision 2, and still standing from revision 1: the 15 `tests/` type errors and the 5 pseudonymizer errors (both fall out of the §4.5 codemod, which was re-run — the per-file table reproduces `src/pseudonym/pseudonymizer.ts` at 5), and the §7.2 compile-time bridge failure (the codemod reproduces its single `TS2344`). Open question 2 still needs a live instance and is unchanged.

## Appendix A — Reproducing the measurements

Revision 1 described the probes but left the numbers unreproducible, because the probes themselves were deleted (QA F4). Revision 2 states each one as a recipe precise enough to rebuild. Everything below runs in a worktree with `pnpm install --frozen-lockfile` done, and nothing touches a live Canvas. Revision 2's recipes ran at `origin/main` @ `5740739`. Revision 3's recipes ran at PR head `76cf525`, whose `src/`, `tests/`, `package.json` and `pnpm-lock.yaml` are identical to `5740739` (`git diff --stat 5740739 HEAD -- src tests package.json pnpm-lock.yaml` is empty). Node's `typescript` package is the AST parser in every recipe below; `rg` is ripgrep. In Git Bash, write a leading-slash argument as `[/]api[/]v1`, because MSYS rewrites `/api/v1` into a Windows path and the count reads 0. **This PR remains design-only: none of these probes is committed.** The only one whose full source is in this document is the grade hazard (§2.3.1), because it is the one headline numeric claim.

Common requirements, each of which cost a wrong answer at least once while writing this:

- **A probe must have a control.** A zero or a green is a claim about the probe until you show the same harness producing a non-zero on a case that should fail. Every recipe below names its control.
- **`pnpm test -- --coverage` and friends do not forward flags**; use `pnpm exec vitest run <file>`. `vitest`'s `include` is `tests/**/*.test.ts`, so a probe outside `tests/` reports "no test files" rather than failing, and `console.log` is swallowed even on pass — collect results and `writeFileSync` them.
- **A scratch script run from outside the worktree resolves bare and relative specifiers against its own directory.** Import `dist/` and `node_modules/` by absolute `file:///D:/...` URL, or pass the worktree root as `process.argv[2]`.
- **Never generate a `.ts`/`.js` file from a `node -e` inside a shell heredoc**, and never insert text with `str.replace(anchor, text)` — `$'` in a replacement string is a pattern and splices the rest of the file in. Use slice-based insertion.

| Claim | Recipe | Control |
| --- | --- | --- |
| Zod behaviour and the §4.2.2 boundary table | A CJS script requiring `<wt>/node_modules/zod`, building the recommended union, and `safeParse`-ing each table row; print the first issue's leaf `code`, not its message. For N1, wrap each `safeParse` in `try/catch` and report throws **separately from rejections** — otherwise the 7 throwing inputs are indistinguishable from clean rejections. | The 3 accepting strings must accept, and the `.regex()`-without-`abort` form must still produce the 7 throws. A form that rejects everything looks identical to a correct one. |
| Emitted JSON Schema (§9) | `z.toJSONSchema(schema)` for each candidate shape, plus `{ io: 'input' }` and `{ io: 'output' }` explicitly. The transform case (N2) throws under `output`; if your run does not show that throw, you are not testing the transform. | Compare against bare `z.number().int()` — it must emit `minimum: -9007199254740991`. If every shape emits the same body, the schema under test is not the one you built. |
| Published schema census (§1 correction 3, §9) | `pnpm build`, then a CJS script that `await import`s `dist/server.js`, `createCanvasMCPServer({token,baseUrl})`, links an `InMemoryTransport` pair to a real `Client`, calls `listTools()`, and walks every `inputSchema` / `outputSchema` tallying keywords. | Abort below 100 tools. The run must report 165; a smaller number means the registry did not fully load and every keyword count is low. |
| Wire round trip (§2.2, §1 correction 7) | Same harness, with `globalThis.fetch` stubbed to record URLs and return a minimal JSON `Response`. **`listTools()` must be called before `callTool`** — the SDK populates its argument-validator cache from the list response, so a probe that skips it bypasses validation entirely and goes green on a broken payload. | Pair every "no request was issued" assertion with a call that *should* issue one, asserting the URL array is non-empty. Otherwise a server broken for an unrelated reason passes. |
| `tsc` blindness (§1 correction 7, §3.6) | Record `pnpm typecheck`'s error count as a baseline (0). Patch `get_course.course_id` in `src/tools/courses.ts` to the recommended union by slice insertion, re-run, then restore from a byte copy taken beforehand and re-verify 0. | The baseline itself is the control: if it is not 0, the 0-after reading means nothing. Also confirm the patch took effect by reading the published schema back from `listTools()` — a failed anchor match otherwise reads as "widening causes no errors". |
| ID inventory (§3, §3.0 rule) | TypeScript AST walk over `src/canvas/types.ts` implementing §3.0's strict leaf rule: visit `PropertySignature`s of every `InterfaceDeclaration` and of every `TypeLiteral` reached through a declared type; strip `T[]` and `Array<T>`, parentheses, `null`, `undefined`; for any **other** generic reference, descend into its type arguments (this is the revision-3 change: it reaches the `TypeLiteral` inside `CanvasSubmission.rubric_assessment: Record<string, {…}>`), skipping a bare `number` that is the value of a `Record`; treat a surviving `TypeLiteral` as a container (recurse, do not count); count a surviving `number` keyword once. Classify with the two `StringifyIds` regexes. Then match the 12 §3.2 identifier paths against an explicit allowlist, each of which must resolve to exactly one non-converting leaf. Quantities = non-converting − 12. **Expected:** 261 leaves, 130 convert, 131 non-convert, 12 identifiers, 119 quantities, `points` ×5. With the `Record` skip disabled the leaf count is 263. | Abort below 50 leaves or if `id` / `course_id` / `user_id` / `assignment_id` is missing from the result. Every allowlist entry must resolve (run reported none unmatched), and the path `CanvasSubmission.rubric_assessment.points` must be present, since it is the leaf revision 2 missed. Both guards fired during development — an off-by-one in the interface traversal produced a plausible-looking short list. |
| Tool-input walk (§3.4) | TypeScript AST walk over every `.ts` file under `src/tools/` (56 files). Record each `CallExpression` `z.number()` and `z.string()`. Attribute it to the nearest enclosing `PropertyAssignment` name. It is in scope if a `PropertyAssignment` named `inputSchema` encloses it. It is an array item if a `.array(…)` call sits between it and its attribution property. Record `.int()` and `.positive()` in its postfix chain, and whether it is a direct element of a `z.union([…])` array. ID-named = attributed name matches `/(^|_)ids?$/i`. | Abort below 100 in-scope `z.number()` or 50 ID-named. **Expected:** 318 `z.number()` total, 308 in scope, 274 ID-named, 34 not. Of the 274: 206 scalar + 16 array with no `.int()` (222), 39 + 7 `.int().positive()` (46), 6 bare `.int()`. The union arms are 7 (1 scalar + 6 array), all inside the 222. Standalone in-scope `z.string()` ID fields: 6. Nested string arms in union sites: 7. Out of scope: 2 (`new-quizzes.ts:12`, `:17`). Control: the seven union sites must match the list in §3.4 by file and line, so a walk that loses a union site fails the comparison. |
| Canvas client call sites (§5) | AST over every `.ts` file in `src/canvas/` except `client.ts` and `types.ts`. A call qualifies if its callee is a property access named `request`, `paginate` or `paginateEnvelope`. It is New Quizzes if the first argument, or the 200 characters after the call's start, contains `quiz/v1`. | **Expected:** 161 total = 11 New Quizzes + 150 non-quiz. Cross-check: `rg -o "[/]api[/]v1" src` gives 150 occurrences, which counts literals, not calls, and is not the figure §5 uses. `rg -o "[/]api[/]quiz[/]v1" src` gives 13, two of them in `src/tools/errors.ts` and not request sites. |
| ID operators and conversions (§4.1) | AST over `src/**/*.ts`, excluding `*.test.ts`. ID-named operand = source text matches `/(^\|[._])(id\|ids)$\|[a-z](Id\|Ids)$\|_id$\|^id$/`. Count (a) `===` / `!==` where both operands are ID-named, restricted to `src/tools/**` for the 14 (20 across `src/`); (b) `Number(x)` / `parseInt(x)` where `x` is ID-named (4); (c) `-`, `<`, `>`, `<=`, `>=` with an ID-named operand (1); (d) `rg -o "(Map\|Set)<number" src` (18). | **Expected:** 14 / 4 / 1 / 18. Revision 3 read each of the 20 `===` hits; the six outside `src/tools/` are OAuth client/grant and local-config identifiers. |
| `as number` casts (§4.4) | AST over `src/tools/**/*.ts`: count each `AsExpression` whose type is `number` or a union containing `number`. It is ID-named if its operand's source text matches the ID-operand regex above. | **Expected:** 268 casts, 240 on ID-named operands. Not a text grep: `rg -o " as number" src/tools` gives 280 matches and is not the figure the spec uses. |
| Zod boundary codes (§4.2.2) | Node script that requires `<wt>/node_modules/zod` (4.6.5) and builds the §4.2 rule 1–2 union with `abort: true` on the regex. It runs `safeParse` on each table row, collects the top-level issue codes, and flattens each `invalid_union`'s `errors` into the nested set. Throws are reported separately from rejections. | **Expected:** the codes in the §4.2.2 table; no hostile input throws. Control: the same union with `.regex(D)` and no `abort` throws on 7 hostile strings (§4.2.1, measured by QA BRU-2736). |
| Canvas module ID parameters (§3.6) | The same walk pointed at every `src/canvas/*.ts` except `types.ts`. Collect every `Parameter` of a function, method or constructor, and every `PropertySignature` anywhere in the file (interfaces, type aliases, inline type literals, and generic type arguments such as `paginate<{…}>`), filtered to §3.6's name rule. Unwrap parentheses, `T[]`, `Array<T>`, `ReadonlyArray<T>` and `readonly T[]`, and drop `null` / `undefined`. A site admits `number` if any remaining union member is the `number` keyword. Report by declared type so `number` is separated from `number \| string`. | Assert the walk finds ≥ 200 sites and that `src/canvas/courses.ts` contributes `get(courseId: number)`. Pointing it at an empty directory must fail the floor, not return a clean zero. **Expected (revision 6):** 256 sites admitting `number`; 247 unwrapping to `number` (236 bare, 11 array-wrapped); 15 of the 256 inline PropertySignatures (11 `number` or `number[]`, 4 `number \| string`); 25 of 30 files. Variants from the same walk: dropping only `ReadonlyArray<T>` and `readonly T[]` unwrapping gives 247 admitting / 241 unwrapping to `number`; dropping only inline PropertySignatures gives 241 / 236; dropping both gives 232 / 230. The revision 3 figures 230 / 232 are not reproduced by any single variant. |
| Widening blast radius (§4.5) | The §3 walk again, this time emitting the byte offsets of every `number` keyword inside each of the 130 converting leaves. Apply the edits **back-to-front** by string slice, prepend `export type CanvasWireId = string \| number`, run `tsc --noEmit`, tally errors by file and by `TS` code, then restore `types.ts` from a byte copy. | Baseline must be 0 before and 0 after, and the restore must be asserted with a byte comparison (`Buffer.compare`), not assumed. Expect exactly 130 edits; a different count means the leaf rule drifted. |
| Grade divergence (§2.3) | Full source in §2.3.1. It calls the exported `computeGroupGrade` directly, so there is no `fetch` stub and no transport — the only variable is the `StringifyIds` port. | Run both branches in one invocation and print both rows. A single-branch run cannot distinguish "the header changes the grade" from "the fixture produces 92.5 either way". |
| Pinned Canvas sources (§2.1, §2.3, §5) | `gh api "repos/instructure/canvas-lms/contents/<path>?ref=<sha>" --jq .content \| base64 -d`. | Name each downloaded file by its **full path**, not its basename: Canvas has same-named files under `app/` and `lib/`, and a basename download silently overwrites. Then grep for the construct and assert it occurs **exactly once** before citing a line number — that is what caught the `:2977` → `:2978` error in §5. |

## 13. Revision 3 change map (QA BRU-2736 → BRU-2737)

QA's second review of PR #382 at `76cf525` returned CHANGES REQUIRED with findings 1–9. The table gives the disposition of each. Where the re-derivation disagrees with QA, the evidence is stated in the subsection below the table. Revision 2's correction matrix (§12) is kept as history; where its text is now wrong, this section overrides it.

| QA finding | Disposition | Where |
| --- | --- | --- |
| **1** — F3 inventory omits the `TypeLiteral` in `CanvasSubmission.rubric_assessment` | **Fixed.** The walk descends into non-Array generic arguments. Totals are **261 / 130 / 131**, with **119** quantities and `points` ×5. The "260 vs 261 rule boundary" explanation is withdrawn: revision 2's 260 omitted one leaf, `CanvasSubmission.rubric_assessment.points`. | §0, §3.0, §3.3, §8 (Phase 2a), §12 F3, Appendix A (ID inventory row) |
| **2** — §0 "purely additive for every call that works today" | **Fixed.** §0 now states the accurate contract: additive for valid IDs, breaking for `0`, negatives, fractions and out-of-range exponent-form values. | §0 item 1, consistent with §4.2 rule 1 and §7.3 |
| **3** — header pins SDK 1.30.0 | **Fixed.** Pinned to the lockfile-resolved `@modelcontextprotocol/sdk` **1.32.0** (`pnpm-lock.yaml`; `package.json` declares `^1.30.0`). The §4.2 rule 4 citation `zod-json-schema-compat.js:23` is retained as QA confirmed it at 1.32.0. | Header, §4.2 (4), §4.2.1 N2 |
| **4** — N1 says "uncaught exception" | **Fixed.** The SDK catches the throw and returns `isError: true` with the raw text (`Cannot convert 7.0 to a BigInt`). The defect is the wrong error class (no `-32602`) plus the leak, not an uncaught process exception. The PR 1a requirement for `-32602` is unchanged. | §4.2.1 N1 |
| **5** — union-site count and double-description | **Fixed, with a disagreement.** §3.4 now states **7** union sites, and the union row is labelled a subset of the 222 row, not an addition. See note A. | §3.4 table and paragraph after it, §4.4 |
| **6** — string-ID scope | **Fixed, with a disagreement.** Standalone in-scope `z.string()` IDs: **6**. Nested string arms in union sites: **7**. Outside `inputSchema`: **2**. See note B. | §3.4 table, §4.4 |
| **7** — boundary table leaf codes | **Fixed, with a disagreement.** The column is now the nested set of issue codes, and the note under the table states the two properties that matter. See note C. | §4.2.2 |
| **8** — unreproduced counts | **Fixed.** Every retained figure now has an AST or grep recipe and an expected value in Appendix A. Figures that changed: `===` 13 → **14**; ordering/arithmetic `.id` 2 → **1**; `as number` "~230" → **268** total / **240** on ID-named operands; `/api/v1` call sites 144 → **150** non-quiz (161 total, 11 quiz). Kept and reproduced: 18 `Map`/`Set<number>`, 4 `Number`/`parseInt`, 16 / 7 array items, 222 / 46 / 6 `.int()` split. The "27 files" qualifier on the 222 row is removed, because it was never reproduced. | §3.4, §4.1, §4.4, §5, Appendix A |
| **9** — §2.3 `grade-explanation.ts:238` citation | **Fixed.** The derivation is `percentageOf` at `src/tools/grade-engine.ts:263–265`, called from `grade-explanation.ts:30`. Line 238 is the `computeGroupGrade(...)` call in the multi-group loop. | §2.3 |

**Note A — union sites.** QA lists six union sites (outcomes ×4, submissions ×1, users ×1). The AST walk finds **seven**. The seventh is `src/tools/enrollments.ts:123` (`user_id: z.union([z.number(), z.string()])`), which QA's own nested-string list includes at `enrollments.ts:124`. Revision 2 and this revision both say 7.

**Note B — string sites.** QA says the six union sites hold nine nested string branches, including `accounts.ts` `account_id` ×2. Those two are **standalone** `z.string()` fields (`accounts.ts:115`, `:138`), not inside a union. The nested count is **7**. Standalone in-scope count is **6**, not 5: `account_id` ×2, `item_id` ×3 (`new-quizzes.ts:189`, `:234`, `:261`), `criterion_id` (`rubrics.ts:76`). `correct_choice_id` (`new-quizzes.ts:17`) and `id` (`:12`) sit in the New Quizzes sub-schema constant, outside `inputSchema`.

**Note C — top-level codes.** QA says top-level numeric rows report `invalid_union`, with the leaf code nested. Measured with Zod 4.6.5: only **non-integers** (`7.5`, `Infinity`) report a top-level `invalid_union`. Out-of-range integers (`9007199254740992`, `9007199254740993`, `0`, `-7`) report their own top-level `too_big` / `too_small`, with no union wrapper. Every rejected string reports `invalid_union`, and the hostile strings nest `invalid_type` (from the number arm) alongside the string-arm leaf.

**Other revision 3 corrections.** The §3.0 statement that counting the two `Record<string, number>` properties gives "262" is now **263** (measured with the skip disabled). The §4.1 comparison count (`===` 13 → 14) applies to `src/tools/**`. Over all of `src/`, the same rule gives 20; the six outside `src/tools/` are OAuth client/grant and local-config identifiers, not Canvas data.

## 14. Revision 4 change map (QA BRU-2738 → BRU-2739)

QA's re-review of PR #382 at head `f0668e2` returned CHANGES REQUIRED with findings 1–7. Each is dispositioned below. Where this section and §13 or earlier text conflict, this section governs.

| QA finding | Disposition | Where |
| --- | --- | --- |
| **1** — cast guard assigned to no PR | **Assigned.** Removal of the ID-named `as number` casts in `src/tools/**` is PR 1c's job, retyped to `as CanvasId`. PR 1c's guard only prevents their return. (Revision 4 put this in 1b; moved in revision 5, see below.) The guard's scope (`as number` on ID-named operands) is unchanged. | §8 PR 1b, PR 1c |
| **2** — §3.6 counting rule | **Fixed, and wider than QA's list.** `ReadonlyArray` is in the unwrap set: 9 sites (QA's 8 plus `users.ts:29`). Literal unions count: `number \| 'all'` at `submissions.ts:46` admits the `number` keyword, so it is counted. The 230 / 232 chain stated in revision 4 is withdrawn in §15 D. The denominator is 30 files excluding `types.ts`, of which 25 contain sites. Also found and fixed in revision 4: rule (a) missed inline parameter object types (revision 4 said 15 sites; the walk gives 11, e.g. `modules.ts:65`, `outcomes.ts:116`). **Final: 256 sites admit `number`; 247 unwrap to `number`.** | §0 item 6, §1 row 6, §3.6, §8 PR 1c, Appendix A |
| **3** — N3 refine message | **Fixed.** Measured: `"9223372036854775808"` yields `Invalid input` with no message on the refine, and the custom message with `{ error }` on it. The number member's `.int()` and `.positive()` both need the message. | §4.2.1 N3, §8 PR 1a |
| **4** — §9 "byte-identical under draft-7 and draft-2020-12" | **Restated.** The body is asserted identical with `$schema` excluded. Each dialect's `$schema` is asserted separately. Zod 4.6.5 emits the draft-07 URI for draft-7 and the 2020-12 URI for 2020-12 (probe, revision 5). | §9 |
| **5** — base `get_course` rejects string `course_id` | **Stated.** The base schema rejects `"9010000000000001"` with `-32602` (QA's measurement, not re-measured in revision 4). The byte-exact result is a property of the widened schema. | §0 item 6, §1 row 7 |
| **6** — §2.4 tag | **Retagged `[P]`.** The evidence is BRU-2550's probe. No pinned Canvas source call site was found. | §2.4 |
| **7** — "15 type errors in `tests/`" | **Marked unverified.** Not reproduced. `tsconfig.json` excludes `tests/`, so `pnpm typecheck` cannot report them. The figure stays in the text only as an unverified claim. | §3.5, §4.5 |

**Figures superseded by revision 4.** Anywhere an earlier section says *230* as the count of ID declaration sites, read *247* (unwrap to `number`) or *256* (admit `number`), per §3.6. The 230 / 232 / 241 history is kept in §3.6's reconciliation. The §13 "Not changed by this revision" paragraph and the §12 F1 row describe revision 2 and 3 counts, and are history.

**Not re-measured in revision 4.** The §3.4 tool-input counts (222 / 46 / 6 / 7 / 6 / 2), the §4.5 codemod's 103 errors, the 240 `as number` casts (§4.4, Appendix A), and the §2.3 grade figures. None of these depends on the §3.6 rule, but they were not re-run. Open question 2 still needs a live instance.

**Not changed by this revision.** The design, the phase order, the 230 Canvas ID declaration sites (§3.6, which QA confirmed), the 103-error codemod (§4.5), the grade-divergence figures 47.5 / 92.5 (§2.3, QA confirmed), and the open questions (§11). Open question 2 still needs a live instance. §12 is the revision 2 history; where its text conflicts with this section, this section governs. The `1.30.0` in §12's N2 row is part of that history.

## 15. Revision 5 change map (QA BRU-2740 re-review of 18a48bc)

| QA finding | Change | Where |
| --- | --- | --- |
| **A** — PR 1b cast removal to `as CanvasId` fails TS2345 until PR 1c lands | **Superseded in revision 6 (§16 A).** Revision 5 moved the removal into PR 1c. Revision 6 moves it into PR 1b, which lands after PR 1c. | §8, §16 |
| **B** — §9 and §14 row 4 said Zod 4.6.5 emits no `$schema` for 2020-12 | **Corrected.** Re-probed: draft-7 emits `http://json-schema.org/draft-07/schema#`; 2020-12 emits `https://json-schema.org/draft/2020-12/schema`. | §9, §14 row 4 |
| **C** (non-blocking) — "exactly `number`" included 11 `number[]` sites; Appendix A's variant dropped inline types too | **Relabelled and re-measured.** The 247 unwraps to `number`: 236 bare + 11 array-wrapped. Appendix A gives the walk's variant counts. Dropping only `ReadonlyArray` / `readonly T[]` gives 247 / 241, as QA measured. Dropping inline PropertySignatures gives 241 / 236, and dropping both gives 232 / 230 (the revision 5 withdrawal is reversed in §16 D). 256 total is unchanged. | §3.6, §8 PR 1c, §14 row 2, Appendix A |
| **D** (found while checking C) — the inline count and the 230 → 256 chain | **Revision 5's correction is reversed in revision 6 (§16 D).** Revision 5 said the inline count is 11. The walk finds 15 inline PropertySignatures, including 4 response-shape props in `analytics.ts`. The additive chain still does not close; §3.6 gives the measured variants instead. | §3.6, §16 D |

## 16. Revision 6 change map (QA BRU-2741, round-3 re-review of 953cd17)

Commit `496e4fd`, made on this branch during this revision by a concurrent run, claimed that the inline count is 11, that the walk does not find four sites, and that `main` has 249 admitting sites. Those claims do not reproduce and are reversed below. The 1b-casts rationale it added (handler operands are `unknown`) is kept.

| QA finding | Change | Where |
| --- | --- | --- |
| **A** — PR 1b casts: "bare `string as number` is TS2352; retyping to `CanvasId` is TS2345" | **Premise corrected; split changed.** A typed `string as number` is TS2352 (probe). The handler operands are `unknown` (`types.ts:75`), so `unknown as number` compiles. A single-tool probe (`get_account`'s schema as `z.string()`, cast unchanged) gives 0 `tsc` errors. The retype to `as CanvasId` is TS2345 against a `number` signature (measured on `accounts.ts:23`). Widening the 256 signatures alone gives 5 errors, fixed in PR 1c. Retyping the 240 casts on top of that gives 27 more, in 12 tool files, fixed in PR 1b. New order: 1a → **1c** (signatures) → **1b** (schema and cast removal). The "only thing that compiles" wording is removed. | §3.6 item 2, §8 Phase 1, PR 1b, PR 1c, §10 |
| **D** — the inline count is 15 (11 `number` + 4 `number \| string`) | **Reproduced: 15.** Rule (a), applied to every `PropertySignature` in `src/canvas/`, gives 15 inline sites: 11 admitting `number` or `number[]` (7 in parameter objects, 4 in `analytics.ts` response shapes at `:29,:42,:54,:66`) and 4 admitting `number \| string`. Dropping inline gives 241, not 245. Dropping inline and `ReadonlyArray` gives 232, not 236. The 4 response-shape props need the `CourseSearchResult` change in PR 1c. | §3.6 items 2 and 3, §15 C/D, Appendix A |
| **Minor** — Appendix A's recipe collected only option-interface properties | **Aligned to rule (a).** Appendix A collects every `PropertySignature` in the file, including inline type literals and generic type arguments, as §3.6 does. | Appendix A |
| **B**, **C** | Passed in round 3; unchanged, except the §15 rows noted above. | — |
