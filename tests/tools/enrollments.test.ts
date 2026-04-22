import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasEnrollment } from '../../src/canvas/types'
import { enrollmentTools } from '../../src/tools/enrollments'

describe('enrollmentTools', () => {
  const mockEnrollment: CanvasEnrollment = {
    id: 1,
    course_id: 1,
    user_id: 5,
    type: 'StudentEnrollment',
    enrollment_state: 'active',
    role: 'StudentEnrollment',
    created_at: '2026-01-01T00:00:00Z',
  }

  function buildMockCanvas(): CanvasClient {
    return {
      enrollments: {
        list: vi.fn().mockResolvedValue([mockEnrollment]),
        listForCourse: vi.fn().mockResolvedValue([mockEnrollment]),
        enroll: vi.fn().mockResolvedValue(mockEnrollment),
        remove: vi.fn().mockResolvedValue(mockEnrollment),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 4 tool definitions', () => {
    expect(enrollmentTools(buildMockCanvas())).toHaveLength(4)
  })

  it('exports tools with correct names', () => {
    const names = enrollmentTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'list_enrollments',
      'list_course_enrollments',
      'enroll_user',
      'remove_enrollment',
    ])
  })

  describe('list_enrollments', () => {
    it('has read-only annotations', () => {
      const tool = enrollmentTools(buildMockCanvas()).find((t) => t.name === 'list_enrollments')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.enrollments.list with empty opts', async () => {
      const canvas = buildMockCanvas()
      const tool = enrollmentTools(canvas).find((t) => t.name === 'list_enrollments')!
      const result = await tool.handler({})
      expect(canvas.enrollments.list).toHaveBeenCalledWith({})
      expect(result).toEqual([mockEnrollment])
    })

    it('forwards type, state, and include', async () => {
      const canvas = buildMockCanvas()
      const tool = enrollmentTools(canvas).find((t) => t.name === 'list_enrollments')!
      await tool.handler({
        type: ['StudentEnrollment'],
        state: ['active'],
        include: ['grades'],
      })
      expect(canvas.enrollments.list).toHaveBeenCalledWith({
        type: ['StudentEnrollment'],
        state: ['active'],
        include: ['grades'],
      })
    })
  })

  describe('list_course_enrollments', () => {
    it('has read-only annotations', () => {
      const tool = enrollmentTools(buildMockCanvas()).find(
        (t) => t.name === 'list_course_enrollments',
      )!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.enrollments.listForCourse with filters', async () => {
      const canvas = buildMockCanvas()
      const tool = enrollmentTools(canvas).find((t) => t.name === 'list_course_enrollments')!
      await tool.handler({
        course_id: 100,
        type: ['StudentEnrollment'],
        state: ['active'],
        include: ['grades', 'current_points'],
        user_id: 'self',
      })
      expect(canvas.enrollments.listForCourse).toHaveBeenCalledWith(100, {
        type: ['StudentEnrollment'],
        state: ['active'],
        include: ['grades', 'current_points'],
        user_id: 'self',
      })
    })
  })

  describe('enroll_user', () => {
    it('has destructive annotations', () => {
      const tool = enrollmentTools(buildMockCanvas()).find((t) => t.name === 'enroll_user')!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.enrollments.enroll', async () => {
      const canvas = buildMockCanvas()
      const tool = enrollmentTools(canvas).find((t) => t.name === 'enroll_user')!
      await tool.handler({ course_id: 1, user_id: 5, type: 'StudentEnrollment' })
      expect(canvas.enrollments.enroll).toHaveBeenCalledWith(1, 5, 'StudentEnrollment', undefined)
    })

    it('passes optional enrollment_state', async () => {
      const canvas = buildMockCanvas()
      const tool = enrollmentTools(canvas).find((t) => t.name === 'enroll_user')!
      await tool.handler({
        course_id: 1,
        user_id: 5,
        type: 'TeacherEnrollment',
        enrollment_state: 'active',
      })
      expect(canvas.enrollments.enroll).toHaveBeenCalledWith(1, 5, 'TeacherEnrollment', 'active')
    })
  })

  describe('remove_enrollment', () => {
    it('has destructive annotations', () => {
      const tool = enrollmentTools(buildMockCanvas()).find((t) => t.name === 'remove_enrollment')!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.enrollments.remove', async () => {
      const canvas = buildMockCanvas()
      const tool = enrollmentTools(canvas).find((t) => t.name === 'remove_enrollment')!
      await tool.handler({ course_id: 1, enrollment_id: 10, task: 'conclude' })
      expect(canvas.enrollments.remove).toHaveBeenCalledWith(1, 10, 'conclude')
    })
  })
})
