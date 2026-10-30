/**
 * Marked-name fixtures for `explain_grade` (`src/tools/grade-explanation.ts`)
 * and `project_grade` (`src/tools/grade-projection.ts`).
 *
 * Both tools reconcile a student's grade from four Canvas reads and emit a
 * single identity field, `student: { id, name }`, read off
 * `pseudonymizer.anonymizeUser(courseId, user, enrollments)`. The enrollments
 * are passed in deliberately so that role classification uses real enrollment
 * types — a staff member fetched by id keeps their name — which is why the
 * fixture's enrollment is a `StudentEnrollment`.
 *
 * **Serializer reads** (`instructure/canvas-lms@master`):
 * `lib/api/v1/user.rb#user_json` for `canvas.users.get` (so `first_name` /
 * `last_name` are present, per `users_controller#api_show_includes`),
 * `#enrollment_json` for the graded enrollment, and
 * `lib/api/v1/assignment.rb` / `#submission_json` for the groups and
 * submissions, neither of which carries a person.
 *
 * **`course.name` is the decoy.** Both tools copy it into their response
 * verbatim, next to the masked student name. It must survive unchanged, so it
 * carries no mark.
 *
 * **`grading_standard_id` is null on purpose.** A non-null value sends both
 * handlers into `resolveGradingScheme`, i.e. more Canvas calls that have
 * nothing to do with pseudonymization.
 *
 * **`student_id` is passed explicitly.** Both handlers skip pseudonymization
 * entirely when `studentId === 'self'` — the caller is the token owner and is
 * never masked — so a fixture that omitted it would be VACUOUS rather than
 * CLEAN.
 */
import type { CanvasClient } from '../../../src/canvas'
import { buildSweepPseudonymizer, type MarkedNameFixture } from './sweep'

function gradeCanvas(): CanvasClient {
  return {
    courses: {
      get: async () => ({
        id: '7',
        // Decoy: a course name, beside a masked student name.
        name: 'Introduction to Fjords',
        course_code: 'FJORD-101',
        workflow_state: 'available',
        apply_assignment_group_weights: false,
        grading_standard_id: null,
      }),
    },
    assignments: {
      listGroups: async () => [
        {
          id: '30',
          name: 'Reports',
          group_weight: 100,
          position: 1,
          assignments: [
            {
              id: '88',
              name: 'Fjord field report',
              points_possible: 20,
              omit_from_final_grade: false,
              published: true,
              due_at: '2026-10-26T23:59:00Z',
              assignment_group_id: '30',
              grading_type: 'points',
            },
          ],
        },
      ],
    },
    submissions: {
      listForStudents: async () => [
        {
          id: '9001',
          assignment_id: '88',
          user_id: '101',
          score: 18,
          grade: '18',
          entered_score: 18,
          workflow_state: 'graded',
          submitted_at: '2026-10-27T08:55:00Z',
          graded_at: '2026-10-28T11:29:00Z',
          excused: false,
          missing: false,
          late: false,
        },
      ],
    },
    enrollments: {
      listForCourse: async () => [
        {
          id: '5001',
          user_id: '101',
          course_id: '7',
          type: 'StudentEnrollment',
          role: 'StudentEnrollment',
          enrollment_state: 'active',
          grades: {
            html_url: 'https://school.example/courses/7/grades/101',
            current_score: 90,
            current_grade: 'A-',
            final_score: 90,
            final_grade: 'A-',
          },
        },
      ],
    },
    users: {
      get: async () => ({
        id: '101',
        name: 'REAL_NAME_1',
        created_at: '2026-01-05T08:00:00Z',
        sortable_name: 'REAL_NAME_2',
        short_name: 'REAL_NAME_3',
        first_name: 'REAL_NAME_4',
        last_name: 'REAL_NAME_5',
        email: 'REAL_NAME_6@school.example',
        avatar_url: 'https://school.example/images/users/101',
        locale: null,
        effective_locale: 'en',
        permissions: { can_update_name: true, can_update_avatar: false },
      }),
    },
  } as unknown as CanvasClient
}

export const gradeFixtures: Record<string, MarkedNameFixture> = {
  explain_grade: {
    args: { course_id: '7', student_id: '101' },
    buildCanvas: gradeCanvas,
    buildPseudonymizer: buildSweepPseudonymizer,
  },

  project_grade: {
    args: { course_id: '7', student_id: '101', target_percentage: 95 },
    buildCanvas: gradeCanvas,
    buildPseudonymizer: buildSweepPseudonymizer,
  },
}
