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

The server includes 48 write tools. All require appropriate Canvas permissions. They are grouped below by domain; the grading tools you'll use most often are listed first.

### Grading & Feedback

| Operation | Tool | What It Does | Reversible? |
|-----------|------|--------------|-------------|
| Grade a submission | `grade_submission` | Sets/updates a grade (e.g., "95", "A", "pass") | Yes (re-grade) |
| Comment on submission | `comment_on_submission` | Adds a text comment | No (comments cannot be deleted via API) |
| Rubric assessment | `submit_rubric_assessment` | Scores each rubric criterion with comments | Yes (re-submit) |
| Score quiz question | `score_quiz_question` | Scores a manually-graded quiz question | Yes (re-score) |
| Post discussion reply | `post_discussion_entry` | Posts a reply to a discussion topic | No |
| Send message | `send_conversation` | Sends a Canvas inbox message | No |

**Idempotent operations** (grade, rubric, quiz score) can be safely retried -- they overwrite the previous value. **Non-idempotent operations** (comment, discussion post, message) create new entries each time.

### Courses

| Operation | Tool | What It Does | Reversible? |
|-----------|------|--------------|-------------|
| Create a course | `create_course` | Creates a new course in an account | No -- no `delete_course` tool in this server; conclude or delete the course via Canvas UI/admin |
| Update a course | `update_course` | Updates course fields; only provided fields change | Yes (call again to revert fields) |

### Assignments

| Operation | Tool | What It Does | Reversible? |
|-----------|------|--------------|-------------|
| Create an assignment | `create_assignment` | Creates a new assignment in a course | Yes (call `delete_assignment`) |
| Update an assignment | `update_assignment` | Updates an existing assignment; only provided fields change | Yes (call again to revert fields) |
| Delete an assignment | `delete_assignment` | Deletes an assignment from a course | No -- permanent; removes the assignment and its submissions/grades |

### Rubrics

| Operation | Tool | What It Does | Reversible? |
|-----------|------|--------------|-------------|
| Create a rubric | `create_rubric` | Creates a rubric with criteria and rating levels; can link to an assignment immediately | No -- no `delete_rubric`/`update_rubric` tool in this server; remove or unlink via Canvas UI |

### New Quizzes

| Operation | Tool | What It Does | Reversible? |
|-----------|------|--------------|-------------|
| Create a New Quiz | `create_new_quiz` | Creates a New Quiz (LTI) in a course | Yes (call `delete_new_quiz`) |
| Update a New Quiz | `update_new_quiz` | Updates an existing New Quiz | Yes (call again to revert fields) |
| Delete a New Quiz | `delete_new_quiz` | Deletes a New Quiz | No -- permanent |
| Create a New Quiz item | `create_new_quiz_item` | Adds a question (choice, true/false, essay, matching, or numeric) to a New Quiz | Yes (call `delete_new_quiz_item`) |
| Update a New Quiz item | `update_new_quiz_item` | Updates an existing New Quiz question | Yes (call again to revert fields) |
| Delete a New Quiz item | `delete_new_quiz_item` | Deletes a question from a New Quiz | No -- permanent |

### Files

| Operation | Tool | What It Does | Reversible? |
|-----------|------|--------------|-------------|
| Upload a file | `upload_file` | Uploads a base64-encoded file to a course | Yes (call `delete_file`) |
| Delete a file | `delete_file` | Deletes a file by ID | No -- permanent |

### Enrollments

| Operation | Tool | What It Does | Reversible? |
|-----------|------|--------------|-------------|
| Enroll a user | `enroll_user` | Enrolls a user in a course with a specified role | Yes -- call `remove_enrollment` with `task=conclude` or `task=deactivate` |
| Remove an enrollment | `remove_enrollment` | Removes, concludes, or deactivates an enrollment (`task` parameter) | Depends on `task`: `delete` is permanent (No); `conclude`/`deactivate` are reversible (Yes) |

### Discussions

| Operation | Tool | What It Does | Reversible? |
|-----------|------|--------------|-------------|
| Create a discussion | `create_discussion` | Creates a new discussion topic in a course | Yes (call `delete_discussion`) |
| Update a discussion | `update_discussion` | Updates an existing discussion topic | Yes (call again to revert fields) |
| Delete a discussion | `delete_discussion` | Deletes a discussion topic from a course | No -- permanent |

### Modules

| Operation | Tool | What It Does | Reversible? |
|-----------|------|--------------|-------------|
| Create a module | `create_module` | Creates a new module in a course | No -- no `delete_module` tool in this server; remove via Canvas UI |
| Update a module | `update_module` | Renames, repositions, publishes, or unpublishes a module | Yes (call again to revert fields, e.g. unpublish) |
| Add a module item | `create_module_item` | Adds an item (Assignment, Page, Quiz, File, Discussion, ExternalUrl, ExternalTool, or SubHeader) to a module | No -- no `delete_module_item` tool in this server; remove via Canvas UI |

### Pages

| Operation | Tool | What It Does | Reversible? |
|-----------|------|--------------|-------------|
| Create a page | `create_page` | Creates a new wiki page in a course | Yes (call `delete_page`) |
| Update a page | `update_page` | Updates an existing wiki page | Yes (call again to revert fields; Canvas keeps page revision history) |
| Delete a page | `delete_page` | Deletes a wiki page from a course | No -- permanent |

### Calendar

| Operation | Tool | What It Does | Reversible? |
|-----------|------|--------------|-------------|
| Create a calendar event | `create_calendar_event` | Creates a new Canvas calendar event | No -- no `delete_calendar_event` tool in this server; remove via Canvas UI |
| Update a calendar event | `update_calendar_event` | Updates an existing calendar event; only provided fields change | Yes (call again to revert fields) |

### Peer Reviews

| Operation | Tool | What It Does | Reversible? |
|-----------|------|--------------|-------------|
| Assign a peer review | `create_peer_review` | Assigns a user to peer-review a submission | Yes (call `delete_peer_review`) |
| Remove a peer review | `delete_peer_review` | Removes a peer review assignment from a submission | No -- permanent |

### Content Export & Migration

| Operation | Tool | What It Does | Reversible? |
|-----------|------|--------------|-------------|
| Start a content export | `create_content_export` | Starts an asynchronous course export (Common Cartridge / QTI / zip); returns an export ID to poll with `get_content_export` | N/A -- read-only against course content; only generates a downloadable file |
| Start a content migration | `create_content_migration` | Starts an asynchronous course copy, Common Cartridge import, zip import, QTI conversion, or Moodle conversion into the course | No -- imported content is not automatically removed; delete individual imported items manually |

### Grading Standards

| Operation | Tool | What It Does | Reversible? |
|-----------|------|--------------|-------------|
| Create a grading standard | `create_grading_standard` | Creates a letter-to-percentage grading scheme in a course or account | No -- no `delete_grading_standard` tool in this server; remove via Canvas UI if unused |
| Apply a grading standard | `apply_grading_standard_to_course` | Activates a grading standard on a course's gradebook | Yes -- call again with `grading_standard_id: null` to remove it from the course |

### Quiz Accommodations

| Operation | Tool | What It Does | Reversible? |
|-----------|------|--------------|-------------|
| Set a Classic Quiz accommodation | `set_student_quiz_accommodation` | Grants extra time and/or attempts to a student across a course's Classic Quizzes | No -- verify in Canvas before use; Canvas's quiz extensions API rejects `0`/negative values, so this tool cannot fully clear an accommodation once set (reduce via a smaller value, or adjust in Canvas UI) |
| Set a New Quiz accommodation | `set_student_new_quiz_accommodation` | Grants a time multiplier and/or extra attempts to a student across a course's New Quizzes | No -- verify in Canvas before use; this tool has no "clear" path back to no accommodation (adjust in Canvas UI) |

### Assignment Overrides

| Operation | Tool | What It Does | Reversible? |
|-----------|------|--------------|-------------|
| Create an assignment override | `create_assignment_override` | Sets a due-date/availability override for students, a course section, or a group on one assignment | No -- no update/delete tool for the override in this server; edit or remove via Canvas UI |
| Set a student's assignment dates | `set_student_assignment_dates` | Fans a due-date/availability override for one student across some or all assignments in a course (create-only; fails on assignments that already have an override) | No -- no update/delete tool for the resulting overrides in this server; edit or remove via Canvas UI |

### Scheduler (Appointment Groups)

| Operation | Tool | What It Does | Reversible? |
|-----------|------|--------------|-------------|
| Create an appointment group | `create_appointment_group` | Creates sign-up slots (Canvas Scheduler) for a course or other context | Yes (call `delete_appointment_group`) |
| Update an appointment group | `update_appointment_group` | Publishes a draft group or adds new time slots | Yes (call again to revert fields) |
| Delete an appointment group | `delete_appointment_group` | Deletes an appointment group and cancels any existing reservations | No -- permanent |

### Student Assignment Submission (opt-in)

These two tools submit the *token holder's own* work and are only available when the server is started with `CANVAS_ENABLE_ASSIGNMENT_SUBMISSION`. They're listed here for completeness since they are write tools, but they're used by students, not educators.

| Operation | Tool | What It Does | Reversible? |
|-----------|------|--------------|-------------|
| Upload a submission file | `upload_submission_file` | Uploads a file to the student's own submission area (step 1 of an online-upload submission) | Yes -- nothing is submitted until `submit_assignment` is called |
| Submit an assignment | `submit_assignment` | Submits the student's own work to an assignment | No -- Canvas submissions cannot be retracted and may consume a limited attempt |

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
