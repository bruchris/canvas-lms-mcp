import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import { mapFilePath } from '../../src/pseudonym/paths'
import type { CourseMap } from '../../src/pseudonym/store'
import type { CanvasEnrollment, CanvasSubmission, CanvasUser } from '../../src/canvas/types'

const BASE_URL = 'https://school.instructure.com/api/v1'
const HOST = 'school.instructure.com'
const COURSE_ID = 101

function studentEnrollment(): CanvasEnrollment {
  return {
    id: 1,
    user_id: 0,
    course_id: COURSE_ID,
    type: 'StudentEnrollment',
    enrollment_state: 'active',
    role: 'StudentEnrollment',
    role_id: 1,
  } as CanvasEnrollment
}

function teacherEnrollment(): CanvasEnrollment {
  return {
    id: 2,
    user_id: 0,
    course_id: COURSE_ID,
    type: 'TeacherEnrollment',
    enrollment_state: 'active',
    role: 'TeacherEnrollment',
    role_id: 2,
  } as CanvasEnrollment
}

function student(id: number, name: string, extra: Partial<CanvasUser> = {}): CanvasUser {
  return {
    id,
    name,
    sortable_name: name,
    short_name: name.split(' ')[0],
    email: `${name.replace(/\s+/g, '.').toLowerCase()}@example.edu`,
    login_id: name.replace(/\s+/g, '.').toLowerCase(),
    sis_user_id: `SIS-${id}`,
    bio: 'A real bio',
    pronouns: 'they/them',
    last_login: '2026-05-20T10:00:00Z',
    avatar_url: 'https://canvas.example/avatars/x.png',
    enrollments: [{ ...studentEnrollment(), user_id: id }],
    ...extra,
  }
}

function teacher(id: number, name: string): CanvasUser {
  return {
    id,
    name,
    sortable_name: name,
    short_name: name.split(' ')[0],
    email: `${name}@example.edu`,
    enrollments: [{ ...teacherEnrollment(), user_id: id }],
  }
}

let tmpRoot: string
let env: NodeJS.ProcessEnv

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'pseudonymizer-'))
  env = { CANVAS_PSEUDONYMIZE_STUDENTS: 'true' }
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

function make(overrides: Partial<{ env: NodeJS.ProcessEnv; rootDir: string }> = {}) {
  return new Pseudonymizer({
    baseUrl: BASE_URL,
    rootDir: overrides.rootDir ?? tmpRoot,
    env: overrides.env ?? env,
    auditLog: () => undefined,
  })
}

describe('isEnabled / isReverseLookupEnabled', () => {
  it('is disabled when CANVAS_PSEUDONYMIZE_STUDENTS unset', () => {
    const p = make({ env: {} })
    expect(p.isEnabled()).toBe(false)
    expect(p.isReverseLookupEnabled()).toBe(false)
  })

  it.each(['true', '1', 'yes', 'on', 'TRUE', 'Yes'])('treats %s as truthy', (val) => {
    const p = make({ env: { CANVAS_PSEUDONYMIZE_STUDENTS: val } })
    expect(p.isEnabled()).toBe(true)
  })

  it.each(['false', '0', 'no', 'off', '', 'maybe'])('treats %s as falsy', (val) => {
    const p = make({ env: { CANVAS_PSEUDONYMIZE_STUDENTS: val } })
    expect(p.isEnabled()).toBe(false)
  })

  it('requires both env vars for reverse lookup', () => {
    expect(make({ env: { CANVAS_PSEUDONYMIZE_STUDENTS: 'true' } }).isReverseLookupEnabled()).toBe(
      false,
    )
    expect(
      make({ env: { CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP: 'true' } }).isReverseLookupEnabled(),
    ).toBe(false)
    expect(
      make({
        env: { CANVAS_PSEUDONYMIZE_STUDENTS: 'true', CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP: 'true' },
      }).isReverseLookupEnabled(),
    ).toBe(true)
  })
})

describe('pass-through when disabled', () => {
  it('returns users unchanged when the flag is off', async () => {
    const p = make({ env: {} })
    const u = student(1, 'Alice Smith')
    const out = await p.anonymizeUser(COURSE_ID, u)
    expect(out).toBe(u)
  })

  it('returns users unchanged when the base URL is unparseable', async () => {
    const p = new Pseudonymizer({
      baseUrl: 'not a url',
      rootDir: tmpRoot,
      env,
      auditLog: () => undefined,
    })
    const u = student(1, 'Alice Smith')
    expect(await p.anonymizeUser(COURSE_ID, u)).toBe(u)
  })
})

describe('anonymizeUser', () => {
  it('replaces name and contact fields with stable pseudonym', async () => {
    const p = make()
    const out = await p.anonymizeUser(COURSE_ID, student(1, 'Alice Smith'))
    expect(out.name).toBe('Student 1')
    expect(out.short_name).toBe('Student 1')
    expect(out.sortable_name).toBe('Student 1')
    expect(out.email).toBe('student-1@anon.invalid')
    expect(out.login_id).toBe('student-1')
    expect(out.sis_user_id).toBeNull()
    expect(out.bio).toBeNull()
    expect(out.pronouns).toBeNull()
    expect(out.last_login).toBeNull()
    expect(out.avatar_url).toBeUndefined()
  })

  it('passes staff (teacher) users through unchanged', async () => {
    const p = make()
    const t = teacher(99, 'Prof Jones')
    expect(await p.anonymizeUser(COURSE_ID, t)).toBe(t)
  })

  it('pseudonymizes users with no enrollments (unknown → student)', async () => {
    const p = make()
    const u: CanvasUser = { id: 5, name: 'Mystery Person' }
    const out = await p.anonymizeUser(COURSE_ID, u)
    expect(out.name).toBe('Student 1')
  })

  it('treats mixed (TA + Student) enrollments as student', async () => {
    const p = make()
    const u = student(7, 'Mixed Role')
    u.enrollments = [
      { ...teacherEnrollment(), user_id: 7, type: 'TaEnrollment' },
      { ...studentEnrollment(), user_id: 7 },
    ]
    const out = await p.anonymizeUser(COURSE_ID, u)
    expect(out.name).toBe('Student 1')
  })

  it('reuses the same pseudonym across calls (stability)', async () => {
    const p = make()
    const first = await p.anonymizeUser(COURSE_ID, student(1, 'Alice'))
    const second = await p.anonymizeUser(COURSE_ID, student(1, 'Alice renamed in Canvas'))
    expect(first.name).toBe(second.name)
  })

  it('assigns distinct pseudonyms to distinct students in arrival order', async () => {
    const p = make()
    const a = await p.anonymizeUser(COURSE_ID, student(1, 'Alice'))
    const b = await p.anonymizeUser(COURSE_ID, student(2, 'Bob'))
    const c = await p.anonymizeUser(COURSE_ID, student(3, 'Carol'))
    expect([a.name, b.name, c.name]).toEqual(['Student 1', 'Student 2', 'Student 3'])
  })
})

describe('anonymizeUsers (array)', () => {
  it('pseudonymizes a list and pass-through teachers', async () => {
    const p = make()
    const out = await p.anonymizeUsers(COURSE_ID, [
      student(1, 'Alice'),
      teacher(99, 'Prof Jones'),
      student(2, 'Bob'),
    ])
    expect(out.map((u) => u.name)).toEqual(['Student 1', 'Prof Jones', 'Student 2'])
  })
})

describe('persistence', () => {
  it('writes the map to disk and reuses pseudonyms across instances', async () => {
    const p1 = make()
    await p1.anonymizeUser(COURSE_ID, student(1, 'Alice'))
    await p1.anonymizeUser(COURSE_ID, student(2, 'Bob'))

    const file = mapFilePath(tmpRoot, HOST, COURSE_ID)
    const raw = await readFile(file, 'utf8')
    const map = JSON.parse(raw) as CourseMap
    expect(map.next_pseudonym_index).toBe(3)
    expect(Object.keys(map.students)).toEqual(['1', '2'])

    const p2 = make()
    const reloaded = await p2.anonymizeUser(COURSE_ID, student(1, 'Alice'))
    expect(reloaded.name).toBe('Student 1')
  })

  it('keys files per base-URL host', async () => {
    const pA = new Pseudonymizer({
      baseUrl: 'https://school-a.instructure.com/api/v1',
      rootDir: tmpRoot,
      env,
      auditLog: () => undefined,
    })
    const pB = new Pseudonymizer({
      baseUrl: 'https://school-b.instructure.com/api/v1',
      rootDir: tmpRoot,
      env,
      auditLog: () => undefined,
    })
    await pA.anonymizeUser(COURSE_ID, student(1, 'Alice'))
    await pB.anonymizeUser(COURSE_ID, student(1, 'Different Alice'))

    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(tmpRoot)
    expect(entries.sort()).toEqual(['school-a.instructure.com', 'school-b.instructure.com'])
  })
})

describe('historical / re-enrollment', () => {
  it('marks dropped students historical when their entry is manually edited (round-trip)', async () => {
    const p = make()
    // Allocate Student 1, then simulate drop by writing the on-disk map manually.
    await p.anonymizeUser(COURSE_ID, student(1, 'Alice'))
    const file = mapFilePath(tmpRoot, HOST, COURSE_ID)
    const map = JSON.parse(await readFile(file, 'utf8')) as CourseMap
    expect(map.students['1']?.pseudonym).toBe('Student 1')

    // Manual operator edit: mark Alice historical.
    map.students['1'] = {
      ...map.students['1']!,
      status: 'historical',
      marked_historical_at: '2026-05-01T00:00:00Z',
    }
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, JSON.stringify(map), 'utf8')

    // New student joins — must get next index, NOT Alice's slot.
    const p2 = make()
    const newStudent = await p2.anonymizeUser(COURSE_ID, student(2, 'Bob'))
    expect(newStudent.name).toBe('Student 2')

    // Re-enroll Alice — must restore Student 1, status active.
    const restored = await p2.anonymizeUser(COURSE_ID, student(1, 'Alice'))
    expect(restored.name).toBe('Student 1')
    const after = JSON.parse(await readFile(file, 'utf8')) as CourseMap
    expect(after.students['1']?.status).toBe('active')
    expect(after.students['1']?.marked_historical_at).toBeUndefined()
  })
})

describe('concurrency', () => {
  it('serializes concurrent allocations so each user gets a unique pseudonym', async () => {
    const p = make()
    const students = Array.from({ length: 25 }, (_, i) => student(i + 1, `Student${i + 1}`))
    const results = await Promise.all(students.map((s) => p.anonymizeUser(COURSE_ID, s)))
    const pseudonyms = new Set(results.map((r) => r.name))
    expect(pseudonyms.size).toBe(25)
    // Pseudonyms are exactly Student 1..25 in some order.
    expect([...pseudonyms].sort()).toEqual(
      Array.from({ length: 25 }, (_, i) => `Student ${i + 1}`).sort(),
    )
  })
})

describe('anonymizeEnrollment', () => {
  it('nulls sis_user_id and rewrites embedded user for student enrollment', async () => {
    const p = make()
    const e: CanvasEnrollment = {
      ...studentEnrollment(),
      user_id: 1,
      sis_user_id: 'SIS-1',
      user: student(1, 'Alice'),
    }
    const out = await p.anonymizeEnrollment(COURSE_ID, e)
    expect(out.sis_user_id).toBeNull()
    expect(out.user?.name).toBe('Student 1')
  })

  it('passes teacher enrollment through unchanged', async () => {
    const p = make()
    const e: CanvasEnrollment = {
      ...teacherEnrollment(),
      user_id: 99,
      sis_user_id: 'SIS-99',
      user: teacher(99, 'Prof Jones'),
    }
    const out = await p.anonymizeEnrollment(COURSE_ID, e)
    expect(out.sis_user_id).toBe('SIS-99')
    expect(out.user?.name).toBe('Prof Jones')
  })
})

describe('anonymizeSubmission', () => {
  it('rewrites submission.user and student-authored comments by reusing the course pseudonym', async () => {
    const p = make()
    // First, allocate Student 1 for user 1 (so the comment author is known).
    await p.anonymizeUser(COURSE_ID, student(1, 'Alice'))

    const submission: CanvasSubmission = {
      id: 10,
      assignment_id: 5,
      user_id: 1,
      submitted_at: '2026-05-20T00:00:00Z',
      score: null,
      grade: null,
      body: null,
      url: null,
      attempt: 1,
      workflow_state: 'submitted',
      user: student(1, 'Alice'),
      submission_comments: [
        { id: 50, author_id: 1, author_name: 'Alice', comment: 'My work', created_at: '...' },
        { id: 51, author_id: 99, author_name: 'Prof Jones', comment: 'Good', created_at: '...' },
      ],
    }

    const out = await p.anonymizeSubmission(COURSE_ID, submission)
    expect(out.user?.name).toBe('Student 1')
    expect(out.submission_comments?.[0]?.author_name).toBe('Student 1')
    // Author 99 has no pseudonym in the map — pass through unchanged.
    expect(out.submission_comments?.[1]?.author_name).toBe('Prof Jones')
  })
})

describe('anonymizeConversation', () => {
  it('rewrites all participants using the cross-course pool', async () => {
    const p = make()
    const conv = {
      id: 1,
      subject: 'Hello',
      last_message: 'hi',
      last_message_at: '2026-05-20T00:00:00Z',
      message_count: 1,
      participants: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    }
    const out = await p.anonymizeConversation(conv)
    expect(out.participants[0]?.name).toBe('Person 1')
    expect(out.participants[1]?.name).toBe('Person 2')

    // Same id → same name on a second call.
    const out2 = await p.anonymizeConversation(conv)
    expect(out2.participants[0]?.name).toBe('Person 1')
  })
})

describe('anonymizeOutcomeResults', () => {
  it('pseudonymizes linked.users while leaving everything else intact', async () => {
    const p = make()
    const response = {
      outcome_results: [
        {
          id: 1,
          score: 0.8,
          submitted_or_assessed_at: null,
          links: { user: 1, learning_outcome: 1, alignment: 1 },
          percent: null,
        },
      ],
      linked: {
        users: [student(1, 'Alice'), student(2, 'Bob')],
        outcomes: [],
      },
    } as unknown as Parameters<typeof p.anonymizeOutcomeResults>[1]

    const out = await p.anonymizeOutcomeResults(COURSE_ID, response)
    expect(out.linked?.users?.map((u) => u.name)).toEqual(['Student 1', 'Student 2'])
    expect(out.outcome_results).toEqual(response.outcome_results)
  })

  it('passes responses without linked.users through unchanged', async () => {
    const p = make()
    const response = { outcome_results: [], linked: {} }
    const out = await p.anonymizeOutcomeResults(COURSE_ID, response)
    expect(out).toBe(response)
  })
})

describe('reverseLookup', () => {
  it('returns null when reverse lookup is disabled', async () => {
    const p = make({ env: { CANVAS_PSEUDONYMIZE_STUDENTS: 'true' } })
    await p.anonymizeUser(COURSE_ID, student(1, 'Alice'))
    expect(await p.reverseLookup(COURSE_ID, 'Student 1')).toBeNull()
  })

  it('returns the original user_id when reverse lookup is enabled and pseudonym exists', async () => {
    const p = make({
      env: { CANVAS_PSEUDONYMIZE_STUDENTS: 'true', CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP: 'true' },
    })
    await p.anonymizeUser(COURSE_ID, student(1, 'Alice'))
    const result = await p.reverseLookup(COURSE_ID, 'Student 1')
    expect(result).toEqual({ user_id: 1, pseudonym: 'Student 1', status: 'active' })
  })

  it('returns null for unknown pseudonyms and audit-logs the miss', async () => {
    const lines: string[] = []
    const p = new Pseudonymizer({
      baseUrl: BASE_URL,
      rootDir: tmpRoot,
      env: { CANVAS_PSEUDONYMIZE_STUDENTS: 'true', CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP: 'true' },
      auditLog: (line) => lines.push(line),
    })
    await p.anonymizeUser(COURSE_ID, student(1, 'Alice'))
    const result = await p.reverseLookup(COURSE_ID, 'Student 99')
    expect(result).toBeNull()
    expect(lines.some((l) => l.includes('Student 99'))).toBe(true)
  })
})

describe('audit log file (opt-in)', () => {
  it('appends successful reverse_lookup calls when CANVAS_PSEUDONYM_AUDIT_LOG is set', async () => {
    const logFile = join(tmpRoot, 'audit.log')
    const p = new Pseudonymizer({
      baseUrl: BASE_URL,
      rootDir: tmpRoot,
      env: {
        CANVAS_PSEUDONYMIZE_STUDENTS: 'true',
        CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP: 'true',
        CANVAS_PSEUDONYM_AUDIT_LOG: logFile,
      },
      auditLog: () => undefined,
    })
    await p.anonymizeUser(COURSE_ID, student(1, 'Alice'))
    await p.reverseLookup(COURSE_ID, 'Student 1')
    // Allow the fire-and-forget append a tick.
    await new Promise((r) => setTimeout(r, 20))
    const contents = await readFile(logFile, 'utf8')
    expect(contents).toContain('Student 1')
    expect(contents).toContain('reverse_lookup hit')
  })
})
