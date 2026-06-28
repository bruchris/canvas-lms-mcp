import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import { CanvasApiError } from '../canvas/client'
import type { ToolDefinition } from './types'

interface NewQuizAccommodationResult {
  assignment_id: number | null
  time_multiplier: number | null
  extra_attempts: number | null
  error?: string
}

export function newQuizAccommodationTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'set_student_new_quiz_accommodation',
      description:
        'Apply a time and/or attempts accommodation for a student across all New Quizzes in a course ' +
        '(course-level, single Canvas API call when no assignment_ids are given) or for a specified ' +
        'subset of New Quizzes (per-quiz fan-out when assignment_ids are given). ' +
        'New Quizzes use a time_multiplier (ratio, e.g. 1.5 for 1.5× time), not absolute minutes. ' +
        'For Classic Quizzes (quiz_type: assignment / practice_quiz / etc.) use ' +
        'set_student_quiz_accommodation instead. ' +
        'Partial per-quiz failures are tolerated — a failure on one quiz does not abort the rest. ' +
        'In per-quiz mode, fan-out is sequential (one Canvas API call per assignment ID, awaited in series). ' +
        'Canvas errors on the course-level path (no assignment_ids) propagate as a top-level error (no envelope). ' +
        'Returns a uniform envelope: scope ("course" or "per_quiz"), applied[], failed[], and summary. ' +
        'Provide user_id as the real Canvas user ID. If CANVAS_PSEUDONYMIZE_STUDENTS is enabled, ' +
        'call resolve_pseudonym first to obtain the real user_id from a pseudonym.',
      inputSchema: {
        course_id: z.number().int().positive().describe('Canvas course ID'),
        user_id: z
          .number()
          .int()
          .positive()
          .describe('Real Canvas user ID of the student to accommodate'),
        time_multiplier: z
          .number()
          .min(1.01)
          .optional()
          .describe(
            'Time multiplier for New Quizzes (e.g. 1.5 for 1.5× time, 2.0 for double time). ' +
              "This is the native New Quizzes field; Canvas applies it to each quiz's time limit. " +
              'Must be > 1.0. Mutually exclusive with nothing — can be combined with extra_attempts.',
          ),
        extra_attempts: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Additional attempts to grant beyond each quiz's default attempt limit."),
        assignment_ids: z
          .array(z.number().int().positive())
          .optional()
          .describe(
            'Limit accommodation to these specific New Quiz assignment IDs. ' +
              'Omit to apply a course-level accommodation (covers all New Quizzes in the course ' +
              'with a single Canvas API call). When provided, fans out one call per assignment ID.',
          ),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const userId = params.user_id as number
        const timeMultiplier = params.time_multiplier as number | undefined
        const extraAttempts = params.extra_attempts as number | undefined
        const assignmentIds = params.assignment_ids as number[] | undefined

        if (timeMultiplier === undefined && extraAttempts === undefined) {
          throw new Error('Provide at least one of time_multiplier or extra_attempts.')
        }

        if (!assignmentIds || assignmentIds.length === 0) {
          const record = await canvas.newQuizzes.setAccommodation(
            courseId,
            userId,
            timeMultiplier,
            extraAttempts,
          )
          const result: NewQuizAccommodationResult = {
            assignment_id: null,
            time_multiplier: record.time_multiplier,
            extra_attempts: record.extra_attempts,
          }
          return {
            scope: 'course',
            applied: [result],
            failed: [],
            summary: { applied: 1, failed: 0 },
          }
        }

        const applied: NewQuizAccommodationResult[] = []
        const failed: NewQuizAccommodationResult[] = []

        for (const assignmentId of assignmentIds) {
          try {
            const record = await canvas.newQuizzes.setQuizAccommodation(
              courseId,
              assignmentId,
              userId,
              timeMultiplier,
              extraAttempts,
            )
            applied.push({
              assignment_id: assignmentId,
              time_multiplier: record.time_multiplier,
              extra_attempts: record.extra_attempts,
            })
          } catch (err) {
            const message = err instanceof CanvasApiError ? err.message : 'Unknown error'
            failed.push({
              assignment_id: assignmentId,
              time_multiplier: null,
              extra_attempts: null,
              error: message,
            })
          }
        }

        return {
          scope: 'per_quiz',
          applied,
          failed,
          summary: { applied: applied.length, failed: failed.length },
        }
      },
    },
    {
      name: 'list_student_new_quiz_accommodations',
      description:
        'Read the current course-level New Quizzes accommodation (time multiplier and/or extra attempts) ' +
        'for a specific student in a course. Useful for auditing before or after calling ' +
        'set_student_new_quiz_accommodation. ' +
        'Returns has_accommodation: false when no accommodation is set (Canvas 404 is treated as ' +
        '"no record", not an error). ' +
        'New Quizzes store a single course-level accommodation record per student; this is not ' +
        'per-quiz. For Classic Quizzes, use list_student_quiz_accommodations instead. ' +
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

        const record = await canvas.newQuizzes.getAccommodation(courseId, userId)

        if (record === null) {
          return {
            has_accommodation: false,
            time_multiplier: null,
            extra_attempts: null,
          }
        }

        return {
          has_accommodation: true,
          time_multiplier: record.time_multiplier,
          extra_attempts: record.extra_attempts,
        }
      },
    },
  ]
}
