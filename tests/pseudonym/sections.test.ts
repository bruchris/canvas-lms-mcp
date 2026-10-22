import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pseudonymizer, WITHHELD_AUTHOR_NAME } from '../../src/pseudonym/pseudonymizer'
import type { CanvasUser } from '../../src/canvas/types'
import {
  FIXTURE_COURSE_ID,
  FIXTURE_SECTION_CROSSLISTED,
  FIXTURE_SECTION_NULL_STUDENTS,
  FIXTURE_SECTION_PLAIN,
  FIXTURE_SECTION_STUDENT_NO_ID,
  FIXTURE_SECTION_WITH_STUDENTS,
  SECTION_REAL_NAMES,
} from '../fixtures/sections'

// BRU-3129. `list_sections` never requests Canvas's `include[]=students`, so on
// today's code path no name can reach a client. These tests cover the
// fail-closed half: the payload `section_json` emits WITH that include — the
// shape a widening of `CourseSectionInclude` would produce — must come out
// pseudonymized, and a student entry with no id must have its name withheld
// rather than passed through.

const BASE_URL = 'https://school.instructure.com/api/v1'

let tmpRoot: string

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'sections-pseudonym-'))
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function make(env: NodeJS.ProcessEnv = { CANVAS_PSEUDONYMIZE_STUDENTS: 'true' }) {
  return new Pseudonymizer({
    baseUrl: BASE_URL,
    rootDir: tmpRoot,
    env,
    auditLog: () => undefined,
  })
}

/** Every string value anywhere in `value`, however deeply nested. */
function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) allStrings(v, out)
  else if (value && typeof value === 'object')
    for (const v of Object.values(value)) allStrings(v, out)
  return out
}

describe('anonymizeSections — the students arm', () => {
  it('replaces every student name with a scope-stable pseudonym and keeps the id', async () => {
    const [section] = await make().anonymizeSections(FIXTURE_COURSE_ID, [
      FIXTURE_SECTION_WITH_STUDENTS,
    ])

    const students = section!.students as CanvasUser[]
    expect(students.map((s) => s.name)).toEqual(['Student 1', 'Student 2'])
    expect(students.map((s) => s.short_name)).toEqual(['Student 1', 'Student 2'])
    expect(students.map((s) => s.sortable_name)).toEqual(['Student 1', 'Student 2'])
    // Ids are never rewritten — they are how a caller follows up with
    // `get_submission` or `resolve_pseudonym`.
    expect(students.map((s) => s.id)).toEqual(['551', '552'])
  })

  it('scrubs the identity siblings that would reveal the student without the name', async () => {
    const [section] = await make().anonymizeSections(FIXTURE_COURSE_ID, [
      FIXTURE_SECTION_WITH_STUDENTS,
    ])

    const [priya] = section!.students as CanvasUser[]
    expect(priya!.sis_user_id).toBeNull()
    expect(priya!.integration_id).toBeNull()
    expect(priya!.avatar_url).toBeUndefined()
    expect(priya!.login_id).toBe('student-1')
    expect(priya!.email).toBe('student-1@anon.invalid')
  })

  it('withholds the name of a student entry that carries no id (fail closed)', async () => {
    const [section] = await make().anonymizeSections(FIXTURE_COURSE_ID, [
      FIXTURE_SECTION_STUDENT_NO_ID,
    ])

    const [marcus] = section!.students as CanvasUser[]
    expect(marcus!.name).toBe(WITHHELD_AUTHOR_NAME)
    expect(marcus!.sortable_name).toBe(WITHHELD_AUTHOR_NAME)
  })

  it('no real name survives anywhere in the response, at any nesting depth', async () => {
    const sections = await make().anonymizeSections(FIXTURE_COURSE_ID, [
      FIXTURE_SECTION_WITH_STUDENTS,
      FIXTURE_SECTION_STUDENT_NO_ID,
      FIXTURE_SECTION_NULL_STUDENTS,
      FIXTURE_SECTION_PLAIN,
    ])

    const strings = allStrings(sections)
    for (const name of SECTION_REAL_NAMES) {
      expect(strings, `"${name}" survived pseudonymization`).not.toContain(name)
    }
  })

  it('control: with the flag off, every one of those names IS present', async () => {
    // Without this the sweep above could pass by looking in the wrong place.
    const sections = await make({}).anonymizeSections(FIXTURE_COURSE_ID, [
      FIXTURE_SECTION_WITH_STUDENTS,
      FIXTURE_SECTION_STUDENT_NO_ID,
    ])

    const strings = allStrings(sections)
    for (const name of SECTION_REAL_NAMES) {
      expect(strings, `"${name}" is not in the un-pseudonymized fixture`).toContain(name)
    }
  })
})

describe('anonymizeSections — scope and the non-PII arms', () => {
  it('uses the course scope, so a student keeps the label other course tools gave them', async () => {
    const ps = make()
    // Warm the course map with a DIFFERENT student first: a per-scope counter
    // hands out "Student 1" in every fresh bucket, so asserting equality on a
    // cold map would pass whatever scope the implementation picked.
    const warmed = await ps.anonymizeUsers(FIXTURE_COURSE_ID, [
      { id: '999', name: 'Someone Else' } as CanvasUser,
    ])
    expect(warmed[0]!.name).toBe('Student 1')

    const [section] = await ps.anonymizeSections(FIXTURE_COURSE_ID, [FIXTURE_SECTION_WITH_STUDENTS])
    const [priya] = section!.students as CanvasUser[]
    expect(priya!.name).toBe('Student 2')
    expect(priya!.name).not.toBe(warmed[0]!.name)

    // And the same user_id resolves to that same label through the roster path.
    const again = await ps.anonymizeUsers(FIXTURE_COURSE_ID, [
      { id: '551', name: 'Priya Raman' } as CanvasUser,
    ])
    expect(again[0]!.name).toBe('Student 2')
  })

  it('leaves a section with no students arm structurally untouched', async () => {
    const sections = await make().anonymizeSections(FIXTURE_COURSE_ID, [
      FIXTURE_SECTION_PLAIN,
      FIXTURE_SECTION_CROSSLISTED,
      FIXTURE_SECTION_NULL_STUDENTS,
    ])

    expect(sections[0]).toEqual(FIXTURE_SECTION_PLAIN)
    expect(sections[1]).toEqual(FIXTURE_SECTION_CROSSLISTED)
    // `null` is what Canvas sends for an empty section, and it must survive as
    // `null` rather than being normalised to `[]`.
    expect(sections[2]!.students).toBeNull()
  })

  it('preserves the section metadata and the non-PII includes on a students payload', async () => {
    const [section] = await make().anonymizeSections(FIXTURE_COURSE_ID, [
      FIXTURE_SECTION_WITH_STUDENTS,
    ])

    expect(section!.id).toBe('4021')
    expect(section!.name).toBe('Section A — Mon/Wed')
    expect(section!.total_students).toBe(2)
    expect(section!.permissions).toEqual({ manage_calendar: true })
    expect(section!.sis_section_id).toBe('SIS-SEC-A')
  })

  it('passes sections through untouched when the flag is off', async () => {
    const sections = await make({}).anonymizeSections(FIXTURE_COURSE_ID, [
      FIXTURE_SECTION_WITH_STUDENTS,
    ])
    expect(sections).toEqual([FIXTURE_SECTION_WITH_STUDENTS])
  })
})
