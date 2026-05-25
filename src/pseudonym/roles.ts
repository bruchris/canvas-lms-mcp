// Role classification for pseudonymization.
//
// A user is pseudonymized when classified as `student` or `unknown`. Mixed
// roles (a TA who is also a student in the same course) classify as student —
// conservative-anonymize. The principle is unknown → student: false positives
// (a staff member pseudonymized) are visible and fixable; false negatives
// (a student leaked) are a privacy incident.

import type { CanvasEnrollment, CanvasUser } from '../canvas/types'

export type Role = 'student' | 'staff' | 'unknown'

const STAFF_TYPES = new Set(['TeacherEnrollment', 'TaEnrollment', 'DesignerEnrollment'])

const STUDENT_TYPES = new Set(['StudentEnrollment', 'StudentViewEnrollment'])

/**
 * Classify a user as student / staff / unknown based on their enrollments
 * in a course. Pass `enrollments` explicitly when the user object lacks them
 * (e.g. when the caller fetched enrollments via a separate API call).
 *
 * Rules:
 *   1. Any active `StudentEnrollment` → `student` (wins over staff).
 *   2. Any `TeacherEnrollment` / `TaEnrollment` / `DesignerEnrollment` → `staff`.
 *   3. Otherwise `unknown`.
 *
 * `ObserverEnrollment` alone does not classify as either; observers are
 * typically parents and should not see student PII, but they are not the
 * subject we are pseudonymizing — treat as unknown (conservative).
 */
export function classifyRole(
  user: Pick<CanvasUser, 'enrollments'>,
  enrollments?: ReadonlyArray<CanvasEnrollment>,
): Role {
  const list = enrollments ?? user.enrollments ?? []
  if (list.length === 0) return 'unknown'

  let sawStudent = false
  let sawStaff = false
  for (const e of list) {
    const type = e.type
    if (!type) continue
    if (STUDENT_TYPES.has(type)) {
      sawStudent = true
    } else if (STAFF_TYPES.has(type)) {
      sawStaff = true
    }
  }

  if (sawStudent) return 'student'
  if (sawStaff) return 'staff'
  return 'unknown'
}

/**
 * Does this role get pseudonymized when the flag is on?
 * Unknown classifies as needing pseudonymization (conservative).
 */
export function shouldPseudonymize(role: Role): boolean {
  return role !== 'staff'
}
