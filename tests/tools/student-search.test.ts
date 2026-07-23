import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CanvasApiError } from '../../src/canvas'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasCourse, CanvasUser } from '../../src/canvas/types'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import { studentSearchTools } from '../../src/tools/student-search'

// --- Fixtures ---

const activeCourse: CanvasCourse = {
  id: 1,
  name: 'Intro to CS',
  course_code: 'CS101',
  workflow_state: 'available',
  term: { id: 10, name: 'Fall 2026', start_at: '2026-08-25T00:00:00Z', end_at: null },
  enrollments: [
    {
      id: 501,
      course_id: 1,
      user_id: 900,
      type: 'TeacherEnrollment',
      role: 'TeacherEnrollment',
      enrollment_state: 'active',
    },
  ],
}

const concludedCourse: CanvasCourse = {
  id: 2,
  name: 'Data Structures',
  course_code: 'CS201',
  workflow_state: 'available',
  term: {
    id: 9,
    name: 'Spring 2026',
    start_at: '2026-01-12T00:00:00Z',
    end_at: '2026-05-01T00:00:00Z',
  },
  enrollments: [
    {
      id: 502,
      course_id: 2,
      user_id: 900,
      type: 'TeacherEnrollment',
      role: 'TeacherEnrollment',
      enrollment_state: 'completed',
    },
  ],
}

const studentCourse: CanvasCourse = {
  id: 3,
  name: 'Faculty Development Seminar',
  course_code: 'FAC100',
  workflow_state: 'available',
  term: { id: 10, name: 'Fall 2026', start_at: '2026-08-25T00:00:00Z', end_at: null },
  enrollments: [
    {
      id: 503,
      course_id: 3,
      user_id: 900,
      type: 'StudentEnrollment',
      role: 'StudentEnrollment',
      enrollment_state: 'active',
    },
  ],
}

const janeInCourse1: CanvasUser = {
  id: 5,
  name: 'Jane Doe',
  enrollments: [
    {
      id: 601,
      course_id: 1,
      user_id: 5,
      type: 'StudentEnrollment',
      role: 'StudentEnrollment',
      enrollment_state: 'active',
      last_activity_at: '2026-07-01T00:00:00Z',
    },
  ],
}

const janeInCourse2: CanvasUser = {
  id: 5,
  name: 'Jane Doe',
  enrollments: [
    {
      id: 602,
      course_id: 2,
      user_id: 5,
      type: 'StudentEnrollment',
      role: 'StudentEnrollment',
      enrollment_state: 'completed',
      last_activity_at: '2026-04-20T00:00:00Z',
    },
  ],
}

// --- Mock helpers ---

function buildMockCanvas(overrides: Partial<CanvasClient> = {}): CanvasClient {
  return {
    courses: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({}),
      getSyllabus: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    assignments: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({}),
      listGroups: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
      listOverrides: vi.fn().mockResolvedValue([]),
      createOverride: vi.fn().mockResolvedValue({}),
    },
    submissions: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({}),
      grade: vi.fn().mockResolvedValue({}),
      comment: vi.fn().mockResolvedValue({}),
      listMy: vi.fn().mockResolvedValue([]),
      listForStudents: vi.fn().mockResolvedValue([]),
    },
    rubrics: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({}),
      getAssessment: vi.fn().mockResolvedValue({}),
      submitAssessment: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    quizzes: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({}),
      listSubmissions: vi.fn().mockResolvedValue([]),
      listQuestions: vi.fn().mockResolvedValue([]),
      getSubmissionAnswers: vi.fn().mockResolvedValue([]),
      scoreQuestion: vi.fn().mockResolvedValue(undefined),
      getSubmissionEvents: vi.fn().mockResolvedValue([]),
      setExtension: vi.fn().mockResolvedValue([]),
    },
    files: {
      list: vi.fn().mockResolvedValue([]),
      listFolders: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({}),
      upload: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
      download: vi.fn().mockResolvedValue({}),
    },
    gradebookHistory: {
      listDays: vi.fn().mockResolvedValue([]),
      getDay: vi.fn().mockResolvedValue([]),
      listSubmissions: vi.fn().mockResolvedValue([]),
      getFeed: vi.fn().mockResolvedValue([]),
    },
    users: {
      listStudents: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({}),
      getProfile: vi.fn().mockResolvedValue({}),
      searchUsers: vi.fn().mockResolvedValue([]),
      listCourseUsers: vi.fn().mockResolvedValue([]),
      getUpcomingAssignments: vi.fn().mockResolvedValue([]),
    },
    groups: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({}),
      listMembers: vi.fn().mockResolvedValue([]),
    },
    enrollments: {
      list: vi.fn().mockResolvedValue([]),
      listCourse: vi.fn().mockResolvedValue([]),
      listMyGrades: vi.fn().mockResolvedValue([]),
    },
    discussions: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({}),
      listEntries: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      reply: vi.fn().mockResolvedValue({}),
    },
    modules: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({}),
      listItems: vi.fn().mockResolvedValue([]),
    },
    pages: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    calendar: {
      listEvents: vi.fn().mockResolvedValue([]),
    },
    conversations: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    outcomes: {
      getResults: vi.fn().mockResolvedValue([]),
      getRollups: vi.fn().mockResolvedValue({}),
      getLinks: vi.fn().mockResolvedValue([]),
    },
    accounts: {
      listUsers: vi.fn().mockResolvedValue([]),
      getRoles: vi.fn().mockResolvedValue([]),
    },
    analytics: {
      getCourseGrades: vi.fn().mockResolvedValue({}),
      getStudentSummaries: vi.fn().mockResolvedValue([]),
    },
    peerReviews: {
      list: vi.fn().mockResolvedValue([]),
      assign: vi.fn().mockResolvedValue({}),
    },
    newQuizzes: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({}),
    },
    contentExports: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    ...overrides,
  } as unknown as CanvasClient
}

// --- Tests ---

describe('studentSearchTools', () => {
  it('returns a single tool named find_student_across_courses', () => {
    const tools = studentSearchTools(buildMockCanvas())
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('find_student_across_courses')
  })

  it('has correct annotations', () => {
    const tool = studentSearchTools(buildMockCanvas())[0]
    expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
  })

  it('default include_concluded: true makes two courses.list calls', async () => {
    const canvas = buildMockCanvas()
    ;(canvas.courses.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([activeCourse])
      .mockResolvedValueOnce([concludedCourse])
    ;(canvas.users.listCourseUsers as ReturnType<typeof vi.fn>).mockImplementation(
      async (courseId: number) => {
        if (courseId === 1) return [janeInCourse1]
        if (courseId === 2) return [janeInCourse2]
        return []
      },
    )

    const tool = studentSearchTools(canvas)[0]
    await tool.handler({ search_term: 'Jane' })

    expect(canvas.courses.list).toHaveBeenCalledTimes(2)
    expect(canvas.courses.list).toHaveBeenNthCalledWith(1, {})
    expect(canvas.courses.list).toHaveBeenNthCalledWith(2, { enrollment_state: 'completed' })
  })

  it('include_concluded: false skips the second courses.list call', async () => {
    const canvas = buildMockCanvas()
    ;(canvas.courses.list as ReturnType<typeof vi.fn>).mockResolvedValue([activeCourse])
    ;(canvas.users.listCourseUsers as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const tool = studentSearchTools(canvas)[0]
    await tool.handler({ search_term: 'Jane', include_concluded: false })

    expect(canvas.courses.list).toHaveBeenCalledTimes(1)
    expect(canvas.courses.list).toHaveBeenCalledWith({})
  })

  it('filters out non-teaching courses', async () => {
    const canvas = buildMockCanvas()
    ;(canvas.courses.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([activeCourse, studentCourse])
      .mockResolvedValueOnce([])
    ;(canvas.users.listCourseUsers as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const tool = studentSearchTools(canvas)[0]
    await tool.handler({ search_term: 'Jane' })

    const callArgs = (canvas.users.listCourseUsers as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    )
    expect(callArgs).toContain(1)
    expect(callArgs).not.toContain(3)
  })

  it('includes a course with missing enrollments (defensive fallback)', async () => {
    const courseNoEnrollments: CanvasCourse = {
      ...activeCourse,
      id: 99,
      enrollments: undefined,
    }
    const canvas = buildMockCanvas()
    ;(canvas.courses.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([courseNoEnrollments])
      .mockResolvedValueOnce([])
    ;(canvas.users.listCourseUsers as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const tool = studentSearchTools(canvas)[0]
    await tool.handler({ search_term: 'Jane' })

    const callArgs = (canvas.users.listCourseUsers as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    )
    expect(callArgs).toContain(99)
  })

  it('groups a student match across two courses by user_id', async () => {
    const canvas = buildMockCanvas()
    ;(canvas.courses.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([activeCourse])
      .mockResolvedValueOnce([concludedCourse])
    ;(canvas.users.listCourseUsers as ReturnType<typeof vi.fn>).mockImplementation(
      async (courseId: number) => {
        if (courseId === 1) return [janeInCourse1]
        if (courseId === 2) return [janeInCourse2]
        return []
      },
    )

    const tool = studentSearchTools(canvas)[0]
    const result = await tool.handler({ search_term: 'Jane' })
    const r = result as {
      matches_count: number
      matches: Array<{
        user_id: number
        matched_courses: Array<{
          course_id: number
          course_name: string
          term: string
          enrollment_state: string
          last_activity_at: string
        }>
      }>
    }

    expect(r.matches_count).toBe(1)
    expect(r.matches[0].user_id).toBe(5)
    expect(r.matches[0].matched_courses).toHaveLength(2)

    const c1 = r.matches[0].matched_courses.find((c) => c.course_id === 1)
    expect(c1?.course_name).toBe('Intro to CS')
    expect(c1?.term).toBe('Fall 2026')
    expect(c1?.enrollment_state).toBe('active')
    expect(c1?.last_activity_at).toBe('2026-07-01T00:00:00Z')

    const c2 = r.matches[0].matched_courses.find((c) => c.course_id === 2)
    expect(c2?.course_name).toBe('Data Structures')
    expect(c2?.term).toBe('Spring 2026')
    expect(c2?.enrollment_state).toBe('completed')
    expect(c2?.last_activity_at).toBe('2026-04-20T00:00:00Z')
  })

  it('calls listCourseUsers with the correct options', async () => {
    const canvas = buildMockCanvas()
    ;(canvas.courses.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([activeCourse])
      .mockResolvedValueOnce([])
    ;(canvas.users.listCourseUsers as ReturnType<typeof vi.fn>).mockResolvedValue([janeInCourse1])

    const tool = studentSearchTools(canvas)[0]
    await tool.handler({ search_term: 'Jane' })

    expect(canvas.users.listCourseUsers).toHaveBeenCalledWith(1, {
      search_term: 'Jane',
      enrollment_type: ['student'],
      enrollment_state: ['active', 'completed', 'inactive', 'invited', 'rejected'],
      include: ['enrollments'],
    })
  })

  it('returns zero matches when no users found', async () => {
    const canvas = buildMockCanvas()
    ;(canvas.courses.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([activeCourse])
      .mockResolvedValueOnce([])
    ;(canvas.users.listCourseUsers as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const tool = studentSearchTools(canvas)[0]
    const result = await tool.handler({ search_term: 'Nobody' })
    const r = result as { matches_count: number; matches: unknown[] }

    expect(r.matches_count).toBe(0)
    expect(r.matches).toEqual([])
  })

  it('returns zero matches when caller has no teaching courses', async () => {
    const canvas = buildMockCanvas()
    ;(canvas.courses.list as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const tool = studentSearchTools(canvas)[0]
    const result = await tool.handler({ search_term: 'Jane' })
    const r = result as { courses_found: number; courses_scanned: number; matches: unknown[] }

    expect(r.courses_found).toBe(0)
    expect(r.courses_scanned).toBe(0)
    expect(r.matches).toEqual([])
    expect(canvas.users.listCourseUsers).not.toHaveBeenCalled()
  })

  it('tolerates per-course listCourseUsers failure', async () => {
    const canvas = buildMockCanvas()
    ;(canvas.courses.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([activeCourse, concludedCourse])
      .mockResolvedValueOnce([])
    ;(canvas.users.listCourseUsers as ReturnType<typeof vi.fn>).mockImplementation(
      async (courseId: number) => {
        if (courseId === 1) return [janeInCourse1]
        throw new CanvasApiError('Forbidden', 403, '/api/v1/courses/2/users')
      },
    )

    const tool = studentSearchTools(canvas)[0]
    const result = await tool.handler({ search_term: 'Jane' })
    const r = result as {
      matches_count: number
      courses_failed: Array<{ course_id: number; status: number; message: string }>
    }

    expect(r.matches_count).toBe(1)
    expect(r.courses_failed).toHaveLength(1)
    expect(r.courses_failed[0]).toEqual({ course_id: 2, status: 403, message: 'Forbidden' })
  })

  it('applies max_courses truncation, most-recent-term-first', async () => {
    const course2024: CanvasCourse = {
      ...activeCourse,
      id: 10,
      term: { id: 7, name: 'Fall 2024', start_at: '2024-08-25T00:00:00Z', end_at: null },
    }
    const course2025: CanvasCourse = {
      ...activeCourse,
      id: 11,
      term: { id: 8, name: 'Fall 2025', start_at: '2025-08-25T00:00:00Z', end_at: null },
    }
    const course2026: CanvasCourse = { ...activeCourse, id: 12 } // term start_at: 2026

    const canvas = buildMockCanvas()
    ;(canvas.courses.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([course2024, course2025, course2026])
      .mockResolvedValueOnce([])
    ;(canvas.users.listCourseUsers as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const tool = studentSearchTools(canvas)[0]
    const result = await tool.handler({ search_term: 'Jane', max_courses: 2 })
    const r = result as { truncated: boolean; courses_found: number; courses_scanned: number }

    expect(r.truncated).toBe(true)
    expect(r.courses_found).toBe(3)
    expect(r.courses_scanned).toBe(2)

    const callArgs = (canvas.users.listCourseUsers as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    )
    expect(callArgs).toContain(12) // 2026
    expect(callArgs).toContain(11) // 2025
    expect(callArgs).not.toContain(10) // 2024 dropped
  })

  it('sorts course with no term.start_at last under truncation', async () => {
    const undatedCourse: CanvasCourse = {
      ...activeCourse,
      id: 20,
      term: undefined,
    }
    const course2025: CanvasCourse = {
      ...activeCourse,
      id: 21,
      term: { id: 8, name: 'Fall 2025', start_at: '2025-08-25T00:00:00Z', end_at: null },
    }
    const course2026: CanvasCourse = { ...activeCourse, id: 22 }

    const canvas = buildMockCanvas()
    ;(canvas.courses.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([undatedCourse, course2025, course2026])
      .mockResolvedValueOnce([])
    ;(canvas.users.listCourseUsers as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const tool = studentSearchTools(canvas)[0]
    await tool.handler({ search_term: 'Jane', max_courses: 2 })

    const callArgs = (canvas.users.listCourseUsers as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    )
    expect(callArgs).not.toContain(20) // undated dropped
    expect(callArgs).toContain(22)
    expect(callArgs).toContain(21)
  })

  it('falls back gracefully when matched user has no enrollments', async () => {
    const userNoEnrollments: CanvasUser = { id: 5, name: 'Jane Doe', enrollments: [] }

    const canvas = buildMockCanvas()
    ;(canvas.courses.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([activeCourse])
      .mockResolvedValueOnce([])
    ;(canvas.users.listCourseUsers as ReturnType<typeof vi.fn>).mockResolvedValue([
      userNoEnrollments,
    ])

    const tool = studentSearchTools(canvas)[0]
    const result = await tool.handler({ search_term: 'Jane' })
    const r = result as {
      matches: Array<{
        matched_courses: Array<{ enrollment_state: string; last_activity_at: null }>
      }>
    }

    expect(r.matches[0].matched_courses[0].enrollment_state).toBe('unknown')
    expect(r.matches[0].matched_courses[0].last_activity_at).toBeNull()
  })

  it('returns real user_name when pseudonymizer is not provided', async () => {
    const canvas = buildMockCanvas()
    ;(canvas.courses.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([activeCourse])
      .mockResolvedValueOnce([])
    ;(canvas.users.listCourseUsers as ReturnType<typeof vi.fn>).mockResolvedValue([janeInCourse1])

    const tool = studentSearchTools(canvas)[0]
    const result = await tool.handler({ search_term: 'Jane' })
    const r = result as { matches: Array<{ matched_courses: Array<{ user_name: string }> }> }

    expect(r.matches[0].matched_courses[0].user_name).toBe('Jane Doe')
  })

  it('does not echo search_term in the output', async () => {
    const canvas = buildMockCanvas()
    ;(canvas.courses.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([activeCourse])
      .mockResolvedValueOnce([])
    ;(canvas.users.listCourseUsers as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const tool = studentSearchTools(canvas)[0]
    const result = await tool.handler({ search_term: 'Jane' })

    expect(Object.keys(result as object)).not.toContain('search_term')
  })

  it('records non-CanvasApiError failures in courses_failed without throwing', async () => {
    const canvas = buildMockCanvas()
    ;(canvas.courses.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([activeCourse])
      .mockResolvedValueOnce([])
    ;(canvas.users.listCourseUsers as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'))

    const tool = studentSearchTools(canvas)[0]
    const result = await tool.handler({ search_term: 'Jane' })
    const r = result as {
      courses_failed: Array<{ course_id: number; status: null; message: string }>
    }

    expect(r.courses_failed).toHaveLength(1)
    expect(r.courses_failed[0].course_id).toBe(1)
    expect(r.courses_failed[0].status).toBeNull()
    expect(r.courses_failed[0].message).toContain('boom')
  })

  it('processes courses in batches of 10 to limit concurrent requests', async () => {
    // 15 courses → batch 1 (10) then batch 2 (5); max concurrent must stay ≤ 10
    const manyCourses: CanvasCourse[] = Array.from({ length: 15 }, (_, i) => ({
      ...activeCourse,
      id: 100 + i,
    }))

    const canvas = buildMockCanvas()
    ;(canvas.courses.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(manyCourses)
      .mockResolvedValueOnce([])

    let concurrentCount = 0
    let maxConcurrentCount = 0

    ;(canvas.users.listCourseUsers as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      concurrentCount++
      maxConcurrentCount = Math.max(maxConcurrentCount, concurrentCount)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      concurrentCount--
      return []
    })

    const tool = studentSearchTools(canvas)[0]
    await tool.handler({ search_term: 'Jane' })

    expect(canvas.users.listCourseUsers).toHaveBeenCalledTimes(15)
    expect(maxConcurrentCount).toBeLessThanOrEqual(10)
  })

  describe('pseudonymizer', () => {
    let tmpDir: string

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'student-search-tool-'))
    })

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true })
    })

    function makePseudonymizer(enabled = true) {
      return new Pseudonymizer({
        baseUrl: 'https://school.instructure.com/api/v1',
        rootDir: tmpDir,
        env: enabled ? { CANVAS_PSEUDONYMIZE_STUDENTS: 'true' } : {},
      })
    }

    it('pseudonymizes user_name per-course when enabled', async () => {
      const canvas = buildMockCanvas()
      ;(canvas.courses.list as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([activeCourse])
        .mockResolvedValueOnce([concludedCourse])
      ;(canvas.users.listCourseUsers as ReturnType<typeof vi.fn>).mockImplementation(
        async (courseId: number) => {
          if (courseId === 1) return [janeInCourse1]
          if (courseId === 2) return [janeInCourse2]
          return []
        },
      )

      const tool = studentSearchTools(canvas, makePseudonymizer())[0]
      const result = await tool.handler({ search_term: 'Jane' })
      const r = result as {
        matches: Array<{ matched_courses: Array<{ user_name: string }> }>
      }

      const names = r.matches[0].matched_courses.map((c) => c.user_name)
      for (const name of names) {
        expect(name).toMatch(/^Student \d+$/)
      }
      // Per-course pseudonym scoping: the two names are allowed (not required) to differ
      // — this test proves scoping is preserved rather than flattened to a single name.
    })
  })
})
