/**
 * Marked-name fixture for `find_student_across_courses`
 * (`src/tools/student-search.ts`).
 *
 * The tool scans every course the caller can see, runs the roster search in
 * each, and groups the hits by real `user_id` — pseudonymizing **per course**,
 * never hoisting one course's map over another, because a person's label is
 * only stable within a course. Its output carries one name field per hit,
 * `matched_courses[].user_name`.
 *
 * **Serializer reads** (`instructure/canvas-lms@master`):
 * `lib/api/v1/course.rb#course_json` for the course list and
 * `lib/api/v1/user.rb#user_json` for each roster hit. The tool asks for
 * `include[]=enrollments`, and `courses_controller#users` pushes
 * `sis_user_id` and `email` on top of whatever is requested, so both are
 * present on every row.
 *
 * **Two courses, one person — that is the point of the fixture.** The same
 * `user_id` appears in both courses with marks of its own per course, so the
 * per-course scoping is actually exercised: a single-course fixture would pass
 * just as well with the map hoisted.
 *
 * **`course_name` and `term.name` are the decoys.** Both are copied into the
 * output beside the masked name and must survive unchanged.
 *
 * **The enrollments are `StudentEnrollment`,** which is what the tool asks
 * Canvas for — and which keeps `classifyRole` on the student arm rather than
 * the unknown one, so the fixture tests the ordinary path rather than the
 * fail-closed default.
 */
import type { CanvasClient } from '../../../src/canvas'
import { buildSweepPseudonymizer, type MarkedNameFixture } from './sweep'

function rosterHit(courseId: string, marks: [string, string, string, string]) {
  return {
    id: '101',
    name: marks[0],
    created_at: '2026-01-05T08:00:00Z',
    sortable_name: marks[1],
    short_name: marks[2],
    sis_user_id: 'SIS-4411',
    email: `${marks[3]}@school.example`,
    enrollments: [
      {
        id: `50${courseId}`,
        course_id: courseId,
        user_id: '101',
        type: 'StudentEnrollment',
        role: 'StudentEnrollment',
        enrollment_state: 'active',
        last_activity_at: '2026-10-28T19:02:00Z',
      },
    ],
  }
}

export const studentSearchFixtures: Record<string, MarkedNameFixture> = {
  find_student_across_courses: {
    args: { search_term: 'REAL' },
    buildCanvas: () =>
      ({
        courses: {
          list: async (opts?: { enrollment_state?: string }) =>
            opts?.enrollment_state === 'completed'
              ? [
                  {
                    id: '8',
                    name: 'Glacial Geomorphology',
                    course_code: 'GEO-220',
                    workflow_state: 'completed',
                    term: { id: '2', name: 'Spring 2026' },
                  },
                ]
              : [
                  {
                    id: '7',
                    name: 'Introduction to Fjords',
                    course_code: 'FJORD-101',
                    workflow_state: 'available',
                    term: { id: '3', name: 'Autumn 2026' },
                  },
                ],
        },
        users: {
          listCourseUsers: async (courseId: string) => [
            courseId === '8'
              ? rosterHit('8', ['REAL_NAME_5', 'REAL_NAME_6', 'REAL_NAME_7', 'REAL_NAME_8'])
              : rosterHit('7', ['REAL_NAME_1', 'REAL_NAME_2', 'REAL_NAME_3', 'REAL_NAME_4']),
          ],
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },
}
