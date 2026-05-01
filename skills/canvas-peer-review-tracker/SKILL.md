---
name: canvas-peer-review-tracker
description: Educator skill for tracking peer-review assignments in Canvas. Lists who has been asked to review whom, who has submitted versus who is still pending, and lets you assign new reviewers or send reminder messages — one student at a time. Trigger phrases include "peer reviews", "who hasn't done their peer review", "peer review status", "assign a peer reviewer", "remind students about peer reviews", or "peer review tracker".
---

# Canvas Peer Review Tracker

Educator workflow for the peer-review surface canvas-lms-mcp actually exposes: list assignments, see who is pending, optionally create new peer-review assignments, and optionally send a reminder via Canvas Conversations. **One student at a time, with confirmation before every write.**

## What this skill does NOT do

canvas-lms-mcp ships **4 peer-review tools** today (`list_peer_reviews`, `get_submission_peer_reviews`, `create_peer_review`, `delete_peer_review`). It does not yet expose any of the analytics, reminder-campaign, or quality-scoring endpoints competing servers ship. This skill stays inside the surface we have. Do **not** fabricate calls to:

1. **Completion-rate analytics** — there is no `get_peer_review_completion_analytics`. Completion percentages must be computed locally from the `list_peer_reviews` results, not retrieved as a server-side metric.
2. **Comment-quality scoring** — there is no `analyze_peer_review_quality` and no way to read the comments students wrote on peer reviews. Do not attempt to "rate" peer review feedback.
3. **Problematic-review detection** — there is no `identify_problematic_peer_reviews`. The skill cannot flag low-effort reviews automatically; it can only show which reviews are still incomplete.
4. **Peer review comments** — there is no `get_peer_review_comments`. The skill can show that a review is `assigned` or `completed` (the `workflow_state` from `list_peer_reviews`), not the comment body.
5. **Follow-up lists / dataset export** — there is no `get_peer_review_followup_list` and no `extract_peer_review_dataset`. The "who needs reminding" list is built locally from `workflow_state=assigned`.
6. **Bulk reminder campaigns** — there is no `send_peer_review_reminders` or `send_peer_review_followup_campaign`. Reminders go through `send_conversation` **one recipient at a time**, with the same per-student confirmation pattern as `canvas-at-risk-students`.
7. **Auto-generated reports** — there is no `generate_peer_review_report` or `generate_peer_review_feedback_report`. Any summary is built by this skill at presentation time; it is not a Canvas artefact.

If a user asks for any of those, name the gap explicitly and stop. Do not invent tool calls.

## Prerequisites

- Canvas MCP server must be running and connected.
- You must have instructor or TA role in the target course.
- The assignment must have peer review enabled (`peer_reviews: true` on the assignment).
- Student names appear in output — only run this in a private or educator-only session.
- Reminder messages (Step 5) require Canvas Conversations to be enabled for the course.

## Steps

### 1. Identify the Target Course and Assignment

Ask the educator which course and which peer-reviewed assignment to look at.

If unclear, call `list_assignments` for the course and surface assignments with peer review enabled. Confirm the choice before continuing — peer-review status data is per assignment, so picking the wrong one wastes the rest of the walk.

### 2. Pull the Peer Review Roster

Call `list_peer_reviews` with the course ID and assignment ID. The response is one row per assignment of (reviewer, submission-being-reviewed) with a `workflow_state` of `assigned` or `completed` and the `user_id` of the reviewer.

Compute locally:

| Bucket | Meaning |
|--------|---------|
| **Completed** | `workflow_state == completed` |
| **Pending** | `workflow_state == assigned` |
| **Total assignments** | Sum of completed + pending |
| **Completion rate** | `completed / total` (computed here, not fetched) |

Note: this list is keyed by reviewer-and-submission. A single student can appear multiple times if they were assigned more than one peer to review.

### 3. Resolve Names

`list_peer_reviews` returns user IDs only. Call `list_course_enrollments` with `type=['StudentEnrollment']` and `state=['active']` once and build a `user_id → name` map for the rest of the session. **Do not re-query enrollments for every reviewer** — one call up front, lookup locally afterwards.

### 4. Present the Tracker

```
Peer Review Tracker — [Course] › [Assignment]
Total assignments: 60   Completed: 41 (68%)   Pending: 19

PENDING REVIEWS  (19)
• Alex Doe (id: 12345)        — review of submission 8821 (assigned 4 days ago)
• Jordan Park (id: 12346)     — review of submission 8822 (assigned 4 days ago)
• Sam Lee (id: 12347)         — review of submissions 8823 and 8825

COMPLETED  (41)
• [Summary list — collapse by default unless asked]
```

Group the pending list by reviewer so the educator sees "who has 2+ outstanding reviews" at a glance. **Do not** display anything that would require fetching review comments — those are not available through this tool surface.

### 5. Send a Reminder (Optional, One Recipient at a Time)

If the educator wants to remind pending reviewers, repeat 5a–5c **once per reviewer**. Do not batch.

#### 5a. Draft the Message

Show the educator a default subject line and body, e.g.:

> Subject: Reminder — peer review for [Assignment] is still pending
> Body: Hi [Name], this is a reminder that your peer review for [Assignment] in [Course] hasn't been submitted yet. The review window is still open — let me know if you're running into any issues. Thanks!

Let the educator edit before each send.

#### 5b. Confirm Per Reviewer

Ask, exactly once per reviewer:

> "Send this reminder to [Name] (user id [n])? (yes / edit / skip)"

Do not proceed until the educator confirms. **Never confirm once and then send to multiple students.**

#### 5c. Send

After confirmation, call `send_conversation` with:
- `recipients`: array containing the single reviewer's user ID **as a string** (the tool requires `string[]`, not numbers)
- `subject`: the confirmed subject
- `body`: the confirmed body

Report `✓ Sent to [Name]` and move to the next reviewer.

### 6. Assign a New Peer Reviewer (Optional)

If the educator wants to add a missing peer-review assignment (e.g., a student joined late and was not auto-assigned a partner):

1. Call `list_submissions` for the assignment so the educator can pick the submission to be reviewed.
2. Identify the student you want to assign as the reviewer (by name, then look up the user ID from the enrollment map built in Step 3).
3. Show the educator: "Assign [Reviewer Name] to peer-review submission [n] (by [Author Name])? (yes/no)"
4. Only after confirmation: call `create_peer_review` with `course_id`, `assignment_id`, `submission_id`, and `user_id` (the reviewer).
5. Report the new peer-review row. Re-run Step 2 if the educator wants the updated tracker.

### 7. Inspect a Single Submission's Peer Reviews (Optional)

If the educator wants to see every peer review tied to one specific submission (e.g., "what reviews were assigned for Jane Smith's paper?"):

1. Call `list_submissions` and find the submission ID for Jane Smith.
2. Call `get_submission` if the educator wants context about the submission itself.
3. Call `get_submission_peer_reviews` with `course_id`, `assignment_id`, `submission_id`. This returns every reviewer assigned to that single submission with their workflow state.

This is useful when triaging "did this student's paper get reviewed by anyone?" — it is the inverse view of Step 2 (which is reviewer-centric).

## Output Format

```
Peer Review Tracker — [Course Name] › [Assignment Name]

OVERVIEW
Total assignments:  60
Completed:          41 (68%)
Pending:            19

PENDING (grouped by reviewer)
• Alex Doe              — 1 pending  (submission 8821)
• Jordan Park           — 1 pending  (submission 8822)
• Sam Lee               — 2 pending  (submissions 8823, 8825)

REMINDERS THIS SESSION
• Alex Doe       → message sent ✓
• Jordan Park    → educator chose to skip
• Sam Lee        → message sent ✓

NEW ASSIGNMENTS THIS SESSION
• Casey Chen → reviewing submission 8830 (Pat Kim)  ✓ created
```

## Notes

- **Read-only by default.** Steps 1–4 do not modify any Canvas data. Write paths (`create_peer_review`, `send_conversation`) live in Steps 5 and 6 only, each gated by per-student confirmation.
- **One reviewer at a time for reminders.** `send_conversation` accepts an array of recipients but the skill deliberately sends one recipient per call so the educator can audit and skip individuals. Do not collapse multiple reviewers into a single bulk send.
- **`send_conversation` recipients are strings, not numbers.** The tool's `recipients` parameter is `string[]`. Convert user IDs with `String(id)` before sending.
- **Completion percentage is computed locally.** Canvas does not return a server-side completion metric through this tool surface. The `(completed / total)` value comes from counting the `list_peer_reviews` rows yourself — do not invent another source.
- **Workflow states are limited to `assigned` and `completed`.** There is no `in_progress` or `late` state surfaced through `list_peer_reviews`. "Late" is a local interpretation of `assigned` past the assignment's `peer_reviews_due_at` date, if set.
- **Reviewer self-references.** Canvas occasionally returns peer-review rows where the reviewer ID equals the submission author's user ID (a misconfigured assignment). Surface these to the educator as "self-review — verify configuration" rather than counting them in the completion stats.
- **No comment access.** This skill cannot show what a reviewer wrote. It can only confirm that a review is marked `completed`. If the educator needs to read peer-review comments, point them at the Canvas web UI.
- **Reminder cadence.** Canvas does not deduplicate Conversation messages. Sending two reminders in quick succession will deliver two messages — track which reviewers were already pinged this session and warn the educator before re-sending.
