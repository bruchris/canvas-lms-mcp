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
that Canvas will apply automatically?* — “will a blank become a 0?”, “is there a late penalty?”,
“does the Exams group count more than Homework?”

---

## Design unknowns (retired)

### 1. Permission / persona: who can read `GET /courses/:id/late_policy`?

**Decision: instructor/admin primary; student best-effort with a graceful fallback.**

The Canvas REST API requires the `manage_grades` permission (i.e. teacher or admin role) to read
`GET /api/v1/courses/:course_id/late_policy`. A student token typically receives a `403 Forbidden`.

Handling:

- The tool issues the late-policy call in parallel with the course + assignment-groups calls via
  `Promise.allSettled` (see Canvas API calls section for unwrapping pseudocode).
- If the late-policy result is rejected with a `CanvasApiError` where `status === 403`, the tool
  returns `null` for both `missing_submission_policy` and `late_submission_policy` and appends a
  caveat: `"Late/missing submission policy requires instructor or admin permissions — policy details
  are not accessible with this token."`
- If the late-policy result is rejected with `status === 404` (Canvas has not created a `LatePolicy`
  row for this course yet), it is treated as policy-not-configured: all flags false, all values 0,
  `source: 'default'`. No caveat is added (this is the normal state for new courses).
- If the late-policy result is rejected with any **other** error (5xx, network error), the tool
  propagates it via `formatError()` and returns a tool-level error response. The partial data from
  calls 2 and 3 is discarded in this case.
- Non-403, non-404 errors on calls 2 (course) or 3 (assignment groups) propagate unconditionally
  via `formatError()` — the tool cannot produce meaningful output without course-level data.

Documented persona in tool description: **instructor or admin** for full output; students receive
the group-weighting and grading-scheme sections only, with a caveat noting what is unavailable.

### 2. When no late policy is configured (Canvas returns 404 or all-false flags)

**Decision: surface as “not configured / off” rather than “unknown”.**

Canvas creates a `LatePolicy` row lazily — only when the instructor first saves a late-policy
change in the UI. Before that, a GET returns 404. When the policy exists but all flags are `false`,
no automatic deductions are in effect.

Both situations (404 and all-flags-false) should be expressed to the user as
“No automatic missing/late penalty is configured for this course” rather than “policy unknown” or
“not retrievable”, since the _effect_ is the same: no automation will fire. The tool normalises
both to `enabled: false` / `deduction_percent: 0`.

To distinguish the two states in the raw output, the tool exposes a
`missing_submission_policy.source` field:
- `'api'` — a 200 response was received from the late_policy endpoint.
- `'default'` — a 404 was received; defaults (no automation) are assumed.

Same pattern for `late_submission_policy.source`. When the field is `null` (403 case), neither
status is applicable — the caller should treat the absence of the field as "unknown, not off".

### 3. Scope: include group weighting and grading-scheme presence in this tool?

**Decision: yes — all three facets in a single tool.**

The user story asks for one answer to “how is grading set up in this course?” Splitting the grading
automation rules across two or three tools would force the caller (Claude or a user) to issue
multiple requests and synthesise the answer manually. Combining them:

- Late/missing policy (from `late_policy` endpoint)
- Group weighting (from `course.apply_assignment_group_weights` + `assignment_groups`)
- Grading standard presence (from `course.grading_standard_id`)

into one tool is idiomatic Canvas — they are all properties of the same conceptual object
(“how this course grades”) — and the Canvas endpoints needed for groups and the course record are
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

**Unwrapping `Promise.allSettled` results (required reading for implementers):**

```ts
const [latePolicyResult, courseResult, groupsResult] = await Promise.allSettled([
  canvas.latePolicy.get(courseId),
  canvas.courses.get(courseId),
  canvas.assignments.listGroups(courseId),
])

// Calls 2 and 3 are required — propagate any error immediately
if (courseResult.status === 'rejected') return formatError(courseResult.reason)
if (groupsResult.status === 'rejected') return formatError(groupsResult.reason)
const course = courseResult.value
const groups = groupsResult.value

// Call 1: late policy — only 403 and 404 are handled gracefully
let latePolicySource: 'api' | 'default' = 'default'
let rawLatePolicy: CanvasLatePolicy | null = null
let policyUnavailable = false

if (latePolicyResult.status === 'fulfilled') {
  rawLatePolicy = latePolicyResult.value
  latePolicySource = 'api'
} else {
  const err = latePolicyResult.reason
  if (err instanceof CanvasApiError && err.status === 403) {
    policyUnavailable = true  // both policy output fields become null
  } else if (err instanceof CanvasApiError && err.status === 404) {
    latePolicySource = 'default'  // no policy row yet; defaults (disabled) apply
  } else {
    return formatError(err)  // 5xx, network error — propagate
  }
}
```

Note: `canvas.assignments.listGroups(courseId)` is called without `include: ['assignments']`
(the default call omits assignments) to avoid fetching unnecessary data.

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

**Register in `src/canvas/index.ts`** (following the pattern of all existing modules):

```ts
import { LatePolicyModule } from './late-policy'

// 1. Declare as a class property (in the class body, alongside existing properties):
latePolicy: LatePolicyModule

// 2. Assign in the constructor:
this.latePolicy = new LatePolicyModule(this.client)
```

---

## New Canvas types (`src/canvas/types.ts`)

Append this interface:

```ts
export interface CanvasLatePolicy {
  id?: number
  course_id?: number
  late_submission_deduction_enabled: boolean
  // Percent deducted per interval (0–100 integer; no normalization required)
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
export function gradingPolicyTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[]
```

The `pseudonymizer` parameter is accepted to satisfy the `ToolDomainRegistration` interface
(which declares `getTools: (canvas: CanvasClient, pseudonymizer?: Pseudonymizer) => ToolDefinition[]`)
but is **not used** — this tool returns no student PII.

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
  // null when the late_policy endpoint returned 403 (student token).
  // Non-null for both 200 (source: 'api') and 404 (source: 'default') responses.
  missing_submission_policy: {
    source: 'api' | 'default',  // 'api' = Canvas returned data; 'default' = no policy row (404)
    enabled: boolean,             // true iff missing_submission_deduction_enabled
    deduction_percent: number,    // 0-100; 100 means auto-zero; 0 when source is 'default'
  } | null,
  late_submission_policy: {
    source: 'api' | 'default',
    enabled: boolean,
    deduction_percent: number,    // percent deducted per interval; 0 when source is 'default'
    interval: 'hour' | 'day',
    minimum_percent_enabled: boolean,
    minimum_percent: number,      // 0 if minimum_percent_enabled is false
  } | null,
  group_weighting: {
    weighted: boolean,            // course.apply_assignment_group_weights ?? false
    groups: Array<{
      id: number,
      name: string,
      weight: number,             // group_weight from Canvas (0-100)
    }>,
  },
  grading_scheme: {
    applied: boolean,             // true iff grading_standard_id is non-null
    standard_id: number | null,
    standard_title: string | null,  // populated if applied; null if unretrievable or not set
  },
  summary: string,               // plain-language paragraph
  caveats: string[],
}
```

**When `missing_submission_policy === null` (and likewise for `late_submission_policy`)**, the
caller should treat the values as **unknown, not off** — the policy exists but cannot be read
with the current token. The `caveats` array will contain an explanation.

### Summary generation

The `summary` field is assembled from the structured data. Examples:

**Full instructor view (auto-zero + late penalty + weighted groups + grading scheme):**
> “Missing work is automatically scored 0% (auto-zero). Late submissions lose 10% per day, with a
> floor of 50%. Assignment groups are weighted: Exams (60%), Homework (40%). A letter-grade scheme
> is applied.”

**Student view (403 on late_policy):**
> “Assignment groups are weighted: Exams (60%), Homework (40%). A letter-grade scheme is applied.
> Late/missing penalty details require instructor permissions and are not available.”

**No automation (policy-off or 404):**
> “No automatic missing-work penalty. No automatic late penalty. Assignment groups are not weighted
> — all assignments contribute equally. No letter-grade scheme is applied.”

### Summary assembly rules

```
missing_block:
  if missing_submission_policy === null:  skip (permission caveat added separately)
  elif enabled:
    if deduction_percent === 100: "Missing work is automatically scored 0% (auto-zero)."
    elif deduction_percent === 0:  "Missing work policy is enabled with no deduction (0%)."
    else: "Missing work loses <deduction_percent>% of the possible points automatically."
  else: "No automatic missing-work penalty."

late_block:
  if late_submission_policy === null:  skip (permission caveat added separately)
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
  if applied and standard_title is not null:
    "A letter-grade scheme is applied (\"<standard_title>\")."
  elif applied and standard_title is null:
    "A letter-grade scheme is applied (title unavailable)."
  else:
    "No letter-grade scheme is applied."

permission_caveat (added when missing_submission_policy === null):
  append to caveats: "Late/missing penalty details require instructor or admin permissions
  and are not available with this token."
  append to summary: "Late/missing penalty details require instructor permissions and are
  not available."

summary = [missing_block, late_block, weighting_block, scheme_block]
  .filter(Boolean).join(" ")
  (permission note appended at the end when policy is null)
```

---

## Catalog registration (`src/tools/catalog.ts`)

Add import and catalog entry:

```ts
import { gradingPolicyTools } from './grading-policy'

// In toolDomainCatalog (append after the 'grade_explanation' entry):
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

Note: if Canvas adds user-identity fields (e.g. `created_by`) to the `late_policy` or
`grading_standards` responses in future API versions, this tool must be re-evaluated for
PII exposure.

---

## Error handling

| Scenario | Handling |
|----------|----------|
| 403 on `late_policy` call | Set both policy fields to `null`; add caveat; continue with course/groups data |
| 404 on `late_policy` call | Treat as default (all-false policy, `source: 'default'`); no caveat |
| 5xx or network error on `late_policy` call | Propagate via `formatError()`; discard partial data |
| 403 or 404 on course or assignment_groups | Propagate via `formatError()` — tool cannot function without course data |
| `grading_standard_id` set but standard not in course-level list | Try account-level list via `listForAccount(course.account_id)` |
| Standard not found in either course or account list | `standard_title: null`; add caveat `"Grading standard (id: <n>) could not be retrieved."` |
| Network failure on any call | Propagate via `formatError()` "Failed to connect to Canvas — check your base URL" |

---

## Test plan (`tests/grading-policy.test.ts`)

All tests use mocked Canvas responses — no real Canvas instance is hit.

### Fixture A — Full instructor view: auto-zero + late penalty + weighted groups + grading scheme

**Course mock**: `id: 1`, `name: 'Physics 101'`, `apply_assignment_group_weights: true`,
`grading_standard_id: 42`, `account_id: 10`

**Late policy mock** (200 with envelope `{ late_policy: { ... } }`):
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

**Assignment groups mock** (two groups, no `include[]=assignments`):
```json
[
  { "id": 1, "name": "Exams", "group_weight": 60 },
  { "id": 2, "name": "Homework", "group_weight": 40 }
]
```

**Grading standards mock** (course-level list returns `[{ id: 42, title: 'Default Grading Scale', ... }]`).

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
10. `result.group_weighting.groups` has two entries: Exams (weight 60) and Homework (weight 40)
11. `result.grading_scheme.applied === true`
12. `result.grading_scheme.standard_title === 'Default Grading Scale'`
13. `result.summary` contains "auto-zero" and "10%" and "day" and "50%" and group names
14. `result.caveats` is empty

### Fixture B — No policy configured (late_policy returns 404)

**Course mock**: `apply_assignment_group_weights: false`, `grading_standard_id: null`

**Late policy call**: `canvas.latePolicy.get` throws `CanvasApiError` with `status: 404`.

**Assignment groups mock**: single group `{ id: 1, name: 'Assignments', group_weight: 0 }`.

**Assertions**:
1. `result.missing_submission_policy` is non-null
2. `result.missing_submission_policy.enabled === false`
3. `result.missing_submission_policy.source === 'default'`
4. `result.late_submission_policy.enabled === false`
5. `result.late_submission_policy.source === 'default'`
6. `result.group_weighting.weighted === false`
7. `result.grading_scheme.applied === false`
8. `result.grading_scheme.standard_id === null`
9. `result.summary` contains "No automatic" and "not weighted" and "No letter-grade"
10. `result.caveats` is empty

### Fixture C — Student token (403 on late_policy)

**Late policy call**: `canvas.latePolicy.get` throws `CanvasApiError` with `status: 403`.

**Course mock**: `apply_assignment_group_weights: true`, `grading_standard_id: null`

**Assignment groups mock**: single group `{ id: 1, name: 'Exams', group_weight: 100 }`.

**Assertions**:
1. `result.missing_submission_policy === null`
2. `result.late_submission_policy === null`
3. `result.group_weighting.weighted === true` (group data still returned)
4. `result.caveats` has exactly one entry containing "instructor or admin permissions"
5. `result.summary` contains group name and weight, and ends with the permissions note

### Fixture D — Grading standard is account-scoped (two-level fallback)

**Course mock**: `grading_standard_id: 42`, `account_id: 10`

**Course-level grading standards mock**: `listForCourse(1)` returns `[]` (standard is
account-scoped; `/courses/:id/grading_standards` returns only course-owned standards).

**Account-level grading standards mock**: `listForAccount(10)` returns
`[{ id: 42, title: 'Institutional Scale', grading_scheme: [...] }]`.

**Assertions**:
1. `result.grading_scheme.applied === true`
2. `result.grading_scheme.standard_title === 'Institutional Scale'`
3. Both `listForCourse` AND `listForAccount` mocks were called (verify via spy)

### Fixture E — Grading standard set but not retrievable

**Course mock**: `grading_standard_id: 99`, `account_id: 10`

**Both `listForCourse(1)` and `listForAccount(10)`** return arrays that do not include id 99.

**Assertions**:
1. `result.grading_scheme.applied === true`
2. `result.grading_scheme.standard_id === 99`
3. `result.grading_scheme.standard_title === null`
4. `result.caveats` contains a string matching "Grading standard (id: 99) could not be retrieved"

### Fixture F — Late penalty with no floor (`minimum_percent_enabled: false`)

**Late policy mock** (200): `late_submission_deduction_enabled: true`,
`late_submission_deduction: 5`, `late_submission_interval: 'hour'`,
`late_submission_minimum_percent_enabled: false`, `late_submission_minimum_percent: 0`.

**Assertions**:
1. `result.late_submission_policy.minimum_percent_enabled === false`
2. `result.late_submission_policy.minimum_percent === 0`
3. `result.summary` contains "5%" and "hour" but does NOT contain "floor" or "minimum" or "below"

### Fixture G — `deduction_percent === 0` with policy enabled (edge case)

**Late policy mock** (200): `missing_submission_deduction_enabled: true`,
`missing_submission_deduction: 0` (policy enabled but deduction is 0%).

**Assertion**:
1. `result.summary` contains "no deduction (0%)" or equivalent — does NOT say "100%"
   (i.e. the `(100 - 0) = 100%` formula is NOT applied)

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
| `src/canvas/index.ts` | Import `LatePolicyModule`; declare `latePolicy: LatePolicyModule` property; assign in constructor |
| `src/tools/grading-policy.ts` | **New** — `gradingPolicyTools(canvas, pseudonymizer?)` with `explain_grading_policy` ToolDefinition, `Promise.allSettled` calls, and summary generation |
| `src/tools/catalog.ts` | Import `gradingPolicyTools`; add `grading_policy` domain entry after `grade_explanation` |
| `tests/grading-policy.test.ts` | **New** — Fixtures A–G with mocked Canvas responses |

**6 files total. No new package dependencies. No student PII (pseudonymizer accepted but unused).**

Existing modules used without modification:
- `src/canvas/courses.ts` — `CoursesModule.get(courseId)` (already exists)
- `src/canvas/assignments.ts` — `AssignmentsModule.listGroups(courseId)` (already exists)
- `src/canvas/grading-standards.ts` — `GradingStandardsModule.listForCourse()` /
  `listForAccount()` (already exists and registered on `CanvasClient` as `canvas.gradingStandards`)

---

## Open questions for CTO review

None — all design unknowns are retired above. The spec is implementation-ready.
