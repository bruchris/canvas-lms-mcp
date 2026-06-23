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

Same pattern for `late_submission_policy.source`. When either field is `null` (403 case), the
state is unknown — callers must NOT infer "policy is off" from a null field.

The **synthetic default object** used when Canvas returns 404 is:

```ts
const DEFAULT_LATE_POLICY = {
  late_submission_deduction_enabled: false,
  late_submission_deduction: 0,
  late_submission_interval: 'day' as const,
  late_submission_minimum_percent_enabled: false,
  late_submission_minimum_percent: 0,
  missing_submission_deduction_enabled: false,
  missing_submission_deduction: 0,
}
```

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
| 3 | `GET /api/v1/courses/:id/assignment_groups` | Group names and weights | `canvas.assignments.listGroups(courseId)` (existing; omit `include` opts to skip assignments) |
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
let rawLatePolicy: CanvasLatePolicy = DEFAULT_LATE_POLICY
let policyUnavailable = false

if (latePolicyResult.status === 'fulfilled') {
  rawLatePolicy = latePolicyResult.value
  latePolicySource = 'api'
} else {
  const err = latePolicyResult.reason
  if (err instanceof CanvasApiError && err.status === 403) {
    policyUnavailable = true  // both policy output fields become null
  } else if (err instanceof CanvasApiError && err.status === 404) {
    latePolicySource = 'default'  // rawLatePolicy stays as DEFAULT_LATE_POLICY
  } else {
    return formatError(err)  // 5xx, network error — propagate
  }
}

// Initialize caveats (always starts as empty array)
const caveats: string[] = []
if (policyUnavailable) {
  caveats.push(
    'Late/missing submission policy requires instructor or admin permissions '
    + '— policy details are not accessible with this token.',
  )
}
```

Note: `canvas.assignments.listGroups(courseId)` is called without options (the second parameter
defaults to `{}`), so `include[]=assignments` is NOT sent and only group metadata is returned.

**Grading standard lookup (call 4):**

```ts
let standardTitle: string | null = null
if (course.grading_standard_id != null) {
  // Canvas /courses/:id/grading_standards returns ONLY course-owned standards;
  // account-inherited standards are NOT included, so an account-level fallback is needed.
  const courseStandards = await canvas.gradingStandards.listForCourse(courseId)
  const found = courseStandards.find(s => s.id === course.grading_standard_id)
  if (found) {
    standardTitle = found.title
  } else if (course.account_id != null) {
    const accountStandards = await canvas.gradingStandards.listForAccount(course.account_id)
    const foundInAccount = accountStandards.find(s => s.id === course.grading_standard_id)
    if (foundInAccount) {
      standardTitle = foundInAccount.title
    } else {
      caveats.push(`Grading standard (id: ${course.grading_standard_id}) could not be retrieved.`)
    }
  } else {
    caveats.push(`Grading standard (id: ${course.grading_standard_id}) could not be retrieved.`)
  }
}
```

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

**Register in `src/canvas/index.ts`** (following the exact pattern of all existing modules):

```ts
// 1. Add import alongside existing module imports:
import { LatePolicyModule } from './late-policy'

// 2. Declare as a class property in the class body, alongside e.g. `courses: CoursesModule`:
latePolicy: LatePolicyModule

// 3. Assign in the constructor body, alongside e.g. `this.courses = new CoursesModule(...)`:
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

Note: `grading_standard_id?: number | null` and `account_id?: number` are already present on
`CanvasCourse` in `types.ts` — no additional type changes needed for those fields.

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

### Input schema

Following the `ToolDefinition.inputSchema` shape used by all other tools (a `Record<string, ZodTypeAny>`,
not a `z.object()` wrapper):

```ts
inputSchema: {
  course_id: z.number().int().positive().describe(
    'Canvas course ID to explain the grading policy for.'
  ),
}
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
  // Non-null for both 200 (source: 'api') and 404/default (source: 'default') responses.
  // When null, treat values as UNKNOWN — not as "no penalty".
  missing_submission_policy: {
    source: 'api' | 'default',  // 'api' = Canvas returned data; 'default' = no policy row (404)
    enabled: boolean,             // mirrors missing_submission_deduction_enabled
    deduction_percent: number,    // mirrors missing_submission_deduction (0-100)
  } | null,
  late_submission_policy: {
    source: 'api' | 'default',
    enabled: boolean,
    deduction_percent: number,    // mirrors late_submission_deduction
    interval: 'hour' | 'day',    // mirrors late_submission_interval
    minimum_percent_enabled: boolean,
    minimum_percent: number,      // mirrors late_submission_minimum_percent
  } | null,
  group_weighting: {
    weighted: boolean,
    // Each group: { id, name, weight } where weight maps from CanvasAssignmentGroup.group_weight
    groups: Array<{ id: number; name: string; weight: number }>,
  },
  grading_scheme: {
    applied: boolean,             // true iff grading_standard_id is non-null
    standard_id: number | null,
    standard_title: string | null,  // populated if applied; null if unretrievable or not set
  },
  summary: string,
  caveats: string[],             // initialised as []; strings appended as issues arise
}
```

**Field mapping from Canvas types to output:**

```ts
// group_weighting.groups is built by mapping CanvasAssignmentGroup[]:
groups: assignmentGroups.map(g => ({ id: g.id, name: g.name, weight: g.group_weight }))

// missing_submission_policy (when non-null):
{
  source: latePolicySource,
  enabled: rawLatePolicy.missing_submission_deduction_enabled,
  deduction_percent: rawLatePolicy.missing_submission_deduction,
}

// late_submission_policy (when non-null):
{
  source: latePolicySource,
  enabled: rawLatePolicy.late_submission_deduction_enabled,
  deduction_percent: rawLatePolicy.late_submission_deduction,
  interval: rawLatePolicy.late_submission_interval,
  minimum_percent_enabled: rawLatePolicy.late_submission_minimum_percent_enabled,
  minimum_percent: rawLatePolicy.late_submission_minimum_percent,
}
```

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

`caveats` starts as `[]`; strings are pushed as issues are encountered. The summary is
built by joining non-empty blocks with a space.

```
missing_block:
  if missing_submission_policy === null:  skip  // permission caveat added below
  elif enabled:
    if deduction_percent === 100: "Missing work is automatically scored 0% (auto-zero)."
    elif deduction_percent === 0:  "Missing work policy is enabled with no deduction (0%)."
    else: "Missing work loses <deduction_percent>% of possible points automatically."
  else: "No automatic missing-work penalty."

late_block:
  if late_submission_policy === null:  skip
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

permission note (appended when missing_submission_policy === null):
  // one caveat entry covers both policy fields (single 403 caused both to be null):
  caveats.push('Late/missing penalty details require instructor or admin permissions — not available with this token.')
  // append to summary after scheme_block:
  + " Late/missing penalty details require instructor permissions and are not available."

summary = [missing_block, late_block, weighting_block, scheme_block]
  .filter(Boolean).join(" ")
  (permission note text appended to summary when policyUnavailable)
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

Note: if Canvas adds user-identity fields (e.g. `created_by`) to `late_policy` or
`grading_standards` responses in future API versions, this tool must be re-evaluated for PII exposure.

---

## Error handling

| Scenario | Handling |
|----------|----------|
| 403 on `late_policy` call | Set `policyUnavailable = true`; both policy fields become `null`; push one caveat entry; continue |
| 404 on `late_policy` call | Use `DEFAULT_LATE_POLICY`, `source: 'default'`; no caveat |
| 5xx or network error on `late_policy` call | Propagate via `formatError()`; discard partial data |
| 403 or 404 on course or assignment_groups | Propagate via `formatError()` — tool cannot function without course data |
| `grading_standard_id` set, not in course-level list | Try `listForAccount(course.account_id)` |
| Standard not found in either course or account list | `standard_title: null`; push caveat |
| `account_id` is null/undefined and standard not in course list | `standard_title: null`; push caveat |
| Network failure on any call | Propagate via `formatError()` |

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

**Assignment groups mock** (no `include[]=assignments`):
```json
[
  { "id": 1, "name": "Exams", "group_weight": 60 },
  { "id": 2, "name": "Homework", "group_weight": 40 }
]
```

**Grading standards mock**: `listForCourse(1)` returns `[{ id: 42, title: 'Default Grading Scale', grading_scheme: [] }]`.

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
10. `result.group_weighting.groups` is `[{ id: 1, name: 'Exams', weight: 60 }, { id: 2, name: 'Homework', weight: 40 }]`
11. `result.grading_scheme.applied === true`
12. `result.grading_scheme.standard_title === 'Default Grading Scale'`
13. `result.summary` contains "auto-zero" and "10%" and "day" and "50%" and "Exams" and "Homework"
14. `result.caveats` is `[]`

### Fixture B — No policy configured (late_policy returns 404)

**Course mock**: `apply_assignment_group_weights: false`, `grading_standard_id: null`

**Late policy call**: throws `CanvasApiError` with `status: 404`.

**Assignment groups mock**: `[{ id: 1, name: 'Assignments', group_weight: 0 }]`.

**Assertions**:
1. `result.missing_submission_policy` is not null
2. `result.missing_submission_policy.enabled === false`
3. `result.missing_submission_policy.source === 'default'`
4. `result.late_submission_policy.enabled === false`
5. `result.late_submission_policy.source === 'default'`
6. `result.group_weighting.weighted === false`
7. `result.grading_scheme.applied === false`
8. `result.grading_scheme.standard_id === null`
9. `result.summary` contains "No automatic" and "not weighted" and "No letter-grade"
10. `result.caveats` is `[]`

### Fixture C — Student token (403 on late_policy)

**Late policy call**: throws `CanvasApiError` with `status: 403`.

**Course mock**: `apply_assignment_group_weights: true`, `grading_standard_id: null`

**Assignment groups mock**: `[{ id: 1, name: 'Exams', group_weight: 100 }]`.

**Assertions**:
1. `result.missing_submission_policy === null`
2. `result.late_submission_policy === null`
3. `result.group_weighting.weighted === true`
4. `result.group_weighting.groups[0].weight === 100` (mapping from `group_weight`)
5. `result.caveats.length === 1` (exactly one caveat for both policy fields)
6. `result.caveats[0]` contains "instructor or admin permissions"
7. `result.summary` contains "Exams" and "100%" and "instructor permissions"

### Fixture D — Grading standard is account-scoped (two-level fallback)

**Course mock**: `grading_standard_id: 42`, `account_id: 10`

**`listForCourse(1)` mock**: returns `[]` (standard is account-scoped; this endpoint returns
only course-owned standards, not inherited ones).

**`listForAccount(10)` mock**: returns `[{ id: 42, title: 'Institutional Scale', grading_scheme: [] }]`.

**Assertions**:
1. `result.grading_scheme.applied === true`
2. `result.grading_scheme.standard_title === 'Institutional Scale'`
3. Spy confirms both `listForCourse` and `listForAccount` were called
4. `result.caveats` is `[]`

### Fixture E — Grading standard set but not retrievable at either level

**Course mock**: `grading_standard_id: 99`, `account_id: 10`

**`listForCourse(1)` mock**: returns `[{ id: 1, title: 'Other', grading_scheme: [] }]` (id 99 not present).

**`listForAccount(10)` mock**: returns `[]`.

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
`missing_submission_deduction: 0`.

**Assertion**:
1. `result.summary` contains "no deduction (0%)" — does NOT say "100%"
   (the `(100 - 0)` formula must NOT be applied for this case)

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
| `src/canvas/index.ts` | Import `LatePolicyModule`; declare property; assign in constructor |
| `src/tools/grading-policy.ts` | **New** — `gradingPolicyTools(canvas, pseudonymizer?)` with `explain_grading_policy` ToolDefinition, `Promise.allSettled` orchestration, `DEFAULT_LATE_POLICY` constant, and summary generation |
| `src/tools/catalog.ts` | Import `gradingPolicyTools`; add `grading_policy` domain entry after `grade_explanation` |
| `tests/grading-policy.test.ts` | **New** — Fixtures A–G with mocked Canvas responses |

**6 files total. No new package dependencies. No student PII (pseudonymizer accepted but unused).**

Existing modules used without modification:
- `src/canvas/courses.ts` — `CoursesModule.get(courseId)` ✅
- `src/canvas/assignments.ts` — `AssignmentsModule.listGroups(courseId)` (second param omitted; defaults to `{}`) ✅
- `src/canvas/grading-standards.ts` — `GradingStandardsModule.listForCourse()` / `listForAccount()` (registered on `CanvasClient` as `canvas.gradingStandards`) ✅

---

## Open questions for CTO review

None — all design unknowns are retired above. The spec is implementation-ready.
