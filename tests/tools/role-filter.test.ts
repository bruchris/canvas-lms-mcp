import { describe, expect, it } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { getAllTools } from '../../src/tools'
import { parseRole } from '../../src/tools/roles'
import type { ToolAudience } from '../../src/tools/types'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'

// getAllTools never invokes a tool's handler — it only constructs the
// definitions — so a deep no-op proxy is a sufficient CanvasClient stand-in.
function mockCanvas(): CanvasClient {
  const deep: unknown = new Proxy(function () {}, {
    get: () => deep,
    apply: () => deep,
  })
  return deep as CanvasClient
}

const REVERSE_LOOKUP_ENV = {
  CANVAS_PSEUDONYMIZE_STUDENTS: 'true',
  CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP: 'true',
}

function names(role?: 'student' | 'teacher' | 'admin'): string[] {
  return getAllTools(mockCanvas(), undefined, role).map((t) => t.name)
}

function audienceCounts() {
  const all = getAllTools(mockCanvas())
  const by = (a: ToolAudience) => all.filter((t) => t.audience === a).length
  return {
    shared: by('shared'),
    student: by('student'),
    educator: by('educator'),
    admin: by('admin'),
  }
}

describe('getAllTools — role filtering', () => {
  it('unset role returns the full registry, byte-for-byte current behaviour', () => {
    const unset = getAllTools(mockCanvas())
    const explicitUndefined = getAllTools(mockCanvas(), undefined, undefined)
    expect(explicitUndefined.map((t) => t.name)).toEqual(unset.map((t) => t.name))
  })

  it('each role set equals exactly its audience partition (empirically derived)', () => {
    const { shared, student, educator, admin } = audienceCounts()
    expect(names('student').length).toBe(shared + student)
    expect(names('teacher').length).toBe(shared + educator)
    expect(names('admin').length).toBe(shared + educator + admin)
    // admin (shared+educator+admin) excludes the student-only audience, so it is
    // NOT the full registry whenever any student-only tool exists.
    expect(names('admin').length).toBe(getAllTools(mockCanvas()).length - student)
  })

  it('every filtered role set is a strict subset of the full registry', () => {
    const all = new Set(names())
    for (const role of ['student', 'teacher', 'admin'] as const) {
      const subset = names(role)
      expect(subset.length).toBeLessThan(all.size)
      for (const n of subset) expect(all.has(n)).toBe(true)
    }
  })

  it('student role: includes student/shared tools, excludes educator + admin tools', () => {
    const student = names('student')
    expect(student).toContain('get_my_courses') // student
    expect(student).toContain('health_check') // shared
    expect(student).toContain('list_assignments') // shared override of educator-default domain
    expect(student).not.toContain('delete_assignment') // educator
    expect(student).not.toContain('list_account_users') // admin
    expect(student).not.toContain('grade_submission') // educator
  })

  it('teacher role: includes educator + shared, excludes admin + student-only tools', () => {
    const teacher = names('teacher')
    expect(teacher).toContain('grade_submission') // educator
    expect(teacher).toContain('list_assignments') // shared
    expect(teacher).not.toContain('list_account_users') // admin
    expect(teacher).not.toContain('get_my_grades') // student-only
  })

  it('admin role: includes admin + educator + shared', () => {
    const admin = names('admin')
    expect(admin).toContain('list_account_users') // admin
    expect(admin).toContain('enroll_user') // admin
    expect(admin).toContain('grade_submission') // educator
    expect(admin).toContain('health_check') // shared
    expect(admin).not.toContain('get_my_grades') // student-only
  })

  it('case-insensitive role values resolve to the same filtered set', () => {
    // The parsing happens upstream (parseRole); getAllTools takes the canonical
    // role. This asserts the canonical lowercased values are what the filter keys on.
    expect(parseRole('STUDENT').role).toBe('student')
    expect(parseRole('Student').role).toBe('student')
    expect(names('student').length).toBeGreaterThan(0)
  })
})

describe('getAllTools — pseudonymizer interaction', () => {
  function reverseLookupPseudonymizer() {
    return new Pseudonymizer({ baseUrl: 'https://h.example/api/v1', env: REVERSE_LOOKUP_ENV })
  }

  it('resolve_pseudonym is educator-audience: hidden from student even when enabled', () => {
    const ps = reverseLookupPseudonymizer()
    expect(getAllTools(mockCanvas(), ps).find((t) => t.name === 'resolve_pseudonym')).toBeDefined()
    expect(
      getAllTools(mockCanvas(), ps, 'student').find((t) => t.name === 'resolve_pseudonym'),
    ).toBeUndefined()
    expect(
      getAllTools(mockCanvas(), ps, 'teacher').find((t) => t.name === 'resolve_pseudonym'),
    ).toBeDefined()
    expect(
      getAllTools(mockCanvas(), ps, 'admin').find((t) => t.name === 'resolve_pseudonym'),
    ).toBeDefined()
  })
})

describe('parseRole', () => {
  it('accepts the three roles, case-insensitively, trimming whitespace', () => {
    expect(parseRole('student')).toEqual({ role: 'student', invalid: false })
    expect(parseRole('TEACHER')).toEqual({ role: 'teacher', invalid: false })
    expect(parseRole('  Admin ')).toEqual({ role: 'admin', invalid: false })
  })

  it('treats unset, empty, and "all" as no-filter without warning', () => {
    expect(parseRole(undefined)).toEqual({ invalid: false })
    expect(parseRole(null)).toEqual({ invalid: false })
    expect(parseRole('')).toEqual({ invalid: false })
    expect(parseRole('all')).toEqual({ invalid: false })
    expect(parseRole(' ALL ')).toEqual({ invalid: false })
  })

  it('flags unrecognised values as invalid (caller warns and registers all)', () => {
    expect(parseRole('ta')).toEqual({ invalid: true })
    expect(parseRole('observer')).toEqual({ invalid: true })
    expect(parseRole('foo')).toEqual({ invalid: true })
  })
})
