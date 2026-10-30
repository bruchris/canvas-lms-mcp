/**
 * Marked-name fixture for `list_sections` (`src/tools/courses.ts`).
 *
 * **This is a GUARD fixture, deliberately ahead of the wire.** Every other
 * fixture in this directory models what Canvas sends us today.
 * `list_sections` is different, and knowingly so: it is in
 * `PSEUDONYMIZER_WRAPPED_TOOLS` as a *fail-closed* wrap (BRU-3129), because
 * `CourseSectionInclude` in `src/canvas/courses.ts` cannot produce
 * `include[]=students`, so no name reaches a client on today's code path. A
 * wire-faithful fixture would therefore carry no marks, its control would
 * never fire, and the oracle would record the tool as VACUOUS — which is
 * right as a reading of the wire and useless as a check on the wrap that
 * exists precisely for the payload the wire does not yet carry.
 *
 * So this fixture models the payload `Pseudonymizer#anonymizeSections` was
 * written for, and the comment is the honest label: a reviewer must read it as
 * "the shape a widened include, or a Canvas instance that volunteers the
 * field, would produce", not as "what `list_sections` returns".
 *
 * **Serializer read** (`instructure/canvas-lms@master`):
 * `lib/api/v1/section.rb#section_json`. Base fields are
 * `id name course_id nonxlist_course_id start_at end_at
 * restrict_enrollments_to_section_dates created_at`; SIS ids ride along for a
 * caller with `read_sis`; and under `include[]=students` the method does
 * `res["students"] << user_json(e.user, user, session, includes, @context,
 * enrollments, [], e)` for each `StudentEnrollment`, capped at
 * `STUDENTS_LIMIT = 1000`, with `res["students"] = nil` when the list comes
 * back empty. `include[]=enrollments` nests each student's section enrollment
 * under `students[].enrollments`.
 *
 * **The section's own `name` is the decoy and stays UNMARKED** — `'Section A
 * (morning)'` is a section, not a person, and neither is `total_students` or
 * the boolean `permissions` map.
 *
 * **The second student has no `id`.** `anonymizeSections` withholds a name
 * outright when a student entry carries nothing to key a stable pseudonym on,
 * and that branch is otherwise unreached: it must still swallow the mark.
 */
import type { CanvasClient } from '../../../src/canvas'
import { buildSweepPseudonymizer, type MarkedNameFixture } from './sweep'

export const sectionFixtures: Record<string, MarkedNameFixture> = {
  // GET /api/v1/courses/:course_id/sections
  list_sections: {
    args: { course_id: '7' },
    buildCanvas: () =>
      ({
        courses: {
          listSections: async () => [
            {
              id: '70',
              name: 'Section A (morning)',
              course_id: '7',
              nonxlist_course_id: null,
              start_at: null,
              end_at: null,
              restrict_enrollments_to_section_dates: false,
              created_at: '2025-12-01T10:00:00Z',
              sis_section_id: 'SIS-SEC-70',
              sis_course_id: 'SIS-CRS-7',
              integration_id: null,
              total_students: 2,
              permissions: { manage_calendar: true },
              students: [
                {
                  id: '101',
                  name: 'REAL_NAME_1',
                  created_at: '2026-01-05T08:00:00Z',
                  sortable_name: 'REAL_NAME_2',
                  short_name: 'REAL_NAME_3',
                  sis_user_id: 'SIS-4411',
                  enrollments: [
                    {
                      id: '881',
                      course_id: '7',
                      course_section_id: '70',
                      user_id: '101',
                      type: 'StudentEnrollment',
                      role: 'StudentEnrollment',
                      enrollment_state: 'active',
                    },
                  ],
                },
                {
                  // No `id`: nothing to key a stable pseudonym on, so
                  // `anonymizeSections` withholds the name rather than
                  // allocating a `Student N` for nobody.
                  name: 'REAL_NAME_4',
                  sortable_name: 'REAL_NAME_5',
                  short_name: 'REAL_NAME_6',
                },
              ],
            },
            {
              id: '71',
              name: 'Section B (afternoon)',
              course_id: '7',
              created_at: '2025-12-01T10:00:00Z',
              // `res["students"] = nil if res["students"].empty?` — the shape a
              // section with no student enrollments actually returns.
              students: null,
            },
          ],
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },
}
