import { describe, it, expect } from 'vitest'
import { classifyRole, shouldPseudonymize } from '../../src/pseudonym/roles'
import type { CanvasEnrollment, CanvasUser } from '../../src/canvas/types'

function enrollment(type: string, extra: Partial<CanvasEnrollment> = {}): CanvasEnrollment {
  return {
    id: 1,
    user_id: 1,
    course_id: 1,
    type,
    enrollment_state: 'active',
    role: type,
    role_id: 1,
    ...extra,
  } as CanvasEnrollment
}

describe('classifyRole', () => {
  it('returns student for StudentEnrollment', () => {
    const user = { enrollments: [enrollment('StudentEnrollment')] } as Pick<
      CanvasUser,
      'enrollments'
    >
    expect(classifyRole(user)).toBe('student')
  })

  it('returns student for StudentViewEnrollment', () => {
    const user = { enrollments: [enrollment('StudentViewEnrollment')] } as Pick<
      CanvasUser,
      'enrollments'
    >
    expect(classifyRole(user)).toBe('student')
  })

  it('returns staff for TeacherEnrollment', () => {
    const user = { enrollments: [enrollment('TeacherEnrollment')] } as Pick<
      CanvasUser,
      'enrollments'
    >
    expect(classifyRole(user)).toBe('staff')
  })

  it('returns staff for TaEnrollment and DesignerEnrollment', () => {
    expect(
      classifyRole({ enrollments: [enrollment('TaEnrollment')] } as Pick<
        CanvasUser,
        'enrollments'
      >),
    ).toBe('staff')
    expect(
      classifyRole({
        enrollments: [enrollment('DesignerEnrollment')],
      } as Pick<CanvasUser, 'enrollments'>),
    ).toBe('staff')
  })

  it('returns student when user has both student and staff enrollments (mixed → conservative)', () => {
    const user = {
      enrollments: [enrollment('TaEnrollment'), enrollment('StudentEnrollment')],
    } as Pick<CanvasUser, 'enrollments'>
    expect(classifyRole(user)).toBe('student')
  })

  it('returns unknown when user has no enrollments', () => {
    expect(classifyRole({} as Pick<CanvasUser, 'enrollments'>)).toBe('unknown')
    expect(classifyRole({ enrollments: [] } as Pick<CanvasUser, 'enrollments'>)).toBe('unknown')
  })

  it('returns unknown for ObserverEnrollment alone', () => {
    const user = { enrollments: [enrollment('ObserverEnrollment')] } as Pick<
      CanvasUser,
      'enrollments'
    >
    expect(classifyRole(user)).toBe('unknown')
  })

  it('uses explicit enrollments parameter over user.enrollments', () => {
    const user = { enrollments: [enrollment('TeacherEnrollment')] } as Pick<
      CanvasUser,
      'enrollments'
    >
    expect(classifyRole(user, [enrollment('StudentEnrollment')])).toBe('student')
  })
})

describe('shouldPseudonymize', () => {
  it('returns true for student and unknown, false for staff', () => {
    expect(shouldPseudonymize('student')).toBe(true)
    expect(shouldPseudonymize('unknown')).toBe(true)
    expect(shouldPseudonymize('staff')).toBe(false)
  })
})
