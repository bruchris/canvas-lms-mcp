import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { CanvasQuiz } from '../canvas/types'
import { fanOut } from './fan-out'
import type { ToolDefinition } from './types'

// Quiz types that the Classic Quizzes extensions API can extend. New Quizzes
// (`quizzes.next`) use a different accommodation mechanism and are skipped.
const CLASSIC_QUIZ_TYPES = new Set(['assignment', 'practice_quiz', 'graded_survey', 'survey'])

interface QuizAccommodationResult {
  quiz_id: number
  quiz_title: string
  // Status (applied/skipped/failed) is conveyed by which bucket the entry lands
  // in. skip_reason is present only on skipped[]; error only on failed[].
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
        'New Quizzes (quiz_type quizzes.next) are skipped — use set_student_new_quiz_accommodation instead. ' +
        'Only applies to quizzes that exist at call time; re-run after creating new quizzes. ' +
        'Assignment due-date overrides are not handled here (separate fast-follow feature). ' +
        'Note: for courses with many quizzes this makes one Canvas API call per quiz. ' +
        'Partial failures are tolerated — a failure on one quiz does not abort the rest. ' +
        'Returns the standard fan-out envelope: separated applied[], skipped[] (each with a ' +
        'skip_reason), and failed[] (each with an error) arrays, a not_found list of any requested ' +
        'quiz_ids absent from the course, and a summary of counts. ' +
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
        const notFound: number[] = []
        if (quizIds && quizIds.length > 0) {
          const requested = new Set(quizIds)
          const present = new Set(quizzes.map((q) => q.id))
          for (const id of requested) {
            if (!present.has(id)) notFound.push(id)
          }
          quizzes = quizzes.filter((q) => requested.has(q.id))
        }

        // Shared fan-out: per-item try/catch, non-CanvasApiError logging, and
        // the applied/skipped/failed envelope all live in fanOut().
        return fanOut<CanvasQuiz, QuizAccommodationResult>({
          items: quizzes,
          notFound,
          errorContext: (quiz) => `applying quiz extension (course ${courseId}, quiz ${quiz.id})`,
          onError: (quiz, message) => ({
            quiz_id: quiz.id,
            quiz_title: quiz.title,
            extra_time_minutes: null,
            extra_attempts: null,
            error: message,
          }),
          perform: async (quiz) => {
            if (!CLASSIC_QUIZ_TYPES.has(quiz.quiz_type)) {
              return {
                status: 'skipped',
                result: {
                  quiz_id: quiz.id,
                  quiz_title: quiz.title,
                  skip_reason: 'new_quiz_not_supported',
                  extra_time_minutes: null,
                  extra_attempts: null,
                },
              }
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
              return {
                status: 'skipped',
                result: {
                  quiz_id: quiz.id,
                  quiz_title: quiz.title,
                  skip_reason: 'no_time_limit_for_multiplier',
                  extra_time_minutes: null,
                  extra_attempts: null,
                },
              }
            }

            await canvas.quizzes.setExtension(courseId, quiz.id, userId, extraTime, extraAttempts)
            return {
              status: 'applied',
              result: {
                quiz_id: quiz.id,
                quiz_title: quiz.title,
                extra_time_minutes: extraTime ?? null,
                extra_attempts: extraAttempts ?? null,
              },
            }
          },
        })
      },
    },
    {
      name: 'list_student_quiz_accommodations',
      description:
        'List the current quiz accommodation (extra time and/or extra attempts) for a specific ' +
        'student across all Classic Quizzes in a course. Useful for auditing before or after ' +
        'calling set_student_quiz_accommodation. ' +
        'New Quizzes (quiz_type quizzes.next) are excluded. ' +
        "Reads extra_time / extra_attempts from each quiz's submission records " +
        '(Canvas exposes no read endpoint for quiz extensions directly) — one Canvas API call per ' +
        'Classic Quiz, so it may be slow for courses with many quizzes. ' +
        "Errors from any quiz's read propagate immediately (no per-quiz error catching). " +
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
          // Canvas has no GET for quiz extensions; the accommodation is stored on
          // the student's quiz submission (extra_time / extra_attempts). No
          // try/catch: a failed read means the audit is incomplete, so the error
          // propagates to buildHandler (isError: true) rather than being silently
          // skipped. This differs from set_student_quiz_accommodation, which
          // catches per-quiz errors so the fan-out continues.
          const submissions = await canvas.quizzes.listSubmissions(courseId, quiz.id)
          const mySubmission = submissions.find((s) => s.user_id === userId)
          const rawTime = mySubmission?.extra_time
          const rawAttempts = mySubmission?.extra_attempts
          const extraTimeMinutes = typeof rawTime === 'number' && rawTime > 0 ? rawTime : null
          const extraAttempts =
            typeof rawAttempts === 'number' && rawAttempts > 0 ? rawAttempts : null
          // Output carries only accommodation values, not the student identifier,
          // so no pseudonymizer wrapping is required.
          results.push({
            quiz_id: quiz.id,
            quiz_title: quiz.title,
            has_accommodation: extraTimeMinutes !== null || extraAttempts !== null,
            extra_time_minutes: extraTimeMinutes,
            extra_attempts: extraAttempts,
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
