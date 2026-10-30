/**
 * Marked-name fixtures for `list_gradebook_history_submissions` and
 * `get_gradebook_history_feed` (`src/tools/gradebook-history.ts`).
 *
 * **Serializer read** (`instructure/canvas-lms@master`):
 * `app/controllers/gradebook_history_api_controller.rb`, whose `SubmissionVersion`
 * object documentation is the authoritative key list for this endpoint. Four of
 * its keys are person names, and they split two ways:
 *
 * - `user_name` — "the name of the student" — is the one the tool
 *   pseudonymizes, keyed by the version's own `user_id`. Marked.
 * - `current_grader` ("the name of the most recent grader"), `grader`,
 *   `new_grader` ("alias for grader") and `previous_grader` ("the name of the
 *   grader who graded the version ... immediately preceding this one") are
 *   staff names and pass through unchanged per the FERPA design. **Unmarked,
 *   and they are the decoys:** a scrub that rewrote every name-shaped string
 *   on this payload would have to fail these fixtures rather than pass them.
 *
 * `list_gradebook_history_submissions` nests versions under
 * `[{ submission_id, versions: [...] }]`; the feed returns the versions
 * uncollated. Both go through the same `anonymizeHistoryVersion` helper, which
 * is why both fixtures carry the same version shape.
 *
 * A version with a `user_name` but no `user_id` is returned untouched by that
 * helper (`if (!version.user_name || !version.user_id) return version`), so a
 * fixture must not mark such a row: there is nothing to key a pseudonym on and
 * nothing promises a rewrite. The second feed row exercises that branch with
 * an unmarked name instead.
 */
import type { CanvasClient } from '../../../src/canvas'
import { buildSweepPseudonymizer, type MarkedNameFixture } from './sweep'

function version(opts: { id: string; userId: string | null; userNameMark: string | null }) {
  return {
    id: opts.id,
    assignment_id: '88',
    assignment_name: 'Fjord field report',
    course_id: '7',
    user_id: opts.userId,
    user_name: opts.userNameMark ?? 'Dr. Ingrid Holt',
    submission_type: 'online_upload',
    submitted_at: '2026-10-27T08:55:00Z',
    workflow_state: 'graded',
    score: 18,
    grade: '18',
    graded_at: '2026-10-28T11:29:00Z',
    grade_matches_current_submission: true,
    grader_id: '9',
    grader: 'Dr. Ingrid Holt',
    current_grade: '18',
    current_graded_at: '2026-10-28T11:29:00Z',
    current_grader: 'Dr. Ingrid Holt',
    new_grade: '18',
    new_graded_at: '2026-10-28T11:29:00Z',
    new_grader: 'Dr. Ingrid Holt',
    previous_grade: '15',
    previous_graded_at: '2026-10-27T18:00:00Z',
    previous_grader: 'Sam Ta-Teacher',
  }
}

export const gradebookHistoryFixtures: Record<string, MarkedNameFixture> = {
  // GET /api/v1/courses/:id/gradebook_history/:date/graders/:grader_id/assignments/:id/submissions
  list_gradebook_history_submissions: {
    args: { course_id: '7', date: '2026-10-28', grader_id: '9', assignment_id: '88' },
    buildCanvas: () =>
      ({
        gradebookHistory: {
          listSubmissions: async () => [
            {
              submission_id: '9001',
              versions: [version({ id: '9001', userId: '101', userNameMark: 'REAL_NAME_1' })],
            },
            {
              submission_id: '9002',
              // `versions: null` is a real shape for this endpoint, and the
              // handler guards on it before mapping.
              versions: null,
            },
          ],
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },

  // GET /api/v1/courses/:id/gradebook_history/feed
  get_gradebook_history_feed: {
    args: { course_id: '7' },
    buildCanvas: () =>
      ({
        gradebookHistory: {
          getFeed: async () => [
            version({ id: '9001', userId: '101', userNameMark: 'REAL_NAME_1' }),
            // No `user_id`: `anonymizeHistoryVersion` returns the row
            // untouched, so this row's name must NOT be marked.
            version({ id: '9003', userId: null, userNameMark: null }),
          ],
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },
}
