---
name: canvas-office-hours
description: Educator skill for running office hours through Canvas Scheduler appointment groups. Create and publish sign-up slots for a course, list existing groups and their time slots, and see which students (or student groups) have reserved — one confirmed action at a time. Trigger phrases include "office hours", "appointment group", "Canvas Scheduler", "sign-up slots", "create office hours", "who signed up for office hours", "manage appointment slots", "publish office hours", or "schedule office hours".
---

# Canvas Office Hours

Manage office hours as Canvas Scheduler **appointment groups**: review the groups you already run, create new sign-up slots for a course, publish a draft so students can see it, and check who has reserved. Read paths are free; every write (create, update/publish, delete) is gated by an explicit per-action confirmation, clearly separated from the read paths.

## What this skill can and cannot do

canvas-lms-mcp exposes **eight appointment-group tools**. This skill covers the full surface:

- Read: `list_appointment_groups`, `get_appointment_group`, `list_appointment_group_users`, `list_appointment_group_groups`, `next_appointment`.
- Write (confirmed per action): `create_appointment_group`, `update_appointment_group`, `delete_appointment_group`.

**It does NOT reserve slots on a student's behalf.** Reservations live in the Canvas Calendar Events API and were explicitly out of scope for this domain — there is no `reserve_appointment` tool. Students sign up themselves via the Canvas Calendar ("Find Appointment"). Do not promise to book, cancel, or move an individual student's reservation; you can only manage the *group* and *read* who has reserved.

## Prerequisites

- Canvas MCP server must be running and connected.
- **Instructor or TA role on the target course is required** for the write tools and for `list_appointment_group_users` / `list_appointment_group_groups`. `list_appointment_groups` and `get_appointment_group` are available more broadly, but managing groups requires teaching permissions.
- Student names appear when you list who signed up — only run those steps in a private or educator-only session.

## Steps

### 1. Identify the Course

Ask the educator which course the office hours are for. You need its Canvas ID to build the `context_code` (format: `course_<id>`, e.g. `course_123`). If unclear, call `list_courses` and let them pick.

### 2. Review Existing Appointment Groups

Call `list_appointment_groups` with `scope=manageable` to list the groups the educator manages (use `scope=reservable` instead to see groups a user could sign up for). Present each group's title, status (published vs. draft), and slot/participant counts.

For a specific group, call `get_appointment_group` with its ID to see its individual time slots and per-slot participant counts. Use this to answer "how many of my Thursday slots are still open?".

### 3. See Who Signed Up

To see reservations for a group:

- Call `list_appointment_group_users` with the group ID for individual students who reserved a slot (`participant_type=User`, the common case).
- Call `list_appointment_group_groups` with the group ID when the appointment group is configured for **student-group** sign-ups (`participant_type=Group`) — this lists the student groups that reserved.

Present a roster: slot time → who reserved it. Flag empty slots so the educator can see remaining capacity. Remember this is a read of existing reservations — you cannot add or remove a reservation here.

### 4. Create an Appointment Group (Write — Confirmed)

**Requires explicit educator confirmation before the call.**

1. Collect:
   - **Title** (required) — e.g. "CS 101 Office Hours — Week 6".
   - **Context** — at least one `context_code`, e.g. `course_123` from Step 1.
   - **Time slots** — one or more `new_appointments` entries, each a `[start_at, end_at]` pair of ISO-8601 datetimes. Each pair is a single bookable slot (e.g. four 15-minute Thursday slots = four pairs).
   - Optionally: description, location, and per-slot participant limit if the educator wants one student per slot.
2. Show a single preview naming the course, title, and every slot:

   > "Create appointment group '[Title]' in [Course] with these slots: [list]? It will be created as a **draft** (students can't see it until you publish in Step 5). (yes/no)"

3. Only after confirmation: call `create_appointment_group` with the `context_code`, `title`, and `new_appointments` pairs.
4. Report the new group ID. **Note it is unpublished** — proceed to Step 5 to make it visible.

**Never batch.** If the educator wants two separate groups (e.g. two different weeks), repeat Steps 4a–4d with a fresh confirmation for each.

### 5. Publish or Add Slots (Write — Confirmed)

**Requires explicit educator confirmation before the call.**

`update_appointment_group` handles two common edits:

- **Publish a draft** so students can reserve: confirm, then call `update_appointment_group` with the group ID and `publish=true`. A newly created group is not visible to students until this happens.
- **Add more time slots** to an existing group: confirm the new `[start_at, end_at]` pairs, then call `update_appointment_group` with the group ID and the additional `new_appointments`.

Show a one-line preview before each call:

> "Publish '[Title]' so students can sign up?" or "Add [n] new slots to '[Title]'? (yes/no)"

Report the updated group state.

### 6. Delete an Appointment Group (Write — Confirmed, Destructive)

**Requires explicit educator confirmation before the call. This cancels every existing reservation.**

1. Confirm which group to delete (ID and title from Step 2).
2. Ask for a `cancel_reason` — Canvas sends it to any students who had reserved a slot, so a clear reason ("Office hours moved to Zoom — see announcement") is courteous.
3. Show the preview, naming the group and how many reservations will be cancelled:

   > "Delete '[Title]' and cancel [n] existing reservation(s)? Students will be notified: '[cancel_reason]'. This cannot be undone. (yes/no)"

4. Only after confirmation: call `delete_appointment_group` with the group ID and `cancel_reason`.
5. Report `✓ Deleted '[Title]' — [n] reservation(s) cancelled`.

### 7. Check Your Next Appointment (Read)

Call `next_appointment` to get the current user's next upcoming reserved appointment across all (or specified) groups. Useful for "when's my next office-hours booking?".

## Output Format

```
Office Hours — [Course Name]

YOUR APPOINTMENT GROUPS
• [id 51] "Week 6 Office Hours"   PUBLISHED   6 slots, 4 reserved / 2 open
• [id 52] "Exam Review Slots"     DRAFT       8 slots, 0 reserved  (not yet visible)

WHO SIGNED UP — "Week 6 Office Hours"
• Thu 2:00–2:15 PM   → Alex Doe
• Thu 2:15–2:30 PM   → Jordan Park
• Thu 2:30–2:45 PM   → (open)
• Thu 2:45–3:00 PM   → Sam Lee

WRITES THIS SESSION
• Created  "Exam Review Slots" (course_123, 8 slots)        ✓ id 52  (draft)
• Published "Exam Review Slots"                             ✓ now visible
```

## Notes

- **Read-only by default.** Steps 1–3 and Step 7 do not modify Canvas. Writes live only in Steps 4–6, each gated by an explicit per-action confirmation. Never confirm once and then perform multiple writes.
- **No reservation tool.** This domain manages appointment *groups*, not individual reservations. Students reserve slots themselves in the Canvas Calendar; there is no tool here to book or cancel a single student's slot. If asked, say so and point them at the Calendar.
- **New groups start as drafts.** `create_appointment_group` does not publish. Students cannot see or reserve slots until you call `update_appointment_group` with `publish=true` (Step 5). This is the most common "why can't my students sign up?" cause — check the published state first.
- **`context_code`, not a bare course ID.** `create_appointment_group` takes a `context_code` like `course_123`. Build it from the course ID; passing a raw number will fail.
- **Slots are `[start_at, end_at]` pairs.** Each pair in `new_appointments` is one bookable slot. Four separate 15-minute slots need four pairs, not one long range.
- **Deletion cancels reservations.** `delete_appointment_group` cancels every reservation and notifies students with your `cancel_reason`. Always include a clear reason and confirm the reservation count before deleting.
- **Privacy.** `list_appointment_group_users` returns student identities. Treat the sign-up roster as FERPA-protected — do not paste it into shared channels.
