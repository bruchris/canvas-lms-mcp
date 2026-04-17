import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import type {
  CanvasCourse,
  CanvasEnrollment,
  CanvasSubmission,
  CanvasUpcomingEvent,
} from '../../src/canvas/types'
import { studentTools } from '../../src/tools/student'

describe('studentTools', () => {
  const mockCourse: CanvasCourse = {
    id: 1,
    name: 'Intro to CS',
    course_code: 'CS101',
    workflow_state: 'available',
  }

  const mockEnrollment: CanvasEnrollment = {
    id: 10,
    course_id: 1,
    user_id: 5,
    type: 'StudentEnrollment',
    role: 'StudentEnrollment',
    enrollment_state: 'active',
    grades: {
      current_grade: 'A',
      current_score: 95,
      final_grade: 'A',
      final_score: 95,
    },
  }

  const mockSubmission: CanvasSubmission = {
    id: 100,
    assignment_id: 20,
    user_id: 5,
    submitted_at: '2026-04-01T10:00:00Z',
    score: 90,
    grade: 'A-',
    body: null,
    url: null,
    attempt: 1,
    workflow_state: 'graded',
  }

  const mockUpcomingEvent: CanvasUpcomingEvent = {
    id: 200,
    title: 'Homework 3',
    type: 'Assignment',
    workflow_state: 'published',
    context_code: 'course_1',
    start_at: '2026-04-20T23:59:00Z',
    end_at: null,
  }

  function buildMockCanvas(): CanvasClient {
    return {
      courses: {
        list: vi.fn().mockResolvedValue([mockCourse]),
      },
      enrollments: {
        listMyGrades: vi.fn().mockResolvedValue([mockEnrollment]),
      },
      submissions: {
        listMy: vi.fn().mockResolvedValue([mockSubmission]),
      },
      users: {
        getUpcomingAssignments: vi.fn().mockResolvedValue([mockUpcomingEvent]),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 4 tool definitions', () => {
    expect(studentTools(buildMockCanvas())).toHaveLength(4)
  })

  it('exports tools with correct names', () => {
    const names = studentTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'get_my_courses',
      'get_my_grades',
      'get_my_submissions',
      'get_my_upcoming_assignments',
    ])
  })

  it('all student tools have read-only annotations', () => {
    for (const tool of studentTools(buildMockCanvas())) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    }
  })

  describe('get_my_courses', () => {
    it('delegates to canvas.courses.list with enrollment_state=active', async () => {
      const canvas = buildMockCanvas()
      const tool = studentTools(canvas).find((t) => t.name === 'get_my_courses')!
      const result = await tool.handler({})
      expect(canvas.courses.list).toHaveBeenCalledWith({ enrollment_state: 'active' })
      expect(result).toEqual([mockCourse])
    })
  })

  describe('get_my_grades', () => {
    it('delegates to canvas.enrollments.listMyGrades without courseId', async () => {
      const canvas = buildMockCanvas()
      const tool = studentTools(canvas).find((t) => t.name === 'get_my_grades')!
      const result = await tool.handler({})
      expect(canvas.enrollments.listMyGrades).toHaveBeenCalledWith(undefined)
      expect(result).toEqual([mockEnrollment])
    })

    it('delegates to canvas.enrollments.listMyGrades with courseId', async () => {
      const canvas = buildMockCanvas()
      const tool = studentTools(canvas).find((t) => t.name === 'get_my_grades')!
      await tool.handler({ course_id: 1 })
      expect(canvas.enrollments.listMyGrades).toHaveBeenCalledWith(1)
    })
  })

  describe('get_my_submissions', () => {
    it('delegates to canvas.submissions.listMy', async () => {
      const canvas = buildMockCanvas()
      const tool = studentTools(canvas).find((t) => t.name === 'get_my_submissions')!
      const result = await tool.handler({ course_id: 1 })
      expect(canvas.submissions.listMy).toHaveBeenCalledWith(1)
      expect(result).toEqual([mockSubmission])
    })
  })

  describe('get_my_upcoming_assignments', () => {
    it('delegates to canvas.users.getUpcomingAssignments', async () => {
      const canvas = buildMockCanvas()
      const tool = studentTools(canvas).find((t) => t.name === 'get_my_upcoming_assignments')!
      const result = await tool.handler({})
      expect(canvas.users.getUpcomingAssignments).toHaveBeenCalled()
      expect(result).toEqual([mockUpcomingEvent])
    })
  })
})
