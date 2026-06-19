import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import type { CanvasClient } from '../../src/canvas'
import { CanvasApiError } from '../../src/canvas/client'
import { assignmentOverrideTools } from '../../src/tools/assignment-overrides'

function buildMockCanvas(): CanvasClient {
  return {
    assignments: {
      list: vi.fn().mockResolvedValue([
        {
          id: 1,
          name: 'Assignment 1',
          due_at: '2026-08-01T23:59:00Z',
          points_possible: 10,
          grading_type: 'points',
          submission_types: ['online_text_entry'],
          course_id: 10,
          allowed_attempts: -1,
        },
        {
          id: 2,
          name: 'Assignment 2',
          due_at: null,
          points_possible: 20,
          grading_type: 'points',
          submission_types: ['online_upload'],
          course_id: 10,
          allowed_attempts: -1,
        },
      ]),
      listOverrides: vi.fn().mockResolvedValue([
        {
          id: 5,
          assignment_id: 1,
          title: 'Existing Override',
          student_ids: [42],
          due_at: '2026-09-10T23:59:00Z',
        },
      ]),
      createOverride: vi.fn().mockResolvedValue({
        id: 99,
        assignment_id: 1,
        title: 'Student accommodation',
        student_ids: [42],
        due_at: '2026-09-15T23:59:00Z',
      }),
    },
  } as unknown as CanvasClient
}

const tool = (canvas: CanvasClient, name: string) =>
  assignmentOverrideTools(canvas).find((t) => t.name === name)!

type FanOutResult = {
  applied: Array<Record<string, unknown>>
  skipped: Array<Record<string, unknown>>
  failed: Array<Record<string, unknown>>
  not_found: number[]
  summary: Record<string, number>
}

describe('assignmentOverrideTools', () => {
  it('returns exactly 3 tool definitions', () => {
    expect(assignmentOverrideTools(buildMockCanvas())).toHaveLength(3)
  })

  it('exports tools with correct names in order', () => {
    const names = assignmentOverrideTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'list_assignment_overrides',
      'create_assignment_override',
      'set_student_assignment_dates',
    ])
  })

  describe('list_assignment_overrides', () => {
    it('has readOnlyHint + openWorldHint', () => {
      expect(tool(buildMockCanvas(), 'list_assignment_overrides').annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: true,
      })
    })

    it('returns the overrides for an assignment', async () => {
      const canvas = buildMockCanvas()
      const result = await tool(canvas, 'list_assignment_overrides').handler({
        course_id: 10,
        assignment_id: 1,
      })
      const listOverrides = canvas.assignments.listOverrides as ReturnType<typeof vi.fn>
      expect(listOverrides).toHaveBeenCalledWith(10, 1)
      expect(result).toEqual([
        {
          id: 5,
          assignment_id: 1,
          title: 'Existing Override',
          student_ids: [42],
          due_at: '2026-09-10T23:59:00Z',
        },
      ])
    })

    it('returns an empty array when the assignment has no overrides', async () => {
      const canvas = buildMockCanvas()
      ;(canvas.assignments.listOverrides as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])
      const result = await tool(canvas, 'list_assignment_overrides').handler({
        course_id: 10,
        assignment_id: 1,
      })
      expect(result).toEqual([])
    })
  })

  describe('create_assignment_override', () => {
    it('has destructiveHint + openWorldHint', () => {
      expect(tool(buildMockCanvas(), 'create_assignment_override').annotations).toEqual({
        destructiveHint: true,
        openWorldHint: true,
      })
    })

    it('creates an override targeting student_ids without an unset title', async () => {
      const canvas = buildMockCanvas()
      const result = await tool(canvas, 'create_assignment_override').handler({
        course_id: 10,
        assignment_id: 1,
        student_ids: [42],
        due_at: '2026-09-15T23:59:00Z',
      })
      const createOverride = canvas.assignments.createOverride as ReturnType<typeof vi.fn>
      expect(createOverride).toHaveBeenCalledWith(
        10,
        1,
        expect.objectContaining({ student_ids: [42], due_at: '2026-09-15T23:59:00Z' }),
      )
      // The handler only includes fields with non-undefined values, so an
      // unprovided title must NOT appear in the params object.
      const passedParams = createOverride.mock.calls[0][2] as Record<string, unknown>
      expect('title' in passedParams).toBe(false)
      expect(result).toEqual({
        id: 99,
        assignment_id: 1,
        title: 'Student accommodation',
        student_ids: [42],
        due_at: '2026-09-15T23:59:00Z',
      })
    })

    it('creates an override targeting course_section_id', async () => {
      const canvas = buildMockCanvas()
      await tool(canvas, 'create_assignment_override').handler({
        course_id: 10,
        assignment_id: 1,
        course_section_id: 5,
        due_at: '2026-09-15T23:59:00Z',
      })
      const createOverride = canvas.assignments.createOverride as ReturnType<typeof vi.fn>
      const passedParams = createOverride.mock.calls[0][2] as Record<string, unknown>
      expect(passedParams).toMatchObject({ course_section_id: 5 })
      expect('student_ids' in passedParams).toBe(false)
      expect('group_id' in passedParams).toBe(false)
    })

    it('creates an override targeting group_id', async () => {
      const canvas = buildMockCanvas()
      await tool(canvas, 'create_assignment_override').handler({
        course_id: 10,
        assignment_id: 1,
        group_id: 7,
        due_at: '2026-09-15T23:59:00Z',
      })
      const createOverride = canvas.assignments.createOverride as ReturnType<typeof vi.fn>
      const passedParams = createOverride.mock.calls[0][2] as Record<string, unknown>
      expect(passedParams).toMatchObject({ group_id: 7 })
      expect('student_ids' in passedParams).toBe(false)
      expect('course_section_id' in passedParams).toBe(false)
    })

    it('throws when no target is provided', async () => {
      const canvas = buildMockCanvas()
      await expect(
        tool(canvas, 'create_assignment_override').handler({
          course_id: 10,
          assignment_id: 1,
          due_at: '2026-09-15T23:59:00Z',
        }),
      ).rejects.toThrow(/exactly one of/)
    })

    it('throws when multiple targets are provided', async () => {
      const canvas = buildMockCanvas()
      await expect(
        tool(canvas, 'create_assignment_override').handler({
          course_id: 10,
          assignment_id: 1,
          student_ids: [42],
          course_section_id: 5,
          due_at: '2026-09-15T23:59:00Z',
        }),
      ).rejects.toThrow(/mutually exclusive/)
    })

    it('passes a null due_at through to remove the due date', async () => {
      const canvas = buildMockCanvas()
      await tool(canvas, 'create_assignment_override').handler({
        course_id: 10,
        assignment_id: 1,
        student_ids: [42],
        due_at: null,
      })
      const createOverride = canvas.assignments.createOverride as ReturnType<typeof vi.fn>
      const passedParams = createOverride.mock.calls[0][2] as Record<string, unknown>
      expect(passedParams).toMatchObject({ due_at: null })
    })
  })

  describe('set_student_assignment_dates', () => {
    it('has destructiveHint + openWorldHint', () => {
      expect(tool(buildMockCanvas(), 'set_student_assignment_dates').annotations).toEqual({
        destructiveHint: true,
        openWorldHint: true,
      })
    })

    it('fans the override across every assignment in the course', async () => {
      const canvas = buildMockCanvas()
      const result = (await tool(canvas, 'set_student_assignment_dates').handler({
        course_id: 10,
        user_id: 42,
        due_at: '2026-09-15T23:59:00Z',
      })) as FanOutResult

      const list = canvas.assignments.list as ReturnType<typeof vi.fn>
      const createOverride = canvas.assignments.createOverride as ReturnType<typeof vi.fn>
      expect(list).toHaveBeenCalledWith(10)
      expect(createOverride).toHaveBeenCalledTimes(2)
      expect(createOverride).toHaveBeenNthCalledWith(
        1,
        10,
        1,
        expect.objectContaining({
          student_ids: [42],
          due_at: '2026-09-15T23:59:00Z',
          title: 'Student accommodation',
        }),
      )
      expect(result.applied).toHaveLength(2)
      expect(result.failed).toHaveLength(0)
      expect(result.skipped).toHaveLength(0)
      expect(result.applied[0].assignment_id).toBe(1)
      expect(result.applied[0].override_id).toBe(99)
      // No student identifier may leak into the output entries.
      expect('user_id' in result.applied[0]).toBe(false)
    })

    it('limits the fan-out to assignment_ids when provided', async () => {
      const canvas = buildMockCanvas()
      const result = (await tool(canvas, 'set_student_assignment_dates').handler({
        course_id: 10,
        user_id: 42,
        assignment_ids: [1],
        due_at: '2026-09-15T23:59:00Z',
      })) as FanOutResult

      const createOverride = canvas.assignments.createOverride as ReturnType<typeof vi.fn>
      expect(createOverride).toHaveBeenCalledTimes(1)
      expect(result.summary.total_assignments).toBe(1)
    })

    it('uses a custom title when provided', async () => {
      const canvas = buildMockCanvas()
      await tool(canvas, 'set_student_assignment_dates').handler({
        course_id: 10,
        user_id: 42,
        due_at: '2026-09-15T23:59:00Z',
        title: 'Excused absence makeup',
      })
      const createOverride = canvas.assignments.createOverride as ReturnType<typeof vi.fn>
      expect(createOverride).toHaveBeenNthCalledWith(
        1,
        10,
        1,
        expect.objectContaining({ title: 'Excused absence makeup' }),
      )
    })

    it('records partial failures without aborting the fan-out', async () => {
      const canvas = buildMockCanvas()
      const createOverride = canvas.assignments.createOverride as ReturnType<typeof vi.fn>
      createOverride
        .mockResolvedValueOnce({ id: 99, assignment_id: 1, title: 'x', student_ids: [42] })
        .mockRejectedValueOnce(
          new CanvasApiError(
            'Unprocessable Entity',
            422,
            '/api/v1/courses/10/assignments/2/overrides',
          ),
        )
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = (await tool(canvas, 'set_student_assignment_dates').handler({
        course_id: 10,
        user_id: 42,
        due_at: '2026-09-15T23:59:00Z',
      })) as FanOutResult

      expect(result.applied).toHaveLength(1)
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].assignment_id).toBe(2)
      expect(result.failed[0].error).toBe('Unprocessable Entity')
      expect(result.applied[0].applied).toBe(true)
      // A routine CanvasApiError (e.g. an expected 422 duplicate) is recorded
      // quietly — it must NOT be logged, unlike the non-Canvas branch.
      expect(errorSpy).not.toHaveBeenCalled()
      // No student identifier may leak into failed[] entries either.
      expect('user_id' in result.failed[0]).toBe(false)
      expect('student_ids' in result.failed[0]).toBe(false)
      errorSpy.mockRestore()
    })

    it('logs and records non-Canvas errors without aborting the fan-out', async () => {
      const canvas = buildMockCanvas()
      const createOverride = canvas.assignments.createOverride as ReturnType<typeof vi.fn>
      createOverride
        .mockResolvedValueOnce({ id: 99, assignment_id: 1, title: 'x', student_ids: [42] })
        .mockRejectedValueOnce(new Error('boom'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = (await tool(canvas, 'set_student_assignment_dates').handler({
        course_id: 10,
        user_id: 42,
        due_at: '2026-09-15T23:59:00Z',
      })) as FanOutResult

      // The non-CanvasApiError branch logs (so a programming bug is not silently
      // swallowed) and still records the message on the failed entry.
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(result.applied).toHaveLength(1)
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].assignment_id).toBe(2)
      expect(result.failed[0].error).toBe('boom')
      errorSpy.mockRestore()
    })

    it('reports requested assignment_ids absent from the course in not_found', async () => {
      const canvas = buildMockCanvas()
      const result = (await tool(canvas, 'set_student_assignment_dates').handler({
        course_id: 10,
        user_id: 42,
        assignment_ids: [1, 999],
        due_at: '2026-09-15T23:59:00Z',
      })) as FanOutResult

      const createOverride = canvas.assignments.createOverride as ReturnType<typeof vi.fn>
      // Only the existing assignment (1) is fanned to; 999 is neither applied nor failed.
      expect(createOverride).toHaveBeenCalledTimes(1)
      expect(result.summary.total_assignments).toBe(1)
      expect(result.failed).toEqual([])
      expect(result.not_found).toEqual([999])
      expect(result.summary.not_found).toBe(1)
    })

    it('applies to nothing when every requested assignment_id is absent', async () => {
      const canvas = buildMockCanvas()
      const result = (await tool(canvas, 'set_student_assignment_dates').handler({
        course_id: 10,
        user_id: 42,
        assignment_ids: [999],
        due_at: '2026-09-15T23:59:00Z',
      })) as FanOutResult

      const createOverride = canvas.assignments.createOverride as ReturnType<typeof vi.fn>
      // Nothing matches: no write is attempted, but the caller is told via not_found
      // rather than silently believing a real fan-out occurred.
      expect(createOverride).not.toHaveBeenCalled()
      expect(result.summary.total_assignments).toBe(0)
      expect(result.applied).toEqual([])
      expect(result.failed).toEqual([])
      expect(result.not_found).toEqual([999])
    })

    it('rejects an explicit empty assignment_ids array at the schema boundary', () => {
      const def = tool(buildMockCanvas(), 'set_student_assignment_dates')
      const parsed = z.object(def.inputSchema).safeParse({
        course_id: 10,
        user_id: 42,
        assignment_ids: [],
        due_at: '2026-09-15T23:59:00Z',
      })
      // An empty array must not silently mean "target all" — it is rejected so a
      // caller scoping to zero assignments cannot accidentally fan across the course.
      expect(parsed.success).toBe(false)
    })

    it('handles an empty course', async () => {
      const canvas = buildMockCanvas()
      ;(canvas.assignments.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])
      const result = (await tool(canvas, 'set_student_assignment_dates').handler({
        course_id: 10,
        user_id: 42,
        due_at: '2026-09-15T23:59:00Z',
      })) as FanOutResult

      expect(result.summary.total_assignments).toBe(0)
      expect(result.applied).toEqual([])
      expect(result.failed).toEqual([])
    })

    it('throws when no date is provided', async () => {
      const canvas = buildMockCanvas()
      await expect(
        tool(canvas, 'set_student_assignment_dates').handler({
          course_id: 10,
          user_id: 42,
        }),
      ).rejects.toThrow(/at least one/)
    })

    it('supports unlock_at and lock_at without a due_at', async () => {
      const canvas = buildMockCanvas()
      await tool(canvas, 'set_student_assignment_dates').handler({
        course_id: 10,
        user_id: 42,
        unlock_at: '2026-09-01T00:00:00Z',
        lock_at: '2026-09-20T23:59:00Z',
      })
      const createOverride = canvas.assignments.createOverride as ReturnType<typeof vi.fn>
      const passedParams = createOverride.mock.calls[0][2] as Record<string, unknown>
      expect(passedParams).toMatchObject({
        unlock_at: '2026-09-01T00:00:00Z',
        lock_at: '2026-09-20T23:59:00Z',
      })
      expect('due_at' in passedParams).toBe(false)
    })
  })
})
