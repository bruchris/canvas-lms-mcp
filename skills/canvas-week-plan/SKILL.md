---
name: canvas-week-plan
description: Student weekly planner for Canvas. Pulls upcoming assignments, due dates, current grades, pending submissions, and peer review obligations into a single prioritised plan for the week ahead. Trigger phrases include "plan my week", "what's due this week", "weekly Canvas plan", "week ahead", or "upcoming assignments".
---

# Canvas Week Plan

Build a focused weekly action plan by pulling everything due, missing, or upcoming from Canvas into a single prioritised view.

## Prerequisites

- Canvas MCP server must be running and connected.
- You must be logged in as a student (or have a student token) — this skill uses student-scoped endpoints.

## Steps

### 1. Load Active Courses

Call `get_my_courses` to retrieve the student's currently enrolled courses. Note each course ID and name — you will need them for per-course lookups.

### 2. Fetch Upcoming Assignments

Call `get_my_upcoming_assignments` to get assignments due within the next 7 days across all courses. Note due dates, point values, and submission types.

### 3. Check the To-Do List

Call `get_todo_items` to retrieve any Canvas-generated action items (assignments needing submission, quizzes needing completion). Merge with the upcoming assignments list, deduplicating by assignment ID.

### 4. Check Upcoming Calendar Events

Call `get_upcoming_events` to surface any class sessions, office hours, or exam blocks scheduled this week. Include these in the timeline alongside assignment due dates.

### 5. Review Recent Submissions and Grades

Call `get_my_grades` to get current grades per course (useful for prioritisation — a course where the grade is borderline deserves more attention this week).

Call `get_my_submissions` for each course where the student has recent activity to check which assignments are submitted, pending review, or returned with feedback.

For any course whose grade is borderline (near a letter-grade or pass boundary), call `project_grade` with the course ID and a target — a percentage like `90` or a letter like `"A"`. It returns the minimum uniform percentage needed on all remaining assignments to reach that target, a feasibility flag (`achievable` / `already_secured` / `impossible`), and a plain-language summary. This turns "this course is borderline" into a concrete weekly goal — e.g. "average 84% on the three remaining assignments to hold an A-". `project_grade` accounts for assignment-group weights and drop rules; it does not factor in late penalties.

### 6. Check Peer Review Obligations

For each course ID from Step 1, call `list_peer_reviews` (with the course ID and relevant assignment ID when known) to surface any assigned peer reviews that are due this week but not yet completed.

### 7. Build the Weekly Plan

Compile everything into a prioritised plan:

1. **Overdue / missing** — anything already past its due date with no submission
2. **Due today or tomorrow** — highest urgency
3. **Due later this week** — plan the effort required
4. **Peer reviews due** — easy to forget; flag them explicitly
5. **Upcoming events** — class sessions and exams to block time for

Ask the student if they want to adjust priorities or go deeper on any item.

## Output Format

```
Week Plan — [Student Name]  Week of [Mon date] – [Sun date]

OVERDUE (action required)
• [Course] — [Assignment] — due [date], not submitted
  → Suggest: submit now or talk to instructor

DUE TODAY / TOMORROW
• [Course] — [Assignment] — due [datetime], [points] pts
• [Course] — [Peer review] — due [date] for [peer name]

DUE LATER THIS WEEK
• [Course] — [Assignment] — due [day], ~[estimated effort]
• [Course] — [Quiz] — due [day]

UPCOMING EVENTS
• [Date] [time] — [Event title] ([course])

GRADE SNAPSHOT
• [Course A] — 88%  (on track)
• [Course B] — 71%  (borderline — need ≥84% on remaining work to reach a B)
• [Course C] — 94%  (strong)
```

## Notes

- This skill is fully **read-only** — it surfaces information but does not submit anything on the student's behalf.
- `list_peer_reviews` requires a course ID and assignment ID. If the student has many courses, focus on courses where the assignment deadline is within 7 days.
- Grades from `get_my_grades` reflect the current posted grade and may not include unposted scores. Mention this caveat if a course shows an unexpectedly low or missing grade.
- `project_grade` uses a uniform-percentage model (the same percentage assumed on every remaining item) and freezes drop rules at their current state — treat its output as a planning target, not a guarantee. It computes one student per call; omit `student_id` to run it for the logged-in student.
