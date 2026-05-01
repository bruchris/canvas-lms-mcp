---
name: canvas-syllabus-coach
description: Learning designer skill for reviewing and improving Canvas course syllabi and front pages. Reads the syllabus and key pages, proposes clarity and completeness improvements, then optionally applies the edits with your confirmation. Trigger phrases include "syllabus review", "improve the syllabus", "syllabus coach", "course front page", "update course description", "review course pages", or "polish the syllabus".
---

# Canvas Syllabus Coach

Learning designer skill for auditing and improving course syllabi and front pages in Canvas. Reads the current syllabus and course pages, proposes improvements, and optionally applies edits — one confirmed step at a time.

## Prerequisites

- Canvas MCP server must be running and connected.
- **Read-only review** requires instructor, TA, or designer role.
- **Applying edits** (`update_course`, `update_page`, `create_page`) requires instructor or designer role with content-editing permissions.
- Changes to the course syllabus body are permanent and immediately visible to students — review every proposed edit before confirming.

## Steps

### 1. Identify the Target Course

Ask the user which course to work with. Accept a course name, course code, or Canvas ID.

### 2. Read the Current Syllabus

Call `get_course` with the course ID to retrieve course metadata (name, course code, description, default view, and other settings).

Call `get_syllabus` with the course ID to retrieve the syllabus body HTML and the list of syllabus items (assignments and events).

Parse the syllabus HTML into readable sections. Identify which sections are present:

- **Course description** — what the course is about
- **Learning objectives / outcomes** — what students will be able to do
- **Required materials** — textbooks, software, subscriptions
- **Grading policy** — weights and breakdown
- **Late work / make-up policy** — penalties and exceptions
- **Communication policy** — response time expectations, preferred contact method
- **Academic integrity** — plagiarism and AI use policies
- **Accessibility / accommodation** — disability services contact
- **Course schedule** — weekly topics or module structure

### 3. Read Key Course Pages (Optional)

If the course has a custom front page, call `list_pages` with the course ID to see all pages. Then call `get_page` with the course ID and the front page URL slug to read its content.

If relevant, read additional pages the user mentions (e.g., "review the resources page").

### 4. Present the Syllabus Review

Summarise what you found and flag gaps:

```
Syllabus Review — [Course Name]

PRESENT ✓
• Course description
• Grading policy (A 93–100%, B 83–92%, C 73–82%, D 60–72%)
• Required materials (3 items)
• Course schedule (14 weeks listed)

MISSING OR WEAK ✗
• Learning objectives — not listed; students cannot see what they are expected to master
• Late work policy — no mention; students may dispute late penalties
• Communication policy — no response-time commitment listed
• Accessibility / accommodation — no disability services reference
• Academic integrity — grading policy mentions it briefly but no AI-use guidance

SUGGESTED IMPROVEMENTS
1. Add 3–5 measurable learning objectives to the opening section
2. Add a "Late Work" policy block (e.g., 10% penalty per day, no submissions after 1 week)
3. Add a "Communication" section with your preferred contact method and typical response time
4. Add a one-line accessibility statement with your institution's disability services contact
5. Expand the academic integrity section to clarify your AI tool policy
```

Ask the user if they want to apply any of these improvements.

### 5. Draft and Apply Edits

**All edits require explicit user confirmation before being applied.**

Work through improvements one at a time:

#### 5A. Update the Syllabus Body (via `update_course`)

The Canvas syllabus body is part of the course record — update it with `update_course`:

1. Draft the revised syllabus HTML. Show the user a plain-text preview of the proposed changes.
2. Ask: "Apply these changes to the syllabus for [course name]? (yes/no)"
3. Only after confirmation: call `update_course` with the course ID and `syllabus_body` set to the revised HTML.
4. Report: "Syllabus updated. Changes are live and visible to students."

#### 5B. Update a Course Page (via `update_page`)

For changes to an existing page (e.g., the front page or a resources page):

1. Draft the revised page body. Show the user a plain-text preview.
2. Ask: "Update the [page title] page in [course name] with these changes? (yes/no)"
3. Only after confirmation: call `update_page` with the course ID, page URL slug, and updated body.
4. Report the updated page title and publish status.

#### 5C. Create a New Page (via `create_page`)

If the improvement requires a new page (e.g., adding a dedicated "Course Policies" page):

1. Draft the new page content. Show a plain-text preview including the proposed title.
2. Ask: "Create a new page titled '[title]' in [course name]? (yes/no)"
3. Only after confirmation: call `create_page` with the course ID, title, and body. Set `published: false` initially so the user can review before students see it.
4. Report the new page URL slug and note that it is currently unpublished.

Repeat Steps 5A–5C for each improvement the user wants to apply.

## Output Format

```
Syllabus Coach — [Course Name]

REVIEW COMPLETE
Sections found: 5/9 standard sections
Gaps identified: 4

EDITS APPLIED
• Syllabus body updated — added learning objectives and late work policy ✓
• Front page updated — added communication and accessibility sections ✓
• New page created: "Course Policies (Draft)" — unpublished, URL: /pages/course-policies ✓

STILL PENDING (user chose to skip)
• Academic integrity AI-use section — no changes applied
```

## Notes

- **Read-only review comes first** — Steps 1–4 do not modify any Canvas data. You can produce a full review report without applying any changes.
- Every write step (`update_course`, `update_page`, `create_page`) must have explicit user confirmation before execution. Never batch multiple edits into a single unconfirmed call.
- `update_course` with `syllabus_body` replaces the entire syllabus HTML. Always base the update on the current content retrieved in Step 2 to avoid discarding sections the user has not reviewed.
- The Canvas syllabus editor stores content as HTML. When drafting improvements, write clean HTML or strip tags for the preview; avoid injecting raw markdown into the `syllabus_body` field.
- `create_page` defaults pages to `published: false`. Recommend the user review the new page in Canvas before publishing to students.
- Learning designer roles in Canvas may have different permissions per institution. If a write call returns a 403, report the permission error and suggest the instructor apply the change manually.
