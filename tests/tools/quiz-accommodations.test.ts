import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { CanvasApiError } from '../../src/canvas/client'
import { quizAccommodationTools } from '../../src/tools/quiz-accommodations'

const QUIZZES = [
  {
    id: 1,
    title: 'Classic Quiz 1',
    quiz_type: 'assignment',
    time_limit: 60,
    published: true,
    points_possible: 10,
    question_count: 5,
    due_at: null,
  },
  {
    id: 2,
    title: 'Classic Quiz 2',
    quiz_type: 'practice_quiz',
    time_limit: null,
    published: true,
    points_possible: 0,
    question_count: 3,
    due_at: null,
  },
  {
    id: 3,
    title: 'New Quiz',
    quiz_type: 'quizzes.next',
    time_limit: null,
    published: true,
    points_possible: 10,
    question_count: 4,
    due_at: null,
  },
]

function buildMockCanvas(): CanvasClient {
  return {
    quizzes: {
      list: vi.fn().mockResolvedValue(QUIZZES),
      setExtension: vi.fn().mockResolvedValue([{ user_id: 42, extra_time: 20, extra_attempts: 1 }]),
      listExtensions: vi
        .fn()
        .mockResolvedValue([{ user_id: 42, extra_time: 20, extra_attempts: 1 }]),
    },
  } as unknown as CanvasClient
}

const tool = (canvas: CanvasClient, name: string) =>
  quizAccommodationTools(canvas).find((t) => t.name === name)!

// Both tools return { results: [...], summary: {...} }; the per-entry shape
// differs, so model each entry as an opaque record for assertion access.
type HandlerResult = {
  results: Array<Record<string, unknown>>
  summary: Record<string, number>
}

describe('quizAccommodationTools', () => {
  it('returns exactly 2 tool definitions', () => {
    expect(quizAccommodationTools(buildMockCanvas())).toHaveLength(2)
  })

  it('exports tools with correct names in order', () => {
    const names = quizAccommodationTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual(['set_student_quiz_accommodation', 'list_student_quiz_accommodations'])
  })

  describe('set_student_quiz_accommodation', () => {
    it('has destructiveHint + openWorldHint', () => {
      expect(tool(buildMockCanvas(), 'set_student_quiz_accommodation').annotations).toEqual({
        destructiveHint: true,
        openWorldHint: true,
      })
    })

    it('applies extra_time_minutes to Classic Quizzes and skips New Quizzes', async () => {
      const canvas = buildMockCanvas()
      const result = (await tool(canvas, 'set_student_quiz_accommodation').handler({
        course_id: 10,
        user_id: 42,
        extra_time_minutes: 20,
      })) as HandlerResult

      const setExtension = canvas.quizzes.setExtension as ReturnType<typeof vi.fn>
      expect(setExtension).toHaveBeenCalledWith(10, 1, 42, 20, undefined)
      expect(setExtension).toHaveBeenCalledWith(10, 2, 42, 20, undefined)
      expect(setExtension).not.toHaveBeenCalledWith(10, 3, 42, expect.anything(), expect.anything())
      expect(result.summary).toEqual({
        total_quizzes: 3,
        applied: 2,
        skipped: 1,
        failed: 0,
      })
      expect(result.results[2].skip_reason).toBe('new_quiz_not_supported')
    })

    it('computes extra time from time_multiplier when the quiz has a time limit', async () => {
      const canvas = buildMockCanvas()
      await tool(canvas, 'set_student_quiz_accommodation').handler({
        course_id: 10,
        user_id: 42,
        time_multiplier: 1.5,
      })
      const setExtension = canvas.quizzes.setExtension as ReturnType<typeof vi.fn>
      // 60 * (1.5 - 1) = 30 minutes for quiz id 1.
      expect(setExtension).toHaveBeenCalledWith(10, 1, 42, 30, undefined)
    })

    it('skips a quiz with no time limit when only time_multiplier is given', async () => {
      const canvas = buildMockCanvas()
      const result = (await tool(canvas, 'set_student_quiz_accommodation').handler({
        course_id: 10,
        user_id: 42,
        time_multiplier: 1.5,
      })) as HandlerResult
      const setExtension = canvas.quizzes.setExtension as ReturnType<typeof vi.fn>
      // Quiz id 2 has time_limit: null — no extra_time can be computed and no
      // extra_attempts provided, so it is skipped without a Canvas call.
      expect(setExtension).not.toHaveBeenCalledWith(10, 2, 42, expect.anything(), expect.anything())
      expect(result.results[1].applied).toBe(false)
      expect(result.results[1].skip_reason).toBe('no_time_limit_for_multiplier')
    })

    it('restricts the fan-out to quiz_ids when provided', async () => {
      const canvas = buildMockCanvas()
      const result = (await tool(canvas, 'set_student_quiz_accommodation').handler({
        course_id: 10,
        user_id: 42,
        extra_time_minutes: 20,
        quiz_ids: [1],
      })) as HandlerResult
      const setExtension = canvas.quizzes.setExtension as ReturnType<typeof vi.fn>
      expect(setExtension).toHaveBeenCalledTimes(1)
      expect(setExtension).toHaveBeenCalledWith(10, 1, 42, 20, undefined)
      expect(result.summary.total_quizzes).toBe(1)
    })

    it('records a per-quiz error without aborting the fan-out', async () => {
      const canvas = buildMockCanvas()
      const setExtension = canvas.quizzes.setExtension as ReturnType<typeof vi.fn>
      setExtension
        .mockResolvedValueOnce([{ user_id: 42, extra_time: 20, extra_attempts: null }])
        .mockRejectedValueOnce(new CanvasApiError('Forbidden', 403, '/extensions'))
      const result = (await tool(canvas, 'set_student_quiz_accommodation').handler({
        course_id: 10,
        user_id: 42,
        extra_time_minutes: 20,
      })) as HandlerResult
      expect(result.results[0].applied).toBe(true)
      expect(result.results[1].applied).toBe(false)
      expect(result.results[1].error).toBe('Forbidden')
      expect(result.summary.applied).toBe(1)
      expect(result.summary.failed).toBe(1)
    })

    it('handles an empty course', async () => {
      const canvas = buildMockCanvas()
      ;(canvas.quizzes.list as ReturnType<typeof vi.fn>).mockResolvedValue([])
      const result = (await tool(canvas, 'set_student_quiz_accommodation').handler({
        course_id: 10,
        user_id: 42,
        extra_time_minutes: 20,
      })) as HandlerResult
      expect(result.results).toEqual([])
      expect(result.summary.total_quizzes).toBe(0)
    })

    it('rejects providing both extra_time_minutes and time_multiplier', async () => {
      await expect(
        tool(buildMockCanvas(), 'set_student_quiz_accommodation').handler({
          course_id: 10,
          user_id: 42,
          extra_time_minutes: 20,
          time_multiplier: 1.5,
        }),
      ).rejects.toThrow('not both')
    })

    it('rejects when no accommodation field is provided', async () => {
      await expect(
        tool(buildMockCanvas(), 'set_student_quiz_accommodation').handler({
          course_id: 10,
          user_id: 42,
        }),
      ).rejects.toThrow('at least one')
    })
  })

  describe('list_student_quiz_accommodations', () => {
    it('has readOnlyHint + openWorldHint', () => {
      expect(tool(buildMockCanvas(), 'list_student_quiz_accommodations').annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: true,
      })
    })

    it('reports the student accommodation for each Classic Quiz, excluding New Quizzes', async () => {
      const canvas = buildMockCanvas()
      const result = (await tool(canvas, 'list_student_quiz_accommodations').handler({
        course_id: 10,
        user_id: 42,
      })) as HandlerResult
      const listExtensions = canvas.quizzes.listExtensions as ReturnType<typeof vi.fn>
      expect(listExtensions).toHaveBeenCalledWith(10, 1)
      expect(listExtensions).toHaveBeenCalledWith(10, 2)
      expect(listExtensions).not.toHaveBeenCalledWith(10, 3)
      expect(result.results[0].has_accommodation).toBe(true)
      expect(result.results[0].extra_time_minutes).toBe(20)
      // Output must not echo the student identifier.
      expect('user_id' in result.results[0]).toBe(false)
      expect(result.summary.with_accommodation).toBe(2)
      expect(result.summary.without_accommodation).toBe(0)
    })

    it('reports no accommodation when the student has none', async () => {
      const canvas = buildMockCanvas()
      ;(canvas.quizzes.listExtensions as ReturnType<typeof vi.fn>).mockResolvedValue([])
      const result = (await tool(canvas, 'list_student_quiz_accommodations').handler({
        course_id: 10,
        user_id: 42,
      })) as HandlerResult
      expect(result.results[0].has_accommodation).toBe(false)
      expect(result.summary.with_accommodation).toBe(0)
    })

    it('ignores a different student present on the quiz', async () => {
      const canvas = buildMockCanvas()
      ;(canvas.quizzes.listExtensions as ReturnType<typeof vi.fn>).mockResolvedValue([
        { user_id: 99, extra_time: 30, extra_attempts: null },
      ])
      const result = (await tool(canvas, 'list_student_quiz_accommodations').handler({
        course_id: 10,
        user_id: 42,
      })) as HandlerResult
      expect(result.results[0].has_accommodation).toBe(false)
      expect(result.results[0].extra_time_minutes).toBeNull()
    })

    it('propagates a GET error (no per-quiz catching)', async () => {
      const canvas = buildMockCanvas()
      ;(canvas.quizzes.listExtensions as ReturnType<typeof vi.fn>).mockRejectedValue(
        new CanvasApiError('Not Found', 404, '/extensions'),
      )
      await expect(
        tool(canvas, 'list_student_quiz_accommodations').handler({
          course_id: 10,
          user_id: 42,
        }),
      ).rejects.toBeInstanceOf(CanvasApiError)
    })
  })
})
