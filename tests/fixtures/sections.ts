import type { CanvasCourseSection, CanvasUser } from '../../src/canvas/types'

// Fixtures for `GET /api/v1/courses/:course_id/sections`, shaped after
// `Api::V1::Section#section_json` (instructure/canvas-lms,
// `lib/api/v1/section.rb`) rather than after this repo's types:
//
//   res = section.as_json(only: %w[id name course_id nonxlist_course_id
//                                  start_at end_at
//                                  restrict_enrollments_to_section_dates
//                                  created_at])
//
// with `sis_section_id` / `sis_course_id` / `integration_id` added for a caller
// holding `:read_sis` or `:manage_sis`, `total_students` and `permissions`
// added per `include[]`, and `students` holding `user_json` objects when
// `include[]=students` is requested.

export const FIXTURE_COURSE_ID = '7'

/** Every real name that appears anywhere in the fixtures below. */
export const SECTION_REAL_NAMES = [
  'Priya Raman',
  'Raman, Priya',
  'Tobias Lindqvist',
  'Lindqvist, Tobias',
  'Marcus Webb',
] as const

/**
 * The shape `list_sections` actually asks Canvas for: base fields only, plus
 * the two `include[]` extras the tool exposes. No names anywhere.
 */
export const FIXTURE_SECTION_PLAIN: CanvasCourseSection = {
  id: '4021',
  name: 'Section A — Mon/Wed',
  course_id: FIXTURE_COURSE_ID,
  start_at: null,
  end_at: null,
  created_at: '2026-08-14T09:12:03Z',
  restrict_enrollments_to_section_dates: false,
  nonxlist_course_id: null,
  sis_section_id: 'SIS-SEC-A',
  sis_course_id: 'SIS-CRS-7',
  integration_id: null,
  total_students: 2,
  permissions: { manage_calendar: true },
}

/** A cross-listed section: `nonxlist_course_id` names the original course. */
export const FIXTURE_SECTION_CROSSLISTED: CanvasCourseSection = {
  id: '4022',
  name: 'Section B — Fri',
  course_id: FIXTURE_COURSE_ID,
  start_at: '2026-09-01T00:00:00Z',
  end_at: '2026-12-19T23:59:00Z',
  created_at: '2026-08-14T09:12:04Z',
  restrict_enrollments_to_section_dates: true,
  nonxlist_course_id: '9',
}

const PRIYA: CanvasUser = {
  id: '551',
  name: 'Priya Raman',
  sortable_name: 'Raman, Priya',
  short_name: 'Priya Raman',
  login_id: 'praman',
  sis_user_id: 'SIS-551',
  email: 'priya.raman@school.example',
  avatar_url: 'https://school.instructure.com/images/thumbnails/551/abc',
  enrollments: [
    {
      id: '88001',
      course_id: FIXTURE_COURSE_ID,
      user_id: '551',
      type: 'StudentEnrollment',
      role: 'StudentEnrollment',
      enrollment_state: 'active',
      course_section_id: '4021',
      sis_user_id: 'SIS-551',
    },
  ],
}

const TOBIAS: CanvasUser = {
  id: '552',
  name: 'Tobias Lindqvist',
  sortable_name: 'Lindqvist, Tobias',
  short_name: 'Tobias Lindqvist',
  login_id: 'tlindqvist',
  sis_user_id: 'SIS-552',
}

/**
 * GUARD fixture — the shape `list_sections` deliberately never requests.
 *
 * `section_json` emits this whenever `include[]=students` is in the request
 * (with `students[].enrollments` when `include[]=enrollments` rides along), so
 * it is what a widening of `CourseSectionInclude`, or a Canvas instance that
 * returns the field unasked, would produce. The Pseudonymizer's section path
 * exists for exactly this payload; without a fixture that reaches it, the guard
 * would be untested decoration.
 */
export const FIXTURE_SECTION_WITH_STUDENTS: CanvasCourseSection = {
  ...FIXTURE_SECTION_PLAIN,
  students: [PRIYA, TOBIAS],
}

/**
 * GUARD fixture — a student entry with no identifier. There is nothing to key a
 * stable pseudonym on, so the name must be withheld rather than passed through.
 */
export const FIXTURE_SECTION_STUDENT_NO_ID: CanvasCourseSection = {
  ...FIXTURE_SECTION_CROSSLISTED,
  students: [{ name: 'Marcus Webb' } as CanvasUser],
}

/**
 * Canvas sets `students` to `null`, not `[]`, when the section has no student
 * enrollments (`res["students"] = nil if res["students"].empty?`), so the
 * null-vs-empty-array distinction is part of the real payload.
 */
export const FIXTURE_SECTION_NULL_STUDENTS: CanvasCourseSection = {
  ...FIXTURE_SECTION_CROSSLISTED,
  students: null,
}
