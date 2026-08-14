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
}

/** Marker labels for the two MCP resources, which bypass `buildHandler` (§8.2). */
export const RESOURCE_LABELS = {
  syllabus: 'course syllabus',
  assignmentDescription: 'assignment description',
} as const
