/**
 * Marked-name fixtures for the three student-facing tools in
 * `src/tools/student.ts`: `get_my_submission_feedback`,
 * `get_my_activity_stream` and `list_my_planner_items`.
 *
 * These are the payloads where a name arrives with NO identifier beside it,
 * and the pseudonymizer's answer is to withhold rather than to label — so the
 * fixtures below are the ones that prove a withheld name is still not a real
 * name.
 *
 * ### `get_my_submission_feedback`
 *
 * `GET /courses/:id/students/submissions?student_ids[]=self` with
 * `MY_SUBMISSION_FEEDBACK_INCLUDE` (`submission_comments`, `user`,
 * `assignment`, …) → `lib/api/v1/submission.rb#submission_json` plus
 * `submission_comment_json`. The tool classifies each comment author as
 * `self` / `teacher` / `peer` from `author_id` against `user_id` and
 * `grader_id`, pre-warms the peers so a one-submission payload cannot leak
 * them, and then re-reads the teacher's ORIGINAL name back over the
 * pseudonymized one. All three arms are present below:
 *
 * - the peer reviewer (`author_id` is neither) — marked, must be masked;
 * - the recorded grader (`author_id === grader_id`) — unmarked by design,
 *   because the tool deliberately restores staff attribution;
 * - the student's own comment (`author_id === user_id`) — marked, masked
 *   through `submission.user` being warmed first.
 *
 * ### `get_my_activity_stream`
 *
 * `lib/api/v1/stream_item.rb#stream_item_json`, whose arms differ in what
 * identity they carry, and each one is a separate item here:
 *
 * - `DiscussionTopic` → `root_discussion_entries[] = { "user" => { "user_id",
 *   "user_name" => entry.user_short_name }, "message" }`. A name WITH an id,
 *   so it gets an ordinary scope-stable pseudonym. Marked.
 * - `DiscussionEntry` → `hash["author_name"] = discussion_entry.author_name`
 *   and nothing else; **no identifier anywhere in the item**, so there is
 *   nothing to key a pseudonym on and the name is withheld outright. Marked —
 *   `WITHHELD_AUTHOR_NAME` is not a real name, which is the whole claim.
 * - `Submission` → `submission_json(..., %w[submission_comments assignment
 *   course html_url user])`, i.e. the full person plus comments. Marked, with
 *   the grader's comment unmarked as above.
 * - `Conversation` → `latest_messages`, which is `{ id, created_at,
 *   author_id, message, participating_user_ids }`: identifiers and text, no
 *   name field. The decoy — nothing here may be marked, and nothing here
 *   changes.
 *
 * `title`, `message` and `context_type` are item content, not names.
 *
 * ### `list_my_planner_items`
 *
 * `lib/api/v1/planner_item.rb#feedback_data`:
 *
 * ```ruby
 * feedback_hash[:comment] = ...
 * feedback_hash[:is_media] = last_teacher_comment.media_comment_id?
 * feedback_hash[:author_name] = last_teacher_comment.author_name
 * feedback_hash[:author_avatar_url] = last_teacher_comment.author&.avatar_url
 * ```
 *
 * Despite the variable being called `last_teacher_comment`, the plannable set
 * includes `assessment_request` and `peer_review_sub_assignment`, where the
 * feedback can come from a peer reviewer — and there is no `author_id`
 * sibling to classify against. Withheld outright, with `author_avatar_url`
 * nulled beside it. Marked.
 *
 * The second item carries `submissions: false` — the union arm Canvas
 * initialises for a non-submittable plannable — so the guard that must not
 * dereference it is exercised. `context_name` and `plannable.title` are a
 * course nickname and an assignment title: decoys, unmarked.
 */
import type { CanvasClient } from '../../../src/canvas'
import { buildSweepPseudonymizer, type MarkedNameFixture } from './sweep'

function feedbackSubmission() {
  return {
    id: '9001',
    assignment_id: '88',
    course_id: '7',
    user_id: '101',
    attempt: 1,
    score: 18,
    grade: '18',
    workflow_state: 'graded',
    submitted_at: '2026-10-27T08:55:00Z',
    graded_at: '2026-10-28T11:29:00Z',
    grader_id: '9',
    read_status: 'unread',
    html_url: 'https://school.example/courses/7/assignments/88/submissions/101',
    assignment: { id: '88', name: 'Fjord field report' },
    course: { id: '7', name: 'Introduction to Fjords' },
    user: {
      id: '101',
      name: 'REAL_NAME_1',
      created_at: '2026-01-05T08:00:00Z',
      sortable_name: 'REAL_NAME_2',
      short_name: 'REAL_NAME_3',
      avatar_url: 'https://school.example/images/users/101',
    },
    submission_comments: [
      {
        id: '5001',
        attempt: 1,
        author_id: '101',
        author_name: 'REAL_NAME_4',
        comment: 'Re-uploaded with the missing appendix.',
        created_at: '2026-10-27T09:00:00Z',
        edited_at: null,
      },
      {
        // The recorded grader: staff, restored to the real name by the tool.
        id: '5002',
        attempt: 1,
        author_id: '9',
        author_name: 'Dr. Ingrid Holt',
        comment: 'Good structure — tighten the conclusion.',
        created_at: '2026-10-28T11:30:00Z',
        edited_at: null,
      },
      {
        // A peer reviewer: neither `user_id` nor `grader_id`, so the tool
        // pre-warms this author before pseudonymizing the submission.
        id: '5003',
        attempt: 1,
        author_id: '102',
        author_name: 'REAL_NAME_5',
        comment: 'Your figure 2 axis labels are swapped.',
        created_at: '2026-10-29T08:10:00Z',
        edited_at: null,
      },
    ],
  }
}

export const studentFixtures: Record<string, MarkedNameFixture> = {
  get_my_submission_feedback: {
    args: { course_id: '7' },
    buildCanvas: () =>
      ({
        submissions: { listMy: async () => [feedbackSubmission()] },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },

  // GET /api/v1/users/self/activity_stream
  get_my_activity_stream: {
    args: {},
    buildCanvas: () =>
      ({
        activityStream: {
          getStream: async () => [
            {
              id: '1001',
              created_at: '2026-10-28T07:00:00Z',
              updated_at: '2026-10-28T07:00:00Z',
              type: 'DiscussionTopic',
              read_state: false,
              context_type: 'Course',
              course_id: '7',
              title: 'Week 4 discussion',
              message: 'Post your field notes here.',
              discussion_topic_id: '400',
              html_url: 'https://school.example/courses/7/discussion_topics/400',
              total_root_discussion_entries: 1,
              require_initial_post: false,
              user_has_posted: true,
              root_discussion_entries: [
                {
                  user: { user_id: '102', user_name: 'REAL_NAME_1' },
                  message: 'The tidal range surprised me.',
                },
              ],
            },
            {
              id: '1002',
              created_at: '2026-10-28T08:00:00Z',
              updated_at: '2026-10-28T08:00:00Z',
              type: 'DiscussionEntry',
              read_state: false,
              context_type: 'Course',
              course_id: '7',
              title: 'Re: Week 4 discussion',
              // The only identity on the item, and it has no id anywhere:
              // withheld rather than labelled.
              author_name: 'REAL_NAME_2',
              message: 'Agreed — see the 1998 survey.',
              html_url: 'https://school.example/courses/7/discussion_topics/400',
            },
            {
              ...feedbackSubmission(),
              id: '1003',
              submission_id: '9001',
              created_at: '2026-10-28T11:30:00Z',
              updated_at: '2026-10-28T11:30:00Z',
              type: 'Submission',
              read_state: false,
              context_type: 'Course',
              title: 'Fjord field report',
              user: {
                id: '101',
                name: 'REAL_NAME_6',
                created_at: '2026-01-05T08:00:00Z',
                sortable_name: 'REAL_NAME_7',
                short_name: 'REAL_NAME_8',
                avatar_url: 'https://school.example/images/users/101',
              },
              submission_comments: [
                {
                  id: '5002',
                  attempt: 1,
                  author_id: '9',
                  author_name: 'Dr. Ingrid Holt',
                  comment: 'Good structure — tighten the conclusion.',
                  body: 'Good structure — tighten the conclusion.',
                  created_at: '2026-10-28T11:30:00Z',
                },
                {
                  id: '5003',
                  attempt: 1,
                  author_id: '102',
                  author_name: 'REAL_NAME_9',
                  comment: 'Your figure 2 axis labels are swapped.',
                  body: 'Your figure 2 axis labels are swapped.',
                  created_at: '2026-10-29T08:10:00Z',
                },
              ],
            },
            {
              // Decoy arm: identifiers and message text, no name field.
              id: '1004',
              created_at: '2026-10-29T09:00:00Z',
              updated_at: '2026-10-29T09:00:00Z',
              type: 'Conversation',
              read_state: true,
              context_type: 'Course',
              course_id: '7',
              conversation_id: '301',
              private: true,
              participant_count: 2,
              html_url: 'https://school.example/conversations/301',
              latest_messages: [
                {
                  id: '9001',
                  created_at: '2026-10-29T09:00:00Z',
                  author_id: '9',
                  message: 'See my comments on the report.',
                  participating_user_ids: ['9', '101'],
                },
              ],
            },
          ],
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },

  // GET /api/v1/planner/items
  list_my_planner_items: {
    args: {},
    buildCanvas: () =>
      ({
        planner: {
          listItems: async () => [
            {
              context_type: 'Course',
              course_id: '7',
              context_name: 'Introduction to Fjords',
              context_image: null,
              plannable_id: '88',
              plannable_type: 'assignment',
              planner_override: null,
              new_activity: true,
              plannable_date: '2026-10-26T23:59:00Z',
              plannable: { id: '88', title: 'Fjord field report', points_possible: 20 },
              html_url: 'https://school.example/courses/7/assignments/88/submissions/101',
              submissions: {
                submitted: true,
                excused: false,
                graded: true,
                late: false,
                missing: false,
                needs_grading: false,
                has_feedback: true,
                redo_request: false,
                feedback: {
                  comment: 'Your figure 2 axis labels are swapped.',
                  is_media: false,
                  // No `author_id` sibling anywhere on the item, and the
                  // plannable set includes peer-review types, so this is
                  // withheld rather than labelled.
                  author_name: 'REAL_NAME_1',
                  author_avatar_url: 'https://school.example/images/users/102',
                },
              },
            },
            {
              // `submission_status = { submissions: false }` — the union arm
              // Canvas initialises for a non-submittable plannable.
              context_type: 'Course',
              course_id: '7',
              context_name: 'Introduction to Fjords',
              plannable_id: '77',
              plannable_type: 'wiki_page',
              planner_override: null,
              new_activity: false,
              plannable_date: '2026-10-20T10:00:00Z',
              plannable: { id: '77', title: 'Reading list' },
              html_url: 'https://school.example/courses/7/pages/reading-list',
              submissions: false,
            },
          ],
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },
}
