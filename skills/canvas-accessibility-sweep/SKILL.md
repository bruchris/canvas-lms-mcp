---
name: canvas-accessibility-sweep
description: Educator and learning-designer skill for a pre-launch accessibility and broken-link sweep of a Canvas course. Walks the structural accessibility audit and the link audit over a course's pages, assignments, syllabus, announcements, and (optionally) quizzes, then produces a prioritised remediation list you can work through in the Canvas editor. Trigger phrases include "accessibility sweep", "accessibility audit", "check course accessibility", "a11y check", "WCAG scan", "alt text audit", "broken links", "check my course for broken links", "pre-launch course check", or "course QC for accessibility".
---

# Canvas Accessibility Sweep

A read-only pre-launch pass over a course's content that flags structurally-detectable accessibility problems (WCAG 2.1) and broken or stale links, then hands you a prioritised remediation list. Built for the moment before a term starts — or right after a course copy — when you want to catch the issues that silently break for students before they do.

## What this skill does NOT do

canvas-lms-mcp exposes **two read-only audit tools** for this workflow — `audit_course_accessibility` and `audit_course_links`. There is **no fix tool**: neither the accessibility domain nor the link domain can edit content. This skill therefore **surfaces and prioritises** problems; the actual edits happen in the Canvas Rich Content Editor. Do not claim to have "fixed" anything.

Two limits are worth stating up front so you don't over-promise:

1. **No color-contrast checking.** `audit_course_accessibility` does structural checks only — it cannot see rendered theme CSS, so it does not evaluate text/background contrast. For contrast, point the user at Canvas's own in-app Accessibility Checker (course navigation → **Accessibility** → **Scan Course**), which this skill complements rather than replaces.
2. **No outbound link-reachability checking.** `audit_course_links` does structural checks only — it does **not** make HTTP requests, so it cannot tell you whether an external URL returns 404. It finds cross-course references (links still pointing at a previous copy of the course — the canonical stale-copy failure after an import) and empty or malformed URLs. A link to a genuinely dead external site will not be flagged.

## Prerequisites

- Canvas MCP server must be running and connected.
- **Instructor (or TA/designer) permissions on the course are required.** Both audit tools return 403 without them.
- Content in the target course must be created before the sweep is meaningful — running it on an empty shell finds nothing.

## Steps

### 1. Identify the Target Course

Ask the user which course to sweep. Accept a course name, course code, or Canvas ID. If unclear, call `list_courses` and let them pick.

Confirm whether they want to include quizzes in the sweep (see Step 2) — quiz scanning is opt-in and adds time.

### 2. Run the Accessibility Audit

Call `audit_course_accessibility` with the course ID. By default it scans **pages, assignments, syllabus, and announcements**. To also scan Classic quiz descriptions/questions and New Quiz item stems, pass `include=["quizzes"]` — quiz content breaks silently for students while still rendering in the instructor's own preview, so include it for a real pre-launch pass.

Each finding carries:

- The **content location** (which page/assignment/etc.).
- A **WCAG success criterion** (e.g. 1.1.1 Non-text Content).
- A **severity**: `error` (an unambiguous failure) or `advisory` (needs human review).

The tool detects: images missing alt text or with low-quality (filename/generic) alt text, non-descriptive link text ("click here"), adjacent duplicate links, skipped/empty/overlong headings, and tables missing headers, header scope, or captions. It does **not** detect color-contrast or list-misuse problems.

### 3. Run the Link Audit

Call `audit_course_links` with the course ID. Same default scope (pages, assignments, syllabus, announcements); pass `include=["quizzes"]` to also scan Classic quiz descriptions/questions and New Quiz item stems.

It returns two structured categories:

- **Cross-course references** — links that still point at a *previous copy* of the course. This is the classic breakage after a course import/copy: the content looks fine to you but sends students to a course they can't access. Treat these as high priority.
- **Empty or malformed URLs** — links with no `href`, `href="#"`, or otherwise broken markup.

### 4. Build the Prioritised Remediation List

Merge the two audits into one worklist, ordered so the user fixes the highest-impact items first:

1. **Cross-course references** (from Step 3) — students hit access errors; fix before launch.
2. **Accessibility `error` findings** (from Step 2) — unambiguous WCAG failures (e.g. images with no alt text, tables with no headers).
3. **Empty / malformed URLs** (from Step 3).
4. **Accessibility `advisory` findings** (from Step 2) — needs human judgement (e.g. "is this alt text good enough?", overlong headings).

Within each tier, group by content area (pages, then assignments, then syllabus, then announcements, then quizzes) so the user can work through one editor at a time. For each item, show the location, the specific problem, and — for accessibility findings — the WCAG criterion so they can justify the fix.

### 5. Point to Where Fixes Happen

Because there is no fix tool, close by telling the user **where** to remediate:

- Content edits (alt text, headings, link text, tables, fixing stale links) → the Canvas **Rich Content Editor** on each flagged page/assignment.
- Color contrast and in-UI accessibility remediation → Canvas's built-in **Accessibility Checker** (course navigation → Accessibility → Scan Course).

Offer to re-run the sweep after they've made a batch of edits so they can confirm the findings cleared.

## Output Format

```
Accessibility Sweep — [Course Name]
Scanned: pages, assignments, syllabus, announcements[, quizzes]

FIX BEFORE LAUNCH — cross-course links (3)
• Page "Week 1 Overview"        → link points at course 8821 (previous copy)
• Assignment "Lab 2"            → link points at course 8821 (previous copy)
• Syllabus                      → 2 links point at course 8821

ACCESSIBILITY ERRORS (7)
• Page "Module 1 Intro"         → image missing alt text            (WCAG 1.1.1)
• Page "Reading List"           → table missing header row          (WCAG 1.3.1)
• Assignment "Essay 1"          → heading level skipped (h2 → h4)   (WCAG 1.3.1)

MALFORMED / EMPTY URLS (2)
• Announcement "Welcome"        → empty href on "syllabus" link

ACCESSIBILITY ADVISORIES (needs review) (5)
• Page "Module 1 Intro"         → alt text is a filename ("IMG_2043.png")   (WCAG 1.1.1)
• Page "Resources"              → link text "click here" (x3)               (WCAG 2.4.4)

Remediate in the Canvas Rich Content Editor. For color contrast,
run Canvas's built-in Accessibility Checker (Accessibility → Scan Course).
```

## Notes

- **Read-only.** Both `audit_course_accessibility` and `audit_course_links` are read tools; this skill never modifies course content. There is no fix tool in canvas-lms-mcp for either domain.
- **Structural only, both tools.** Accessibility findings are structural (no color contrast, no list-misuse); link findings are structural (no HTTP reachability check). Say this plainly so the user knows a clean sweep is *necessary but not sufficient* — a passing sweep does not guarantee a perfectly accessible or fully-working course.
- **Quizzes are opt-in.** Pass `include=["quizzes"]` to both tools for a true pre-launch pass. Quiz content breaks silently for students while rendering fine in the instructor's preview, so it is the easiest thing to miss.
- **Cross-course references are the highest-value catch.** After a course copy, links to the source course look correct to the instructor but 403 for students. This is the single most common "why can't my students open this?" issue, and the link audit is built to catch it.
- **Complements Canvas's own checker.** Canvas's in-app Accessibility Checker covers the same WCAG areas *plus* rendered color contrast and offers in-UI remediation. Recommend running both: this skill for a fast, whole-course triage across pages/assignments/syllabus/announcements/quizzes in one pass, and the Canvas checker for contrast and guided fixes.
