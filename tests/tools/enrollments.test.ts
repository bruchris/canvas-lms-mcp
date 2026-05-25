import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasEnrollment } from '../../src/canvas/types'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
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

  describe('pseudonymization', () => {
    const mockEnrollmentWithUser: CanvasEnrollment = {
      id: 2,
      course_id: 10,
      user_id: 5,
      type: 'StudentEnrollment',
      enrollment_state: 'active',
      role: 'StudentEnrollment',
      sis_user_id: 'SIS-12345',
      user: {
        id: 5,
        name: 'Alice',
        sortable_name: 'Alice',
        short_name: 'Alice',
        email: 'alice@example.edu',
      },
    }

    let tmpDir: string
    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'enrollment-tool-'))
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

    function buildCanvasWithUser(): CanvasClient {
      return {
        enrollments: {
          list: vi.fn().mockResolvedValue([mockEnrollmentWithUser]),
          listForCourse: vi.fn().mockResolvedValue([mockEnrollmentWithUser]),
          enroll: vi.fn().mockResolvedValue(mockEnrollmentWithUser),
          remove: vi.fn().mockResolvedValue(mockEnrollmentWithUser),
        },
      } as unknown as CanvasClient
    }

    describe('list_enrollments', () => {
      it('pseudonymizes embedded user and nulls sis_user_id when enabled', async () => {
        const tool = enrollmentTools(buildCanvasWithUser(), makePseudonymizer()).find(
          (t) => t.name === 'list_enrollments',
        )!
        const result = (await tool.handler({})) as CanvasEnrollment[]
        expect(result[0].sis_user_id).toBeNull()
        expect(result[0].user?.name).toMatch(/^Student \d+$/)
      })

      it('passes through enrollment unchanged when disabled', async () => {
        const tool = enrollmentTools(buildCanvasWithUser(), makePseudonymizer(false)).find(
          (t) => t.name === 'list_enrollments',
        )!
        const result = (await tool.handler({})) as CanvasEnrollment[]
        expect(result[0].sis_user_id).toBe('SIS-12345')
        expect(result[0].user?.name).toBe('Alice')
      })
    })

    describe('list_course_enrollments', () => {
      it('pseudonymizes embedded user when enabled', async () => {
        const tool = enrollmentTools(buildCanvasWithUser(), makePseudonymizer()).find(
          (t) => t.name === 'list_course_enrollments',
        )!
        const result = (await tool.handler({ course_id: 10 })) as CanvasEnrollment[]
        expect(result[0].user?.name).toMatch(/^Student \d+$/)
      })

      it('passes through real names when disabled', async () => {
        const tool = enrollmentTools(buildCanvasWithUser(), makePseudonymizer(false)).find(
          (t) => t.name === 'list_course_enrollments',
        )!
        const result = (await tool.handler({ course_id: 10 })) as CanvasEnrollment[]
        expect(result[0].user?.name).toBe('Alice')
      })
    })
  })
})
