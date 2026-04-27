---
name: canvas-at-risk-students
description: Identify at-risk Canvas students and send targeted outreach. Surfaces students with missing assignments, low grades, or declining submission patterns — then lets you message them directly. Trigger phrases include "at-risk students", "struggling students", "who's falling behind", "students to check in with", or "missing submissions".
---

# Canvas At-Risk Students

Identify students who are falling behind and reach out to them without leaving your agent session.

## Prerequisites

- Canvas MCP server must be running and connected.
- You must have instructor or TA role in the target course.
- Student names are visible in output — only run this in a private or educator-only session.

## Steps

### 1. Identify the Target Course

Ask the user which course to check. Accept a course name, course code, or Canvas ID.

If unclear, call `list_courses` to let the user select from their active courses.

### 2. Retrieve Enrolled Students

Call `list_course_enrollments` with `type=StudentEnrollment` and `state=active` to get the active student roster. Note the student user IDs — you will need them for individual lookups.

### 3. Collect Submission Data

Call `list_assignments` to get all assignments with due dates in the **past 4 weeks**. For each assignment:

1. Call `list_submissions` filtered to that assignment.
2. Flag any student whose submission `workflow_state` is `unsubmitted` or whose score is missing.

Build a per-student tally: missing assignment count and submitted-on-time count.

### 4. Classify by Risk Tier

| Tier | Criteria |
|------|----------|
| **Critical** | 3 or more missing assignments in the past 4 weeks |
| **Needs attention** | 1–2 missing assignments, or a `get_student_analytics` score trend showing decline |
| **On track** | All assignments submitted |

For students in Critical or Needs Attention tiers, call `get_student_analytics` (with their user ID and the course ID) to confirm the pattern and surface their current grade.

### 5. Present the At-Risk List

Show a table:

| Student | Missing Assignments | Current Grade | Risk Tier |
|---------|--------------------|--------------:|-----------|
| …       | …                  | …             | Critical  |

Ask the instructor: "Would you like to send a check-in message to any of these students?"

### 6. Send Outreach (Optional)

For each student the instructor wants to contact, call `send_conversation` with:

- `recipients`: the student's Canvas user ID (from the enrollment list)
- `subject`: a brief subject line (suggest a default, let instructor edit)
- `body`: a supportive check-in message (draft one, let instructor approve before sending)

Confirm each message before sending. Report which students were contacted.

## Output Format

```
At-Risk Students — [Course Name]  (checked [date range])

CRITICAL (3+ missing)
• Jane Smith — missing 4 of 5 assignments, current grade 41%
  → Message sent ✓

NEEDS ATTENTION (1–2 missing)
• Alex Doe — missing 1 assignment, grade trending from 78% → 68%
  → Instructor chose to skip

ON TRACK: 24 students
```

## Notes

- This skill does not grade or modify any submissions — it is read-only except for the optional outreach step.
- Use `send_conversation` only after explicit instructor confirmation per student.
- For large courses (100+ students), process assignments in batches to stay within Canvas rate limits.
