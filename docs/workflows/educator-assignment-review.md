# Educator Assignment Review

Use this workflow pack when an instructor or TA needs to review one Canvas assignment end to end: inspect the assignment brief, review one or more submissions, apply grades, and leave feedback without jumping between separate ad hoc prompts.

## When to Use It

- You are grading a single assignment in one course.
- You need a repeatable review loop across multiple students.
- The assignment may include a rubric and you want feedback to stay aligned with that rubric.
- You want the agent to summarize grading progress before performing write actions.

## Recommended Tool Sequence

1. `list_assignments`
   Use when you need to find the assignment ID inside a course.
2. `get_assignment`
   Confirm points possible, due date, submission type, and whether a rubric is attached.
3. `list_submissions`
   Build the grading queue and identify missing, late, or already graded submissions.
4. `get_submission`
   Inspect one student's submission details, attachments, prior comments, and current grade state.
5. `get_rubric`
   Load the rubric criteria before grading when the assignment uses rubric-based assessment.
6. `get_rubric_assessment`
   Check whether the student already has rubric scores so you do not overwrite them blindly.
7. `grade_submission`
   Set or update the score or grade.
8. `comment_on_submission`
   Add narrative feedback after the grade is confirmed.
9. `submit_rubric_assessment`
   Apply criterion-level rubric scores and comments when rubric grading is required.

## Write-Safety Notes

- `grade_submission` is a write action. Confirm the course, assignment, and student IDs before posting.
- `submit_rubric_assessment` is also a write action and overwrites prior rubric values for the targeted criteria.
- `comment_on_submission` is non-idempotent. Re-running the same prompt can create duplicate comments.
- Prefer a read-first loop: inspect the assignment, submission, and existing rubric assessment before sending any write call.
- If the agent proposes grades or comments, review the summary before allowing it to write in bulk across multiple students.

## Example Prompts

- "Run the educator assignment review workflow for the Week 4 essay in course 12345 and start with a grading queue summary."
- "Review student 11111's submission for assignment 67890 in course 12345, show the rubric context, then draft feedback before posting anything."
- "Grade the next ungraded submission for assignment 67890 in course 12345, using the rubric if present."
- "Summarize which submissions for assignment 67890 are missing, late, already graded, or still need feedback."
- "For assignment 67890 in course 12345, review student 11111, propose a score and comment, and wait for confirmation before writing."

## Expected Output Shape

The agent should return a structured grading summary before or alongside any write action, typically including:

- Assignment context: course, assignment title, points possible, rubric availability.
- Submission snapshot: student, submission state, submitted time, attachments, prior grade/comment status.
- Recommended action: proposed score, rubric notes, and feedback draft.
- Write plan: which Canvas write tools will be called next, if any.
- Post-write confirmation: final grade/comment/rubric actions that were actually sent.

## Related Tools

- `list_assignments`
- `get_assignment`
- `list_submissions`
- `get_submission`
- `get_rubric`
- `get_rubric_assessment`
- `grade_submission`
- `comment_on_submission`
- `submit_rubric_assessment`
