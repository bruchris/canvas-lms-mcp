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
      // The read tool audits accommodations via quiz submissions, not a
      // (non-existent) GET extensions endpoint.
      listSubmissions: vi
        .fn()
        .mockResolvedValue([{ id: 5, quiz_id: 1, user_id: 42, extra_time: 20, extra_attempts: 1 }]),
    },
  } as unknown as CanvasClient
}

const tool = (canvas: CanvasClient, name: string) =>
  quizAccommodationTools(canvas).find((t) => t.name === name)!

// The read tool (list_student_quiz_accommodations) returns { results, summary };
// the per-entry shape varies, so model each entry as an opaque record.
type HandlerResult = {
  results: Array<Record<string, unknown>>
  summary: Record<string, number>
}

// The write fan-out (set_student_quiz_accommodation) returns the canonical
// separated-arrays envelope shared with set_student_assignment_dates.
type FanOutResult = {
  applied: Array<Record<string, unknown>>
  skipped: Array<Record<string, unknown>>
  failed: Array<Record<string, unknown>>
  not_found: number[]
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
      })) as FanOutResult

      const setExtension = canvas.quizzes.setExtension as ReturnType<typeof vi.fn>
      expect(setExtension).toHaveBeenCalledWith(10, 1, 42, 20, undefined)
      expect(setExtension).toHaveBeenCalledWith(10, 2, 42, 20, undefined)
      expect(setExtension).not.toHaveBeenCalledWith(10, 3, 42, expect.anything(), expect.anything())
      expect(result.summary).toEqual({
        total: 3,
        applied: 2,
        skipped: 1,
        failed: 0,
        not_found: 0,
      })
      // The applied entry reports exactly what was requested (the user-visible contract).
      expect(result.applied[0].quiz_id).toBe(1)
      expect(result.applied[0].extra_time_minutes).toBe(20)
      expect(result.applied[0].extra_attempts).toBeNull()
      // The New Quiz lands in skipped[] with its reason.
      expect(result.skipped[0].quiz_id).toBe(3)
      expect(result.skipped[0].skip_reason).toBe('new_quiz_not_supported')
    })

    it('computes extra time from time_multiplier when the quiz has a time limit', async () => {
      const canvas = buildMockCanvas()
      const result = (await tool(canvas, 'set_student_quiz_accommodation').handler({
        course_id: 10,
        user_id: 42,
        time_multiplier: 1.5,
      })) as FanOutResult
      const setExtension = canvas.quizzes.setExtension as ReturnType<typeof vi.fn>
      // 60 * (1.5 - 1) = 30 minutes for quiz id 1.
      expect(setExtension).toHaveBeenCalledWith(10, 1, 42, 30, undefined)
      expect(result.applied[0].extra_time_minutes).toBe(30)
    })

    it('applies extra_attempts only (no extra time) across Classic Quizzes', async () => {
      const canvas = buildMockCanvas()
      const result = (await tool(canvas, 'set_student_quiz_accommodation').handler({
        course_id: 10,
        user_id: 42,
        extra_attempts: 2,
      })) as FanOutResult
      const setExtension = canvas.quizzes.setExtension as ReturnType<typeof vi.fn>
      // extra_time is undefined for every quiz; only extra_attempts is sent.
      expect(setExtension).toHaveBeenCalledWith(10, 1, 42, undefined, 2)
      expect(setExtension).toHaveBeenCalledWith(10, 2, 42, undefined, 2)
      expect(result.applied[0].extra_time_minutes).toBeNull()
      expect(result.applied[0].extra_attempts).toBe(2)
      expect(result.summary.applied).toBe(2)
    })

    it('applies extra_attempts on an untimed quiz when time_multiplier has nothing to multiply', async () => {
      // Spec §3: with time_multiplier + extra_attempts, a quiz with no time limit
      // still gets the attempts; extra_time is simply omitted (reported as null).
      const canvas = buildMockCanvas()
      const result = (await tool(canvas, 'set_student_quiz_accommodation').handler({
        course_id: 10,
        user_id: 42,
        time_multiplier: 1.5,
        extra_attempts: 1,
      })) as FanOutResult
      const setExtension = canvas.quizzes.setExtension as ReturnType<typeof vi.fn>
      // Timed quiz (id 1): computed extra time + attempts.
      expect(setExtension).toHaveBeenCalledWith(10, 1, 42, 30, 1)
      // Untimed quiz (id 2): no extra time, attempts still applied — not skipped.
      expect(setExtension).toHaveBeenCalledWith(10, 2, 42, undefined, 1)
      // The untimed quiz (id 2) is applied, not skipped.
      const quiz2 = result.applied.find((r) => r.quiz_id === 2)!
      expect(quiz2.skip_reason).toBeUndefined()
      expect(quiz2.extra_time_minutes).toBeNull()
      expect(quiz2.extra_attempts).toBe(1)
    })

    it('clamps a sub-minute computed extra time up to 1 minute', async () => {
      // 1-minute quiz × 1.01 → round(0.01) = 0, clamped to 1 (Canvas rejects 0).
      const canvas = buildMockCanvas()
      ;(canvas.quizzes.list as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 1,
          title: 'One-minute quiz',
          quiz_type: 'assignment',
          time_limit: 1,
          published: true,
          points_possible: 1,
          question_count: 1,
          due_at: null,
        },
      ])
      await tool(canvas, 'set_student_quiz_accommodation').handler({
        course_id: 10,
        user_id: 42,
        time_multiplier: 1.01,
      })
      const setExtension = canvas.quizzes.setExtension as ReturnType<typeof vi.fn>
      expect(setExtension).toHaveBeenCalledWith(10, 1, 42, 1, undefined)
    })

    it('treats a zero time_limit like an untimed quiz for time_multiplier', async () => {
      const canvas = buildMockCanvas()
      ;(canvas.quizzes.list as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 1,
          title: 'Zero-limit quiz',
          quiz_type: 'assignment',
          time_limit: 0,
          published: true,
          points_possible: 1,
          question_count: 1,
          due_at: null,
        },
      ])
      const result = (await tool(canvas, 'set_student_quiz_accommodation').handler({
        course_id: 10,
        user_id: 42,
        time_multiplier: 1.5,
      })) as FanOutResult
      const setExtension = canvas.quizzes.setExtension as ReturnType<typeof vi.fn>
      expect(setExtension).not.toHaveBeenCalled()
      expect(result.skipped[0].quiz_id).toBe(1)
      expect(result.skipped[0].skip_reason).toBe('no_time_limit_for_multiplier')
    })

    it('logs and surfaces the real message for an unexpected (non-Canvas) error', async () => {
      const canvas = buildMockCanvas()
      const setExtension = canvas.quizzes.setExtension as ReturnType<typeof vi.fn>
      setExtension.mockRejectedValue(new TypeError('boom'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = (await tool(canvas, 'set_student_quiz_accommodation').handler({
        course_id: 10,
        user_id: 42,
        extra_time_minutes: 20,
      })) as FanOutResult
      // The fan-out continues and records the actual error message, not a constant.
      expect(result.failed[0].error).toBe('boom')
      expect(result.summary.failed).toBe(2)
      expect(errorSpy).toHaveBeenCalled()
      errorSpy.mockRestore()
    })

    it('skips a quiz with no time limit when only time_multiplier is given', async () => {
      const canvas = buildMockCanvas()
      const result = (await tool(canvas, 'set_student_quiz_accommodation').handler({
        course_id: 10,
        user_id: 42,
        time_multiplier: 1.5,
      })) as FanOutResult
      const setExtension = canvas.quizzes.setExtension as ReturnType<typeof vi.fn>
      // Quiz id 2 has time_limit: null — no extra_time can be computed and no
      // extra_attempts provided, so it is skipped without a Canvas call.
      expect(setExtension).not.toHaveBeenCalledWith(10, 2, 42, expect.anything(), expect.anything())
      const quiz2 = result.skipped.find((r) => r.quiz_id === 2)!
      expect(quiz2.skip_reason).toBe('no_time_limit_for_multiplier')
    })

    it('restricts the fan-out to quiz_ids when provided', async () => {
      const canvas = buildMockCanvas()
      const result = (await tool(canvas, 'set_student_quiz_accommodation').handler({
        course_id: 10,
        user_id: 42,
        extra_time_minutes: 20,
        quiz_ids: [1],
      })) as FanOutResult
      const setExtension = canvas.quizzes.setExtension as ReturnType<typeof vi.fn>
      expect(setExtension).toHaveBeenCalledTimes(1)
      expect(setExtension).toHaveBeenCalledWith(10, 1, 42, 20, undefined)
      expect(result.summary.total).toBe(1)
    })

    it('reports requested quiz_ids absent from the course in not_found', async () => {
      const canvas = buildMockCanvas()
      const result = (await tool(canvas, 'set_student_quiz_accommodation').handler({
        course_id: 10,
        user_id: 42,
        extra_time_minutes: 20,
        quiz_ids: [1, 999],
      })) as FanOutResult
      const setExtension = canvas.quizzes.setExtension as ReturnType<typeof vi.fn>
      // Only the existing quiz (1) is fanned to; 999 is neither applied nor failed.
      expect(setExtension).toHaveBeenCalledTimes(1)
      expect(result.summary.total).toBe(1)
      expect(result.not_found).toEqual([999])
      expect(result.summary.not_found).toBe(1)
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
      })) as FanOutResult
      expect(result.applied[0].quiz_id).toBe(1)
      expect(result.failed[0].quiz_id).toBe(2)
      expect(result.failed[0].error).toBe('Forbidden')
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
      })) as FanOutResult
      expect(result.applied).toEqual([])
      expect(result.skipped).toEqual([])
      expect(result.failed).toEqual([])
      expect(result.summary.total).toBe(0)
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

    it('reports the student accommodation from quiz submissions, excluding New Quizzes', async () => {
      const canvas = buildMockCanvas()
      const result = (await tool(canvas, 'list_student_quiz_accommodations').handler({
        course_id: 10,
        user_id: 42,
      })) as HandlerResult
      const listSubmissions = canvas.quizzes.listSubmissions as ReturnType<typeof vi.fn>
      expect(listSubmissions).toHaveBeenCalledWith(10, 1)
      expect(listSubmissions).toHaveBeenCalledWith(10, 2)
      expect(listSubmissions).not.toHaveBeenCalledWith(10, 3)
      expect(result.results[0].has_accommodation).toBe(true)
      expect(result.results[0].extra_time_minutes).toBe(20)
      expect(result.results[0].extra_attempts).toBe(1)
      // Output must not echo the student identifier.
      expect('user_id' in result.results[0]).toBe(false)
      expect(result.summary.with_accommodation).toBe(2)
      expect(result.summary.without_accommodation).toBe(0)
    })

    it('reports no accommodation when the student has no submission', async () => {
      const canvas = buildMockCanvas()
      ;(canvas.quizzes.listSubmissions as ReturnType<typeof vi.fn>).mockResolvedValue([])
      const result = (await tool(canvas, 'list_student_quiz_accommodations').handler({
        course_id: 10,
        user_id: 42,
      })) as HandlerResult
      expect(result.results[0].has_accommodation).toBe(false)
      expect(result.results[0].extra_time_minutes).toBeNull()
      expect(result.summary.with_accommodation).toBe(0)
    })

    it('treats a submission with no extension (null/zero values) as no accommodation', async () => {
      const canvas = buildMockCanvas()
      ;(canvas.quizzes.listSubmissions as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 5, quiz_id: 1, user_id: 42, extra_time: 0, extra_attempts: null },
      ])
      const result = (await tool(canvas, 'list_student_quiz_accommodations').handler({
        course_id: 10,
        user_id: 42,
      })) as HandlerResult
      expect(result.results[0].has_accommodation).toBe(false)
      expect(result.results[0].extra_time_minutes).toBeNull()
      expect(result.results[0].extra_attempts).toBeNull()
    })

    it('ignores another student present on the quiz', async () => {
      const canvas = buildMockCanvas()
      ;(canvas.quizzes.listSubmissions as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 9, quiz_id: 1, user_id: 99, extra_time: 30, extra_attempts: 2 },
      ])
      const result = (await tool(canvas, 'list_student_quiz_accommodations').handler({
        course_id: 10,
        user_id: 42,
      })) as HandlerResult
      expect(result.results[0].has_accommodation).toBe(false)
      expect(result.results[0].extra_time_minutes).toBeNull()
    })

    it('propagates a read error (no per-quiz catching)', async () => {
      const canvas = buildMockCanvas()
      ;(canvas.quizzes.listSubmissions as ReturnType<typeof vi.fn>).mockRejectedValue(
        new CanvasApiError('Not Found', 404, '/submissions'),
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
