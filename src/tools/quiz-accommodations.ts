import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import { CanvasApiError } from '../canvas/client'
import type { ToolDefinition } from './types'

// Quiz types that the Classic Quizzes extensions API can extend. New Quizzes
// (`quizzes.next`) use a different accommodation mechanism and are skipped.
const CLASSIC_QUIZ_TYPES = new Set(['assignment', 'practice_quiz', 'graded_survey', 'survey'])

interface QuizAccommodationResult {
  quiz_id: number
  quiz_title: string
  applied: boolean
  skipped?: boolean
  skip_reason?: 'new_quiz_not_supported' | 'no_time_limit_for_multiplier'
  extra_time_minutes: number | null
  extra_attempts: number | null
  error?: string
}

export function quizAccommodationTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'set_student_quiz_accommodation',
      description:
        'Apply extra time and/or extra attempts to a specific student across all Classic Quizzes ' +
        'in a course (or a specified subset). Fans out to the Canvas quiz extensions API for each quiz. ' +
        'New Quizzes (quiz_type quizzes.next) are skipped — they use a different accommodation ' +
        'mechanism not covered by this tool. ' +
        'Only applies to quizzes that exist at call time; re-run after creating new quizzes. ' +
        'Assignment due-date overrides are not handled here (separate fast-follow feature). ' +
        'Note: for courses with many quizzes this makes one Canvas API call per quiz. ' +
        'Provide user_id as the real Canvas user ID. If CANVAS_PSEUDONYMIZE_STUDENTS is enabled, ' +
        'call resolve_pseudonym first to obtain the real user_id from a pseudonym.',
      inputSchema: {
        course_id: z.number().int().positive().describe('Canvas course ID'),
        user_id: z
          .number()
          .int()
          .positive()
          .describe('Real Canvas user ID of the student to accommodate'),
        extra_time_minutes: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Absolute extra time in minutes to add to each quiz. ' +
              'Mutually exclusive with time_multiplier.',
          ),
        time_multiplier: z
          .number()
          .min(1.01)
          .optional()
          .describe(
            'Relative time multiplier (e.g. 1.5 for 1.5× time). ' +
              'extra_minutes = round(quiz.time_limit * (multiplier - 1)), minimum 1 minute. ' +
              'Quizzes with no time limit are skipped for extra_time ' +
              '(extra_attempts is still applied if provided). ' +
              'Mutually exclusive with extra_time_minutes.',
          ),
        extra_attempts: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Additional attempts to grant beyond the quiz default.'),
        quiz_ids: z
          .array(z.number().int().positive())
          .optional()
          .describe(
            'Limit accommodation to these specific quiz IDs. ' +
              'Omit to target all Classic Quizzes in the course.',
          ),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const userId = params.user_id as number
        const extraTimeMinutes = params.extra_time_minutes as number | undefined
        const timeMultiplier = params.time_multiplier as number | undefined
        const extraAttempts = params.extra_attempts as number | undefined
        const quizIds = params.quiz_ids as number[] | undefined

        if (extraTimeMinutes !== undefined && timeMultiplier !== undefined) {
          throw new Error('Provide either extra_time_minutes or time_multiplier, not both.')
        }
        if (
          extraTimeMinutes === undefined &&
          timeMultiplier === undefined &&
          extraAttempts === undefined
        ) {
          throw new Error(
            'Provide at least one of extra_time_minutes, time_multiplier, or extra_attempts.',
          )
        }

        let quizzes = await canvas.quizzes.list(courseId)
        if (quizIds && quizIds.length > 0) {
          const idSet = new Set(quizIds)
          quizzes = quizzes.filter((q) => idSet.has(q.id))
        }

        const results: QuizAccommodationResult[] = []
        let appliedCount = 0
        let skippedCount = 0
        let failedCount = 0

        for (const quiz of quizzes) {
          if (!CLASSIC_QUIZ_TYPES.has(quiz.quiz_type)) {
            results.push({
              quiz_id: quiz.id,
              quiz_title: quiz.title,
              applied: false,
              skipped: true,
              skip_reason: 'new_quiz_not_supported',
              extra_time_minutes: null,
              extra_attempts: null,
            })
            skippedCount++
            continue
          }

          let extraTime: number | undefined
          if (extraTimeMinutes !== undefined) {
            extraTime = extraTimeMinutes
          } else if (timeMultiplier !== undefined) {
            if (quiz.time_limit != null && quiz.time_limit > 0) {
              extraTime = Math.max(1, Math.round(quiz.time_limit * (timeMultiplier - 1)))
            }
          }

          if (extraTime === undefined && extraAttempts === undefined) {
            results.push({
              quiz_id: quiz.id,
              quiz_title: quiz.title,
              applied: false,
              skipped: true,
              skip_reason: 'no_time_limit_for_multiplier',
              extra_time_minutes: null,
              extra_attempts: null,
            })
            skippedCount++
            continue
          }

          try {
            await canvas.quizzes.setExtension(courseId, quiz.id, userId, extraTime, extraAttempts)
            results.push({
              quiz_id: quiz.id,
              quiz_title: quiz.title,
              applied: true,
              extra_time_minutes: extraTime ?? null,
              extra_attempts: extraAttempts ?? null,
            })
            appliedCount++
          } catch (err) {
            const message = err instanceof CanvasApiError ? err.message : 'Unknown error'
            results.push({
              quiz_id: quiz.id,
              quiz_title: quiz.title,
              applied: false,
              error: message,
              extra_time_minutes: null,
              extra_attempts: null,
            })
            failedCount++
          }
        }

        return {
          results,
          summary: {
            total_quizzes: quizzes.length,
            applied: appliedCount,
            skipped: skippedCount,
            failed: failedCount,
          },
        }
      },
    },
    {
      name: 'list_student_quiz_accommodations',
      description:
        'List the current quiz accommodation (extra time and/or extra attempts) for a specific ' +
        'student across all Classic Quizzes in a course. Useful for auditing before or after ' +
        'calling set_student_quiz_accommodation. ' +
        'New Quizzes (quiz_type quizzes.next) are excluded. ' +
        'Makes one Canvas API call per Classic Quiz to read extensions — may be slow for courses with many quizzes. ' +
        "Errors from any quiz's GET request propagate immediately (no per-quiz error catching). " +
        'Provide user_id as the real Canvas user ID. If CANVAS_PSEUDONYMIZE_STUDENTS is enabled, ' +
        'call resolve_pseudonym first.',
      inputSchema: {
        course_id: z.number().int().positive().describe('Canvas course ID'),
        user_id: z.number().int().positive().describe('Real Canvas user ID of the student'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const userId = params.user_id as number

        const quizzes = await canvas.quizzes.list(courseId)
        const classicQuizzes = quizzes.filter((q) => CLASSIC_QUIZ_TYPES.has(q.quiz_type))

        const results: Array<{
          quiz_id: number
          quiz_title: string
          has_accommodation: boolean
          extra_time_minutes: number | null
          extra_attempts: number | null
        }> = []

        for (const quiz of classicQuizzes) {
          // No try/catch: errors from listExtensions propagate to buildHandler →
          // isError: true. This differs from set_student_quiz_accommodation,
          // which catches per-quiz errors so the fan-out continues.
          const extensions = await canvas.quizzes.listExtensions(courseId, quiz.id)
          const myExt = extensions.find((e) => e.user_id === userId)
          // Strip user_id: output carries only accommodation values, not student
          // identifiers, so no pseudonymizer wrapping is required.
          results.push({
            quiz_id: quiz.id,
            quiz_title: quiz.title,
            has_accommodation: myExt !== undefined,
            extra_time_minutes: myExt?.extra_time ?? null,
            extra_attempts: myExt?.extra_attempts ?? null,
          })
        }

        const withAccommodation = results.filter((r) => r.has_accommodation).length
        return {
          results,
          summary: {
            total_classic_quizzes: classicQuizzes.length,
            with_accommodation: withAccommodation,
            without_accommodation: classicQuizzes.length - withAccommodation,
          },
        }
      },
    },
  ]
}
