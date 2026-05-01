---
name: canvas-grading-pass
description: Educator grading workflow for Canvas. Walks through ungraded submissions one at a time, applying rubric assessments and score comments with explicit confirmation before each write. Trigger phrases include "grade submissions", "start grading", "grading pass", "mark submissions", "grade this assignment", or "rubric grading".
---

# Canvas Grading Pass

Work through an assignment's ungraded submissions one at a time — viewing the student's work, applying the rubric, entering a score, and adding a comment — with a confirmation gate before each write operation.

## Prerequisites

- Canvas MCP server must be running and connected.
- You must have instructor or TA role in the target course.
- The assignment must accept online submissions (file upload, text entry, URL, etc.).

## Steps

### 1. Select the Course and Assignment

Ask the instructor which course and assignment to grade.

If unclear, call `list_courses` to let them choose a course, then call `list_assignments` (with the course ID) to select an assignment. Prefer assignments with `workflow_state=published` and a past due date.

### 2. Load the Rubric (if attached)

Call `list_rubrics` for the course to see available rubrics. If the assignment has an associated rubric (check `rubric_id` in the assignment object from `get_assignment`), call `get_rubric` with that rubric ID to retrieve criteria, rating descriptions, and point values.

Display the rubric criteria to the instructor before grading begins so they have it in view throughout.

### 3. Retrieve Ungraded Submissions

Call `list_submissions` for the course and assignment. Filter to submissions where `workflow_state` is `submitted` (not `graded`). Present the count:

> "Found [n] ungraded submissions for [Assignment]. Grading one at a time."

For assignments with more than 50 students, note: pace your session — Canvas rate-limits write operations. Take a short break between batches of 20–25 submissions if you encounter slowdowns.

### 4. Grade Each Submission (one at a time)

Repeat steps 4a–4d for each ungraded submission. **Do not batch or skip the confirmation gate.**

#### 4a. View the Submission

Call `get_submission` with the course ID, assignment ID, and student user ID. Display:
- Student name and user ID
- Submission date and type
- Submission body, URL, or attachment reference
- Any existing score or comments

Check `get_rubric_assessment` (with course ID, rubric ID, and submission ID) to see if a partial assessment already exists.

#### 4b. Propose a Score or Rubric Assessment

Based on the rubric (if present) and the instructor's judgment, draft:
- A rubric assessment: ratings per criterion with point values
- Or a raw numeric score

Present the proposed grade and ask the instructor:

> "Proposed score: [n]/[max] pts  
> Rubric: [criterion] → [rating] ([pts])  
> Add comment: [draft comment]  
> **Confirm to submit? (yes / edit / skip)**"

Do not proceed until the instructor confirms.

#### 4c. Submit Rubric Assessment (if rubric attached)

After confirmation, call `submit_rubric_assessment` with:
- `course_id`, `rubric_id`, `rubric_association_id` (from the rubric object)
- Assessment data: criterion ID → rating ID + points for each criterion
- `graded_anonymously: false` unless instructor specifies otherwise

#### 4d. Grade and/or Comment

If no rubric is attached (or in addition to the rubric assessment), call `grade_submission` with the numeric score.

If the instructor provided a comment, call `comment_on_submission` with the comment text.

Report: "✓ [Student name] — [score]/[max] pts — comment posted."

### 5. End-of-Session Summary

After all submissions are reviewed (or the instructor stops the session), present:

```
Grading Session Complete — [Assignment]

Graded this session:  [n]
Skipped:              [n]
Remaining ungraded:   [n]
```

Ask if the instructor wants to continue with any skipped submissions or return later.

## Output Format

```
Grading Pass — [Course] › [Assignment]
[n] ungraded  |  [max pts] pts  |  Rubric: [attached / none]

--- Submission 1 of [n] ---
Student:   [Name]  (ID: [id])
Submitted: [datetime]
Type:      [online_text_entry / file / url]

[submission preview or link]

Rubric Assessment (proposed):
  [Criterion 1]  →  [Rating label]  ([pts] pts)
  [Criterion 2]  →  [Rating label]  ([pts] pts)
  Total: [n]/[max] pts

Draft comment: "[comment text]"

Confirm? (yes / edit score / edit comment / skip)
```

## Notes

- This skill grades **one submission at a time** — there is no bulk grading mode. Every write requires explicit instructor confirmation.
- `grade_submission` and `submit_rubric_assessment` are **write operations** that modify the Canvas gradebook. They cannot be undone via the MCP server; use the Canvas web UI to correct mistakes.
- For assignments with more than 50 students, pace the session. If you encounter API errors, wait 30–60 seconds and retry the single failed call — do not retry the entire batch.
- Anonymous grading: if the assignment has `anonymous_grading: true`, student names will not be visible in submission data. Note this to the instructor before starting.
- `comment_on_submission` posts a visible comment to the student. Draft carefully and confirm before posting.
