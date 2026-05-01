---
name: canvas-admin-roster
description: Admin skill for walking the Canvas account hierarchy: list accounts and sub-accounts, see courses and users under each, look up which canned reports are available, and enroll or remove users from a specific course — one action at a time. Trigger phrases include "admin roster", "list accounts", "sub accounts", "account users", "users in this account", "enroll a user", "remove an enrollment", "account reports", or "what accounts can I see".
---

# Canvas Admin Roster

Admin-audience skill for inspecting the Canvas account tree and making targeted enrollment changes. Walks `list_accounts → list_sub_accounts → list_account_courses / list_account_users` so the agent paces itself instead of dumping the whole institution at once. Write paths (`enroll_user`, `remove_enrollment`) are explicitly gated by per-action confirmation and are clearly separated from the read paths.

## Prerequisites

- Canvas MCP server must be running and connected.
- **Admin Canvas token required.** A teacher or TA token will return empty results from `list_accounts` and 401/403 from `list_sub_accounts`, `list_account_courses`, `list_account_users`, and `get_account_reports`. If the user does not have an admin token, stop at Step 1 and tell them this skill needs an admin role on the relevant account.
- `enroll_user` and `remove_enrollment` additionally require permission to manage enrollments on the target course. A "subaccount admin" role may be able to read the account but not modify enrollments — the skill will surface a 403 if that happens.
- Many admin endpoints expose institution-wide data. Only run this skill in a private session.

## Steps

### 1. Discover the Accounts You Can See

Call `list_accounts`. This returns every account the authenticated admin has access to — in many institutions this is just the root account, but multi-tenant Canvas deployments can return several.

If the response is empty, the token does not have admin scope. Stop here and tell the user.

Show the user the accounts with their `id`, `name`, and `parent_account_id`:

```
ACCOUNTS YOU CAN ADMIN
• [1]  Root Account (Big State University)
• [42] College of Engineering          parent: 1
• [43] College of Liberal Arts         parent: 1
```

### 2. Walk the Sub-Account Tree

Ask the user which account to drill into, or default to the root account.

For the chosen account, call `list_sub_accounts` with that `account_id`. **This is shallow — it returns direct children only, not the full descendant tree.** If the user wants to walk further down, repeat `list_sub_accounts` on each child sub-account they pick. Do not recurse the whole tree by default — large institutions can have hundreds of sub-accounts and you will burn quota.

```
SUB-ACCOUNTS UNDER [42] College of Engineering
• [120] Department of Computer Science    parent: 42
• [121] Department of Mechanical Eng.     parent: 42
• [122] Department of Electrical Eng.     parent: 42
```

If the user wants metadata for a specific account (settings, default time zone, sis identifier, etc.), call `get_account` with that `account_id` and surface the fields they asked for.

### 3. Inspect Courses Under an Account

For the chosen account, call `list_account_courses` with the `account_id`. Optional `search_term` narrows by course name or course code.

The result is paginated under the hood. Present a count first ("Found 187 courses in [account]"), then offer:

| Mode | When to use |
|------|-------------|
| **Filter by name** | Re-call with a `search_term` (e.g. "CS 101") |
| **Show first N** | Display the first 25 by default; offer to page further only if asked |
| **Group by sub-account** | Group locally; do not re-query per sub-account |

For very large accounts (1000+ courses), tell the user: filter by `search_term` first. Pulling the full list works but is slow and crowds the agent's context.

### 4. Inspect Users in an Account

For the chosen account, call `list_account_users` with the `account_id`. Optional `search_term` searches name, email, and login ID.

Users can have many enrollments across many courses; this endpoint returns each user once with account-level metadata, **not** their enrollments. Combine with Step 6 (course enrollments) if the user asks "what is this person enrolled in".

```
USERS IN [120] CS Department  (search: "park")
• [88321] Jordan Park        login: jpark         email: jpark@bsu.edu
• [88455] Min Park           login: minpark       email: minpark@bsu.edu
```

### 5. Discover Available Reports for an Account

Call `get_account_reports` with the `account_id`. **This returns the list of report types Canvas can run for this account, plus metadata about the most recent instance of each — it does NOT start a new report and there is no polling endpoint exposed by this MCP server.** Common report types include `course_storage_csv`, `provisioning_csv`, `student_assignment_outcome_map_csv`, and several SIS exports — exact set varies by Canvas instance.

For each report row, show:
- `report` (the report type identifier)
- `title` (human-readable name)
- `last_run` (timestamp of the most recent execution, if any)
- `parameters` (any defaults the report exposes)

Then tell the user explicitly:

> "These are the report types available to you. To actually run one of these reports, use the Canvas web UI under **Admin → [Account] → Settings → Reports**. canvas-lms-mcp does not expose a `start_report` / `get_report_status` tool surface, so the run must happen in the UI and you can come back here once the export is downloadable."

Do not invent a polling loop. Do not pretend to "wait for the report" — there is nothing to poll.

### 6. List Enrollments in a Specific Course

`list_account_users` does **not** include enrollment lists. To see who is enrolled in a particular course, call `list_course_enrollments` with the `course_id` (you'll have it from Step 3). Filter by `type` and `state` as needed:

- `type=['StudentEnrollment']` for students
- `type=['TeacherEnrollment','TaEnrollment']` for instructional staff
- `state=['active']` to skip pending invites and concluded enrollments

A note about `list_enrollments` (singular, no `course_` prefix): that tool returns the **authenticated user's own enrollments** — `/api/v1/users/self/enrollments`. It is useful for checking "what courses am I admin/teacher in?" but it is **not** a way to look up some other user's enrollment list. There is no tool in this MCP server that fetches arbitrary-user enrollments across courses; you would have to walk `list_account_courses` and `list_course_enrollments` per course, which is expensive.

### 7. Enroll a User in a Course (Write — Confirmed Per Action)

**Requires explicit user confirmation before each call.**

When the admin wants to add an enrollment:

1. Confirm the target course (course ID from Step 3).
2. Confirm the target user (user ID from Step 4 or external lookup).
3. Confirm the enrollment type:
   - `StudentEnrollment` — student
   - `TeacherEnrollment` — teacher
   - `TaEnrollment` — TA
   - `DesignerEnrollment` — learning designer
   - `ObserverEnrollment` — observer (e.g., parent)
4. Optionally confirm the initial `enrollment_state`: `active` (immediately enrolled), `invited` (default — sends Canvas invitation), or `inactive`.
5. Show the admin a single-line preview:

   > "Enroll user [Name] (id [n]) into [Course Name] (id [c]) as [Type], state=[State]? (yes/no)"

6. Only after confirmation: call `enroll_user` with `course_id`, `user_id`, `type`, and `enrollment_state` if specified.
7. Report the new enrollment row, including `enrollment_id` (needed for Step 8 if the admin later wants to revoke it).

**Never batch.** If the admin wants to enroll five users, repeat steps 1–7 five times with five separate confirmations. Do not collapse them into one prompt.

### 8. Remove an Enrollment from a Course (Write — Confirmed Per Action)

**Requires explicit user confirmation before each call.** This is destructive: depending on the `task`, it can permanently delete the enrollment record.

1. Identify the `enrollment_id` to remove (from `list_course_enrollments` output, **not** the user_id — the tool takes `enrollment_id`).
2. Pick the `task`:
   - `conclude` — soft-end the enrollment, preserves grades and submissions for the user
   - `delete` — hard-delete the enrollment row (user loses access immediately; submissions remain in the course but are detached from this enrollment)
   - `deactivate` — set the enrollment to `inactive` (user keeps record but loses course access until reactivated)
3. Show the admin a single-line preview, naming the user and the chosen task:

   > "[Task] enrollment [enrollment_id] for [User Name] in [Course Name]? This [conclude/delete/deactivate]s the enrollment. (yes/no)"

4. Only after confirmation: call `remove_enrollment` with `course_id`, `enrollment_id`, and `task`.
5. Report `✓ [Task]d enrollment [enrollment_id]`.

If the admin asks to "remove a user", default to `conclude` unless they explicitly request `delete`. `conclude` is reversible by re-enrolling the user; `delete` may not be.

## Output Format

```
Admin Roster — Big State University

ACCOUNT TREE
• [1]   Root Account
  • [42]  College of Engineering           187 courses, 4,021 users
    • [120] Computer Science              52 courses
    • [121] Mechanical Engineering        38 courses
  • [43]  College of Liberal Arts          243 courses, 3,108 users

WRITES THIS SESSION
• Enrolled  Casey Chen → CS 101 (StudentEnrollment, active)        ✓ id 991204
• Concluded Pat Kim    → CS 200 (enrollment 887211, task=conclude) ✓
• Reports for [42]: 6 types available — see web UI to run
```

## Notes

- **Account hierarchy is walked one level at a time.** `list_sub_accounts` returns direct children only. There is no `get_account_tree` aggregator; resist the urge to recurse the whole tree by default.
- **`get_account_reports` is discovery-only.** It lists report types available to the account and the most recent instance of each, but this MCP server exposes no `start_report`, no `get_report_status`, and no `download_report`. To actually run a report, the admin uses the Canvas web UI. State this plainly when the user asks "can you run the [foo] report".
- **`list_enrollments` is self-scoped.** It returns the authenticated admin's own enrollments. It is **not** a way to look up another user's enrollment list. Use `list_course_enrollments` per course instead, or `list_account_users` for account-level user discovery.
- **`remove_enrollment` takes `enrollment_id`, not `user_id`.** A user with three enrollments in the same course (e.g., Student, Observer, TA in different sections) has three distinct enrollment rows. Pick the right one from `list_course_enrollments` output before calling `remove_enrollment`.
- **Default `enroll_user` state is `invited`.** The user receives a Canvas invitation and must accept before they show up as `active`. If the admin wants immediate access, pass `enrollment_state: 'active'` explicitly.
- **Privacy.** `list_account_users` and `list_account_courses` can return institution-wide PII. Treat this output the same as a payroll export — do not paste into shared chats or screen-share without redacting.
- **Quotas.** A "show me everything" request against a large account (100k+ users, 10k+ courses) will paginate through hundreds of pages. Always offer the `search_term` filter first and ask the admin to narrow before pulling the full list.
- **Permission errors.** A 403 from `list_sub_accounts`, `list_account_users`, or `get_account_reports` means the admin role does not have access to that specific sub-account, even if `list_accounts` returned the parent. Surface the 403 verbatim — do not silently retry.
