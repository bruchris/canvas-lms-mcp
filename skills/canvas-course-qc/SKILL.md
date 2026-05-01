---
name: canvas-course-qc
description: Learning designer quality-control checklist for Canvas courses. Walks modules, pages, assignments, and rubrics to surface structural issues — broken item sequences, missing rubrics, empty modules, unpublished content — before a course goes live. Trigger phrases include "course QC", "course quality check", "review course structure", "pre-launch audit", "check course content", or "canvas course review".
---

# Canvas Course QC

Systematically walk a Canvas course from top to bottom — syllabus, modules, pages, assignments, and rubrics — and produce a prioritised list of issues to fix before publication.

## Prerequisites

- Canvas MCP server must be running and connected.
- You must have instructor, designer, or admin role in the target course.
- The course may be unpublished — this skill reads draft content.

## Steps

### 1. Load Course Metadata

Call `get_course` with the course ID to retrieve:
- Course name and code
- Publication status (`workflow_state`: `unpublished`, `available`, `completed`)
- Start and end dates
- Default view (modules, syllabus, etc.)

Report the publication status upfront — if the course is already live, note that this is a post-launch audit.

### 2. Check the Syllabus

Call `get_syllabus` for the course. Check:
- Is the syllabus body non-empty?
- Does it contain placeholder text (e.g. "TBD", "Coming soon", "Lorem ipsum")?
- Are expected sections present (course description, grading policy, contact info)?

Flag any missing or placeholder syllabus content.

### 3. Walk the Module Structure

Call `list_modules` for the course to get all modules. For each module:

1. Call `get_module` (with the module ID) to get its publication state, unlock date, and prerequisite chain.
2. Call `list_module_items` (with the course ID and module ID) to get the full item list.

For each module record:
- Flag modules that are **empty** (zero items)
- Flag modules that are **unpublished** if the course is live
- Flag modules with a **broken prerequisite** (prerequisite module ID not in the module list)
- Note the item count and item types (page, assignment, quiz, file, external URL)

### 4. Check Pages

From the module items collected in Step 3, identify items of type `Page`. For each page item:

Call `get_page` (with the course ID and page URL or slug from the module item) to retrieve its content and publication state.

Check for:
- **Unpublished pages** in a published module (students cannot see them)
- **Empty body** — page with no content
- **Placeholder text** — same heuristic as the syllabus check
- **Broken relative links** — look for `href="/courses/` patterns that reference a different course ID

Flag each issue with the module name and page title.

### 5. Check Assignments

Call `list_assignments` for the course. For each assignment:

Call `get_assignment` (with the course ID and assignment ID) to verify:
- **Submission type** is configured (not `none` unless intentional)
- **Points possible** is set (not null or zero for graded assignments)
- **Due date** is set
- **Rubric** is attached if the assignment description implies criteria-based grading

If `rubric_id` is null on an assignment that appears to require rubric grading (based on its description mentioning criteria or a grading rubric), flag it as a missing rubric.

### 6. Check Rubrics

Call `list_rubrics` for the course to get all course-level rubrics.

For each rubric:
- Does it have at least two criteria?
- Do all criteria have point values set?
- Is it associated with at least one assignment?

Flag rubrics with zero assignment associations (orphaned rubrics — may indicate an assignment link was removed).

### 7. Present the QC Report

Organise findings by severity:

- **Blockers** — issues that will prevent students from accessing content or completing work (unpublished required pages, missing submission type, empty modules in the critical path)
- **Warnings** — issues that degrade quality but don't block access (placeholder text, missing due dates, missing rubrics on graded work)
- **Suggestions** — optional improvements (orphaned rubrics, empty optional modules)

Ask the designer if they want to drill into any specific finding or export the full list.

## Output Format

```
Course QC Report — [Course Name]  ([course code])
Status: [Published / Unpublished]  |  Modules: [n]  |  Assignments: [n]  |  Pages: [n]

BLOCKERS  ([n] found)
• Module "[name]" — empty (no items)
• Page "[title]" in module "[name]" — unpublished (students cannot access)
• Assignment "[name]" — submission type not configured

WARNINGS  ([n] found)
• Syllabus — contains placeholder text ("TBD" in section 2)
• Assignment "[name]" — no due date set
• Assignment "[name]" — points possible is 0 (intentional?)
• Assignment "[name]" — no rubric attached (description mentions criteria)

SUGGESTIONS  ([n] found)
• Rubric "[name]" — not associated with any assignment
• Module "[name]" — empty (optional module, consider removing or adding a note)

PASSED
✓ All published pages have content
✓ All modules have items
✓ Syllabus is present and non-empty
```

## Notes

- This skill is fully **read-only** — it audits but does not modify any course content. Use the Canvas web UI or course copy tools to fix issues.
- There is no `get_course_structure` aggregator in canvas-lms-mcp; this skill explicitly chains `list_modules` → `list_module_items` → `get_page` / `get_assignment`. For large courses (20+ modules), this may take a few minutes.
- Placeholder text detection is heuristic (looks for common strings). Review flagged items manually — a page titled "TBD Topics" may be intentional.
- The skill does not check external URLs for liveness (Canvas does not expose link-check results via the API). Flag any items of type `ExternalUrl` for manual verification by the designer.
