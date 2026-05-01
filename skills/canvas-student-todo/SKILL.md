---
name: canvas-student-todo
description: Student action list for Canvas. Surfaces every incomplete to-do item, missing submission, and upcoming deadline in one prioritised view — no calendar, no context switching. Trigger phrases include "what do I need to do", "my Canvas to-dos", "student to-do list", "what's missing", "catch me up", or "what should I work on".
---

# Canvas Student To-Do

Get a clear, prioritised list of everything you still need to do in Canvas — missing submissions, open to-dos, and deadlines — without having to check every course separately.

## Prerequisites

- Canvas MCP server must be running and connected.
- You must be logged in as a student (or have a student token) — this skill uses student-scoped endpoints.

## Steps

### 1. Get the Dashboard Overview

Call `get_dashboard_cards` to get the high-level card view of all enrolled courses. This surfaces which courses have activity and how many items are pending, giving you a quick triage before deeper calls.

Note any courses flagged with unread or to-do indicators.

### 2. Get Canvas To-Do Items

Call `get_todo_items` to retrieve the student's current Canvas to-do list. This includes assignments needing submission, peer reviews to complete, and quizzes with open attempts. Collect each item's:

- Assignment or quiz title
- Course name
- Due date
- Points possible

### 3. Get Missing Submissions

Call `get_missing_submissions` to identify assignments that are past their due date and have no submission. These are higher priority than upcoming items and should be flagged clearly.

### 4. Get Upcoming Events

Call `get_upcoming_events` to surface any scheduled events (class sessions, office hours, exams) in the near future. Include these at the bottom of the list as context for planning effort.

### 5. Get Active Courses for Context

Call `get_my_courses` to confirm the full list of enrolled courses and their names. Use this to cross-reference items from Steps 2–3 against the correct course context.

### 6. Build the Prioritised To-Do List

Sort items in this order:

1. **Missing / overdue submissions** — already late, highest urgency
2. **Due within 24 hours** — must act today
3. **Due in 2–7 days** — plan this week
4. **Upcoming events** — context for time blocking

For each item, show: course, title, due date/time, points, and current submission status.

Ask if the student wants to focus on any specific course or deadline window.

## Output Format

```
Canvas To-Do — [Student Name]
Generated [date]

MISSING (past due — act now)
• [Course] — [Assignment]  (was due [date], [points] pts)

DUE TODAY
• [Course] — [Assignment]  due [time today], [points] pts
• [Course] — [Quiz]        due [time today], [points] pts

DUE THIS WEEK
• [Date] — [Course] — [Assignment]  [points] pts
• [Date] — [Course] — [Peer review]

UPCOMING EVENTS
• [Date time] — [Event] ([Course])

SUMMARY
Courses with open items: [n]
Total items remaining: [n]
```

## Notes

- This skill is fully **read-only** — it surfaces what needs to be done but does not submit or modify anything.
- `get_missing_submissions` returns items that Canvas considers missing based on due date and submission state. Items with a "no submission" type or instructor excusal may appear incorrectly; mention the caveat if the student disputes an item.
- For the most accurate picture, run this skill at the start of the day or before a study session rather than mid-session, since Canvas caches to-do counts.
