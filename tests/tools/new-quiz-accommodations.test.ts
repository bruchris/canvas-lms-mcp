import { describe, it, expect, vi, beforeEach } from 'vitest'
import { newQuizAccommodationTools } from '../../src/tools/new-quiz-accommodations'
import { CanvasApiError } from '../../src/canvas/client'
import type { CanvasClient } from '../../src/canvas'

function buildMockCanvas() {
  return {
    newQuizzes: {
      setAccommodation: vi
        .fn()
        .mockResolvedValue({ user_id: 42, time_multiplier: 1.5, extra_attempts: 1 }),
      setQuizAccommodation: vi
        .fn()
        .mockResolvedValue({ user_id: 42, time_multiplier: 1.5, extra_attempts: 1 }),
      getAccommodation: vi
        .fn()
        .mockResolvedValue({ user_id: 42, time_multiplier: 1.5, extra_attempts: 1 }),
    },
  } as unknown as CanvasClient
}

describe('newQuizAccommodationTools', () => {
  let canvas: ReturnType<typeof buildMockCanvas>

  beforeEach(() => {
    canvas = buildMockCanvas()
  })

  it('returns exactly 2 tool definitions', () => {
    const tools = newQuizAccommodationTools(canvas)
    expect(tools).toHaveLength(2)
  })

  it('tool names are correct', () => {
    const tools = newQuizAccommodationTools(canvas)
    expect(tools.map((t) => t.name)).toEqual([
      'set_student_new_quiz_accommodation',
      'list_student_new_quiz_accommodations',
    ])
  })

  describe('set_student_new_quiz_accommodation', () => {
    function getTool(c: CanvasClient) {
      return newQuizAccommodationTools(c)[0]!
    }

    it('has destructiveHint and openWorldHint annotations', () => {
      const tool = getTool(canvas)
      expect(tool.annotations.destructiveHint).toBe(true)
      expect(tool.annotations.openWorldHint).toBe(true)
    })

    it('course-level: calls setAccommodation and returns course scope', async () => {
      const tool = getTool(canvas)
      const result = (await tool.handler({
        course_id: 10,
        user_id: 42,
        time_multiplier: 1.5,
      })) as {
        scope: string
        applied: Array<{ assignment_id: number | null; time_multiplier: number | null }>
        failed: unknown[]
        summary: { applied: number; failed: number }
      }

      expect(canvas.newQuizzes.setAccommodation).toHaveBeenCalledWith(10, 42, 1.5, undefined)
      expect(canvas.newQuizzes.setQuizAccommodation).not.toHaveBeenCalled()
      expect(result.scope).toBe('course')
      expect(result.applied[0]!.assignment_id).toBeNull()
      expect(result.applied[0]!.time_multiplier).toBe(1.5)
      expect(result.summary.applied).toBe(1)
      expect(result.summary.failed).toBe(0)
    })

    it('course-level: extra_attempts only', async () => {
      const tool = getTool(canvas)
      await tool.handler({ course_id: 10, user_id: 42, extra_attempts: 2 })
      expect(canvas.newQuizzes.setAccommodation).toHaveBeenCalledWith(10, 42, undefined, 2)
    })

    it('per-quiz: fans out to setQuizAccommodation for each assignment_id', async () => {
      const tool = getTool(canvas)
      const result = (await tool.handler({
        course_id: 10,
        user_id: 42,
        time_multiplier: 1.5,
        assignment_ids: [101, 102],
      })) as {
        scope: string
        applied: Array<{ assignment_id: number | null }>
        failed: unknown[]
        summary: { applied: number; failed: number }
      }

      expect(canvas.newQuizzes.setQuizAccommodation).toHaveBeenCalledTimes(2)
      expect(canvas.newQuizzes.setQuizAccommodation).toHaveBeenNthCalledWith(
        1,
        10,
        101,
        42,
        1.5,
        undefined,
      )
      expect(canvas.newQuizzes.setQuizAccommodation).toHaveBeenNthCalledWith(
        2,
        10,
        102,
        42,
        1.5,
        undefined,
      )
      expect(canvas.newQuizzes.setAccommodation).not.toHaveBeenCalled()
      expect(result.scope).toBe('per_quiz')
      expect(result.applied).toHaveLength(2)
      expect(result.applied[0]!.assignment_id).toBe(101)
      expect(result.applied[1]!.assignment_id).toBe(102)
      expect(result.summary.applied).toBe(2)
      expect(result.summary.failed).toBe(0)
    })

    it('per-quiz partial failure: captures error and continues', async () => {
      const tool = getTool(canvas)
      canvas.newQuizzes.setQuizAccommodation
        .mockResolvedValueOnce({ user_id: 42, time_multiplier: 1.5, extra_attempts: 1 })
        .mockRejectedValueOnce(new CanvasApiError('Not Found', 404, '/api/quiz/v1/...'))

      const result = (await tool.handler({
        course_id: 10,
        user_id: 42,
        time_multiplier: 1.5,
        assignment_ids: [101, 102],
      })) as {
        applied: Array<{ assignment_id: number | null }>
        failed: Array<{ assignment_id: number | null; error?: string }>
        summary: { applied: number; failed: number }
      }

      expect(result.applied).toHaveLength(1)
      expect(result.applied[0]!.assignment_id).toBe(101)
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0]!.assignment_id).toBe(102)
      expect(result.failed[0]!.error).toContain('Not Found')
      expect(result.summary.applied).toBe(1)
      expect(result.summary.failed).toBe(1)
    })

    it('throws when neither time_multiplier nor extra_attempts provided', async () => {
      const tool = getTool(canvas)
      await expect(tool.handler({ course_id: 10, user_id: 42 })).rejects.toThrow('at least one')
    })

    it('empty assignment_ids treated as course-level', async () => {
      const tool = getTool(canvas)
      await tool.handler({ course_id: 10, user_id: 42, time_multiplier: 1.5, assignment_ids: [] })
      expect(canvas.newQuizzes.setAccommodation).toHaveBeenCalled()
      expect(canvas.newQuizzes.setQuizAccommodation).not.toHaveBeenCalled()
    })

    it('user_id is not echoed in applied output', async () => {
      const tool = getTool(canvas)
      const result = (await tool.handler({
        course_id: 10,
        user_id: 42,
        time_multiplier: 1.5,
      })) as { applied: Array<Record<string, unknown>> }
      expect('user_id' in result.applied[0]!).toBe(false)
    })
  })

  describe('list_student_new_quiz_accommodations', () => {
    function getTool(c: CanvasClient) {
      return newQuizAccommodationTools(c)[1]!
    }

    it('has readOnlyHint and openWorldHint annotations', () => {
      const tool = getTool(canvas)
      expect(tool.annotations.readOnlyHint).toBe(true)
      expect(tool.annotations.openWorldHint).toBe(true)
    })

    it('returns accommodation when record exists', async () => {
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: 10, user_id: 42 })) as {
        has_accommodation: boolean
        time_multiplier: number | null
        extra_attempts: number | null
      }

      expect(canvas.newQuizzes.getAccommodation).toHaveBeenCalledWith(10, 42)
      expect(result.has_accommodation).toBe(true)
      expect(result.time_multiplier).toBe(1.5)
      expect(result.extra_attempts).toBe(1)
      expect('user_id' in result).toBe(false)
    })

    it('returns has_accommodation: false when no record (null from client)', async () => {
      canvas.newQuizzes.getAccommodation.mockResolvedValueOnce(null)
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: 10, user_id: 42 })) as {
        has_accommodation: boolean
        time_multiplier: number | null
        extra_attempts: number | null
      }
      expect(result).toEqual({
        has_accommodation: false,
        time_multiplier: null,
        extra_attempts: null,
      })
    })

    it('propagates non-404 errors', async () => {
      canvas.newQuizzes.getAccommodation.mockRejectedValueOnce(
        new CanvasApiError('Forbidden', 403, '/api/quiz/v1/...'),
      )
      const tool = getTool(canvas)
      await expect(tool.handler({ course_id: 10, user_id: 42 })).rejects.toThrow('Forbidden')
    })
  })
})
