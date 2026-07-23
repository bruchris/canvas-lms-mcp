---
issue: 245
---

# Audit Course Content for WCAG Accessibility Issues — MCP Tool Design

**Date**: 2026-07-23
**Issue**: [bruchris/canvas-lms-mcp#245](https://github.com/bruchris/canvas-lms-mcp/issues/245)
**Originating RFC**: [Discussion #85 — "RFC: Accessibility tooling domain"](https://github.com/bruchris/canvas-lms-mcp/discussions/85)
**Paperclip task**: BRU-1868 (child of BRU-1862, CTO Product Research)
**Status**: Design — awaiting CTO review

---

## Purpose

Add a single read-only tool, `audit_course_accessibility`, that scans a course's rich-text content
(pages, assignments, syllabus, announcements, and optionally quizzes) for structurally-detectable
WCAG 2.1 accessibility problems: missing or low-quality image alt text, non-descriptive link text,
adjacent duplicate links, skipped/empty/overlong headings, and tables missing headers, header
scope, or captions. An instructor asks "what accessibility problems does my course content have?"
and gets a structured, per-item finding list with a rule name, a WCAG success-criterion reference,
and a severity, so they can remediate before students — including students using screen readers —
encounter the content.

This tool is deliberately the same shape and scanning scope as the already-shipped
`audit_course_links` (`src/tools/link-audit.ts`): same content sources, same `include` schema, same
"structural checks from already-wrapped HTML, no new package dependency" posture. It is a sibling
tool, not an extension of `audit_course_links` — see Design unknown §1.

---

## RFC alignment — resolving Discussion #85's five open questions

The Paperclip task that scoped this design work (BRU-1868) requires resolving the five open
questions from the originating RFC (Discussion #85) before any implementation subtask is created.
This section maps each one explicitly to a decision made below, plus the RFC's own module-boundary
question and its five brainstormed tool names, none of which should be left as an implicit
inference for a reviewer to reconstruct.

1. **Scope** (RFC: "~5-8 new tools ... closer to v1.x than v1.0 maintenance work"). **Decision: one
   tool, not five to eight.** The RFC brainstormed `audit_course_accessibility`,
   `scan_page_accessibility`, `scan_assignment_accessibility`, `list_files_missing_alt_text`, and
   `suggest_alt_text`. This spec collapses the first three into one: `audit_course_accessibility`'s
   findings are already grouped by `location` (content type + id + title), so a caller wanting a
   single page's results filters the returned `findings` array client-side — a dedicated
   `scan_page_accessibility(course_id, page_id)` tool would duplicate the same scan logic behind a
   narrower, redundant schema for no new capability. `list_files_missing_alt_text` doesn't map to
   real Canvas data as named: alt text is a property of an `<img>` element *referencing* a file
   inside rendered content, not a property Canvas stores on the Files/attachment resource itself —
   there is no `GET .../files` field to query for "this file's alt text." The closest real
   equivalent is exactly this spec's `img_missing_alt`/`img_alt_low_quality` findings, which already
   cover every place an image is actually referenced, regardless of whether the underlying image
   happens to be a Canvas File attachment or an external URL — a strict superset of what a
   Files-scoped version could offer, so it is dropped as redundant rather than built separately.
   `suggest_alt_text` is addressed by the Determinism decision immediately below (excluded, by
   design, not by oversight).
2. **Determinism boundary** (RFC: "HTML-parsing checks are deterministic; alt-text suggestions are
   LLM-mediated and best done in the calling agent, not server-side"). **Decision: this tool only
   detects and describes; it never generates replacement content.** Every rule in the taxonomy
   (Design unknown §4 below) is a pure structural/string check with no LLM call and no generated
   suggestion text — `detail` strings quote what's already in the course's own HTML (an alt value,
   link text, a heading), never a proposed replacement. Drafting better alt text, rewritten link
   text, or restructured headings is left entirely to the calling agent, which already has the
   finding's location and current content and can call this server's existing read tools (e.g.
   `get_page`) for full context and its own write tools (e.g. `update_page`) to apply a fix a human
   approves — this server does not add a `suggest_alt_text`-style generation tool. This is the
   RFC's own line, drawn explicitly rather than left to be inferred from the absence of such a tool.
3. **Performance** (RFC: "pagination + per-domain limits + a documented 'this is best-effort'
   stance"). **Decision: match `audit_course_links`'s existing, already-accepted posture exactly —
   no new artificial cap.** `include` lets a caller narrow which sources are scanned (the same
   mechanism `audit_course_links` uses today); each source's own Canvas client method already
   paginates internally via `client.paginate()`. No submission-count-style limit is added here for
   the same reason none exists on `audit_course_links`: this is a v1 read tool over course-owned
   content (not a firehose of per-student records), and inventing a cap without a demonstrated
   real-world performance problem would be scope not asked for. If a real course proves this too
   slow, the fix is the same lever `audit_course_links` would need — not something to
   speculatively design into two sibling tools independently.
4. **Differentiation vs. `vishalsachdev/canvas-mcp`'s 20-check WCAG scanner** (RFC: "is there a
   TypeScript-specific angle ... that makes us the preferred choice?"). **Decision: yes — typed,
   structured `Finding[]` output, not prose.** Every finding carries a machine-checkable `rule`
   union member, a `wcag` success-criterion string, and a `severity` enum (Design unknown §4) —
   built for a downstream agent to programmatically filter/prioritize ("show me only `error`
   severity", "group by WCAG SC"), which is the differentiation angle the RFC's own "ergonomics for
   downstream agents" framing asked about, versus a scanner that returns a report meant primarily
   for human reading.
5. **Dependencies** (RFC: "prefer zero new runtime deps; a small HTML parser is probably the only
   addition"). **Decision: zero new dependencies, no HTML parser needed at all.** The RFC assumed a
   parser might be unavoidable; `audit_course_links` (shipped after this RFC was written) already
   proved regex-based extraction is accurate enough for Canvas's predictable, double-quoted-attribute
   HTML for a structurally similar problem (link/image extraction). This spec extends that same
   proof to a wider rule set (alt text, links, headings, tables) — see the fully-specified regexes
   below. No `package.json` change.
6. **Module boundary** (RFC's own explicit question, asked inline rather than numbered with the
   other five: "a separate `src/canvas/accessibility.ts` module ... or extend each domain with an
   audit flavor?"). **Decision: neither — no new Canvas client module at all.** Every content source
   this tool needs is already exposed by an existing, already-wrapped Canvas client method (the same
   ones `audit_course_links` uses); no new Canvas endpoint is called, so there is nothing for a
   `src/canvas/accessibility.ts` module to wrap. All new code lives at the tools layer only:
   `src/tools/accessibility-audit.ts`, mirroring the precedent `link-audit.ts` already set (a
   dedicated audit-domain tool file with zero corresponding Canvas client module of its own).

---

## Design unknowns (retired)

### 1. Reuse Canvas's native Course Accessibility Checker vs. build an independent structural audit

**Decision: build an independent structural audit composing already-wrapped content endpoints, the
same way `audit_course_links` resolved the equivalent question for link validation. Do NOT depend
on Canvas's native accessibility checker API.**

Canvas shipped a native "Course Accessibility Checker" (General Availability February 25, 2026,
per Instructure's own release notes and corroborating writeups from SMU IT and University of
Sussex TEL), aligned to WCAG 2.1 AA and scanning Pages and Assignments from a course-navigation
dashboard. It is real and it is not the same non-public situation `link_validation` was in — but
its **documented public REST surface does not fit this tool's needs**:

| Endpoint | What it returns | Why it doesn't fit |
| --- | --- | --- |
| `POST /api/v1/users/:user_id/educator_accessibility_course_scan` | A `Progress` object; queues a scan | Scoped to `user_id` (self), not `course_id` — scans *all* of the caller's a11y-enabled courses at once, not one arbitrary course. No result payload beyond the async job handle. |
| `GET /api/v1/users/:user_id/educator_accessibility_course_statistics` | Per-course `active_issue_count` / `resolved_issue_count` / `closed_issue_count`, plus `course_id`, `course_name`, `course_code`, `published`, `workflow_state` | **Aggregate counts only** — no page/assignment identity, no rule name, no WCAG reference, nothing an instructor or an AI assistant could act on directly. |

Both endpoints additionally require the `educator_dashboard` feature flag (root account) and the
`a11y_checker` / `a11y_checker_account_statistics` flags/permissions, which are not guaranteed
enabled on every Canvas instance this server talks to (the feature is GA but feature-flag-gated
per account, and per-instance opt-in is common practice for newly-GA Canvas features). No
documented endpoint returns individual, actionable findings (which content item, which rule).

This is structurally the same resolution already made in
`docs/superpowers/specs/2026-06-25-issue-218-audit-course-links.md` Design unknown §1 for Canvas's
internal `link_validation` feature: when a native Canvas capability exists but its public API
doesn't expose granular, course-scoped, unconditionally-available data, this project composes
already-wrapped documented content endpoints and does its own structural analysis rather than
depend on the narrower native surface. `audit_course_accessibility` follows the exact same content
sources `audit_course_links` already fetches (see table below) — no new Canvas client method is
needed beyond what `link-audit.ts` already established.

**Complementary, not competing**: the tool description explicitly points instructors at Canvas's
own in-app Accessibility Checker (course navigation → "Accessibility" → "Scan Course") for the
full official remediation workflow (including AI-assisted alt-text generation, where the
`IgniteAI Accessibility Remediation` account feature is enabled) — this tool's job is
programmatic, `course_id`-scoped, AI-assistant-drivable discovery, not to replace Canvas's UI
remediation flow.

### 2. Color contrast checking

**Decision: out of scope for v1. Do not attempt inline-style-only contrast checking.**

WCAG 1.4.3 contrast checking requires the *rendered* foreground/background color pair. The HTML
fragments this server fetches (`page.body`, `assignment.description`, etc.) do not include
Canvas's theme CSS — only whatever inline `style="color:...;background-color:..."` an instructor
happened to author directly carries any color information at all. A best-effort inline-style-only
check would have a very high false-negative rate (most real-world contrast failures come from an
institution's Canvas theme colors, not inline styles) and could actively mislead an instructor into
believing "no contrast issues" when the tool simply had no color information to evaluate. This
mirrors `audit_course_links` Design unknown §2's reasoning for deferring external link liveness
checking: don't ship a check that can't be made structurally reliable from the data already
available. A future iteration could revisit this if a defensible signal emerges (e.g. instructor
opts in and supplies their institution's theme palette) — not attempted here.

### 3. List-misuse detection (visually-list-shaped paragraphs not marked up as `<ul>`/`<ol>`)

**Decision: out of scope for v1.**

This is one of Canvas's own native checker rules ("Lists"), but detecting "these adjacent
paragraphs are visually formatted like a list" from raw HTML is a genuinely fuzzy heuristic (must
recognize bullet-like leading characters — `•`, `-`, `*`, `1.`, `a)` — across sibling `<p>` tags
without a real layout renderer) with a real risk of false positives on ordinary prose that happens
to start a paragraph with a hyphen or number. Deferred rather than shipped as a low-confidence
guess, consistent with this project's "don't fabricate a finding you can't defend" posture (see
`docs/superpowers/specs/2026-07-09-issue-240-quiz-question-responses.md` Design unknown §3 for the
same principle applied to a different tool).

### 4. Rule taxonomy and severity model

**Decision: ten structurally-detectable rules across four families (images, links, headings,
tables), each tagged with a WCAG 2.1 success criterion and a two-tier severity
(`error` | `advisory`) mirroring Canvas's own "Errors" vs. "Suggestions" framing in its Rich Content
Editor and native Course Accessibility Checker.**

| Rule | Family | WCAG SC | Severity | Detected as |
| --- | --- | --- | --- | --- |
| `img_missing_alt` | image | 1.1.1 | `error` | `<img>` with no `alt` attribute at all. |
| `img_alt_low_quality` | image | 1.1.1 | `advisory` | `alt` attribute present and non-empty, but looks like a filename (`.jpg`/`.png`/etc. suffix), a generic placeholder word ("image", "photo", "screenshot", ...), or a camera-style filename (`IMG_1234`, `DSC_0042`). |
| `link_non_descriptive_text` | link | 2.4.4 | `advisory` | A link's accessible name (its stripped text content, or its sole child image's `alt` text when the link has no text of its own) is empty or matches a known non-descriptive phrase ("click here", "here", "read more", "more", "link", ...). |
| `adjacent_duplicate_links` | link | 2.4.4 | `advisory` | Two `<a>` elements pointing at the identical `href`, separated only by whitespace (no other content between them) — Canvas's own RCE checker's "Adjacent Links" rule. |
| `heading_skipped_level` | heading | 1.3.1 | `advisory` | Two headings in document order within the same content item where the later heading's level is more than one greater than the former's (e.g. `<h2>` directly followed by `<h4>`). |
| `heading_empty` | heading | 2.4.6 | `error` | A heading tag (`<h1>`–`<h6>`) whose stripped text content is empty. |
| `heading_too_long` | heading | 2.4.6 | `advisory` | A heading's stripped text content exceeds 120 characters — matches the documented threshold in Canvas's own RCE Accessibility Checker ("Headings should not contain more than 120 characters"). |
| `table_missing_header` | table | 1.3.1 | `advisory` | A `<table>` contains zero `<th>` elements anywhere inside it. |
| `table_header_missing_scope` | table | 1.3.1 | `advisory` | A `<table>` contains one or more `<th>` elements, but none carry a `scope` attribute. Only checked when `table_missing_header` did NOT already fire for the same table (mutually exclusive — a table with zero headers is already flagged by the other rule). |
| `table_missing_caption` | table | 1.3.1 | `advisory` | A `<table>` has no `<caption>` child. Independent of (and additive with) the two rules above. |

**Why `img_missing_alt` and `heading_empty` are `error` and everything else is `advisory`**: these
two are the only rules with essentially no plausible legitimate exception — a truly decorative
image should carry `alt=""` (present-but-empty, which is a valid, well-known accessibility pattern
and deliberately does NOT trigger a finding — see the image scan algorithm below), so an image with
*no* `alt` attribute at all is unambiguously wrong; likewise a heading with no visible text serves
no purpose. Every other rule has some plausible false-positive path (a genuinely short, correct alt
text that happens to match a generic word; a legitimately short "More →" link that's actually
disambiguated by surrounding context a regex can't see; a layout table that technically doesn't
need headers), so those are `advisory` — matching Canvas's own "Suggestions, verify manually"
framing rather than a hard failure.

---

## Content sources (identical to `audit_course_links`)

No new Canvas client method is needed. This tool fetches the exact same four (plus one opt-in)
already-wrapped content sources `link-audit.ts` already established:

| Source | Canvas method | HTML field |
| --- | --- | --- |
| Pages | `canvas.pages.listWithBodies(courseId)` | `CanvasPage.body` |
| Assignments | `canvas.assignments.list(courseId)` | `CanvasAssignment.description` |
| Syllabus | `canvas.courses.getSyllabus(courseId)` | raw `syllabus_body` string |
| Announcements | `canvas.discussions.listAnnouncements(courseId)` | `CanvasAnnouncement.message` |
| Quizzes (opt-in) | `canvas.quizzes.list` + `canvas.quizzes.listQuestions` (Classic) and `canvas.assignments.list` (filtered `is_quiz_lti_assignment`) + `canvas.newQuizzes.listItems` (New Quizzes) | quiz/question/item text fields |

**Why duplicate this fetch logic instead of sharing it with `link-audit.ts`**: no shared
"fetch all course content sources" helper exists yet in this codebase — each audit-domain file
(`link-audit.ts`, and now this one) is currently self-contained, matching the pattern already set.
Extracting a shared helper is a reasonable follow-up once a *third* content-scanning audit tool
needs the same sources (rule of three) — not done preemptively here, per this project's "don't
design for hypothetical future requirements" principle. This is an accepted, explicit v1
duplication, not an oversight.

---

## Tool module — `src/tools/accessibility-audit.ts` (new file)

### Type definitions (module-level)

```ts
const CONTENT_SOURCES = ['pages', 'assignments', 'syllabus', 'announcements', 'quizzes'] as const
type ContentSource = (typeof CONTENT_SOURCES)[number]

const DEFAULT_CONTENT_SOURCES: ContentSource[] = [
  'pages',
  'assignments',
  'syllabus',
  'announcements',
]

const CLASSIC_QUIZ_TYPES = new Set(['assignment', 'practice_quiz', 'graded_survey', 'survey'])

type AccessibilityRule =
  | 'img_missing_alt'
  | 'img_alt_low_quality'
  | 'link_non_descriptive_text'
  | 'adjacent_duplicate_links'
  | 'heading_skipped_level'
  | 'heading_empty'
  | 'heading_too_long'
  | 'table_missing_header'
  | 'table_header_missing_scope'
  | 'table_missing_caption'

type Severity = 'error' | 'advisory'

const WCAG_BY_RULE: Record<AccessibilityRule, string> = {
  img_missing_alt: '1.1.1',
  img_alt_low_quality: '1.1.1',
  link_non_descriptive_text: '2.4.4',
  adjacent_duplicate_links: '2.4.4',
  heading_skipped_level: '1.3.1',
  heading_empty: '2.4.6',
  heading_too_long: '2.4.6',
  table_missing_header: '1.3.1',
  table_header_missing_scope: '1.3.1',
  table_missing_caption: '1.3.1',
}

const SEVERITY_BY_RULE: Record<AccessibilityRule, Severity> = {
  img_missing_alt: 'error',
  img_alt_low_quality: 'advisory',
  link_non_descriptive_text: 'advisory',
  adjacent_duplicate_links: 'advisory',
  heading_skipped_level: 'advisory',
  heading_empty: 'error',
  heading_too_long: 'advisory',
  table_missing_header: 'advisory',
  table_header_missing_scope: 'advisory',
  table_missing_caption: 'advisory',
}

interface ContentLocation {
  type: ContentSource
  id: number
  title: string
  quiz_engine?: 'classic' | 'new'
  question_id?: number | string
}

interface AccessibilityFinding {
  location: ContentLocation
  rule: AccessibilityRule
  wcag: string
  severity: Severity
  detail: string
}

function makeFinding(
  location: ContentLocation,
  rule: AccessibilityRule,
  detail: string,
): AccessibilityFinding {
  return { location, rule, wcag: WCAG_BY_RULE[rule], severity: SEVERITY_BY_RULE[rule], detail }
}
```

`ContentLocation` intentionally mirrors `link-audit.ts`'s type of the same name field-for-field
(including the quiz-specific `quiz_engine`/`question_id` fields) — a deliberate duplication for the
same self-contained-file reason given above, not a shared import (link-audit.ts does not export its
types).

### Shared helpers (module-level, not exported)

```ts
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}
```

`stripTags` collapses internal whitespace (Canvas HTML often contains newlines/indentation between
inline tags) before comparing against known non-descriptive phrases or measuring heading length —
without this, `"Click\n  Here"` would not match `"click here"` after a naive lowercase compare.

### Image scan: `img_missing_alt`, `img_alt_low_quality`

```ts
const IMG_RE = /<img\b([^>]*)>/gi
const ALT_ATTR_RE = /(?:^|\s)alt="([^"]*)"/i
const FILENAME_EXT_RE = /\.(jpe?g|png|gif|svg|webp|bmp|tiff?)$/i
const GENERIC_ALT_WORDS = new Set([
  'image',
  'photo',
  'photograph',
  'picture',
  'img',
  'screenshot',
  'graphic',
])
const CAMERA_FILENAME_RE = /^(img|dsc|photo|image)[\s_-]?\d+$/i

function isLowQualityAlt(alt: string): boolean {
  const normalized = alt.toLowerCase()
  return (
    FILENAME_EXT_RE.test(alt) ||
    GENERIC_ALT_WORDS.has(normalized) ||
    CAMERA_FILENAME_RE.test(normalized)
  )
}

function scanImages(html: string, location: ContentLocation): AccessibilityFinding[] {
  const findings: AccessibilityFinding[] = []
  IMG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = IMG_RE.exec(html)) !== null) {
    const attrs = m[1] ?? ''
    const altMatch = attrs.match(ALT_ATTR_RE)
    if (!altMatch) {
      findings.push(makeFinding(location, 'img_missing_alt', 'Image has no alt attribute.'))
      continue
    }
    const alt = decodeHtmlEntities(altMatch[1] ?? '').trim()
    if (!alt) continue // alt="" is a deliberate, valid "decorative image" marker — not a finding.
    if (isLowQualityAlt(alt)) {
      findings.push(
        makeFinding(
          location,
          'img_alt_low_quality',
          `Alt text "${alt}" looks like a filename or generic placeholder.`,
        ),
      )
    }
  }
  return findings
}
```

**`ALT_ATTR_RE` uses `(?:^|\s)alt="` rather than `\balt="`**: a naive `\b` word-boundary pattern
would also match inside `data-alt="..."` (many WYSIWYG editors and lazy-load libraries stash a
working copy of alt text in a `data-alt` attribute; the boundary between `-` and `a` still counts
as a word boundary to a regex engine). Requiring the match to be preceded by whitespace or the
start of the attribute string excludes that false match. This is a new, more precise pattern
introduced for this file — `link-audit.ts`'s existing `HREF_RE`/`IMG_SRC_RE` use plain `\b` and are
left unmodified, since `data-href`/`data-src` collisions are not a realistic concern there and this
spec does not touch that file.

**`alt=""` is explicitly not a finding**: an empty-but-present `alt` attribute is the standard,
correct way to mark a purely decorative image in HTML/WCAG — flagging it would produce a false
positive on content authors who did the right thing.

### Link scan: `link_non_descriptive_text`, `adjacent_duplicate_links`

```ts
const LINK_RE = /<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi

const NON_DESCRIPTIVE_LINK_TEXT = new Set([
  '',
  'click here',
  'here',
  'click',
  'read more',
  'more',
  'more info',
  'more information',
  'link',
  'this link',
])

interface ExtractedLink {
  href: string
  accessibleName: string
  start: number
  end: number
}

function linkAccessibleName(innerHtml: string): string {
  const text = stripTags(innerHtml)
  if (text) return text
  // Reuses the same IMG_RE / ALT_ATTR_RE pair scanImages() uses, applied in the same
  // two-stage way (isolate the tag's attribute substring, then locate `alt=` within
  // it) rather than one combined regex — a single regex here would need `(?:^|\s)`
  // to anchor to "start of the <img> tag's attributes," but against the *whole*
  // innerHtml string `^` only ever matches the true start of that string, not the
  // start of wherever the <img> tag happens to sit inside it.
  IMG_RE.lastIndex = 0
  const imgMatch = IMG_RE.exec(innerHtml)
  if (!imgMatch) return ''
  const altMatch = (imgMatch[1] ?? '').match(ALT_ATTR_RE)
  return altMatch ? decodeHtmlEntities(altMatch[1] ?? '').trim() : ''
}

function extractLinks(html: string): ExtractedLink[] {
  const links: ExtractedLink[] = []
  LINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LINK_RE.exec(html)) !== null) {
    links.push({
      href: decodeHtmlEntities(m[1] ?? '').trim(),
      accessibleName: linkAccessibleName(m[2] ?? ''),
      start: m.index,
      end: m.index + m[0].length,
    })
  }
  return links
}

function scanLinks(html: string, location: ContentLocation): AccessibilityFinding[] {
  const findings: AccessibilityFinding[] = []
  const links = extractLinks(html)

  for (const link of links) {
    const name = link.accessibleName.toLowerCase()
    if (NON_DESCRIPTIVE_LINK_TEXT.has(name)) {
      findings.push(
        makeFinding(
          location,
          'link_non_descriptive_text',
          link.accessibleName
            ? `Link text "${link.accessibleName}" is not descriptive out of context.`
            : 'Link has no accessible name (no text and no alt text on a contained image).',
        ),
      )
    }
  }

  for (let i = 0; i < links.length - 1; i++) {
    const a = links[i]
    const b = links[i + 1]
    if (!a || !b || !a.href || a.href !== b.href) continue
    if (/^\s*$/.test(html.slice(a.end, b.start))) {
      findings.push(
        makeFinding(
          location,
          'adjacent_duplicate_links',
          `Two adjacent links both point to "${a.href}" — merge into a single link.`,
        ),
      )
    }
  }

  return findings
}
```

**Image-only links resolve their accessible name from the image's `alt`**: a link whose only
content is `<img alt="Course syllabus PDF">` has an accessible name of "Course syllabus PDF" via
the image's alt text (standard browser/AT behavior), not an empty string — computing
`linkAccessibleName` this way avoids a false `link_non_descriptive_text` finding on a properly
alt-texted image link. If the contained image also has no alt text, `linkAccessibleName` correctly
falls through to `''`, and the link is flagged — genuinely correct, not a double-count: the image
needs alt text AND, as a direct consequence, the link currently has no accessible name either.

**`adjacent_duplicate_links` only detects consecutive pairs, not runs**: three identical adjacent
links (`A A A`) are detected as one pair (link 1–2), not two (a known, accepted v1 limitation — the
same "detect the common case, document the edge" posture `audit_course_links` took with
single-quoted attributes). `NON_DESCRIPTIVE_LINK_TEXT` comparison is exact-match after
lowercasing/whitespace-collapsing — trailing punctuation like "click here." is not stripped;
documented as a known v1 limitation rather than adding a punctuation-stripping heuristic that risks
its own false positives.

### Heading scan: `heading_skipped_level`, `heading_empty`, `heading_too_long`

```ts
const HEADING_RE = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi
const MAX_HEADING_LENGTH = 120

interface ExtractedHeading {
  level: number
  text: string
}

function extractHeadings(html: string): ExtractedHeading[] {
  const headings: ExtractedHeading[] = []
  HEADING_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = HEADING_RE.exec(html)) !== null) {
    headings.push({ level: parseInt(m[1] ?? '1', 10), text: stripTags(m[2] ?? '') })
  }
  return headings
}

function scanHeadings(html: string, location: ContentLocation): AccessibilityFinding[] {
  const findings: AccessibilityFinding[] = []
  const headings = extractHeadings(html)

  for (const h of headings) {
    if (!h.text) {
      findings.push(makeFinding(location, 'heading_empty', `Empty <h${h.level}> heading.`))
    } else if (h.text.length > MAX_HEADING_LENGTH) {
      findings.push(
        makeFinding(
          location,
          'heading_too_long',
          `Heading is ${h.text.length} characters (recommended max ${MAX_HEADING_LENGTH}): "${h.text.slice(0, 60)}..."`,
        ),
      )
    }
  }

  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1]
    const curr = headings[i]
    if (!prev || !curr) continue
    if (curr.level > prev.level + 1) {
      findings.push(
        makeFinding(
          location,
          'heading_skipped_level',
          `Heading level jumps from <h${prev.level}> to <h${curr.level}> — skips level(s) in between.`,
        ),
      )
    }
  }

  return findings
}
```

**No "must start at h1/h2" check**: unlike a full webpage, a single Canvas Page/assignment body is
a *fragment* rendered below Canvas's own page-title chrome (which itself typically renders as the
page's heading) — requiring body content to start at `<h1>` would produce false positives on
correctly-authored content that reasonably starts at `<h2>` or deeper. Only skips *between*
headings within the same content item are flagged, matching Canvas's own documented "Sequential
headings" rule, not a stronger "must start at the top" rule Canvas itself doesn't enforce either.

**`MAX_HEADING_LENGTH = 120`** is not an invented threshold — it is Canvas's own documented Rich
Content Editor Accessibility Checker rule ("Headings should not contain more than 120 characters").

### Table scan: `table_missing_header`, `table_header_missing_scope`, `table_missing_caption`

```ts
const TABLE_RE = /<table\b[^>]*>([\s\S]*?)<\/table>/gi
const TH_TAG_RE = /<th\b[^>]*>/gi
const SCOPE_ATTR_RE = /(?:^|\s)scope="[^"]*"/i
const CAPTION_RE = /<caption\b[^>]*>/i

function scanTables(html: string, location: ContentLocation): AccessibilityFinding[] {
  const findings: AccessibilityFinding[] = []
  TABLE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TABLE_RE.exec(html)) !== null) {
    const inner = m[1] ?? ''
    const thTags = inner.match(TH_TAG_RE) ?? []

    if (thTags.length === 0) {
      findings.push(makeFinding(location, 'table_missing_header', 'Table has no <th> cells.'))
    } else if (!thTags.some((tag) => SCOPE_ATTR_RE.test(tag))) {
      findings.push(
        makeFinding(
          location,
          'table_header_missing_scope',
          'Table has header cells but none declare a scope attribute.',
        ),
      )
    }

    if (!CAPTION_RE.test(inner)) {
      findings.push(makeFinding(location, 'table_missing_caption', 'Table has no <caption>.'))
    }
  }
  return findings
}
```

**`table_missing_header` and `table_header_missing_scope` are mutually exclusive per table** (an
`else if`): a table with zero headers is already fully described by the first finding: reporting
"also missing scope" on top would be redundant, since there's nothing to scope.

**Nested tables are a known v1 limitation**: `TABLE_RE`'s non-greedy `[\s\S]*?` stops at the first
`</table>`, so a table nested inside another table's cell will cause the outer table to be
mis-parsed (its `inner` capture ends at the nested table's close tag, not its own). Canvas RCE
rarely produces nested tables; this is an accepted limitation matching the project's established
regex-over-full-DOM-parser tradeoff, not a new one introduced here.

**No attempt to distinguish data tables from (discouraged) layout tables**: a `<table>` used purely
for visual layout without real tabular data technically shouldn't need headers at all under WCAG,
but nothing in the raw HTML reliably distinguishes "layout table" from "small data table" (a
2-column, 2-row glossary table is extremely common and genuinely needs headers). This project's
regex-based approach cannot make that judgment call, so every `<table>` is scanned — matching
Canvas's own native checker, which has the same limitation.

### Aggregating a content item's findings

```ts
function scanContentAccessibility(
  html: string | null | undefined,
  location: ContentLocation,
): AccessibilityFinding[] {
  if (!html) return []
  return [
    ...scanImages(html, location),
    ...scanLinks(html, location),
    ...scanHeadings(html, location),
    ...scanTables(html, location),
  ]
}
```

### Quiz scanning (opt-in `quizzes` source)

Structurally identical to `link-audit.ts`'s `scanQuizzes` helper — same Canvas calls, same Classic
vs. New Quiz branching — but calling `scanContentAccessibility` instead of the link-focused
`scanHtml`:

```ts
async function scanQuizzesAccessibility(
  canvas: CanvasClient,
  courseId: number,
): Promise<AccessibilityFinding[]> {
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
      const findings = scanContentAccessibility(quiz.description, location)
      const questions = await canvas.quizzes.listQuestions(courseId, quiz.id)
      for (const question of questions) {
        findings.push(
          ...scanContentAccessibility(question.question_text, {
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
        scanContentAccessibility(item.entry?.item_body, { ...location, question_id: item.id }),
      )
    }),
  )

  return [...classicFindings.flat(), ...newQuizFindings.flat()]
}
```

### Tool: `audit_course_accessibility`

```ts
export function accessibilityAuditTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'audit_course_accessibility',
      description:
        "Scan a course's content (pages, assignments, syllabus, announcements, and optionally " +
        'quizzes) for structurally-detectable WCAG 2.1 accessibility problems: images missing ' +
        'alt text or with low-quality (filename/generic) alt text, non-descriptive link text ' +
        '("click here"), adjacent duplicate links, skipped/empty/overlong headings, and tables ' +
        'missing headers, header scope, or captions. Each finding carries a WCAG success ' +
        'criterion and a severity (error = unambiguous failure, advisory = needs human review). ' +
        'Structural checks only — no color-contrast checking (requires rendered theme CSS this ' +
        'tool cannot see) and no list-misuse detection in this version. Pass "quizzes" in ' +
        '`include` to also scan Classic quiz descriptions/questions and New Quiz item stems ' +
        '(opt-in, off by default). Complements — does not replace — Canvas\'s own in-app ' +
        'Accessibility Checker (course navigation → Accessibility → Scan Course), which covers ' +
        'the same WCAG areas plus rendered color contrast and offers in-UI remediation. ' +
        'Requires instructor permissions in the course.',
      inputSchema: {
        course_id: z.number().int().positive().describe('Canvas course ID'),
        include: z
          .array(z.enum(['pages', 'assignments', 'syllabus', 'announcements', 'quizzes']))
          .optional()
          .describe(
            'Content sources to scan. Omit to scan the default four: pages, assignments, ' +
              'syllabus, announcements. `quizzes` is opt-in — pass it explicitly to also scan ' +
              'Classic quiz descriptions/questions and New Quiz item stems.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const activeInclude = new Set<ContentSource>(
          (params.include as ContentSource[] | undefined) ?? DEFAULT_CONTENT_SOURCES,
        )

        const [pages, assignments, syllabus, announcements, quizFindings] = await Promise.all([
          activeInclude.has('pages') ? canvas.pages.listWithBodies(courseId) : Promise.resolve([]),
          activeInclude.has('assignments')
            ? canvas.assignments.list(courseId)
            : Promise.resolve([]),
          activeInclude.has('syllabus')
            ? canvas.courses.getSyllabus(courseId)
            : Promise.resolve(null),
          activeInclude.has('announcements')
            ? canvas.discussions.listAnnouncements(courseId)
            : Promise.resolve([]),
          activeInclude.has('quizzes')
            ? scanQuizzesAccessibility(canvas, courseId)
            : Promise.resolve([] as AccessibilityFinding[]),
        ])

        const findings: AccessibilityFinding[] = []

        if (activeInclude.has('pages')) {
          for (const page of pages) {
            findings.push(
              ...scanContentAccessibility(page.body, {
                type: 'pages',
                id: page.page_id,
                title: page.title,
              }),
            )
          }
        }

        if (activeInclude.has('assignments')) {
          for (const a of assignments) {
            findings.push(
              ...scanContentAccessibility(a.description, {
                type: 'assignments',
                id: a.id,
                title: a.name,
              }),
            )
          }
        }

        if (activeInclude.has('syllabus') && syllabus) {
          findings.push(
            ...scanContentAccessibility(syllabus, {
              type: 'syllabus',
              id: courseId,
              title: 'Syllabus',
            }),
          )
        }

        if (activeInclude.has('announcements')) {
          for (const ann of announcements) {
            findings.push(
              ...scanContentAccessibility(ann.message, {
                type: 'announcements',
                id: ann.id,
                title: ann.title,
              }),
            )
          }
        }

        findings.push(...quizFindings)

        const errorCount = findings.filter((f) => f.severity === 'error').length

        return {
          summary: {
            course_id: courseId,
            sources_scanned: CONTENT_SOURCES.filter((s) => activeInclude.has(s)),
            total_findings: findings.length,
            error_count: errorCount,
            advisory_count: findings.length - errorCount,
          },
          findings,
        }
      },
    },
  ]
}
```

**Input casting**: `params.X as T` matches the existing no-runtime-parse pattern already used in
`link-audit.ts` and throughout `src/tools/`.

---

## Catalog registration — `src/tools/catalog.ts`

Add the import (alongside the existing `import { linkAuditTools } from './link-audit'` line):

```ts
import { accessibilityAuditTools } from './accessibility-audit'
```

Add a new domain entry after the existing `link_audit` entry (currently the last entry in
`toolDomainCatalog` — verify this is still true before inserting, since new domains have been
appended here recently):

```ts
  {
    domain: 'accessibility_audit',
    defaultPrimaryAudience: 'educator',
    getTools: accessibilityAuditTools,
  },
```

---

## FERPA / pseudonymizer coverage

**No pseudonymizer wrapping required. Do NOT add `audit_course_accessibility` to
`PSEUDONYMIZER_WRAPPED_TOOLS`.**

The output payload contains only course content metadata: content-item IDs/titles (pages,
assignments, syllabus, announcements, quizzes/questions), rule names, WCAG references, severities,
and free-text `detail` strings quoting snippets of the course's own authored HTML (alt text values,
link text, heading text). None of this is a `CanvasUser` object, a `participants` array, or a
`user_name` field — the three triggering patterns from `CLAUDE.md` / `src/pseudonym/coverage.ts`.
This is the same conclusion `audit_course_links` reached for the identical reason; state it
explicitly per that precedent so `tests/pseudonym/coverage.test.ts` passes without modification.

---

## Audience coverage

No `audience` override on the tool — it inherits the `accessibility_audit` domain's
`defaultPrimaryAudience: 'educator'`, matching `link_audit`. `tests/tools/audience-coverage.test.ts`
requires no changes beyond the domain registration already covering this.

---

## Manifest regeneration

Adding a new tool changes the total tool count. **Verify the live count before editing** — as of
this writing (main at commit `05c9f8c`) it is **144** per both `tests/tools/registry.test.ts:382`
and `tests/discovery/manifests.test.ts:38`; do not trust the stale `it('returns all 139 tools...')`
description string a few lines above the 144 assertion in `registry.test.ts` — that's a description
string that was never updated when the count grew past 139, not a second real count. Run
`pnpm test tests/tools/registry.test.ts` on a fresh `main` checkout to confirm 144 before assuming
this spec's numbers are still current.

1. Run `pnpm generate:manifests` and commit the regenerated `docs/generated/tool-manifest.json`
   (and any sibling generated artifact it touches).
2. Bump `tests/tools/registry.test.ts`: `expect(tools).toHaveLength(144)` → `145`, and update the
   `it('returns all 144 tools across all domains', ...)` description string to match (fixing the
   pre-existing 139/144 drift while you're there is a reasonable, in-scope cleanup, not required).
3. Bump `tests/discovery/manifests.test.ts` line 38: `expect(manifest.tools).toHaveLength(144)` →
   `145`.

---

## Test plan

All tests use mocked Canvas responses. No live Canvas calls, per `CLAUDE.md`.

### New file: `tests/tools/accessibility-audit.test.ts`

Build a `buildMockCanvas()` helper following `tests/tools/link-audit.test.ts`'s structural pattern
(course ID `100` throughout).

**Suite-level checks:**
1. `accessibilityAuditTools(buildMockCanvas())` returns exactly **1** tool definition.
2. Tool name: `'audit_course_accessibility'`.
3. `annotations: { readOnlyHint: true, openWorldHint: true }`.

**Image rule cases:**
4. `<img>` with no `alt` attribute → finding `{ rule: 'img_missing_alt', severity: 'error', wcag: '1.1.1' }`.
5. `<img alt="">` (empty, present) → **no finding** (decorative image marker).
6. `<img alt="photo.jpg">` → finding `{ rule: 'img_alt_low_quality' }` (filename extension).
7. `<img alt="Screenshot">` → finding `{ rule: 'img_alt_low_quality' }` (generic word).
8. `<img alt="IMG_0042">` → finding `{ rule: 'img_alt_low_quality' }` (camera filename pattern).
9. `<img alt="Diagram of the water cycle showing evaporation and condensation">` → **no finding**
   (descriptive, non-generic, no extension suffix).
10. `<div data-alt="foo"><img alt="Diagram">` → assert `data-alt` is NOT mistaken for the image's
    `alt` attribute (regression test for the `(?:^|\s)alt="` fix over a naive `\balt="` pattern).

**Link rule cases:**
11. `<a href="/x">Click here</a>` → finding `{ rule: 'link_non_descriptive_text' }`.
12. `<a href="/x">Read more about photosynthesis</a>` → **no finding**.
13. `<a href="/x"><img alt="Course syllabus PDF"></a>` (no link text, but the image has good alt
    text) → **no finding** (accessible name resolves through the image's alt).
14. `<a href="/x"><img></a>` (no link text, image has no alt either) → **two** findings:
    `img_missing_alt` for the image AND `link_non_descriptive_text` for the link (empty accessible
    name) — both genuinely true, not a duplicate.
15. `<a href="/x">A</a> <a href="/x">B</a>` (same href, only whitespace between) → finding
    `{ rule: 'adjacent_duplicate_links' }`.
16. `<a href="/x">A</a><p>text</p><a href="/x">B</a>` (same href, but other content between) →
    **no** `adjacent_duplicate_links` finding.
17. `<a href="/x">A</a> <a href="/y">B</a>` (different hrefs, adjacent) → **no**
    `adjacent_duplicate_links` finding.

**Heading rule cases:**
18. `<h2>Week 1</h2><h4>Details</h4>` → finding `{ rule: 'heading_skipped_level' }` (h2 → h4 skips
    h3).
19. `<h2>Week 1</h2><h3>Details</h3>` → **no** `heading_skipped_level` finding (adjacent levels).
20. `<h2></h2>` / `<h2>   </h2>` → finding `{ rule: 'heading_empty' }` for both (whitespace-only
    counts as empty after `stripTags`).
21. A heading whose stripped text is 130 characters → finding `{ rule: 'heading_too_long' }`.
22. A heading whose stripped text is exactly 120 characters → **no** `heading_too_long` finding
    (boundary: `> 120`, not `>= 120`).

**Table rule cases:**
23. `<table><tr><td>a</td></tr></table>` (no `<th>` at all) → finding
    `{ rule: 'table_missing_header' }` and **no** `table_header_missing_scope` finding for the same
    table (mutual exclusivity).
24. `<table><tr><th>Name</th></tr></table>` (has `<th>`, no `scope`) → finding
    `{ rule: 'table_header_missing_scope' }` and **no** `table_missing_header` finding.
25. `<table><tr><th scope="col">Name</th></tr></table>` → **no** header-related finding.
26. A table with `<th>` and a `scope` attribute but no `<caption>` → finding
    `{ rule: 'table_missing_caption' }` **in addition to** passing the header checks (additive, not
    mutually exclusive with the header rules).
27. A table with `<caption>Grades</caption>` → **no** `table_missing_caption` finding.

**Aggregation / summary cases:**
28. `summary.total_findings === findings.length`.
29. `summary.error_count` + `summary.advisory_count === summary.total_findings`.
30. `summary.error_count` counts only `img_missing_alt` and `heading_empty` findings in a mixed
    fixture with at least one of each severity.
31. `sources_scanned` uses the stable `CONTENT_SOURCES.filter()` order (not `Set` spread), matching
    `audit_course_links`'s existing convention.
32. Null/undefined `body`/`description`/`syllabus`/`message` on any content item → no findings and
    no thrown error for that item (guarded by `scanContentAccessibility`'s `!html` check).

**`include` filter:**
33. `{ course_id: 100, include: ['syllabus'] }` → only `canvas.courses.getSyllabus` is called;
    `pages.listWithBodies`, `assignments.list`, `discussions.listAnnouncements` are NOT called.
34. Omitting `include` scans the default four sources only; `quizzes` is NOT scanned (assert
    `canvas.quizzes.list` is NOT called without explicit `include: [..., 'quizzes']`).
35. `{ course_id: 100, include: ['quizzes'] }` scans a Classic quiz's description AND its
    questions' `question_text`, and a New Quiz assignment's item `entry.item_body`, each finding
    carrying the correct `quiz_engine` and `question_id` in its `location`.

**Registry test — `tests/tools/registry.test.ts` (modify existing file):**
36. Add `accessibility_audit`'s tools mock inputs to `buildFullMockCanvas()` if any new Canvas
    client method were introduced — **none is**, so no mock changes are needed beyond what
    `link_audit`'s existing mocks already cover (same client methods).
37. Bump count 144 → 145 (see Manifest regeneration section) and add:
    ```ts
    // Accessibility Audit (1)
    expect(names).toContain('audit_course_accessibility')
    ```

### Pseudonymizer coverage test — `tests/pseudonym/coverage.test.ts`

No changes. `audit_course_accessibility` does not appear in `PSEUDONYMIZER_WRAPPED_TOOLS`; the CI
coverage test passes without modification (same as `audit_course_links`).

### Audience coverage test — `tests/tools/audience-coverage.test.ts`

No changes. The domain registers with `defaultPrimaryAudience: 'educator'`; the tool sets no
`audience` override.

---

## Implementation checklist for the implementor

1. `src/tools/accessibility-audit.ts` — new file with `accessibilityAuditTools()`, all module-level
   types/constants, the four rule-family scan functions (`scanImages`, `scanLinks`, `scanHeadings`,
   `scanTables`), the `scanContentAccessibility` aggregator, `scanQuizzesAccessibility`, and the
   `audit_course_accessibility` tool definition. No new Canvas client method — reuses exactly the
   methods `link-audit.ts` already established.
2. `src/tools/catalog.ts` — import `accessibilityAuditTools`; add the `accessibility_audit` domain
   entry after `link_audit`.
3. `tests/tools/accessibility-audit.test.ts` — new file, 37 cases across suite-level, image, link,
   heading, table, aggregation/summary, and `include`-filter groups.
4. `tests/tools/registry.test.ts` — bump count 144 → 145 (fix the stale `it()` description string
   too), add `audit_course_accessibility` to the `toContain` block.
5. `tests/discovery/manifests.test.ts` — bump count 144 → 145.
6. Run `pnpm generate:manifests`; commit the regenerated manifest artifact(s).
7. Confirm `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.

Single PR is appropriate — one new tool file (~350 lines including rule tables/comments), one
catalog registration (~5 lines), one new test file (~350 lines), two count bumps, one generated
manifest update. Well under this project's ~15-file bail-out threshold for splitting a PR.

---

## Open questions for CTO review

1. **Scope of native-checker complementarity messaging**: the tool description explicitly frames
   this as complementary to Canvas's own native Course Accessibility Checker rather than a
   replacement. Confirm this framing is desired, versus staying silent on Canvas's native feature
   entirely.
2. **Deferred color contrast (§2) and list-misuse detection (§3)**: confirmed out of scope for v1
   with documented rationale. Flag here in case the CTO wants either pulled forward, particularly
   contrast given it's one of the most commonly cited real-world WCAG failures — this spec's
   position is that a structurally-unreliable check is worse than no check, but this is a judgment
   call worth CTO sign-off on explicitly.
3. **Two-tier severity model (`error`/`advisory`)**: confirm this coarse split is sufficient, versus
   a finer per-rule confidence score. The simpler binary was chosen to match Canvas's own
   Errors/Suggestions framing and avoid inventing an unfalsifiable confidence metric.

---

## Acceptance check

- [x] Originating RFC (Discussion #85)'s five open questions plus its module-boundary question all
      explicitly resolved with a stated decision, not left as an implicit inference — see "RFC
      alignment" section above. RFC's original 5-tool brainstorm explicitly reconciled down to one
      tool, with `list_files_missing_alt_text` shown to not map to real Canvas file metadata and
      `suggest_alt_text` explicitly excluded per the Determinism decision.
- [x] Design-first flag present in issue #245.
- [x] Design unknown §1 (native checker vs. independent audit) retired: native checker's public API
      confirmed (via Canvas's own release notes and documentation) to be aggregate/self-scoped/
      feature-flagged and insufficiently granular; independent structural audit chosen, following
      the same resolution pattern already established for `link_validation` in
      `audit_course_links`.
- [x] Design unknown §2 (color contrast) retired: deferred, with rationale distinguishing this from
      a defensible structural check.
- [x] Design unknown §3 (list-misuse detection) retired: deferred, fuzzy-heuristic rationale.
- [x] Design unknown §4 (rule taxonomy/severity) retired: 10 rules across 4 families, each with a
      WCAG SC reference and a two-tier severity, tabulated with rationale.
- [x] Exact tool name, Zod schema, Canvas calls (all already-wrapped, no new client method), output
      shape, and MCP annotations specified.
- [x] No new package dependencies (regex/string-based scanning only, matching `audit_course_links`
      precedent).
- [x] No student PII in output; pseudonymizer wrapping explicitly NOT required, matching
      `audit_course_links`'s precedent and reasoning.
- [x] Audience coverage: domain-level `educator` default, no per-tool override, explicitly stated.
- [x] Test plan covers all 10 rules' positive and negative cases, the image-link accessible-name
      interaction, mutual-exclusivity between `table_missing_header`/`table_header_missing_scope`,
      boundary conditions (120-char heading threshold), `include` filtering, and null/undefined
      content guards.
- [x] Manifest regeneration and both tool-count assertion bumps called out explicitly, including a
      note about the pre-existing stale test-description-string drift so the implementor doesn't
      mistake it for a second real count.
- [x] Explicit complementarity note relative to Canvas's native Course Accessibility Checker,
      grounded in verified, dated, cited primary sources (Instructure release notes, corroborating
      institutional writeups, and the two documented public REST endpoints) rather than assumption.
