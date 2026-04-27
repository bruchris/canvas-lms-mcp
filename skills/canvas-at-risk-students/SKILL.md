---
name: canvas-at-risk-students
description: Identify struggling students, find who's falling behind, surface at-risk students in a course, and reach out to students who need help. Uses enrollment data, assignment submissions, and course analytics to produce a prioritized list of students, then optionally sends them a Canvas message via send_conversation.
---

# Canvas At-Risk Students

Identify students who are struggling and initiate outreach — all without leaving your AI assistant.

## Prerequisites

- Canvas MCP server running and connected
- Teacher or TA role with course read access
- Messaging permissions to send Canvas conversations

## Steps

### 1. List your courses

Use `list_courses` to retrieve active courses. If you already know the course ID, skip ahead.

### 2. Pull enrollment and analytics data

Call `list_course_enrollments` with the target course ID to get the full student roster. Then call `get_course_analytics` for an overview of participation and grade distribution.

### 3. Fetch assignment and submission data

Call `list_assignments` to get all assignments in the course, then `list_submissions` for each assignment you want to inspect (e.g., past-due or low-scoring work). Look for:
- Missing submissions (submission_type = null, late = true)
- Scores well below the class average
- Patterns of late or unsubmitted work

### 4. Rank at-risk students

Combine the data above to produce a ranked list. Prioritise students with two or more of:
- Grade below the course passing threshold
- Two or more missing submissions
- Low activity score from `get_student_analytics`

### 5. Review individual analytics (optional)

For students near the threshold, call `get_student_analytics` with the student's user ID to see their detailed participation trend before reaching out.

### 6. Send outreach messages

For each student you want to contact, call `send_conversation` with:
- `recipients`: the student's Canvas user ID
- `subject`: a warm, non-alarming subject line (e.g., "Checking in on your progress")
- `body`: a brief, supportive message

Keep the tone supportive and specific. Reference the assignment or area where you've noticed them struggling.

## MCP Tools Used

| Tool | Purpose |
|------|---------|
| `list_courses` | Retrieve active courses to find the right course ID |
| `get_course` | Confirm course details (name, term, student count) |
| `list_course_enrollments` | Get the full student roster for the course |
| `get_course_analytics` | High-level grade distribution and participation overview |
| `get_student_analytics` | Per-student participation trend for borderline cases |
| `list_assignments` | Enumerate assignments to check for missing work |
| `list_submissions` | Get submission status and scores per assignment |
| `send_conversation` | Send a Canvas inbox message to one or more students |

## Example Prompts

- "Show me which students are struggling in my Biology 101 course."
- "Who's falling behind in course 12345? List anyone with missing assignments or low grades."
- "Find at-risk students in my course and draft a check-in message to send to each of them."
- "Which students haven't submitted the last two assignments?"

## Notes / Error Recovery

- If `get_course_analytics` returns empty, the course may not have enough activity yet. Fall back to `list_submissions` to identify missing work directly.
- `send_conversation` requires messaging to be enabled on the Canvas instance. A 403 error means the token lacks messaging permissions.
- Student IDs from `list_course_enrollments` are in the `user_id` field — use those as `recipients` in `send_conversation`.
- This skill works best mid-term or after a major assignment due date; running it in week 1 will produce sparse data.
