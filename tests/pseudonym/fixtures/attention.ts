/**
 * Marked-name fixtures for `list_submission_comments_needing_attention` and
 * `list_students_needing_attention` (`src/tools/attention.ts`).
 *
 * Both tools synthesise their own response and surface exactly one name field
 * per row, `user_name`, read off the pseudonymized object
 * (`s.user?.name` / `e.user?.name`). So the marks that matter are the ones on
 * the nested person, and the payloads below are the two Canvas shapes those
 * are read from.
 *
 * **Serializer reads** (`instructure/canvas-lms@master`):
 * - `lib/api/v1/submission.rb#submission_json` under
 *   `include[]=submission_comments,user,assignment,read_status`
 *   (`ATTENTION_INCLUDE`), with comments through
 *   `lib/api/v1/submission_comment.rb#submission_comment_json`.
 * - `lib/api/v1/user.rb#enrollment_json` with the nested `user`
 *   (`enrollments_api_controller` sets `includes = [:user] + ...`) and the
 *   `grades` hash a student enrollment always carries.
 *
 * **The comment fixture only fires at all when the LATEST comment is the
 * student's own.** `isNeedsAttention` requires
 * `latest.author_id === submission.user_id` and either no `graded_at` or a
 * comment newer than it, so the row below is an ungraded submission whose last
 * word is the student's. The grader's earlier comment stays unmarked: staff
 * feedback keeps its attribution.
 *
 * **The risk fixture needs at least one signal, or the row is dropped.**
 * `last_activity_at` far in the past trips the `inactive` signal, which is the
 * only one that needs no analytics call — and `canvas.analytics
 * .getStudentSummaries` is still mocked, because a *missing* method would
 * throw rather than take the documented 404 branch.
 */
import type { CanvasClient } from '../../../src/canvas'
import { buildSweepPseudonymizer, type MarkedNameFixture } from './sweep'

export const attentionFixtures: Record<string, MarkedNameFixture> = {
  // GET /api/v1/courses/:id/students/submissions?student_ids[]=all
  list_submission_comments_needing_attention: {
    args: { course_id: '7' },
    buildCanvas: () =>
      ({
        submissions: {
          listForStudents: async () => [
            {
              id: '9001',
              assignment_id: '88',
              course_id: '7',
              user_id: '101',
              attempt: 1,
              workflow_state: 'submitted',
              score: null,
              grade: null,
              graded_at: null,
              grader_id: null,
              submitted_at: '2026-10-27T08:55:00Z',
              read_status: 'unread',
              assignment: { id: '88', name: 'Fjord field report' },
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
                  id: '5002',
                  attempt: 1,
                  author_id: '9',
                  author_name: 'Dr. Ingrid Holt',
                  comment: 'Can you clarify the method?',
                  created_at: '2026-10-28T09:00:00Z',
                  edited_at: null,
                },
                {
                  id: '5003',
                  attempt: 1,
                  author_id: '101',
                  author_name: 'REAL_NAME_4',
                  comment: 'Added the method section — is that what you meant?',
                  created_at: '2026-10-28T10:15:00Z',
                  edited_at: null,
                },
              ],
            },
          ],
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },

  // GET /api/v1/courses/:id/enrollments?type[]=StudentEnrollment&include[]=grades
  list_students_needing_attention: {
    args: { course_id: '7' },
    buildCanvas: () =>
      ({
        enrollments: {
          listForCourse: async () => [
            {
              id: '5001',
              root_account_id: '1',
              user_id: '101',
              course_id: '7',
              course_section_id: '70',
              enrollment_state: 'active',
              created_at: '2026-01-05T08:00:00Z',
              type: 'StudentEnrollment',
              role: 'StudentEnrollment',
              role_id: '3',
              // Far enough back to trip the `inactive` signal on any run date.
              last_activity_at: '2026-01-10T09:00:00Z',
              total_activity_time: 120,
              sis_user_id: 'SIS-4411',
              html_url: 'https://school.example/courses/7/users/101',
              grades: {
                html_url: 'https://school.example/courses/7/grades/101',
                current_score: 54,
                current_grade: 'F',
                final_score: 54,
                final_grade: 'F',
              },
              user: {
                id: '101',
                name: 'REAL_NAME_1',
                created_at: '2026-01-05T08:00:00Z',
                sortable_name: 'REAL_NAME_2',
                short_name: 'REAL_NAME_3',
                sis_user_id: 'SIS-4411',
              },
            },
          ],
        },
        analytics: {
          getStudentSummaries: async () => [
            {
              id: '101',
              page_views: 12,
              participations: 1,
              tardiness_breakdown: { total: 6, on_time: 2, late: 3, missing: 1, floating: 0 },
            },
          ],
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },
}
