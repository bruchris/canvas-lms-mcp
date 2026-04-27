---
name: canvas-gradebook-audit
description: Audit gradebook changes and grade edit history in Canvas. Surfaces who changed which grades, when, and by how much — across a date range or for a specific student. Unique to canvas-lms-mcp (no competitor exposes gradebook history). Trigger phrases include "grade audit", "who changed this grade", "gradebook history", "grade edits", "check for grade changes", or "grade integrity".
---

# Canvas Gradebook Audit

Inspect the full audit trail of grade changes in a Canvas course. Useful for grade integrity checks, accreditation reviews, and catching accidental bulk edits.

## Prerequisites

- Canvas MCP server must be running and connected.
- You must have instructor or admin role — grade history is restricted to privileged roles.
- Canvas must have gradebook history enabled on the instance (most institutions do).

## Steps

### 1. Identify the Target Course

Ask the user which course to audit. Accept a course name, code, or Canvas ID.

If unclear, call `list_courses` to let them select.

### 2. Choose Audit Scope

Ask the user one of:
- **Date range**: "Audit grade changes between [start date] and [end date]"
- **Assignment focus**: "Show all grade edits for a specific assignment"
- **Student focus**: "Show all grade edits for a specific student"

Default to the **past 30 days** if no range is given.

### 3. Retrieve History Days

Call `list_gradebook_history_days` with the course ID. This returns a list of calendar days that had grade activity, with a summary count per day.

Filter to the user's requested date range.

### 4. Drill Into Each Day

For each day with activity, call `get_gradebook_history_day` with the course ID and the date string. This returns the graders who made changes and the assignments they touched.

Build a running summary:
- Grader name
- Number of submissions edited
- Assignments affected

### 5. Inspect Individual Edits (When Requested)

If the user wants to see the specific before/after values for a submission, call `list_gradebook_history_submissions` with the course ID, grader ID, assignment ID, and date. This returns per-student grade change records with old score, new score, and timestamp.

For a full chronological feed without filtering by grader, use `get_gradebook_history_feed` with the course ID (and optionally assignment ID or student ID).

### 6. Present the Audit Report

```
Gradebook Audit — [Course Name]
Period: [start date] → [end date]

SUMMARY
Total days with grade activity: 7
Total grade edits: 143
Graders active: 3

BREAKDOWN BY GRADER
• Prof. Martinez — 98 edits across 4 assignments (Apr 10–18)
• TA Chen — 42 edits across 2 assignments (Apr 12–14)
• System (auto-grade) — 3 edits (Apr 20)

NOTABLE CHANGES
• Assignment "Midterm Essay" — 12 students had scores changed on Apr 14
  Old avg: 71.2  →  New avg: 78.4  (grader: TA Chen)

• Student "Alex Doe" — grade changed 3 times on Apr 18 (possible error)
```

Ask the instructor if they want to export details or investigate any specific entry further.

## Notes

- This skill is **read-only** — it audits but does not modify grades.
- Gradebook history is append-only in Canvas; this skill surfaces the official audit log.
- For courses with thousands of submissions, use date range narrowing to stay within API rate limits.
- The four gradebook history tools used here (`list_gradebook_history_days`, `get_gradebook_history_day`, `list_gradebook_history_submissions`, `get_gradebook_history_feed`) are unique to canvas-lms-mcp and not available in other Canvas MCP servers.
