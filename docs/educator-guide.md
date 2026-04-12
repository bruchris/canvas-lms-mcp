# Educator Guide

Use AI assistants to streamline grading, review submissions, and manage course interactions through Canvas. This guide covers setup, grading workflows, write operations, and privacy considerations.

## Setup

Follow the same token and configuration steps as the [Student Guide](student-guide.md). The only difference is that your Canvas token will carry instructor-level permissions, enabling write operations like grading and commenting.

Your token inherits your Canvas role. If you are an instructor or TA for a course, the MCP server can perform any action you could do in the Canvas UI.

## Grading Workflows

### Batch Grading with Feedback

The most common workflow: review submissions, assign grades, and leave comments.

**1. "List all submissions for assignment 67890 in course 12345"**

Start by pulling the full submission list. This shows each student's submission status, any existing grades, and submission timestamps.

**2. "Show me the submission from student 11111 on assignment 67890 in course 12345"**

Drill into a specific submission to see the full details including any prior comments and attachments.

**3. "Grade student 11111 on assignment 67890 in course 12345 with a B+ and comment 'Strong thesis, but the conclusion needs more evidence from primary sources.'"**

This calls `grade_submission` to set the grade and `comment_on_submission` to attach feedback. The AI client typically handles both in one interaction.

### Rubric-Based Grading

For assignments with rubrics, you can view criteria and submit assessments per criterion.

**4. "Show me the rubric for assignment 67890 in course 12345"**

Retrieves the rubric with all criteria, descriptions, and point scales. Useful for calibrating your grading before you start.

**5. "What's the rubric assessment for student 11111 on assignment 67890?"**

Check if a student already has rubric scores before overwriting.

**6. "Submit a rubric assessment for student 11111: Thesis 8/10 'Clear and well-argued', Evidence 6/10 'Needs more primary sources', Writing 9/10 'Excellent flow'"**

The AI assistant will call `submit_rubric_assessment` with per-criterion scores and comments. This is idempotent -- submitting again overwrites the previous assessment.

### Quiz Grading

For manually-graded quiz questions (essay questions, etc.):

**7. "Show me the quiz submissions for quiz 55555 in course 12345"**

Lists all student submissions with scores.

**8. "Show me student 11111's answers for quiz submission 99999"**

Retrieves the student's actual answers for review.

**9. "Score question 77777 on quiz 55555, submission 44444 with 8 points and comment 'Good analysis but missed the second part'"**

Calls `score_quiz_question`. You can optionally specify which attempt to score.

### Course Communication

**10. "Post to the Week 5 Discussion in course 12345: 'Great points everyone. For next week, consider how this applies to the case study we discussed in lecture.'"**

Posts a reply to a discussion topic. Supports HTML formatting.

## Write Operations Reference

The server includes 6 write tools. All require appropriate Canvas permissions.

| Operation | Tool | What It Does | Reversible? |
|-----------|------|--------------|-------------|
| Grade a submission | `grade_submission` | Sets/updates a grade (e.g., "95", "A", "pass") | Yes (re-grade) |
| Comment on submission | `comment_on_submission` | Adds a text comment | No (comments cannot be deleted via API) |
| Rubric assessment | `submit_rubric_assessment` | Scores each rubric criterion with comments | Yes (re-submit) |
| Score quiz question | `score_quiz_question` | Scores a manually-graded quiz question | Yes (re-score) |
| Post discussion reply | `post_discussion_entry` | Posts a reply to a discussion topic | No |
| Send message | `send_conversation` | Sends a Canvas inbox message | No |

**Idempotent operations** (grade, rubric, quiz score) can be safely retried -- they overwrite the previous value. **Non-idempotent operations** (comment, discussion post, message) create new entries each time.

## Privacy and Data Considerations

### What the Token Can Access

Your Canvas API token grants the same access as your Canvas login:

- **Courses you teach**: Full read/write access to course content, submissions, grades
- **Courses you're enrolled in**: Read access appropriate to your role
- **Student data**: Names, submissions, grades, comments for your courses
- **Personal data**: Your profile, inbox messages, calendar

### Best Practices

1. **Token lifecycle**: Set an expiration date on your token. Regenerate it at the start of each semester.

2. **Don't share tokens**: Your token carries your full permissions. Never paste it in shared documents, emails, or chat. Store it only in your local configuration file.

3. **Audit trail**: All actions performed via the MCP server appear in Canvas as actions taken by you. Grades set through the API show in the grade history just like manual grades.

4. **FERPA compliance**: Student educational records accessed through the API are subject to the same FERPA protections as data accessed through the Canvas UI. Follow your institution's data handling policies.

5. **AI-generated feedback**: If using AI to help draft feedback comments, review them before submission. You are responsible for the accuracy and appropriateness of all grading actions.

6. **Minimal access**: If you only need read access (e.g., reviewing submissions without grading), consider using a token from a TA account with limited permissions.

### What the Server Does NOT Do

- Does not store or cache any Canvas data
- Does not bypass Canvas permissions -- if Canvas would deny the action, the API will too
- Does not transmit data to third parties (data flows only between your AI client and Canvas)
- Does not have access to data outside your Canvas permissions

## Troubleshooting

**"You don't have permission to perform this action in this course"**
Your Canvas role may not have the required permissions. Check your course role (instructor vs TA vs designer) in Canvas.

**"Invalid data sent to Canvas"**
Double-check the IDs and data format. For grades, Canvas accepts strings like "95", "A-", "pass", "fail", "complete", "incomplete".

**"Canvas API rate limit exceeded"**
Canvas limits API requests. If grading many submissions, pause between batches. The server handles pagination automatically, but rapid sequential writes can trigger rate limits.
