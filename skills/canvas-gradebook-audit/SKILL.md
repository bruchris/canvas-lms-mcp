---
name: canvas-gradebook-audit
description: Audit grade changes before posting finals, trace who changed grades, review grade history for integrity checks, and produce a grade integrity report. Uses Canvas gradebook history tools that no other MCP server exposes.
---

# Canvas Gradebook Audit

Trace every grade change in a course before finalising grades — catch accidental edits, flag unusual patterns, and produce a clean audit trail for department review.

## Prerequisites

- Canvas MCP server running and connected
- Instructor or admin role with grade history access
- Course ID for the course under review

## Steps

### 1. Survey recent grade activity

Call `list_gradebook_history_days` with the course ID to see which days had grade changes. This gives you a high-level calendar of grading activity — useful for narrowing the audit window.

### 2. Drill into a specific day

For any day that looks unusual (high volume of changes, late-night edits, unexpected date), call `get_gradebook_history_day` with the course ID and date. This returns which graders were active and how many changes they made.

### 3. Pull per-submission history

Call `list_gradebook_history_submissions` for the course (optionally filtered by assignment ID or grader ID) to get the full change log: who graded what, what score was set, and when. Each record includes the grader's name and the previous score.

### 4. Cross-reference assignments

Use `list_assignments` and `get_assignment` to verify that the scores recorded in the history are consistent with the assignment's point total and grading type. Flag any entry where the recorded score exceeds max points.

### 5. Get the real-time feed (optional)

For an ongoing course, call `get_gradebook_history_feed` to stream the most recent changes in chronological order — useful for monitoring active grading sessions.

### 6. Compile the audit report

Summarise your findings:
- Number of grade changes per grader
- Assignments with the most revisions
- Any changes made outside normal grading windows
- Entries where a grade was lowered after initial submission

## MCP Tools Used

| Tool | Purpose |
|------|---------|
| `list_gradebook_history_days` | Calendar view of days with grade activity |
| `get_gradebook_history_day` | Grader summary for a specific date |
| `list_gradebook_history_submissions` | Full change log: who changed what score and when |
| `get_gradebook_history_feed` | Real-time ordered feed of recent grade changes |
| `list_assignments` | Enumerate assignments to cross-reference scores |
| `get_assignment` | Confirm point totals and grading type for an assignment |

## Example Prompts

- "Who changed grades in my course in the last two weeks? Show me a summary."
- "Audit the grade history for course 12345 before I post final grades."
- "Did anyone lower a student's grade on the midterm after it was initially submitted?"
- "Generate a grade integrity report for my Economics course."
- "Show me all grade changes made after midnight this semester."

## Notes / Error Recovery

- Gradebook history is only available on courses where the feature is enabled in your Canvas instance. A 404 on `list_gradebook_history_days` usually means the endpoint is disabled — contact your Canvas admin.
- `list_gradebook_history_submissions` can return large result sets on active courses. Filter by assignment ID to keep results manageable.
- Grader IDs in the history map to Canvas user IDs. Use `get_course` or `list_course_enrollments` to resolve names if the history only returns IDs.
- This skill surfaces what changed, not why. Use it alongside your department's grading policy to decide whether a change warrants follow-up.
