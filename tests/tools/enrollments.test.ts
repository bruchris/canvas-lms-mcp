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

    it('forwards role, grading_period_id, and enrollment_term_id', async () => {
      const canvas = buildMockCanvas()
      const tool = enrollmentTools(canvas).find((t) => t.name === 'list_enrollments')!
      await tool.handler({
        role: ['Mentor'],
        grading_period_id: '3',
        enrollment_term_id: '4',
      })
      expect(canvas.enrollments.list).toHaveBeenCalledWith({
        role: ['Mentor'],
        grading_period_id: '3',
        enrollment_term_id: '4',
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
        course_id: '100',
        type: ['StudentEnrollment'],
        state: ['active'],
        include: ['grades', 'current_points'],
        user_id: 'self',
      })
      expect(canvas.enrollments.listForCourse).toHaveBeenCalledWith('100', {
        type: ['StudentEnrollment'],
        state: ['active'],
        include: ['grades', 'current_points'],
        user_id: 'self',
      })
    })

    it('forwards role, grading_period_id, and enrollment_term_id', async () => {
      const canvas = buildMockCanvas()
      const tool = enrollmentTools(canvas).find((t) => t.name === 'list_course_enrollments')!
      await tool.handler({
        course_id: '100',
        role: ['Mentor'],
        grading_period_id: '7',
        enrollment_term_id: '8',
      })
      expect(canvas.enrollments.listForCourse).toHaveBeenCalledWith('100', {
        role: ['Mentor'],
        grading_period_id: '7',
        enrollment_term_id: '8',
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
      await tool.handler({ course_id: '1', user_id: '5', type: 'StudentEnrollment' })
      expect(canvas.enrollments.enroll).toHaveBeenCalledWith(
        '1',
        '5',
        'StudentEnrollment',
        undefined,
      )
    })

    it('passes optional enrollment_state', async () => {
      const canvas = buildMockCanvas()
      const tool = enrollmentTools(canvas).find((t) => t.name === 'enroll_user')!
      await tool.handler({
        course_id: '1',
        user_id: '5',
        type: 'TeacherEnrollment',
        enrollment_state: 'active',
      })
      expect(canvas.enrollments.enroll).toHaveBeenCalledWith(
        '1',
        '5',
        'TeacherEnrollment',
        'active',
      )
    })
  })

  // BRU-3129 / GH #442. The two tests above assert the pre-existing 4-argument
  // call exactly, so they are the regression guard for "existing behaviour is
  // unchanged when the new options are omitted": passing an options object
  // unconditionally would make both fail on arity.
  describe('enroll_user — optional section restrictions', () => {
    function enrollTool(canvas: CanvasClient) {
      return enrollmentTools(canvas).find((t) => t.name === 'enroll_user')!
    }

    it('passes course_section_id through as an options object', async () => {
      const canvas = buildMockCanvas()
      await enrollTool(canvas).handler({
        course_id: '1',
        user_id: '5',
        type: 'StudentEnrollment',
        course_section_id: '4021',
      })
      expect(canvas.enrollments.enroll).toHaveBeenCalledWith(
        '1',
        '5',
        'StudentEnrollment',
        undefined,
        {
          course_section_id: '4021',
        },
      )
    })

    it('passes both options alongside enrollment_state', async () => {
      const canvas = buildMockCanvas()
      await enrollTool(canvas).handler({
        course_id: '1',
        user_id: '5',
        type: 'TaEnrollment',
        enrollment_state: 'active',
        course_section_id: '4021',
        limit_privileges_to_course_section: true,
      })
      expect(canvas.enrollments.enroll).toHaveBeenCalledWith('1', '5', 'TaEnrollment', 'active', {
        course_section_id: '4021',
        limit_privileges_to_course_section: true,
      })
    })

    it('forwards limit_privileges_to_course_section: false rather than treating it as absent', async () => {
      const canvas = buildMockCanvas()
      await enrollTool(canvas).handler({
        course_id: '1',
        user_id: '5',
        type: 'TeacherEnrollment',
        limit_privileges_to_course_section: false,
      })
      expect(canvas.enrollments.enroll).toHaveBeenCalledWith(
        '1',
        '5',
        'TeacherEnrollment',
        undefined,
        {
          limit_privileges_to_course_section: false,
        },
      )
    })

    it('still calls with four arguments when both options are omitted', async () => {
      // Stated explicitly as well as implied by the two older tests, because
      // this is the acceptance criterion: the previous request shape survives.
      const canvas = buildMockCanvas()
      await enrollTool(canvas).handler({ course_id: '1', user_id: '5', type: 'StudentEnrollment' })
      const call = (canvas.enrollments.enroll as unknown as { mock: { calls: unknown[][] } }).mock
        .calls[0]!
      expect(call).toHaveLength(4)
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
      await tool.handler({ course_id: '1', enrollment_id: '10', task: 'conclude' })
      expect(canvas.enrollments.remove).toHaveBeenCalledWith('1', '10', 'conclude')
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
        const result = (await tool.handler({ course_id: '10' })) as CanvasEnrollment[]
        expect(result[0].user?.name).toMatch(/^Student \d+$/)
      })

      it('passes through real names when disabled', async () => {
        const tool = enrollmentTools(buildCanvasWithUser(), makePseudonymizer(false)).find(
          (t) => t.name === 'list_course_enrollments',
        )!
        const result = (await tool.handler({ course_id: '10' })) as CanvasEnrollment[]
        expect(result[0].user?.name).toBe('Alice')
      })
    })
  })
})
