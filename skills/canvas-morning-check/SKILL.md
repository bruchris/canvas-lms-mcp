---
name: canvas-morning-check
description: Educator morning briefing for Canvas. Surfaces ungraded submissions, participation gaps, upcoming deadlines, and flagged students across all active courses — in under a minute. Trigger phrases include "morning Canvas check", "what needs my attention today", "grading queue", "educator briefing", "what's pending", or "Canvas daily summary".
---

# Canvas Morning Check

Start the teaching day with a prioritised briefing: what needs grading, who hasn't submitted, which deadlines are coming, and which students may need a nudge — all from a single agent session.

## Prerequisites

- Canvas MCP server must be running and connected.
- You must have instructor, TA, or admin role in the target courses.
- **Privacy notice:** student names and submission data are visible in this output. Run this skill only in a private or educator-only session — never in a shared screen or student-facing context. Your institution's Canvas admin token policy governs what data is accessible; you are responsible for handling student information in accordance with FERPA or your local equivalent.

## Steps

### 1. Load Active Courses

Call `list_courses` to retrieve your currently active courses (use `enrollment_type=teacher` if needed to filter to courses where you are the instructor). Alternatively, call `get_dashboard_cards` for a quick overview of courses with pending items.

Note each course ID, name, and enrollment count.

### 2. Check the Grading Queue (per course)

For each active course, call `list_submissions_awaiting_grading` with the course ID. This tool is purpose-built for the grading queue: it returns every submission still needing a human grade — both `workflow_state=submitted` (never graded) and `workflow_state=pending_review` (Classic Quiz essays Canvas auto-graded but left for manual scoring) — sorted oldest-waiting first and grouped by assignment or quiz. It replaces the old manual `list_assignments` → per-assignment `list_submissions` fan-out.

Build a grading backlog table: course → assignment → ungraded count → oldest wait.

> Pass `only_pending_review=true` for just the quiz-essay queue. Note: New Quizzes (Quizzes.Next) submissions may not surface here — grade those in the New Quizzes interface.

Also call `list_submission_comments_needing_attention` for each course to catch submissions where the student left the most recent comment with no reply or grade yet. These are easy to miss and often time-sensitive.

### 3. Flag Students Who Need Attention

For each course, call `list_students_needing_attention` with the course ID. This returns a factual report of students flagged by inactivity, missing or late submissions, and low current score — each finding lists the exact signals that fired and the thresholds used. Use it instead of manually cross-referencing enrollment lists against submissions.

### 4. Scan Engagement Trends

For courses flagged with participation issues or declining grades, call `get_course_analytics` (with the course ID) to see aggregated participation and on-time submission rates.

For individual students flagged in Step 3, call `get_student_analytics` (with course ID and student user ID) to confirm declining trends before including them in the action list.

### 5. Check Upcoming Deadlines

Call `list_assignments` for each active course and surface any assignments due within the next 48 hours that have not yet been published or that have zero submissions (a student reminder may be needed).

### 6. Present the Morning Briefing

Organise output in this order:

1. Grading queue (highest count first)
2. Upcoming deadlines needing attention
3. Students with participation gaps
4. Any urgent analytics flags

Ask the instructor if they want to drill into any item or take action (messaging students, opening a submission for review).

## Output Format

```
Morning Check — [Instructor Name]
[Date]  |  Active courses: [n]

GRADING QUEUE
• [Course A] — [Assignment]  [n] ungraded  (due [date])
• [Course B] — [Assignment]  [n] ungraded  (due [date])

UPCOMING DEADLINES (next 48 h)
• [Course] — [Assignment]  due [datetime]  submissions so far: [n]/[total]

PARTICIPATION GAPS
• [Course] — [Student Name]  — no submission in last 2 assignments
• [Course] — [Student Name]  — grade trending down (was 82% → now 67%)

ANALYTICS FLAGS
• [Course] — on-time submission rate dropped to [n]% this week

All clear on remaining courses.
```

## Notes

- This skill is **read-only** — it surfaces information but does not grade or message anyone. Use `canvas-at-risk-students` for the outreach step.
- For courses with large enrolments (100+ students), `list_submissions_awaiting_grading` and `list_students_needing_attention` do the pagination and cross-referencing server-side — you get a triage list back rather than raw submission pages. Still lead the briefing with the highest-count course to keep it concise.
- `get_student_analytics` may be slow on large courses; call it only for students already flagged in Step 3, not for every student.
- Gradebook data reflects posted grades only. Unposted grades will not appear in analytics trends.
