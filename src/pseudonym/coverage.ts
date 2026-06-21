// CI coverage list: which registered tools surface student PII and therefore
// MUST run their response through the Pseudonymizer when the flag is on.
//
// This list is hand-maintained. When adding a tool whose response contains a
// `CanvasUser`, a participants array, or a `user_name` field, add the tool
// name here AND wrap its handler with the appropriate `pseudonymizer.*` call.
//
// `tests/pseudonymizer.coverage.test.ts` enforces two invariants:
//   1. Every name in this list is registered on the running server.
//   2. The canonical "PII-bearing tools" expectation (in the test itself)
//      matches this list, so adding a PII tool without updating the list
//      fails CI.
//
// See `docs/superpowers/specs/2026-05-25-ferpa-pseudonymization.md` §
// "Tools that surface student PII" for the original audit.

export const PSEUDONYMIZER_WRAPPED_TOOLS: readonly string[] = [
  // src/tools/users.ts
  'list_students',
  'get_user',
  'search_users',
  'list_course_users',

  // src/tools/accounts.ts
  'list_account_users',

  // src/tools/enrollments.ts
  'list_enrollments',
  'list_course_enrollments',

  // src/tools/submissions.ts
  'list_submissions',
  'get_submission',

  // src/tools/conversations.ts
  'list_conversations',
  'get_conversation',

  // src/tools/gradebook-history.ts
  'list_gradebook_history_submissions',
  'get_gradebook_history_feed',

  // src/tools/outcomes.ts
  'get_outcome_results',
  'get_outcome_rollups',

  // src/tools/groups.ts
  'list_group_members',

  // src/tools/attention.ts
  'list_submission_comments_needing_attention',
  'list_students_needing_attention',

  // src/tools/grade-explanation.ts
  'explain_grade',
] as const
