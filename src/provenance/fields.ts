// Which response fields carry Canvas text authored by someone other than the
// operator, per tool. Slice 1 of the provenance-fencing rollout.
//
// Design: docs/superpowers/specs/2026-08-11-bru-2104-provenance-fencing.md §8.1.
// This list is hand-maintained, following the `src/pseudonym/coverage.ts`
// precedent, and `tests/provenance/boundary.test.ts` holds it to a canonical
// duplicate so adding a fenced tool requires touching both files.
//
// Keyed by TOOL NAME, then by FIELD NAME. Field names are matched anywhere in
// that tool's own response subtree rather than by path, because Canvas nests the
// same field inconsistently (`submission.body` and
// `submission.submission_history[].body` are the same kind of text). Per-tool
// keying is what bounds the over-match risk: `get_my_submission_feedback` emits
// its own `courses_failed[].message`, which is server-authored error text and
// must not be fenced — so `message` is absent from that tool's entry even though
// it is present on the discussion tools.
//
// The value is the marker's `<label>`: a server-controlled literal that names
// the kind of text for the model. Never user input, never a field value.

export type UntrustedFieldLabels = Readonly<Record<string, string>>

export const UNTRUSTED_FIELDS: Readonly<Record<string, UntrustedFieldLabels>> = {
  // Rank 1 — student-authored, enters context because of grading, and
  // `grade_submission` / `comment_on_submission` are registered alongside.
  get_submission: { body: 'submission body', comment: 'submission comment' },
  list_submissions: { body: 'submission body', comment: 'submission comment' },
  // Both of the following project a narrower shape than the raw Canvas
  // submission. `get_my_submission_feedback` surfaces `comment`;
  // `list_submissions_awaiting_grading` currently projects neither field (ids,
  // workflow_state, submitted_at, user_name only), so its entry fences nothing
  // today and exists so a widened projection is covered the day it lands.
  list_submissions_awaiting_grading: { body: 'submission body', comment: 'submission comment' },
  get_my_submission_feedback: { comment: 'submission comment' },
  // The cross-course activity stream. `message` covers the DiscussionTopic /
  // Announcement arm, each `root_discussion_entries[].message`, and each
  // `latest_messages[].message` on a Conversation item; `body` and `comment`
  // cover the Submission arm, whose merged `submission_json` carries the
  // submission body and `submission_comments[]` (Canvas sets each comment's
  // `body` from its `comment`, so both keys hold the same text).
  //
  // Three deliberate omissions. `title` is NOT fenced, following
  // list_discussions / get_discussion — and here it would also hit the Message
  // arm's Canvas-generated notification subject and the AssessmentRequest
  // arm's synthesised "Peer Review for …" string, both server-authored.
  // `name` is NOT fenced: the Submission arm merges `includes = %w[… assignment
  // course …]`, so it would fence course and assignment names — the exact
  // over-match this header warns about. `author_name` is NOT fenced because it
  // is a name, and names are the pseudonymizer's job; the two layers must not
  // both rewrite one value.
  get_my_activity_stream: {
    message: 'activity stream message',
    body: 'submission body',
    comment: 'submission comment',
  },
  // The cross-course planner. Despite carrying a `discussion_topic` /
  // `announcement` plannable type, NEITHER arm's actual message text reaches
  // this response: `lib/api/v1/planner_item.rb#plannable_json` slices every
  // plannable down to `API_PLANNABLE_FIELDS` (+ a small per-type extra-field
  // list), and `message`/`body` are in neither — a discussion's real message
  // is dropped entirely at the planner layer (read at pinned SHA
  // 1c9f0bb8013ed69c4f2efe11fd483025469b7e6c, verified by re-deriving the
  // slice from source rather than assuming the activity-stream registry
  // entry carries over). The one free-text field that DOES survive the slice
  // is a calendar event's `description` (`CALENDAR_PLANNABLE_FIELDS`), which
  // can be course-wide and teacher-authored. `planner_note`'s own `details`
  // field is excluded on purpose: it is the CALLER'S OWN note text, not
  // third-party Canvas content, matching the authorship test this fencing
  // design is built on. `title`, `location_name` and `location_address` are
  // short metadata, not prose, and follow the existing title precedent.
  list_my_planner_items: {
    description: 'calendar event description',
  },

  // Rank 2 — any enrolled student can author a discussion message, and
  // `post_discussion_entry` / `update_discussion` publish as the operator.
  get_discussion: { message: 'discussion message' },
  list_discussions: { message: 'discussion message' },

  // Rank 3 — arbitrary sender; `send_conversation` sends as the operator.
  // `last_message` is Canvas's preview string on the conversation itself;
  // `body` is the full text of each message in the thread.
  get_conversation: { last_message: 'conversation preview', body: 'conversation message body' },
  list_conversations: { last_message: 'conversation preview', body: 'conversation message body' },

  // Rank 4 — the literal read→modify→write path the round-trip constraint
  // exists for (`update_page` / `create_page`).
  get_page: { body: 'page body' },
  list_pages: { body: 'page body' },
  get_syllabus: { syllabus_body: 'syllabus body' },

  // Rank 5 — the two UI-bound surfaces §8.3 deferred until their widgets could
  // strip markers. Graduated by BRU-2183, which added that strip
  // (`src/ui/provenance-strip.ts`). Fencing these without it would have shown
  // the annotations to a human in the MCP Apps panel.
  //
  // Each surface is TWO tool names, not one. `view_*` is a separate definition
  // with its own handler that happens to return the same payload plus a `ui`
  // binding — and the `view_*` names are the ones the widgets are attached to,
  // so omitting them would fence the wrong half. The registry is keyed by tool
  // name with no alias indirection, so both are spelled out; the pairs are held
  // identical by `tests/provenance/boundary.test.ts`.
  //
  // `name` and `title` are matched anywhere in the response subtree, as
  // everywhere else in this file. In these two responses that is exactly the
  // module name and the module-item title: no other `name`/`title` key exists
  // in `CanvasCourseStructure`, and `summary.items_by_type` holds numbers.
  // `content_details` is an untyped Canvas passthrough — if Canvas ever adds a
  // `title` inside it, that title is Canvas-authored text too, so fencing it is
  // correct rather than a miss.
  get_course_structure: { name: 'module name', title: 'module item title' },
  view_course_structure: { name: 'module name', title: 'module item title' },
  list_account_notifications: {
    subject: 'announcement subject',
    message: 'announcement message',
  },
  view_account_notifications: {
    subject: 'announcement subject',
    message: 'announcement message',
  },
}

/** Marker labels for the two MCP resources, which bypass `buildHandler` (§8.2). */
export const RESOURCE_LABELS = {
  syllabus: 'course syllabus',
  assignmentDescription: 'assignment description',
} as const
