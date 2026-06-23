---
issue: 213
---

# Grading Automation Policy Tool — `explain_grading_policy` MCP Tool Design

**Date**: 2026-06-23
**Issue**: [bruchris/canvas-lms-mcp#213](https://github.com/bruchris/canvas-lms-mcp/issues/213)
**Status**: Design — awaiting CTO review

---

## Purpose

Add a single read-only tool, `explain_grading_policy`, that surfaces the **grading automation rules**
configured for a Canvas course in one structured response — the missing-submission policy (auto-zero
or custom deduction), the late-submission penalty (percent per day/hour, floor), the assignment-group
weights (are groups weighted? what weight does each carry?), and whether a grading standard
(letter-grade scheme) is applied. The output includes a plain-language `summary` that Claude can
read to students or instructors directly.

This is **complementary to, not overlapping with, `explain_grade`**. `explain_grade` recomputes
the *numeric grade* given current scores. This tool answers the prior question: *what are the rules
that Canvas will apply automatically?* — "will a blank become a 0?", "is there a late penalty?",
"does the Exams group count more than Homework?"

---

## Design unknowns (retired)

### 1. Permission / persona: who can read `GET /courses/:id/late_policy`?

**Decision: instructor/admin primary; student best-effort with a graceful fallback.**

The Canvas REST API requires the `manage_grades` permission (i.e. teacher or admin role) to read
`GET /api/v1/courses/:course_id/late_policy`. A student token typically receives a `403 Forbidden`.

Handling:

- The tool issues the late-policy call in parallel with the course + assignment-groups calls.
- If a `CanvasApiError` with `status === 403` is thrown by the late-policy call, the tool returns
  `null` for both `missing_submission_policy` and `late_submission_policy` and appends a caveat:
  `"Late/missing submission policy requires instructor or admin permissions — policy details are
  not accessible with this token."` The group-weighting and grading-scheme sections, which come
  from the course object and assignment groups (both student-readable), are still returned normally.
- Any other `CanvasApiError` on the late-policy call (e.g. 404 — course has no late policy record
  yet) is treated the same as a policy-not-configured response (all flags false, all values 0).
  A `404` on the late_policy endpoint means Canvas has not yet created a `LatePolicy` row for this
  course — semantically equivalent to "no policy configured".
- Non-403, non-404 errors (5xx, network) propagate normally via `formatError()`.

Documented persona in tool description: **instructor or admin** for full output; students receive
the group-weighting and grading-scheme sections only.

### 2. When no late policy is configured (Canvas returns 404 or all-false flags)

**Decision: surface as "not configured / off" rather than "unknown".**

Canvas creates a `LatePolicy` row lazily — only when the instructor first saves a late-policy
change in the UI. Before that, a GET returns 404. When the policy exists but all flags are `false`,
no automatic deductions are in effect.

Both situations (404 and all-flags-false) should be expressed to the user as
"No automatic missing/late penalty is configured for this course" rather than "policy unknown" or
"not retrievable", since the _effect_ is the same: no automation will fire. The tool normalises
both to `enabled: false` / `deduction_percent: 0`.

To distinguish the two states in the raw output, the tool exposes a
`missing_submission_policy.source` field:
- `'api'` — a 200 response was received from the late_policy endpoint.
- `'default'` — a 404 was received; defaults (no automation) are assumed.
- `'unavailable'` — a 403 was received; values should be treated as unknown.

Same pattern for `late_submission_policy.source`.

### 3. Scope: include group weighting and grading-scheme presence in this tool?

**Decision: yes — all three facets in a single tool.**

The user story asks for one answer to "how is grading set up in this course?" Splitting the grading
automation rules across two or three tools would force the caller (Claude or a user) to issue
multiple requests and synthesise the answer manually. Combining them:

- Late/missing policy (from `late_policy` endpoint)
- Group weighting (from `course.apply_assignment_group_weights` + `assignment_groups`)
- Grading standard presence (from `course.grading_standard_id`)

into one tool is idiomatic Canvas — they are all properties of the same conceptual object
("how this course grades") — and the Canvas endpoints needed for groups and the course record are
called anyway to fill out the answer.

The `explain_grade` tool already fetches groups (with full assignment lists) for its own math;
this tool fetches groups **without** `include[]=assignments` (lighter call, group metadata only).
There is no data overlap that would require deduplication between the two tools — they are called
independently.

---

## Canvas API calls

| # | Endpoint | Purpose | Method |
|---|----------|---------|--------|
| 1 | `GET /api/v1/courses/:id/late_policy` | Missing/late deduction flags and values | `canvas.latePolicy.get(courseId)` (new) |
| 2 | `GET /api/v1/courses/:id` | `apply_assignment_group_weights`, `grading_standard_id`, `account_id`, course name | `canvas.courses.get(courseId)` (existing) |
| 3 | `GET /api/v1/courses/:id/assignment_groups` | Group names and weights | `canvas.assignments.listGroups(courseId)` (existing, no extra includes) |
| 4 _(conditional)_ | `GET /api/v1/courses/:id/grading_standards` (then account fallback) | Confirm the grading standard exists and retrieve its title | `canvas.gradingStandards.listForCourse()` / `listForAccount()` (existing) |

Calls 1, 2, and 3 are independent — issue them as `Promise.allSettled([call1, call2, call3])` so
that a 403 on call 1 does not abort calls 2 and 3. Call 4 is conditional on
`course.grading_standard_id !== null && course.grading_standard_id !== undefined`.

**Why `Promise.allSettled` (not `Promise.all`):** call 1 may throw a 403 `CanvasApiError` for
student tokens while calls 2 and 3 succeed. `allSettled` lets the tool inspect each result
independently and return partial data rather than failing entirely.

---

## New canvas module: `src/canvas/late-policy.ts`

A minimal module following the established canvas-layer pattern: receives `CanvasHttpClient` via
constructor, throws `CanvasApiError`, no MCP dependency.

```ts
import type { CanvasHttpClient } from './client'
import type { CanvasLatePolicy } from './types'

export class LatePolicyModule {
  constructor(private client: CanvasHttpClient) {}

  async get(courseId: number): Promise<CanvasLatePolicy> {
    const envelope = await this.client.request<{ late_policy: CanvasLatePolicy }>(
      `/api/v1/courses/${courseId}/late_policy`,
    )
    return envelope.late_policy
  }
}
```

The response shape from Canvas is `{ "late_policy": { ... } }` — an envelope. The module unwraps
it and returns the inner `CanvasLatePolicy` object directly.

**Register in `src/canvas/index.ts`:**

```ts
import { LatePolicyModule } from './late-policy'
// in CanvasClient constructor:
this.latePolicy = new LatePolicyModule(this.client)
// and as a property:
latePolicy: LatePolicyModule
```

---

## New Canvas types (`src/canvas/types.ts`)

Append these two interfaces:

```ts
export interface CanvasLatePolicy {
  id?: number
  course_id?: number
  late_submission_deduction_enabled: boolean
  // Percent deducted per interval (0–100). Canvas stores as a decimal fraction
  // in older API versions and as an integer in newer; always treat as 0–100 range.
  late_submission_deduction: number
  late_submission_interval: 'hour' | 'day'
  late_submission_minimum_percent_enabled: boolean
  late_submission_minimum_percent: number  // floor: grade cannot fall below this (0–100)
  missing_submission_deduction_enabled: boolean
  missing_submission_deduction: number     // typically 100 for auto-zero
}
```

---

## Tool contract (`src/tools/grading-policy.ts`)

### Export signature

```ts
export function gradingPolicyTools(canvas: CanvasClient): ToolDefinition[]
```

No `pseudonymizer` parameter — this tool returns no student PII (see FERPA section below).

### Tool name

`explain_grading_policy`

### Zod input schema

```ts
z.object({
  course_id: z.number().int().positive().describe(
    'Canvas course ID to explain the grading policy for.'
  ),
})
```

### Annotations

```ts
{
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
}
```

### Output shape

```ts
{
  course: {
    id: number,
    name: string,
  },
  missing_submission_policy: {
    // 'api' = 200 received; 'default' = 404 (no policy row, defaults assumed);
    // 'unavailable' = 403 (student token)
    source: 'api' | 'default' | 'unavailable',
    enabled: boolean,             // true iff missing_submission_deduction_enabled
    deduction_percent: number,    // 0-100; 100 means auto-zero
  } | null,   // null only when source === 'unavailable'
  late_submission_policy: {
    source: 'api' | 'default' | 'unavailable',
    enabled: boolean,
    deduction_percent: number,    // percent deducted per interval
    interval: 'hour' | 'day',
    minimum_percent_enabled: boolean,
    minimum_percent: number,      // 0 if minimum_percent_enabled is false
  } | null,   // null only when source === 'unavailable'
  group_weighting: {
    weighted: boolean,            // course.apply_assignment_group_weights ?? false
    groups: Array<{
      id: number,
      name: string,
      weight: number,             // group_weight from Canvas (0-100)
    }>,
  },
  grading_scheme: {
    applied: boolean,             // true iff grading_standard_id is set
    standard_id: number | null,
    standard_title: string | null,  // fetched if applied; null if unavailable or not set
  },
  summary: string,               // plain-language paragraph
  caveats: string[],
}
```

**When `source === 'unavailable'`**, both `missing_submission_policy` and `late_submission_policy`
are set to `null` (not an object with `enabled: false`), signalling that the values are
**unknown**, not **off**. The summary and caveats reflect this.

### Summary generation

The `summary` field is assembled from the structured data in priority order. Examples:

**Full instructor view (auto-zero + late penalty + weighted groups + grading scheme):**
> "Missing work is automatically scored 0%. Late submissions lose 10% per day, with a floor of
> 50%. Assignment groups are weighted: Exams (60%), Homework (30%), Participation (10%). A
> letter-grade scheme is applied to the final score."

**Student view (403 on late_policy):**
> "Assignment groups are weighted: Exams (60%), Homework (40%). A letter-grade scheme is applied.
> Late/missing penalty details require instructor permissions and are not available."

**No automation (policy-off or 404):**
> "No automatic missing-work or late-submission penalty is configured for this course. Assignment
> groups are not weighted — all assignments contribute equally to the course grade. No letter-grade
> scheme is applied."

### Summary assembly rules

```
missing_block:
  if source === 'unavailable':  skip
  elif enabled:  "Missing work is automatically scored <(100 - deduction_percent)>%."
                 (if deduction_percent === 100: "Missing work is automatically scored 0% (auto-zero).")
  else:          "No automatic penalty for missing work."

late_block:
  if source === 'unavailable':  skip
  elif enabled:
    base = "Late submissions lose <deduction_percent>% per <interval>."
    if minimum_percent_enabled: append " Grade cannot fall below <minimum_percent>%."
  else: "No automatic late penalty."

weighting_block:
  if weighted:
    group_list = groups.map(g => "<name> (<weight>%)").join(", ")
    "Assignment groups are weighted: <group_list>."
  else:
    "Assignment groups are not weighted — all assignments contribute equally."

scheme_block:
  if applied:  "A letter-grade scheme is applied (\"<standard_title>\")."
  else:        "No letter-grade scheme is applied."

if source === 'unavailable' (for both policy fields):
  append to caveats: "Late/missing penalty details require instructor permissions and are
  not available with this token."

summary = [missing_block, late_block, weighting_block, scheme_block]
  .filter(Boolean).join(" ")
```

---

## Catalog registration (`src/tools/catalog.ts`)

Add import and catalog entry:

```ts
import { gradingPolicyTools } from './grading-policy'

// In toolDomainCatalog (append after 'grade_explanation'):
{
  domain: 'grading_policy',
  defaultPrimaryAudience: 'shared',
  getTools: gradingPolicyTools,
},
```

---

## FERPA / pseudonymization

`explain_grading_policy` returns **no student PII**. The response contains only:
- Course ID and name (course-level metadata)
- Late/missing policy flags and numeric values (course-level configuration)
- Assignment group names and weights (course-level configuration)
- Grading standard title (course-level configuration)

No `CanvasUser`, no `user_name`, no `participants` array, no enrollment data with user fields.

**Pseudonymizer integration: not required.** Do NOT add `'explain_grading_policy'` to
`PSEUDONYMIZER_WRAPPED_TOOLS`. CI's `coverage.test.ts` checks only that tools in that list are
actually wrapped — adding a non-PII tool to the list would fail that check.

---

## Error handling

| Scenario | Handling |
|----------|----------|
| 403 on `late_policy` call | Catch in tool; set both policy sections to `null` (source `'unavailable'`); add caveat; continue |
| 404 on `late_policy` call | Treat as default (all-false policy, source `'default'`); no caveat needed |
| 403/404 on course or assignment_groups | Propagate via `formatError()` — tool cannot function without course data |
| `grading_standard_id` set but standard not fetchable (404 on standards list) | `standard_title: null`; add caveat `"Grading standard (id: <n>) could not be retrieved."` |
| Network failure on any call | Propagate via `formatError()` "Failed to connect to Canvas — check your base URL" |

---

## Test plan (`tests/grading-policy.test.ts`)

All tests use mocked Canvas responses — no real Canvas instance is hit.

### Fixture A — Full instructor view: auto-zero + late penalty + weighted groups + grading scheme

**Course mock**: `id: 1`, `name: 'Physics 101'`, `apply_assignment_group_weights: true`,
`grading_standard_id: 42`, `account_id: 10`

**Late policy mock** (200):
```json
{
  "late_policy": {
    "missing_submission_deduction_enabled": true,
    "missing_submission_deduction": 100,
    "late_submission_deduction_enabled": true,
    "late_submission_deduction": 10,
    "late_submission_interval": "day",
    "late_submission_minimum_percent_enabled": true,
    "late_submission_minimum_percent": 50
  }
}
```

**Assignment groups mock** (two groups):
```json
[
  { "id": 1, "name": "Exams", "group_weight": 60 },
  { "id": 2, "name": "Homework", "group_weight": 40 }
]
```

**Grading standards mock** (course-level, id 42, title `'Default Grading Scale'`).

**Assertions**:
1. `result.missing_submission_policy.enabled === true`
2. `result.missing_submission_policy.deduction_percent === 100`
3. `result.missing_submission_policy.source === 'api'`
4. `result.late_submission_policy.enabled === true`
5. `result.late_submission_policy.deduction_percent === 10`
6. `result.late_submission_policy.interval === 'day'`
7. `result.late_submission_policy.minimum_percent_enabled === true`
8. `result.late_submission_policy.minimum_percent === 50`
9. `result.group_weighting.weighted === true`
10. `result.group_weighting.groups` has two entries: Exams (60) and Homework (40)
11. `result.grading_scheme.applied === true`
12. `result.grading_scheme.standard_title === 'Default Grading Scale'`
13. `result.summary` contains "auto-zero" (or "0%") and "10% per day" and "floor of 50%" and
    "weighted" and the group names
14. `result.caveats` is empty

### Fixture B — No policy configured (late_policy returns 404)

**Course mock**: `apply_assignment_group_weights: false`, `grading_standard_id: null`

**Late policy call**: throws `CanvasApiError` with `status: 404`.

**Assignment groups mock**: single group `{ id: 1, name: 'Assignments', group_weight: 0 }`.

**Assertions**:
1. `result.missing_submission_policy.enabled === false`
2. `result.missing_submission_policy.source === 'default'`
3. `result.late_submission_policy.enabled === false`
4. `result.late_submission_policy.source === 'default'`
5. `result.group_weighting.weighted === false`
6. `result.grading_scheme.applied === false`
7. `result.grading_scheme.standard_id === null`
8. `result.summary` contains "No automatic" and "not weighted" and "No letter-grade scheme"
9. `result.caveats` is empty (404 is not a caveat — it is the expected default state)

### Fixture C — Student token (403 on late_policy)

**Late policy call**: throws `CanvasApiError` with `status: 403`.

**Course and assignment_groups**: return normally (weighted course, one group).

**Assertions**:
1. `result.missing_submission_policy === null`
2. `result.late_submission_policy === null`
3. `result.group_weighting.weighted === true` (group data still returned)
4. `result.caveats` includes the "instructor permissions" string
5. `result.summary` includes the permissions caveat mention and group weighting info

### Fixture D — Grading standard in the standard list (course-level)

Same as Fixture A but the grading-standards **course list** returns an empty array (standard is
account-scoped). The tool then calls `listForAccount(course.account_id)` and finds it there.

**Assertions**:
1. `result.grading_scheme.applied === true`
2. `result.grading_scheme.standard_title` matches the account-level mock title
3. Exactly two grading-standard API calls were made (one course-level, one account-level)

### Fixture E — Grading standard set but not retrievable

`grading_standard_id: 99` on course; both `listForCourse` and `listForAccount` return arrays that
do not contain id 99.

**Assertions**:
1. `result.grading_scheme.applied === true`
2. `result.grading_scheme.standard_title === null`
3. `result.caveats` includes `"Grading standard (id: 99) could not be retrieved."`

### Fixture F — Late penalty with no floor (minimum_percent_enabled: false)

**Late policy mock**: `late_submission_deduction_enabled: true`, `late_submission_deduction: 5`,
`late_submission_interval: 'hour'`, `late_submission_minimum_percent_enabled: false`,
`late_submission_minimum_percent: 0`.

**Assertions**:
1. `result.late_submission_policy.minimum_percent_enabled === false`
2. `result.summary` contains "5% per hour" but NOT the word "floor" or "minimum"

---

## Tool description (MCP `tool.description`)

```
Explains the grading automation rules configured for a Canvas course:
- Missing-submission policy: whether blank/unsubmitted work is automatically scored 0 (or another
  deduction), or left unpenalised.
- Late-submission policy: whether Canvas applies a per-day or per-hour percentage deduction to
  late submissions, and whether there is a floor below which the grade cannot fall.
- Assignment-group weighting: whether the course uses weighted groups, and the weight of each group.
- Grading scheme: whether a letter-grade scheme (A/B/C/F mapping) is applied to the final score.

Also returns a plain-language summary paragraph you can share with students or instructors.

Note: the late/missing policy section requires instructor or admin permissions. Students receive
the group-weighting and grading-scheme sections only, with a caveat noting what is unavailable.
Use explain_grade to compute the actual weighted grade for a specific student.
```

---

## File changes summary

| File | Change |
|------|--------|
| `src/canvas/types.ts` | Add `CanvasLatePolicy` interface |
| `src/canvas/late-policy.ts` | **New** — `LatePolicyModule` with `get(courseId)` |
| `src/canvas/index.ts` | Import `LatePolicyModule`; add `latePolicy: LatePolicyModule` property and constructor assignment |
| `src/tools/grading-policy.ts` | **New** — `gradingPolicyTools()` with `explain_grading_policy` ToolDefinition, all Canvas calls, and summary generation |
| `src/tools/catalog.ts` | Import `gradingPolicyTools`; add `grading_policy` domain entry |
| `tests/grading-policy.test.ts` | **New** — Fixtures A–F with mocked Canvas responses |

**6 files total. No new package dependencies. No student PII (pseudonymizer not required).**

---

## Open questions for CTO review

None — all design unknowns are retired above. The spec is implementation-ready.
