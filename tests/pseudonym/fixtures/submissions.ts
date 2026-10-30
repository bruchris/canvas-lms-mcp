/**
 * Marked-name fixtures for the submission-shaped tools: `list_submissions`,
 * `get_submission` (`src/tools/submissions.ts`),
 * `list_course_submission_files` (`src/tools/submission-files.ts`) and
 * `list_submissions_awaiting_grading`
 * (`src/tools/submissions-awaiting-grading.ts`).
 *
 * **Serializer read** (`instructure/canvas-lms@master`):
 * `lib/api/v1/submission.rb#submission_json` and
 * `lib/api/v1/submission_comment.rb#submission_comment_json`.
 *
 * - The nested person arrives only under `include[]=user`:
 *   `hash["user"] = user_json(submission.user, current_user, session,
 *   ["avatar_url"], submission.context, nil)`. Note the narrow include list —
 *   `avatar_url` and nothing else — so this `user_json` carries no `email` and
 *   no `first_name` / `last_name`. Both fixtures pass `include[]=user`
 *   explicitly, which is also what makes their controls fire: with the tool's
 *   default `["submission_comments"]` there is no person object at all.
 * - `submission_comment_json` emits
 *   `{ id, author_id, author_name, created_at, edited_at, comment, attempt }`
 *   plus `author = user_display_json(...)` whenever the viewer holds
 *   `:read_author` — so a comment normally carries the author's name TWICE,
 *   at `author_name` and at `author.display_name`. Both are marked.
 *
 * **Every marked comment author is the submission's own student.** That is a
 * deliberate restriction, not a convenience.
 * `Pseudonymizer#anonymizeSubmissionComments` rewrites an `author_name` only
 * when that author is already in the course's pseudonym map, and
 * `anonymizeSubmission` warms exactly one person: `submission.user`. A
 * comment by a *peer reviewer* — `author_id` matching neither `user_id` nor
 * `grader_id` — is therefore not masked on a single-submission payload, which
 * `anonymizeActivityStreamEntry` says in so many words ("`list_submissions`
 * gets away with it because listing the course warms the map; a stream item is
 * one submission, so it does not") and solves with a pre-warm for its own
 * payload, as `get_my_submission_feedback` does for its own. Nobody has made
 * that call for `get_submission`, so these fixtures do not pre-empt it: see
 * the BRU-3257 task notes, where it is raised rather than decided.
 *
 * **The grader's comment is present and UNMARKED.** A comment from the
 * submission's recorded `grader_id` is staff, and the FERPA design keeps staff
 * feedback attributable. It is the decoy: a scrub that masked every
 * `author_name` would have to fail this fixture rather than pass it.
 */
import type { CanvasClient } from '../../../src/canvas'
import { buildSweepPseudonymizer, type MarkedNameFixture } from './sweep'

/** `user_json(..., ["avatar_url"], ...)` as `submission_json` builds it. */
function submissionUser(id: string, marks: [string, string, string]) {
  return {
    id,
    name: marks[0],
    created_at: '2026-01-05T08:00:00Z',
    sortable_name: marks[1],
    short_name: marks[2],
    avatar_url: `https://school.example/images/users/${id}`,
    pronouns: 'she/her',
  }
}

/** The submission's own student, commenting on their own work. */
function selfComment(id: string, userId: string, marks: [string, string]) {
  return {
    id,
    author_id: userId,
    author_name: marks[0],
    created_at: '2026-10-27T09:00:00Z',
    edited_at: null,
    comment: 'Re-uploaded with the missing appendix.',
    attempt: 1,
    author: {
      id: userId,
      anonymous_id: '2t',
      display_name: marks[1],
      avatar_image_url: `https://school.example/images/users/${userId}`,
      html_url: `https://school.example/courses/7/users/${userId}`,
      pronouns: 'she/her',
    },
  }
}

/** Staff. `author_id` is the submission's `grader_id`, so the name survives. */
function graderComment(id: string) {
  return {
    id,
    author_id: '9',
    author_name: 'Dr. Ingrid Holt',
    created_at: '2026-10-28T11:30:00Z',
    edited_at: null,
    comment: 'Good structure — tighten the conclusion.',
    attempt: 1,
    author: {
      id: '9',
      anonymous_id: '9',
      display_name: 'Ingrid Holt',
      avatar_image_url: 'https://school.example/images/users/9',
      html_url: 'https://school.example/courses/7/users/9',
      pronouns: null,
    },
  }
}

function submission(opts: {
  id: string
  userId: string
  userMarks: [string, string, string]
  commentMarks: [string, string]
  commentId: string
  graderCommentId: string
}) {
  return {
    id: opts.id,
    assignment_id: '88',
    course_id: '7',
    user_id: opts.userId,
    attempt: 1,
    score: 18,
    grade: '18',
    entered_score: 18,
    entered_grade: '18',
    submitted_at: '2026-10-27T08:55:00Z',
    graded_at: '2026-10-28T11:29:00Z',
    grader_id: '9',
    workflow_state: 'graded',
    late: false,
    missing: false,
    excused: null,
    body: null,
    url: null,
    preview_url: `https://school.example/courses/7/assignments/88/submissions/${opts.userId}?preview=1`,
    user: submissionUser(opts.userId, opts.userMarks),
    submission_comments: [
      selfComment(opts.commentId, opts.userId, opts.commentMarks),
      graderComment(opts.graderCommentId),
    ],
  }
}

/** `submission_json` + `include[]=user` + `include[]=assignment`, as the file manifest asks for. */
function submissionWithAttachment(userId: string, userMarks: [string, string, string]) {
  return {
    id: '9101',
    assignment_id: '88',
    course_id: '7',
    user_id: userId,
    attempt: 1,
    workflow_state: 'submitted',
    submitted_at: '2026-10-27T08:55:00Z',
    user: submissionUser(userId, userMarks),
    assignment: { id: '88', name: 'Fjord field report', due_at: '2026-10-26T23:59:00Z' },
    attachments: [
      {
        id: '4400',
        // `display_name` is the student's own upload name. Canvas neither
        // generates nor scrubs it, and a caller asking for a file manifest
        // needs the real filename to fetch the file — so it is NOT a name
        // field the Pseudonymizer promises to rewrite, and carries no mark.
        display_name: 'field-report-final.pdf',
        filename: 'field-report-final.pdf',
        content_type: 'application/pdf',
        size: 182344,
        url: 'https://school.example/files/4400/download?verifier=abc',
      },
    ],
  }
}

export const submissionFixtures: Record<string, MarkedNameFixture> = {
  // GET /api/v1/courses/:id/assignments/:id/submissions?include[]=user
  list_submissions: {
    args: {
      course_id: '7',
      assignment_id: '88',
      include: ['user', 'submission_comments'],
    },
    buildCanvas: () =>
      ({
        submissions: {
          list: async () => [
            submission({
              id: '9001',
              userId: '101',
              userMarks: ['REAL_NAME_1', 'REAL_NAME_2', 'REAL_NAME_3'],
              commentId: '5001',
              commentMarks: ['REAL_NAME_4', 'REAL_NAME_5'],
              graderCommentId: '5002',
            }),
            submission({
              id: '9002',
              userId: '102',
              userMarks: ['REAL_NAME_6', 'REAL_NAME_7', 'REAL_NAME_8'],
              commentId: '5003',
              commentMarks: ['REAL_NAME_9', 'REAL_NAME_10'],
              graderCommentId: '5004',
            }),
          ],
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },

  // GET /api/v1/courses/:id/assignments/:id/submissions/:user_id?include[]=user
  get_submission: {
    args: {
      course_id: '7',
      assignment_id: '88',
      user_id: '101',
      include: ['user', 'submission_comments'],
    },
    buildCanvas: () =>
      ({
        submissions: {
          get: async () =>
            submission({
              id: '9001',
              userId: '101',
              userMarks: ['REAL_NAME_1', 'REAL_NAME_2', 'REAL_NAME_3'],
              commentId: '5001',
              commentMarks: ['REAL_NAME_4', 'REAL_NAME_5'],
              graderCommentId: '5002',
            }),
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },

  // GET /api/v1/courses/:id/students/submissions?student_ids[]=all&include[]=user,assignment
  // The tool emits its own `files[].user_name`, read off
  // `pseudonymizer.anonymizeUser(courseId, sub.user).name`.
  list_course_submission_files: {
    args: { course_id: '7' },
    buildCanvas: () =>
      ({
        submissions: {
          listForStudents: async () => [
            submissionWithAttachment('101', ['REAL_NAME_1', 'REAL_NAME_2', 'REAL_NAME_3']),
          ],
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },

  // The grading queue: `canvas.assignments.list` first (only assignments with
  // `needs_grading_count > 0` are fetched), then the same bulk submissions
  // endpoint with `include[]=user`. The tool emits `user_name` per row.
  list_submissions_awaiting_grading: {
    args: { course_id: '7' },
    buildCanvas: () =>
      ({
        assignments: {
          list: async () => [
            {
              id: '88',
              name: 'Fjord field report',
              due_at: '2026-10-26T23:59:00Z',
              needs_grading_count: 2,
              submission_types: ['online_upload'],
            },
          ],
        },
        submissions: {
          listForStudents: async () => [
            {
              ...submission({
                id: '9001',
                userId: '101',
                userMarks: ['REAL_NAME_1', 'REAL_NAME_2', 'REAL_NAME_3'],
                commentId: '5001',
                commentMarks: ['REAL_NAME_4', 'REAL_NAME_5'],
                graderCommentId: '5002',
              }),
              workflow_state: 'submitted',
              score: null,
              grade: null,
              graded_at: null,
              grader_id: null,
            },
          ],
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },
}
