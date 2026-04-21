# Student Weekly Planning

Use this workflow pack when a student wants a weekly planning pass across Canvas: what is due soon, what is already missing, which courses need attention, and where the heaviest workload sits for the next few days.

## When to Use It

- You want a weekly overview instead of checking each course separately.
- You need a prioritized list of deadlines and missing work.
- You want the agent to combine dashboard, calendar, and course data into one study plan.
- You want a planning-friendly summary without making any changes in Canvas.

## Recommended Tool Sequence

1. `get_dashboard_cards`
   Identify the active course set and gather quick dashboard context.
2. `get_todo_items`
   Pull Canvas todo items that already represent urgent student-facing work.
3. `get_upcoming_events`
   Review near-term due dates and calendar events across courses.
4. `get_my_upcoming_assignments`
   Build the assignment deadline list for the planning window.
5. `get_my_courses`
   Fill in course names, states, and enrollment context when the dashboard summary is not enough.
6. `get_my_grades`
   Add lightweight performance context so the plan can emphasize courses with lower current standing.

## Write-Safety Notes

- This workflow is read-only. It should never call a Canvas write tool.
- The output is a planning aid, not an authoritative calendar replacement. If dates conflict, trust Canvas due dates and event timestamps.
- Grade context should be used for prioritization, not for any inferred academic advice beyond the visible Canvas data.

## Example Prompts

- "Run the student weekly planning workflow and give me a plan for the next 7 days."
- "What should I focus on this week across all my Canvas courses?"
- "Use my dashboard, todo items, and upcoming assignments to build a prioritized study plan."
- "Show me anything missing or due soon, then group the rest by course."
- "Create a weekly planning summary that flags low-grade courses and the assignments I should tackle first."

## Expected Output Shape

The agent should return a planning summary with clear sections, typically including:

- Week snapshot: date window, number of active courses, and the most urgent deadlines.
- Priority list: overdue or missing work first, then upcoming assignments ordered by due date.
- Course-by-course view: each course with relevant todo items, deadlines, and grade signal if available.
- Suggested plan: a short schedule or sequence for the next few days based on urgency and course load.
- Risks and gaps: anything with unclear due dates, missing grade visibility, or likely overload.

## Related Tools

- `get_dashboard_cards`
- `get_todo_items`
- `get_upcoming_events`
- `get_my_upcoming_assignments`
- `get_my_courses`
- `get_my_grades`
