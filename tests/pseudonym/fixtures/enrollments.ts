/**
 * Marked-name fixtures for `list_enrollments` and `list_course_enrollments`
 * (`src/tools/enrollments.ts`).
 *
 * **Serializer read** (`instructure/canvas-lms@master`):
 * `lib/api/v1/user.rb#enrollment_json`. `API_ENROLLMENT_JSON_OPTS` emits the
 * enrollment's own ids, `workflow_state` (renamed to `enrollment_state`),
 * timestamps and `type`; the method then adds `role` / `role_id` (role NAMES,
 * not person names — unmarked), `last_activity_at`, `html_url`, a `grades`
 * hash for a student enrollment, and `sis_user_id` for a caller with
 * `read_sis`.
 *
 * **The nested `user` is always there.** `enrollment_json` attaches it only
 * under `includes.include?(:user)`, and
 * `enrollments_api_controller` sets `includes = [:user] + Array(params[:include])`
 * on both index actions — so neither tool can receive an enrollment without
 * the person attached, whatever the caller asks for. That is why both fixtures
 * carry it.
 *
 * **The nested `user` is a NARROWER `user_json` than a roster row.**
 * `user_includes = includes & %w[avatar_url group_ids uuid email]`, and
 * `ENROLLMENT_INCLUDE` in `src/tools/enrollments.ts` offers `avatar_url`,
 * `group_ids` and `uuid` but not `email` — so no fixture here carries an
 * email, and none carries `first_name` / `last_name` either (those need
 * `include[]=first_name`, which this path cannot produce).
 *
 * **Role classification is the point of the second row.**
 * `anonymizeEnrollment` classifies from the enrollment itself when the nested
 * user has no `enrollments` array of its own, so a `TeacherEnrollment` row
 * keeps its real name by design and is left unmarked.
 */
import type { CanvasClient } from '../../../src/canvas'
import { buildSweepPseudonymizer, type MarkedNameFixture } from './sweep'

function studentEnrollment(courseId: string) {
  return {
    id: '5001',
    root_account_id: '1',
    user_id: '101',
    course_id: courseId,
    course_section_id: '70',
    enrollment_state: 'active',
    limit_privileges_to_course_section: false,
    created_at: '2026-01-05T08:00:00Z',
    updated_at: '2026-01-05T08:00:00Z',
    start_at: null,
    end_at: null,
    type: 'StudentEnrollment',
    role: 'StudentEnrollment',
    role_id: '3',
    last_activity_at: '2026-10-28T19:02:00Z',
    total_activity_time: 7200,
    sis_user_id: 'SIS-4411',
    html_url: 'https://school.example/courses/7/users/101',
    grades: {
      html_url: 'https://school.example/courses/7/grades/101',
      current_score: 88.5,
      current_grade: 'B+',
    },
    user: {
      id: '101',
      name: 'REAL_NAME_1',
      created_at: '2026-01-05T08:00:00Z',
      sortable_name: 'REAL_NAME_2',
      short_name: 'REAL_NAME_3',
      sis_user_id: 'SIS-4411',
      integration_id: 'INT-4411',
      login_id: 'REAL_NAME_4',
      pronouns: 'she/her',
    },
  }
}

/** Staff: `classifyRoleFromEnrollment` reads `type`, so this name survives. */
function teacherEnrollment(courseId: string) {
  return {
    id: '5002',
    root_account_id: '1',
    user_id: '9',
    course_id: courseId,
    course_section_id: '70',
    enrollment_state: 'active',
    created_at: '2025-08-20T08:00:00Z',
    type: 'TeacherEnrollment',
    role: 'TeacherEnrollment',
    role_id: '4',
    html_url: 'https://school.example/courses/7/users/9',
    user: {
      id: '9',
      name: 'Dr. Ingrid Holt',
      created_at: '2025-08-20T08:00:00Z',
      sortable_name: 'Holt, Ingrid',
      short_name: 'Ingrid Holt',
    },
  }
}

export const enrollmentFixtures: Record<string, MarkedNameFixture> = {
  // GET /api/v1/users/self/enrollments — the caller's own enrollments, scoped
  // per row by that row's `course_id`.
  list_enrollments: {
    args: {},
    buildCanvas: () =>
      ({
        enrollments: { list: async () => [studentEnrollment('7'), teacherEnrollment('7')] },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },

  // GET /api/v1/courses/:course_id/enrollments
  list_course_enrollments: {
    args: { course_id: '7' },
    buildCanvas: () =>
      ({
        enrollments: {
          listForCourse: async () => [studentEnrollment('7'), teacherEnrollment('7')],
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },
}
