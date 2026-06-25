---
issue: 218
---

# Audit Course Links — MCP Tool Design

**Date**: 2026-06-25
**Issue**: [bruchris/canvas-lms-mcp#218](https://github.com/bruchris/canvas-lms-mcp/issues/218)
**Status**: Design — awaiting CTO review

---

## Purpose

Add a single read-only tool, `audit_course_links`, that composes existing Canvas read endpoints
to detect broken and outdated references in a course's content. An instructor asks "which links,
images, or videos in my course are broken or point at a previous copy of the course?" and gets
a structured list of findings — grouped by content item, with the exact href/src value and
classification reason — so they can fix dead content before students encounter it.

This is deliberately **structural-only** in v1: the tool detects problems that are unambiguous
from Canvas content alone (cross-course references, empty/malformed URLs). Outbound HTTP
liveness checking is deferred to a future opt-in flag.

---

## Design unknowns (retired)

### 1. API approach

**Decision: compose documented content endpoints; do NOT rely on `link_validation`.**

Canvas has an internal "Validate Links in Content" feature accessible via the UI, exposed
internally as a `link_validation` controller. This endpoint does not appear in the public
`/api/v1` reference, and the Canvas community explicitly confirms it is not available for
external API consumption. The tool MUST NOT depend on
`/api/v1/courses/:id/link_validation` or any undocumented route.

Instead, `audit_course_links` composes four documented content endpoints to fetch course HTML:

| Source | Canvas method | HTML field |
| ------ | ------------- | ---------- |
| Pages | `pages.listWithBodies(courseId)` | `CanvasPage.body` |
| Assignments | `assignments.list(courseId)` | `CanvasAssignment.description` |
| Syllabus | `courses.getSyllabus(courseId)` | returns the raw `syllabus_body` string |
| Announcements | `discussions.listAnnouncements(courseId)` | `CanvasAnnouncement.message` |

This follows the project's composing-tool pattern established by `check_course_setup` and
`explain_grade` — no new API dependencies, no unverified endpoints.

### 2. External liveness checking

**Decision: defer `check_external` to a follow-up; v1 is structural-only.**

Fetching each external URL to verify HTTP 200/404 status means the MCP server makes arbitrary
outbound requests beyond the configured Canvas instance. This conflicts with the canvas-only
product constraint. The `check_external` parameter is intentionally omitted from the v1 tool
schema; a future PR can add it as an opt-in flag once the outbound-call policy is settled.

v1 detects two structurally-evident problem classes:
1. **`cross_course_reference`** — an href/src whose path contains `/courses/{N}/` where N ≠ the
   audited course ID. This is the canonical stale-copy failure: after a course import, content
   still references files, pages, or items scoped to the source course.
2. **`empty_or_malformed`** — empty href/src, `#`-only anchors, or `javascript:` URLs
   (non-navigable by definition).

### 3. Scope

**Decision: read-only structural audit only.**

No auto-fix, no bulk find-and-replace. The tool reports findings; remediation is a separate
write-side concern (a later PR).

---

## Canvas client addition (`src/canvas/pages.ts`)

Add one new method to the existing `PagesModule` class. No new file.

### Method: `listWithBodies`

```ts
async listWithBodies(courseId: number): Promise<CanvasPage[]> {
  const stubs = await this.client.paginate<CanvasPage>(`/api/v1/courses/${courseId}/pages`)
  return Promise.all(stubs.map((s) => this.get(courseId, s.url)))
}
```

**Why a new method (not reusing `list`)**: `pages.list()` returns page stubs without the `body`
field — Canvas does not include page content in the paginated list response. The audit needs
each page's HTML body to scan for links and images. The dedicated `listWithBodies` method uses
a fan-out of `this.get()` calls, exactly mirroring the `listWithItems` pattern in `modules.ts`.
`CanvasPage.body` is already typed as `string | undefined` in `types.ts`; no type change needed.

**Pagination**: `client.paginate()` handles Link-header pagination on the stubs list. Each
individual `this.get()` call is a direct single-page request.

**Error propagation**: `CanvasApiError` propagates unchanged from both `client.paginate()` and
`this.get()`. The tool layer's `formatError()` handles all 401/403/404/network cases.

---

## Tool module — `src/tools/link-audit.ts` (new file)

### Type definitions (module-level)

```ts
const CONTENT_SOURCES = ['pages', 'assignments', 'syllabus', 'announcements'] as const
type ContentSource = (typeof CONTENT_SOURCES)[number]
type LinkKind = 'link' | 'image' | 'video'
type FindingReason = 'cross_course_reference' | 'empty_or_malformed'

interface ContentLocation {
  type: ContentSource
  id: number
  title: string
}

interface LinkFinding {
  location: ContentLocation
  kind: LinkKind
  href: string
  reason: FindingReason
  cross_course_id?: number
}
```

### HTML extraction helpers (module-level, not exported)

```ts
const HREF_RE = /<a\b[^>]*\bhref="([^"]*)"[^>]*>/gi
const IMG_SRC_RE = /<img\b[^>]*\bsrc="([^"]*)"[^>]*>/gi
const EMBED_SRC_RE = /<(?:iframe|embed|video|source)\b[^>]*\bsrc="([^"]*)"[^>]*>/gi

function extractUrls(html: string | null | undefined): Array<{ kind: LinkKind; raw: string }> {
  if (!html) return []
  const results: Array<{ kind: LinkKind; raw: string }> = []
  let m: RegExpExecArray | null
  HREF_RE.lastIndex = 0
  while ((m = HREF_RE.exec(html)) !== null) results.push({ kind: 'link', raw: m[1] })
  IMG_SRC_RE.lastIndex = 0
  while ((m = IMG_SRC_RE.exec(html)) !== null) results.push({ kind: 'image', raw: m[1] })
  EMBED_SRC_RE.lastIndex = 0
  while ((m = EMBED_SRC_RE.exec(html)) !== null) results.push({ kind: 'video', raw: m[1] })
  return results
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

function classifyUrl(
  raw: string,
  courseId: number,
): { reason: FindingReason; crossCourseId?: number } | null {
  const href = decodeHtmlEntities(raw).trim()
  if (!href || href === '#' || href.startsWith('javascript:')) {
    return { reason: 'empty_or_malformed' }
  }
  const crossCourseMatch = href.match(/\/courses\/(\d+)\//)
  if (crossCourseMatch) {
    const refId = parseInt(crossCourseMatch[1], 10)
    if (refId !== courseId) {
      return { reason: 'cross_course_reference', crossCourseId: refId }
    }
  }
  return null
}

function scanHtml(
  html: string | null | undefined,
  courseId: number,
  location: ContentLocation,
): LinkFinding[] {
  const findings: LinkFinding[] = []
  for (const { kind, raw } of extractUrls(html)) {
    const result = classifyUrl(raw, courseId)
    if (!result) continue
    const finding: LinkFinding = { location, kind, href: raw, reason: result.reason }
    if (result.crossCourseId !== undefined) finding.cross_course_id = result.crossCourseId
    findings.push(finding)
  }
  return findings
}
```

### Tool: `audit_course_links`

```ts
{
  name: 'audit_course_links',
  description:
    "Scan a course's content (pages, assignments, syllabus, announcements) for broken or " +
    'outdated links and images. Returns structured findings: cross-course references (links ' +
    'that still point at a previous copy of the course — the canonical stale-copy failure ' +
    'after a course import) and empty/malformed URLs. Structural checks only — no outbound ' +
    'HTTP requests. Requires instructor permissions in the course.',
  inputSchema: {
    course_id: z.number().int().positive().describe('Canvas course ID'),
    include: z
      .array(z.enum(['pages', 'assignments', 'syllabus', 'announcements']))
      .optional()
      .describe(
        'Content sources to scan. Omit to scan all four. ' +
          'Valid values: pages, assignments, syllabus, announcements.',
      ),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  handler: async (params) => {
    const courseId = params.course_id as number
    const activeInclude = new Set<ContentSource>(
      (params.include as ContentSource[] | undefined) ?? [...CONTENT_SOURCES],
    )

    const [pages, assignments, syllabus, announcements] = await Promise.all([
      activeInclude.has('pages')
        ? canvas.pages.listWithBodies(courseId)
        : Promise.resolve([]),
      activeInclude.has('assignments')
        ? canvas.assignments.list(courseId)
        : Promise.resolve([]),
      activeInclude.has('syllabus')
        ? canvas.courses.getSyllabus(courseId)
        : Promise.resolve(null),
      activeInclude.has('announcements')
        ? canvas.discussions.listAnnouncements(courseId)
        : Promise.resolve([]),
    ])

    const findings: LinkFinding[] = []

    if (activeInclude.has('pages')) {
      for (const page of pages) {
        findings.push(
          ...scanHtml(page.body, courseId, { type: 'pages', id: page.page_id, title: page.title }),
        )
      }
    }

    if (activeInclude.has('assignments')) {
      for (const a of assignments) {
        findings.push(
          ...scanHtml(a.description, courseId, { type: 'assignments', id: a.id, title: a.name }),
        )
      }
    }

    if (activeInclude.has('syllabus') && syllabus) {
      findings.push(
        ...scanHtml(syllabus, courseId, { type: 'syllabus', id: courseId, title: 'Syllabus' }),
      )
    }

    if (activeInclude.has('announcements')) {
      for (const ann of announcements) {
        findings.push(
          ...scanHtml(ann.message, courseId, {
            type: 'announcements',
            id: ann.id,
            title: ann.title,
          }),
        )
      }
    }

    return {
      summary: {
        course_id: courseId,
        sources_scanned: [...activeInclude],
        total_findings: findings.length,
      },
      findings,
    }
  },
}
```

**Notes on design decisions baked into the handler:**

- **Parallel fetch with `Promise.all` and conditional gates**: Only sources in `activeInclude`
  generate API calls. The pages fan-out (`listWithBodies`) is the most expensive call; omitting
  `'pages'` from `include` skips it entirely.
- **`pages.listWithBodies` fan-out**: The page list endpoint does not return `body`. Each page
  requires an individual GET — for large courses this can be dozens of requests. The `include`
  filter mitigates this: callers who only care about syllabus links can exclude pages.
- **Syllabus null-guard**: `canvas.courses.getSyllabus()` returns `null` when the course has no
  syllabus. The outer `&& syllabus` guard avoids pushing an empty-scan location into findings.
  `scanHtml` also null-guards defensively.
- **`classifyUrl` — cross-course match scope**: The regex `/\/courses\/(\d+)\//` matches any URL
  segment containing `/courses/{id}/`. This correctly flags relative same-instance paths
  (`/courses/456/files/...`). External URLs to other Canvas instances containing a different
  course ID may also be flagged — acceptable for v1 where the primary use-case is stale-copy
  within the same institution.
- **HTML entity decoding before classification**: Canvas stores HTML with encoded entities
  (`&amp;` in attribute values). `decodeHtmlEntities` normalises these before the regex
  classification to avoid false negatives on cross-course URLs that contain `&amp;` in query
  strings.
- **Regex `lastIndex` reset**: All three regexes carry the `g` flag and maintain `lastIndex`
  state across calls. Explicitly resetting `lastIndex = 0` at the start of each `extractUrls`
  invocation prevents stale state across different HTML strings.
- **`<source>` tag included in `EMBED_SRC_RE`**: `<source>` elements appear inside `<video>`
  containers and carry the actual media URL in `src`. Including them under the `video` kind
  ensures media references inside video elements are scanned.
- **No new package dependencies**: HTML link extraction uses built-in JS regex. Canvas generates
  predictably structured HTML (double-quoted attributes, no arbitrary user-crafted markup in
  attribute position), making regex extraction accurate for this use-case without a DOM parser.

---

## Catalog registration (`src/tools/catalog.ts`)

### 1. Import (add after `import { gradingPolicyTools } from './grading-policy'`):

```ts
import { linkAuditTools } from './link-audit'
```

### 2. Entry (add after the `grading_policy` entry at the end of `toolDomainCatalog`):

```ts
  {
    domain: 'link_audit',
    defaultPrimaryAudience: 'educator',
    getTools: linkAuditTools,
  },
```

---

## FERPA / pseudonymizer coverage

**No pseudonymizer wrapping required. Do NOT add `audit_course_links` to
`PSEUDONYMIZER_WRAPPED_TOOLS`.**

The output payload contains:
- Assignment IDs and names (course content metadata, not student data)
- Page IDs (`page_id`) and titles (course content metadata)
- Announcement IDs and titles (course content metadata)
- `href`/`src` URL strings extracted from course HTML (content metadata)
- Numeric course ID

None of these are a `CanvasUser` object, a `participants` array, or a `user_name` string — the
three triggering patterns for `PSEUDONYMIZER_WRAPPED_TOOLS` registration.
`tests/pseudonym/coverage.test.ts` passes without modification.

---

## Test plan

All tests use mocked Canvas responses. No live Canvas calls.

### Canvas client test — `tests/canvas/pages.test.ts` (modify existing file)

Add a `describe('listWithBodies')` block:

**`listWithBodies` cases:**

1. **Happy path — fan-out**: Mock `client.paginate` returns two stubs:
   ```ts
   [
     { page_id: 1, url: 'introduction', title: 'Introduction', published: true, updated_at: '' },
     { page_id: 2, url: 'week-1',       title: 'Week 1',       published: true, updated_at: '' },
   ]
   ```
   Mock `client.request` (used by `this.get`) to augment each stub with
   `body: '<p>Hello</p>'`. Assert `listWithBodies(42)` returns two pages each with a non-null
   `body`. Assert `client.paginate` called with `('/api/v1/courses/42/pages')`. Assert
   `client.request` called twice, once for each page URL.

2. **Empty course**: Mock `client.paginate` returns `[]`. Assert `listWithBodies(42)` returns
   `[]` and `client.request` is never called.

3. **Error propagation from `paginate`**: Mock `client.paginate` throws
   `new CanvasApiError('Not Found', 404, '...')`. Assert the error propagates unchanged from
   `listWithBodies`.

4. **Error propagation from `get`**: Mock `client.paginate` returns one stub; mock
   `client.request` throws `new CanvasApiError('Forbidden', 403, '...')`. Assert the error
   propagates unchanged from `listWithBodies`.

### Tool tests — `tests/tools/link-audit.test.ts` (new file)

**`buildMockCanvas()` helper** (course ID = `100` throughout):

```ts
function buildMockCanvas() {
  return {
    pages: {
      listWithBodies: vi.fn().mockResolvedValue([
        {
          page_id: 1,
          url: 'intro',
          title: 'Introduction',
          published: true,
          updated_at: '',
          body: '<p>Read more at <a href="/courses/100/pages/foo">here</a></p>',
        },
        {
          page_id: 2,
          url: 'week1',
          title: 'Week 1',
          published: true,
          updated_at: '',
          body: '<p>See <img src="/courses/999/files/42/download"> for details.</p>',
        },
      ]),
    },
    assignments: {
      list: vi.fn().mockResolvedValue([
        {
          id: 10,
          name: 'Essay',
          description: '<p>Submit via <a href="/courses/100/assignments/5">Canvas</a></p>',
          course_id: 100,
          due_at: null,
          points_possible: 10,
          grading_type: 'points',
          submission_types: [],
          allowed_attempts: -1,
        },
        {
          id: 11,
          name: 'Quiz',
          description: null,
          course_id: 100,
          due_at: null,
          points_possible: 5,
          grading_type: 'points',
          submission_types: [],
          allowed_attempts: -1,
        },
      ]),
    },
    courses: {
      getSyllabus: vi.fn().mockResolvedValue(
        '<p>Week 1: <a href="/courses/50/pages/overview">Old link</a></p>',
      ),
    },
    discussions: {
      listAnnouncements: vi.fn().mockResolvedValue([
        { id: 20, title: 'Welcome', message: '<p>See <img src=""> for info.</p>', posted_at: '' },
      ]),
    },
  } as unknown as CanvasClient
}
```

**Suite-level checks:**
- `linkAuditTools(buildMockCanvas())` returns exactly **1** tool definition.
- Tool name: `'audit_course_links'`.
- `annotations: { readOnlyHint: true, openWorldHint: true }`.

**Full scan (no `include` param — all four sources):**

1. **Cross-course image in page → finding**: `Week 1` page has
   `<img src="/courses/999/files/42/download">` (course 999 ≠ 100). Assert finding:
   `{ location: { type: 'pages', id: 2, title: 'Week 1' }, kind: 'image', reason: 'cross_course_reference', cross_course_id: 999 }`.

2. **Same-course page link → no finding**: `Introduction` page has
   `<a href="/courses/100/pages/foo">`. Assert this URL does NOT appear in findings (IDs match).

3. **Same-course assignment link → no finding**: `Essay` description contains
   `/courses/100/assignments/5`. Assert no finding for assignment id 10.

4. **Null assignment description → no finding**: `Quiz` has `description: null`.
   Assert no finding for assignment id 11.

5. **Cross-course syllabus link → finding**: Syllabus has
   `<a href="/courses/50/pages/overview">` (course 50 ≠ 100). Assert finding:
   `{ location: { type: 'syllabus', id: 100, title: 'Syllabus' }, kind: 'link', reason: 'cross_course_reference', cross_course_id: 50 }`.

6. **Empty `src` in announcement → finding**: `Welcome` message has `<img src="">`.
   Assert finding: `{ location: { type: 'announcements', id: 20 }, kind: 'image', reason: 'empty_or_malformed' }`.
   Assert `cross_course_id` is absent on this finding.

7. **`total_findings` matches `findings.length`**: Assert
   `result.summary.total_findings === result.findings.length`.

8. **`sources_scanned` lists all four**: Assert `result.summary.sources_scanned` is an array
   containing all of `'pages'`, `'assignments'`, `'syllabus'`, `'announcements'` (any order).

**`include` filter:**

9. **Single source — only syllabus fetched**: Call `{ course_id: 100, include: ['syllabus'] }`.
   Assert `canvas.pages.listWithBodies` is NOT called.
   Assert `canvas.assignments.list` is NOT called.
   Assert `canvas.discussions.listAnnouncements` is NOT called.
   Assert `canvas.courses.getSyllabus` IS called.
   Assert `result.summary.sources_scanned` equals `['syllabus']`.

10. **Multi-source include**: Call `{ course_id: 100, include: ['pages', 'announcements'] }`.
    Assert `canvas.pages.listWithBodies` IS called.
    Assert `canvas.discussions.listAnnouncements` IS called.
    Assert `canvas.assignments.list` is NOT called.
    Assert `canvas.courses.getSyllabus` is NOT called.
    Assert every finding in `result.findings` has
    `location.type === 'pages' || location.type === 'announcements'`.

**Classification edge cases:**

11. **`javascript:` href → `empty_or_malformed`**: Override pages mock to return a single page
    with `body: '<a href="javascript:void(0)">click</a>'`. Call with
    `{ course_id: 100, include: ['pages'] }`. Assert finding
    `{ kind: 'link', reason: 'empty_or_malformed' }` and no `cross_course_id`.

12. **Pure `#` anchor → `empty_or_malformed`**: Page with `body: '<a href="#">top</a>'`. Assert
    finding `{ kind: 'link', reason: 'empty_or_malformed' }`.

13. **HTML entity-encoded URL decoded and classified**: Page with
    `body: '<a href="/courses/999/pages/foo?a=1&amp;b=2">x</a>'`. Assert finding
    `{ reason: 'cross_course_reference', cross_course_id: 999 }`.

14. **Iframe src classified as `video`**: Assignment with
    `description: '<iframe src="/courses/999/media_objects/m1"></iframe>'`. Call with
    `{ course_id: 100, include: ['assignments'] }`. Assert finding
    `{ kind: 'video', reason: 'cross_course_reference', cross_course_id: 999 }`.

15. **External link (no `/courses/` segment) → no finding**: Page with
    `body: '<a href="https://external.com/docs">docs</a>'`. Assert no finding emitted (external
    links without a `/courses/{n}/` segment are not classified in v1).

16. **Empty body → no findings**: Page with `body: ''`. Assert no finding for that page.

17. **Null syllabus → no findings**: Override `getSyllabus` mock to return `null`. Assert no
    finding with `location.type === 'syllabus'` and no error thrown.

### Registry test — `tests/tools/registry.test.ts` (modify existing file)

**Three changes:**

**Change 1 — `buildFullMockCanvas()` pages mock**: Add `listWithBodies` to the existing `pages`
property:

```ts
    pages: {
      list: async () => [],
      get: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => undefined,
      listWithBodies: async () => [],    // NEW
    },
```

**Change 2 — tool count and describe string**: Change `expect(tools).toHaveLength(137)` →
`expect(tools).toHaveLength(138)`. Also update `it('returns all 137 tools across all domains', ...)` →
`it('returns all 138 tools across all domains', ...)`.

**Change 3 — `toContain` assertion**: Add after the `// Grading Policy (1)` block:

```ts
    // Link Audit (1)
    expect(names).toContain('audit_course_links')
```

`audit_course_links` has `readOnlyHint: true`. It does NOT appear in `writeToolNames` — the
existing "read tools have readOnlyHint: true" assertion loop covers it automatically.

### Pseudonymizer coverage test — `tests/pseudonym/coverage.test.ts`

No changes. `audit_course_links` does not appear in `PSEUDONYMIZER_WRAPPED_TOOLS`.
The CI coverage test passes without modification.

### Audience coverage test — `tests/tools/audience-coverage.test.ts`

No changes. The domain `link_audit` registers with `defaultPrimaryAudience: 'educator'`.
`audit_course_links` does not set an `audience` override — it inherits `educator`. The CI test
passes without modification.

---

## Implementation checklist for the implementor

1. `src/canvas/pages.ts` — add `listWithBodies(courseId)` method to `PagesModule`.
2. `src/tools/link-audit.ts` — new file with `linkAuditTools()` function, module-level helpers
   (`extractUrls`, `decodeHtmlEntities`, `classifyUrl`, `scanHtml`), inline type definitions, and
   the `audit_course_links` tool definition.
3. `src/tools/catalog.ts` — import `linkAuditTools`; add `link_audit` domain entry after
   `grading_policy`.
4. `tests/canvas/pages.test.ts` — add `listWithBodies` (4 cases) to the existing file.
5. `tests/tools/link-audit.test.ts` — new file (17 test cases across suite-level, full-scan,
   filter, and edge-case groups).
6. `tests/tools/registry.test.ts` — 3 changes: `listWithBodies` on pages mock; count 137→138
   and update `it(...)` description string; `audit_course_links` in `toContain` block.

---

## Acceptance check

- [x] `**design-first**` flag present in issue #218.
- [x] Design unknown §1 (API approach): retired — `link_validation` excluded; tool uses only
  documented endpoints (`pages.listWithBodies`, `assignments.list`, `courses.getSyllabus`,
  `discussions.listAnnouncements`); spec explicitly prohibits any reliance on an unverified route.
- [x] Design unknown §2 (external liveness): retired — `check_external` parameter omitted from
  v1; tool is structural-only; noted in tool description and this spec.
- [x] Design unknown §3 (scope): retired — read-only audit only; no write operations.
- [x] No new package dependencies (HTML parsing uses built-in JS regex only).
- [x] No student PII in output (course content metadata only); pseudonymizer wrapping NOT
  required; explicit statement in FERPA section. CI pseudonymizer coverage test unaffected.
- [x] Exact tool name (`audit_course_links`), Zod schema, Canvas endpoints, MCP annotations
  (`readOnlyHint: true`, `openWorldHint: true`), and output shape fully specified.
- [x] Canvas client addition: `listWithBodies` on `PagesModule` with exact endpoint,
  fan-out via `this.get()`, `lastIndex` reset rationale noted.
- [x] HTML parsing approach fully specified: three regex patterns per tag type, entity decoding,
  classification logic with `cross_course_reference` and `empty_or_malformed` cases.
- [x] `cross_course_reference` detection logic specified, including scope note on external URLs.
- [x] `empty_or_malformed` detection logic specified (empty string, `#`, `javascript:` prefix).
- [x] `include` filter with conditional parallel fetch specified; each source independently gated.
- [x] `kind` taxonomy: `link` = `<a href>`, `image` = `<img src>`,
  `video` = `<iframe|embed|video|source src>`.
- [x] Parallel fetch strategy with `Promise.all` and conditional gates documented.
- [x] Catalog: verbatim import and insertion point (after `grading_policy`, last entry).
- [x] Registry test: 3 precise changes (mock method; count + description string; `toContain`).
- [x] Test plan: 4 Canvas client cases + 17 tool cases covering full scan, include filter,
  classification edge cases (javascript:, #, entity encoding, iframe, external, empty, null).
- [x] FERPA and audience coverage tests unaffected — explicitly stated.
