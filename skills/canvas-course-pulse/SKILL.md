---
name: canvas-course-pulse
description: Educator skill for tracking week-over-week course health trends in Canvas. Surfaces assignment performance trends, login activity, engagement gaps, and struggling students across a longer time horizon than a daily check. Trigger phrases include "course pulse", "course health", "course trends", "week-over-week performance", "how is the course going", "engagement trends", "who isn't logging in", or "course activity over time".
---

# Canvas Course Pulse

Educator skill for a longer-horizon view of course health: assignment performance trends, login patterns, engagement gaps, and student activity — across a week or more of data.

**Use this skill for trend analysis over days or weeks. For today's immediate check (submission rates, upcoming deadlines, grade distribution this morning), use `canvas-morning-check` instead.**

## Prerequisites

- Canvas MCP server must be running and connected.
- You must have instructor or admin role in the target course.
- Analytics data requires the course to have active student enrollments and at least one graded activity.
- Student names and engagement data are visible in output — only run this in a private or educator-only session.

## Steps

### 1. Identify the Target Course

Ask the user which course to analyse. Accept a course name, course code, or Canvas ID.

If unclear, call `list_course_enrollments` with the course ID to confirm the course exists and has enrolled students.

### 2. Choose a Focus Area

Offer three pulse views or ask the user what they want to know:

| View | What it answers |
|------|-----------------|
| **Assignment trends** | Which assignments have low completion or low average scores? How has performance trended? |
| **Engagement & login activity** | Who is logging in regularly? Who has gone quiet? What's happening in the activity stream? |
| **Per-student deep-dive** | How is a specific student tracking across assignments, grades, and participation? |

You can combine views in a single report.

### 3A. Assignment Performance Trends

1. Call `get_course_analytics` with the course ID. This returns aggregate assignment-level data: submission counts, score averages, and on-time vs late rates per assignment.
2. Call `list_assignments` with the course ID to get assignment titles, due dates, and point values (for context the analytics data may not include).

Cross-reference to build a trend table, ordering by due date:

```
Assignment Trends — [Course Name]  (last 4 weeks)

Assignment                    Submitted   Avg Score   On Time
"Week 1 Reflection"           47/50 (94%) 88%         92%
"Reading Quiz 2"              46/50 (92%) 81%         89%
"Group Project Draft"         44/50 (88%) 74%         71%  ← slipping
"Week 3 Reflection"           39/50 (78%) 68%         58%  ← needs attention
"Midterm Essay"               41/50 (82%) 72%         63%
```

Flag assignments where submission rate has dropped more than 10 percentage points from the course average, or where the on-time rate is below 65%.

### 3B. Engagement and Login Activity

1. Call `get_course_activity_stream` with the course ID. This returns the recent activity feed: discussion posts, assignment submissions, grade postings, and other course events.
2. Call `list_course_enrollments` with the course ID and `type=StudentEnrollment` to get the enrolled student list with last-activity timestamps.

Identify students who have not had any course activity in the past 7 days. For courses with 50+ students, narrow to the bottom quartile by last-activity date rather than listing all students.

Present a summary:

```
Engagement Pulse — [Course Name]

RECENT ACTIVITY (last 7 days)
Total events: 312
  Discussion posts: 87
  Assignment submissions: 134
  Grade views: 58
  Other: 33

ACTIVE STUDENTS: 43/50 this week

DISENGAGED STUDENTS (no activity in 7+ days)
• Student A — last seen 12 days ago
• Student B — last seen 9 days ago
• Student C — last seen 8 days ago
• … (3 more — ask to see full list)
```

Ask the instructor if they want to reach out to disengaged students or investigate further.

### 3C. Per-Student Deep-Dive

1. Call `get_student_analytics` with the course ID and the student's user ID. This returns the student's per-assignment scores, submission behaviour, and participation data.

Present a compact per-student pulse:

```
Student Pulse — Student A — [Course Name]

Assignments submitted: 7/9 (78%)
Current grade: 71%
Trend: down from 81% four weeks ago

SUBMISSION HISTORY
• "Week 1 Reflection"   ✓  submitted on time   88%
• "Reading Quiz 2"      ✓  submitted on time   76%
• "Group Project Draft" ✓  submitted 2 days late  62%
• "Week 3 Reflection"   ✗  not submitted        —
• "Midterm Essay"       ✓  submitted on time   71%
```

Flag if the student's grade is trending downward (more than 8 points over the past 3 assignments) or if they have 2+ missing submissions.

### 4. Summarise and Suggest Next Steps

After presenting the requested views, offer concrete next steps:

- **For struggling assignments**: "Would you like to review submissions for [assignment name] to understand why scores are low?"
- **For disengaged students**: "Would you like to send a check-in message to students who haven't logged in this week?" (Use `canvas-at-risk-students` for full outreach workflow.)
- **For a declining student**: "Would you like to send [student name] a direct message through Canvas?"

## Output Format

```
Course Pulse — [Course Name]  (analysed [date])

ASSIGNMENT TRENDS
Submission rate this week: 82%  (↓ from 91% two weeks ago)
Average score trend: 74%  (↓ from 81%)
Assignments needing attention: 2

ENGAGEMENT
Active students this week: 43/50
Disengaged (7+ day gap): 7 students

SUGGESTED ACTIONS
• Review "Week 3 Reflection" submissions — lowest completion (78%) and scores (68%)
• Check in with 7 disengaged students — 3 are also below 70% grade
• Student A has missed 2 assignments and grade is trending down 10 pts
```

## Notes

- This skill is **read-only** — it surfaces analytics and engagement data without modifying any Canvas content.
- **Scope vs `canvas-morning-check`**: `canvas-morning-check` is a same-day health check (today's submission rates, this morning's grade distribution). This skill analyses trends over days or weeks — use it for mid-course adjustments, not for daily ops.
- `get_course_analytics` returns aggregate data per assignment, not per-student scores. For individual student trajectories, use `get_student_analytics` (Step 3C).
- For courses with 100+ students, `get_course_activity_stream` may return a large event list. Summarise by event type and highlight disengagement signals rather than listing all events.
- Login activity and "last seen" data comes from enrollment timestamps. Canvas does not always update these in real time; treat "last activity" as approximate.
