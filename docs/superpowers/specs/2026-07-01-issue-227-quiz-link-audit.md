---
issue: 227
---

# Extend `audit_course_links` to Quizzes — MCP Tool Design

**Date**: 2026-07-01
**Issue**: [bruchris/canvas-lms-mcp#227](https://github.com/bruchris/canvas-lms-mcp/issues/227)
**Status**: Design — awaiting CTO review

---

## Purpose

Extend the existing `audit_course_links` tool (issue #218, `src/tools/link-audit.ts`) to also
scan quiz content for broken and cross-course links/images. Today the tool covers pages,
assignments, syllabus, and announcements — quizzes are the highest-stakes gap: an instructor
previewing a quiz as the "Test Student" sees embedded images render correctly (their own
attempt is scoped to the course being previewed), while a real student attempting the same quiz
after a course copy sees a broken image with no way for the instructor to notice by eye. This
spec adds a fifth, **opt-in** content source — `quizzes` — covering Classic quiz descriptions +
questions and New Quiz item stems.

No new tool is added. `audit_course_links`'s name, existing four sources, output shape, and
annotations are unchanged.

---

## Design unknowns (retired)

### 1. Classic vs New Quizzes expose questions through different endpoints

**Decision: scan both engines, each through its own existing, already-implemented method — no
new Canvas client methods.**

| Engine | Container list | Container HTML field | Per-question/item list | Question/item HTML field |
| --- | --- | --- | --- | --- |
| Classic Quizzes | `canvas.quizzes.list(courseId)` → `CanvasQuiz[]` | `CanvasQuiz.description` | `canvas.quizzes.listQuestions(courseId, quiz.id)` → `CanvasQuizQuestion[]` | `CanvasQuizQuestion.question_text` |
| New Quizzes | `canvas.assignments.list(courseId)` → `CanvasAssignment[]`, filtered to `is_quiz_lti_assignment === true` | *(none — New Quizzes have no separate description; the assignment's own `description` is scanned today by the existing `assignments` source)* | `canvas.newQuizzes.listItems(courseId, assignment.id)` → `CanvasNewQuizItem[]` | `CanvasNewQuizItem.entry.item_body` |

Both `listQuestions` and `listItems` already exist and are already tested
(`tests/canvas/quizzes.test.ts`, `tests/canvas/new-quizzes.test.ts`). **No new Canvas client
methods are needed** — this is purely a new consumer of existing, documented endpoints, matching
the issue's S–M effort estimate.

**New Quizzes discovery.** New Quizzes are not rows in the Classic `quizzes` table — they are
assignments backed by the Quizzes.Next LTI tool. Canvas's documented Assignment object exposes
`is_quiz_lti_assignment: boolean` to identify them (parallel to the already-typed
`is_quiz_assignment` field used for Classic quiz-backed assignments). `CanvasAssignment` does not
yet declare this field — add it (see Type changes below). The audit reuses
`canvas.assignments.list(courseId)` — the same call the `assignments` source already makes — to
discover New Quiz assignment IDs; when both `assignments` and `quizzes` are selected, this issues
the list-assignments call twice, concurrently (both calls are independent branches of the same
outer `Promise.all`, not sequential). This is an accepted, minor v1 inefficiency (same
accepted-cost pattern as `pages.listWithBodies`'s per-page fan-out in the original spec); a future
refactor can hoist the shared fetch above both source blocks if it becomes a hot path.

**Field naming.** The issue text describes findings carrying `source: 'quizzes'`; this spec uses
the codebase's actual, pre-existing field name instead — `ContentLocation.type` (see
`src/tools/link-audit.ts` line 11) — for consistency with the four existing sources, which already
use `type`, not `source`. This is a terminology mapping, not a scope change: the issue's intent
("tag findings with which quiz they came from") is satisfied by `type: 'quizzes'` on the existing
field.

**Migrated/stub Classic quiz rows.** When a Classic quiz has been migrated to New Quizzes, Canvas
leaves a stub row in `/courses/:id/quizzes` with `quiz_type: 'quizzes.next'` for backward
compatibility; this stub carries no real question content and calling `listQuestions` on it is
not meaningful. **This repo already has an established, tested convention for telling Classic and
New Quiz rows apart**: `src/tools/quiz-accommodations.ts` defines
`CLASSIC_QUIZ_TYPES = new Set(['assignment', 'practice_quiz', 'graded_survey', 'survey'])` and
uses `CLASSIC_QUIZ_TYPES.has(quiz.quiz_type)` as an **allow-list** (see its `listQuestions`-adjacent
filter at line 130 and the `classicQuizzes = quizzes.filter(...)` at line 205), specifically so an
unrecognized/future `quiz_type` value is never mistakenly treated as a scannable Classic quiz. The
quiz scan here follows that same convention rather than inventing a new one: define an equivalent
local `CLASSIC_QUIZ_TYPES` constant in `src/tools/link-audit.ts` (mirroring the same four values;
not imported cross-module, matching this codebase's existing pattern of each tool file owning its
own small constants — e.g. `link-audit.ts`'s own `HREF_RE`/`IMG_SRC_RE` are not shared either) and
filter with `CLASSIC_QUIZ_TYPES.has(quiz.quiz_type)`, **not** `quiz.quiz_type !== 'quizzes.next'`.
This is strictly safer than the deny-list: it skips `listQuestions` for any quiz whose `quiz_type`
isn't a known-Classic value (including `quizzes.next` and any future/unrecognized type), while the
same course's real New Quiz content is still fully covered via the independent
assignments/`is_quiz_lti_assignment` path. Note the specific stub-row field values assumed in the
test fixtures below (`points_possible: 0`, `question_count: 0`) are illustrative, not verified
against live Canvas API docs — the filter's correctness does not depend on those specific values,
only on `quiz_type` not being a recognized Classic value.

**Classic quiz `description` field.** `CanvasQuiz` does not currently declare `description` even
though Canvas's quiz object returns it (the HTML shown above the quiz questions). Add it (see
Type changes below).

### 2. Standalone question banks / New Quizzes item banks

**Decision: out of scope for v1, per the issue's own recommendation.** The scan covers quiz
descriptions and questions/items **as they appear inside a quiz** — reached via
`listQuestions`/`listItems` on a specific quiz/assignment. Course-level or account-level question
banks (Classic) and item banks (New Quizzes, `/api/quiz/v1/courses/:id/item_banks`) are separate
Canvas resources not reachable from a quiz ID and are not scanned. This mirrors the New Quizzes
tool spec's own decision to defer item banks (issue #124 spec, §"Deferred to follow-up").

### 3. Performance — batching or a per-quiz cap

**Decision: no artificial cap; make the whole `quizzes` source opt-in instead.**

The quiz scan's fan-out shape is one call per quiz/New-Quiz-assignment to fetch its
questions/items (`listQuestions` / `listItems`, each already paginated internally by
`client.paginate`) — structurally identical to the accepted `pages.listWithBodies` fan-out
(one call per page) from the original `audit_course_links` spec. No per-question call is ever
made; `listQuestions`/`listItems` return every question/item for a quiz in one paginated fetch.

Given this fan-out is proportional to "number of quizzes in the course" (typically much smaller
than "number of pages"), a hard cap isn't warranted. Instead, the unknown is retired by making
`quizzes` **opt-in**: it is a valid `include` value but is **not** part of the default source set
scanned when `include` is omitted. A caller auditing a course with many quizzes controls the cost
by choosing when to include it; the existing four sources' default behavior and cost are
completely unchanged.

---

## Type changes (`src/canvas/types.ts`)

### `CanvasQuiz` — add `description`

```ts
export interface CanvasQuiz {
  id: number
  title: string
  quiz_type: string
  description?: string | null // NEW — HTML shown above the quiz's questions
  points_possible: number
  question_count: number
  due_at: string | null
  published: boolean
  time_limit?: number | null // quiz duration in minutes; null if untimed
}
```

### `CanvasAssignment` — add `is_quiz_lti_assignment`

Insert immediately after the existing `is_quiz_assignment?: boolean` field:

```ts
  is_quiz_assignment?: boolean
  is_quiz_lti_assignment?: boolean // NEW — true when backed by the New Quizzes (Quizzes.Next) LTI tool
```

Both fields are optional and additive — no existing mock or test that constructs a `CanvasQuiz`
or `CanvasAssignment` without them needs to change.

---

## Tool module changes — `src/tools/link-audit.ts`

### Content-source enum and default set

```ts
const CONTENT_SOURCES = ['pages', 'assignments', 'syllabus', 'announcements', 'quizzes'] as const
type ContentSource = (typeof CONTENT_SOURCES)[number]

// `quizzes` is opt-in — see Design unknown §3. It is a valid `include` value but
// is excluded from the default set scanned when `include` is omitted, so the
// existing four sources' default cost and behavior are unchanged.
const DEFAULT_CONTENT_SOURCES: ContentSource[] = [
  'pages',
  'assignments',
  'syllabus',
  'announcements',
]
```

### `ContentLocation` — two new optional fields

```ts
interface ContentLocation {
  type: ContentSource
  id: number
  title: string
  // Set only when type === 'quizzes'. Classic ids resolve at
  // /courses/:id/quizzes/:id; New Quiz ids are the backing assignment id and
  // resolve at /courses/:id/assignments/:id.
  quiz_engine?: 'classic' | 'new'
  // Set only when the finding is inside a specific question/item, not the
  // quiz's own description. Classic question ids are numeric; New Quiz item
  // ids are Canvas-assigned strings (CanvasNewQuizItem.id: string).
  question_id?: number | string
}
```

`LinkFinding`, `extractUrls`, `decodeHtmlEntities`, `classifyUrl`, and `scanHtml` are **unchanged**
— the issue's own framing ("reuses the existing `scanHtml` + image-URL + cross-course
classification") is honored exactly: `scanQuizzes` (below) is the only new code, and it calls the
existing `scanHtml` per quiz/question exactly like the existing sources call it per page/
assignment.

### New helper: `scanQuizzes`

```ts
// Mirrors the allow-list convention already established in
// src/tools/quiz-accommodations.ts (CLASSIC_QUIZ_TYPES) — kept as a local
// constant per this codebase's pattern of each tool file owning its own small
// constants, not a cross-module import.
const CLASSIC_QUIZ_TYPES = new Set(['assignment', 'practice_quiz', 'graded_survey', 'survey'])

async function scanQuizzes(canvas: CanvasClient, courseId: number): Promise<LinkFinding[]> {
  // `assignments` here is a separate, locally-scoped fetch from the outer
  // handler's `assignments` variable (used by the `assignments`-source
  // findings loop) — the two never share data or state. When both the
  // `assignments` and `quizzes` sources are active, `canvas.assignments.list`
  // is called twice, concurrently (each inside its own branch of the outer
  // handler's Promise.all) — an accepted v1 inefficiency, not a bug (see
  // Design unknown §1).
  const [quizzes, assignments] = await Promise.all([
    canvas.quizzes.list(courseId),
    canvas.assignments.list(courseId),
  ])

  const classicQuizzes = quizzes.filter((quiz) => CLASSIC_QUIZ_TYPES.has(quiz.quiz_type))
  const classicFindings = await Promise.all(
    classicQuizzes.map(async (quiz) => {
      const location: ContentLocation = {
        type: 'quizzes',
        id: quiz.id,
        title: quiz.title,
        quiz_engine: 'classic',
      }
      const findings = scanHtml(quiz.description, courseId, location)
      const questions = await canvas.quizzes.listQuestions(courseId, quiz.id)
      for (const question of questions) {
        findings.push(
          ...scanHtml(question.question_text, courseId, {
            ...location,
            question_id: question.id,
          }),
        )
      }
      return findings
    }),
  )

  const newQuizAssignments = assignments.filter((a) => a.is_quiz_lti_assignment === true)
  const newQuizFindings = await Promise.all(
    newQuizAssignments.map(async (assignment) => {
      const location: ContentLocation = {
        type: 'quizzes',
        id: assignment.id,
        title: assignment.name,
        quiz_engine: 'new',
      }
      const items = await canvas.newQuizzes.listItems(courseId, assignment.id)
      return items.flatMap((item) =>
        scanHtml(item.entry.item_body, courseId, { ...location, question_id: item.id }),
      )
    }),
  )

  return [...classicFindings.flat(), ...newQuizFindings.flat()]
}
```

Notes:
- `Promise.all` fans out per-quiz and per-New-Quiz-assignment fetches concurrently, matching the
  concurrency style already used for the top-level source fetches.
- `scanHtml(quiz.description, ...)` is called first (with no `question_id`), then each question's
  `scanHtml` call spreads `location` and adds `question_id` — this reuses one `location` object
  per quiz rather than rebuilding it per question.
- `quiz.description` and `question.question_text`/`item.entry.item_body` being `null`/`undefined`/
  empty is already handled by `scanHtml`'s existing `extractUrls` null-guard (`if (!html) return
  []`) — no new null-handling code needed.

### Handler changes

```ts
handler: async (params) => {
  const courseId = params.course_id as number
  const activeInclude = new Set<ContentSource>(
    (params.include as ContentSource[] | undefined) ?? DEFAULT_CONTENT_SOURCES,
  )

  const [pages, assignments, syllabus, announcements, quizFindings] = await Promise.all([
    activeInclude.has('pages') ? canvas.pages.listWithBodies(courseId) : Promise.resolve([]),
    activeInclude.has('assignments') ? canvas.assignments.list(courseId) : Promise.resolve([]),
    activeInclude.has('syllabus') ? canvas.courses.getSyllabus(courseId) : Promise.resolve(null),
    activeInclude.has('announcements')
      ? canvas.discussions.listAnnouncements(courseId)
      : Promise.resolve([]),
    activeInclude.has('quizzes')
      ? scanQuizzes(canvas, courseId)
      : Promise.resolve([] as LinkFinding[]),
  ])

  const findings: LinkFinding[] = []

  // ...existing pages/assignments/syllabus/announcements scanning loops, unchanged...

  findings.push(...quizFindings)

  return {
    summary: {
      course_id: courseId,
      sources_scanned: CONTENT_SOURCES.filter((s) => activeInclude.has(s)),
      total_findings: findings.length,
    },
    findings,
  }
},
```

`sources_scanned` needs no special-casing: `CONTENT_SOURCES.filter((s) => activeInclude.has(s))`
already produces a stable order with `quizzes` last, since `CONTENT_SOURCES` now ends with
`'quizzes'`.

### `include` schema and description text

```ts
inputSchema: {
  course_id: z.number().int().positive().describe('Canvas course ID'),
  include: z
    .array(z.enum(['pages', 'assignments', 'syllabus', 'announcements', 'quizzes']))
    .optional()
    .describe(
      'Content sources to scan. Omit to scan the default four: pages, assignments, syllabus, ' +
        'announcements. `quizzes` is opt-in — pass it explicitly to also scan Classic quiz ' +
        'descriptions/questions and New Quiz item stems; it issues one extra Canvas API call ' +
        'per quiz/New Quiz in the course.',
    ),
},
```

Tool `description` (replace the existing string):

```ts
description:
  "Scan a course's content (pages, assignments, syllabus, announcements, and optionally " +
  'quizzes) for broken or outdated links and images. Returns structured findings: cross-course ' +
  'references (links that still point at a previous copy of the course — the canonical ' +
  'stale-copy failure after a course import) and empty/malformed URLs. Pass "quizzes" in ' +
  '`include` to also scan Classic quiz descriptions/questions and New Quiz item stems — these ' +
  'break silently for students while still rendering in the instructor’s own preview. ' +
  '`quizzes` is opt-in (off by default). Structural checks only — no outbound HTTP requests. ' +
  'Requires instructor permissions in the course.',
```

No other part of the tool definition (`name`, `annotations`) changes.

---

## Catalog, FERPA, and audience — no changes

- **Catalog (`src/tools/catalog.ts`)**: no changes. `audit_course_links` remains the only tool in
  the `link_audit` domain; no new domain entry, no new import.
- **FERPA / pseudonymizer**: no changes. The new fields (`CanvasQuiz.description`,
  `CanvasQuizQuestion.question_text`, `CanvasNewQuizItem.entry.item_body`) are course content —
  the same category as the existing `assignments`/`pages` HTML bodies already scanned by this
  tool, not a `CanvasUser`, `participants` array, or `user_name`. `audit_course_links` stays out
  of `PSEUDONYMIZER_WRAPPED_TOOLS`; `tests/pseudonym/coverage.test.ts` passes unmodified.
- **Audience (`src/tools/audience-coverage.test.ts`)**: no changes. The tool keeps inheriting the
  `link_audit` domain's `defaultPrimaryAudience: 'educator'`.
- **Tool count**: unchanged. This extends an existing tool; no tool is added or removed.
  `tests/tools/registry.test.ts`'s tool-count assertion needs no update.

---

## Manifest regeneration (`docs/generated/tool-manifest.json`)

`audit_course_links`'s `description` string changes. `tests/discovery/manifests.test.ts` compares
the committed manifest against a fresh `generate-manifests` run, so the implementor **must** run
`pnpm generate:manifests` after editing the tool description and commit the resulting diff (the
`audit_course_links` entry's `description` field in `docs/generated/tool-manifest.json`). No other
manifest field (`toolCount`, `annotations`, `access`, `primaryAudience`) changes.

**Do not hand-edit `tool-manifest.json`.** `tests/discovery/manifests.test.ts`'s "matches the
committed generated JSON artifact" case does a full deep `toEqual` between the committed file and
a freshly built manifest (not a scoped diff of just `audit_course_links`) — any manual edit that
doesn't byte-for-byte match `generate-manifests`'s output, including key order, fails the test.
Always regenerate via the script.

---

## Test plan

All tests use mocked Canvas responses. No live Canvas calls. No Canvas client test changes are
needed — `quizzes.list`, `quizzes.listQuestions`, `assignments.list`, and `newQuizzes.listItems`
are pre-existing, already-tested methods; only their TypeScript return types gain optional fields.

### Tool tests — `tests/tools/link-audit.test.ts` (modify existing file)

**`buildMockCanvas()` additions:**

1. Add a `quizzes` property:

   ```ts
   quizzes: {
     list: vi.fn().mockResolvedValue([
       {
         id: 30,
         title: 'Midterm',
         quiz_type: 'assignment',
         description: '<p>Read <a href="/courses/999/pages/notes">notes</a> first.</p>',
         points_possible: 20,
         question_count: 2,
         due_at: null,
         published: true,
       },
       {
         id: 31,
         title: 'Migrated Stub',
         quiz_type: 'quizzes.next',
         description: null,
         points_possible: 0,
         question_count: 0,
         due_at: null,
         published: true,
       },
     ]),
     listQuestions: vi.fn().mockResolvedValue([
       {
         id: 300,
         quiz_id: 30,
         position: 1,
         question_text: '<p>See <img src="/courses/999/files/1/download"> above.</p>',
         question_type: 'multiple_choice_question',
         points_possible: 10,
       },
       {
         id: 301,
         quiz_id: 30,
         position: 2,
         question_text: '<p>No links here.</p>',
         question_type: 'true_false_question',
         points_possible: 10,
       },
     ]),
   },
   newQuizzes: {
     listItems: vi.fn().mockResolvedValue([
       {
         id: 'item-1',
         position: 1,
         points_possible: 5,
         entry_type: 'Item',
         entry: {
           interaction_type_slug: 'choice',
           item_body: '<p>Pick the diagram: <img src="/courses/999/files/2/download"></p>',
           interaction_data: {},
           properties: {},
         },
       },
     ]),
   },
   ```

2. Append a third assignment to the existing `assignments.list` mock array (ids 10, 11 stay
   exactly as-is so all current `assignments`-source tests keep passing unmodified):

   ```ts
   {
     id: 40,
     name: 'Final (New Quiz)',
     description: null, // no href here — keeps existing `assignments`-source tests' finding counts unaffected
     course_id: 100,
     due_at: null,
     points_possible: 20,
     grading_type: 'points',
     submission_types: ['external_tool'],
     allowed_attempts: -1,
     is_quiz_lti_assignment: true,
   },
   ```

**New test cases (course ID = `100` throughout, appended after the existing 26 cases — recount
before implementing: `grep -c '  it(' tests/tools/link-audit.test.ts` on `main` should read 26;
if it doesn't, renumber these to `baseline + 1` through `baseline + 9` accordingly):**

27. **`quizzes` not called by default**: Call `{ course_id: 100 }` (no `include`). Assert
    `canvas.quizzes.list` is NOT called. Assert `canvas.newQuizzes.listItems` is NOT called.
    Assert `result.summary.sources_scanned` equals
    `['pages', 'assignments', 'syllabus', 'announcements']` exactly (unchanged from before this
    feature — locks in the opt-in decision).

28. **Classic quiz description cross-course link → finding, no `question_id`**: Call
    `{ course_id: 100, include: ['quizzes'] }`. Assert a finding
    `{ location: { type: 'quizzes', id: 30, title: 'Midterm', quiz_engine: 'classic' }, kind: 'link', reason: 'cross_course_reference', cross_course_id: 999 }`
    exists with `question_id` absent.

29. **Classic quiz question cross-course image → finding with `question_id`**: Same call. Assert
    a finding
    `{ location: { type: 'quizzes', id: 30, title: 'Midterm', quiz_engine: 'classic', question_id: 300 }, kind: 'image', reason: 'cross_course_reference', cross_course_id: 999 }`.

30. **Classic quiz question with no links → no finding**: Assert no finding has
    `location.question_id === 301`.

31. **Migrated/stub Classic quiz (`quiz_type: 'quizzes.next'`) skipped**: Assert
    `canvas.quizzes.listQuestions` is called exactly once, with `(100, 30)` (never with `31`).
    Assert no finding has `location.id === 31`.

32. **New Quiz item cross-course image → finding**: Same call. Assert a finding
    `{ location: { type: 'quizzes', id: 40, title: 'Final (New Quiz)', quiz_engine: 'new', question_id: 'item-1' }, kind: 'image', reason: 'cross_course_reference', cross_course_id: 999 }`.

33. **Only the New-Quiz-flagged assignment is scanned for items**: Assert
    `canvas.newQuizzes.listItems` is called exactly once, with `(100, 40)` — never with `10` or
    `11`.

34. **`sources_scanned` when only `quizzes` is opted in**: Call
    `{ course_id: 100, include: ['quizzes'] }`. Assert `result.summary.sources_scanned` equals
    `['quizzes']`. Assert `canvas.pages.listWithBodies`, `canvas.courses.getSyllabus`, and
    `canvas.discussions.listAnnouncements` are NOT called. Assert `canvas.assignments.list` IS
    called (needed for New Quiz discovery even though the `assignments` source itself is not
    active).

35. **Combined `include: ['assignments', 'quizzes']` — accepted double-fetch**: Call
    `{ course_id: 100, include: ['assignments', 'quizzes'] }`. Assert `canvas.assignments.list`
    is called exactly **twice** (once for the `assignments` source, once inside `scanQuizzes` for
    New Quiz discovery) — this locks in the accepted v1 inefficiency documented in Design unknown
    §1 rather than leaving it as an untested assumption. Assert `result.summary.sources_scanned`
    equals `['assignments', 'quizzes']`.

**Note (not a new numbered case — already covered):** `Migrated Stub`'s `description: null` (and
a null Classic-quiz description generally) produces no finding and does not throw. This is already
exercised by case 31 (which skips quiz 31 entirely via the `CLASSIC_QUIZ_TYPES` filter before
`scanHtml` would even see its description) and is the same `scanHtml` null-guard already covered
by the pre-existing `assignments`/`announcements` null-body tests — no additional numbered test
case is needed for this path.

**`makeCanvas()` (the minimal mock builder used only by the classification-edge-case suite)
needs no changes** — none of the new cases above use it; they all use `buildMockCanvas()`.

### Registry test — `tests/tools/registry.test.ts` (modify existing file)

Add `list` and `listQuestions` to the existing `quizzes` mock is unnecessary — both already exist
(see mock at lines 40–49: `list`, `listQuestions` are already present). Add `listItems` is
unnecessary — already present on the `newQuizzes` mock (lines 163–175). **No changes needed** to
`tests/tools/registry.test.ts` — `buildFullMockCanvas()` already satisfies every method
`scanQuizzes` calls, and no tool is added or removed so the tool-count assertion is unaffected.

### Pseudonymizer / audience coverage tests

No changes to `tests/pseudonym/coverage.test.ts` or `tests/tools/audience-coverage.test.ts` — see
"Catalog, FERPA, and audience" above.

### Manifest test — `tests/discovery/manifests.test.ts`

No test-file changes. Passes once the implementor regenerates
`docs/generated/tool-manifest.json` via `pnpm generate:manifests` after updating the tool
description (see "Manifest regeneration" above).

---

## Implementation checklist for the implementor

1. `src/canvas/types.ts` — add `description?: string | null` to `CanvasQuiz`; add
   `is_quiz_lti_assignment?: boolean` to `CanvasAssignment` (right after `is_quiz_assignment?:
   boolean`). No other type changes.
2. `src/tools/link-audit.ts`:
   - Add `'quizzes'` to `CONTENT_SOURCES`; add `DEFAULT_CONTENT_SOURCES` (the original four) and
     use it as the `include` fallback in the handler instead of `[...CONTENT_SOURCES]`.
   - Add `quiz_engine?: 'classic' | 'new'` and `question_id?: number | string` to
     `ContentLocation`.
   - Add the `scanQuizzes` helper (module-level, not exported), as specified above.
   - Update the `include` Zod schema to allow `'quizzes'` and update its `.describe()` text.
   - Update the tool's top-level `description` string.
   - Update the handler: add the `scanQuizzes` branch to the `Promise.all` fetch, destructure
     `quizFindings`, and `findings.push(...quizFindings)` after the existing four scanning
     blocks. `sources_scanned` computation is unchanged (already generic over `CONTENT_SOURCES`).
3. `tests/tools/link-audit.test.ts` — extend `buildMockCanvas()` with `quizzes`/`newQuizzes`
   mocks and a third `assignments` entry (id 40, `is_quiz_lti_assignment: true`, `description:
   null`); add 9 new test cases (numbered 27–35 in this spec, assuming the verified baseline of
   26 existing cases — renumber to `baseline + 1..9` if the recount differs). No changes to
   `makeCanvas()`.
4. Run `pnpm generate:manifests` and commit the resulting `docs/generated/tool-manifest.json`
   diff (only `audit_course_links.description` changes).
5. No changes to `src/tools/catalog.ts`, `src/canvas/index.ts`, `src/canvas/quizzes.ts`,
   `src/canvas/new-quizzes.ts`, `tests/canvas/*.test.ts`, `tests/tools/registry.test.ts`,
   `tests/pseudonym/coverage.test.ts`, or `tests/tools/audience-coverage.test.ts`.

---

## Acceptance check

- [x] `**design-first**` flag present in issue #227.
- [x] Design unknown §1 (Classic vs New Quizzes endpoint shapes): retired — exact methods
  (`quizzes.list`/`listQuestions`, `assignments.list`+`newQuizzes.listItems`), exact HTML fields,
  exact discovery mechanism (`is_quiz_lti_assignment`), and the migrated-stub filter
  (`quiz_type !== 'quizzes.next'`) are all specified; no new Canvas client methods required.
- [x] Design unknown §2 (question banks / item banks): retired — explicitly out of scope for v1,
  matching the issue's own recommendation and the precedent set by the New Quizzes tool spec.
- [x] Design unknown §3 (performance / batching / cap): retired — no artificial cap; `quizzes`
  made opt-in instead, with the fan-out cost model spelled out and compared to the accepted
  `pages.listWithBodies` precedent.
- [x] No new package dependencies.
- [x] No student PII in the new payload fields (quiz/question/item content is course content
  metadata, same category as the existing `assignments`/`pages` HTML already scanned); explicit
  statement that `PSEUDONYMIZER_WRAPPED_TOOLS` is unaffected.
- [x] Existing four sources (pages/assignments/syllabus/announcements) are explicitly unchanged;
  default behavior for `quizzes` (opt-in, off by default) is explicitly documented, satisfying the
  issue's acceptance criterion.
- [x] Exact tool name (unchanged: `audit_course_links`), exact Zod schema diff, exact Canvas
  fields/endpoints reused, and exact output shape (`ContentLocation` additions) fully specified.
- [x] Type changes: exact fields, exact interfaces, exact insertion points.
- [x] `scanQuizzes` helper given in full, reusing the existing `scanHtml`/`classifyUrl` machinery
  unchanged, per the issue's own framing.
- [x] Locator info specified: quiz id/title (+ `quiz_engine` to disambiguate Classic vs New) and
  `question_id` for question/item-level findings, letting an instructor jump straight to the
  broken item as required by the issue's acceptance criteria.
- [x] Test plan: 2 new mock fixtures (`quizzes`, `newQuizzes`) + 1 new assignment fixture, 9 new
  test cases (numbered 27–35 against the verified 26-case baseline) covering opt-in default,
  Classic description, Classic question, stub-skip (via the `CLASSIC_QUIZ_TYPES` allow-list, not
  a `quizzes.next` deny-list), New Quiz item, scan-isolation, `sources_scanned` variants, and the
  accepted double-fetch behavior; a closing note documents an already-covered null-guard path and
  confirms `makeCanvas()` needs no changes.
- [x] Classic/New Quiz discrimination reuses the existing `CLASSIC_QUIZ_TYPES` allow-list
  convention from `src/tools/quiz-accommodations.ts` rather than introducing an inconsistent
  deny-list — the two `assignments` fetches (outer handler vs. inside `scanQuizzes`) are called
  out as independently-scoped and concurrent, not sequential or shared.
- [x] Manifest regeneration requirement (`pnpm generate:manifests`) called out explicitly, since
  the tool description text changes.
- [x] Catalog, FERPA/pseudonymizer, audience-coverage, and tool-count impacts all explicitly
  stated as "no changes," with the reasoning for each.
- [x] Implementation checklist enumerates every file touched and every file explicitly untouched.
