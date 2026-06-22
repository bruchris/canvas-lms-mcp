import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function quizTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_quizzes',
      audience: 'shared',
      description: 'List all quizzes in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.quizzes.list(course_id)
      },
    },
    {
      name: 'get_quiz',
      audience: 'shared',
      description: 'Get details for a single quiz by ID.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        quiz_id: z.number().describe('The Canvas quiz ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const quiz_id = params.quiz_id as number
        return canvas.quizzes.get(course_id, quiz_id)
      },
    },
    {
      name: 'list_quiz_submissions',
      description: 'List all submissions for a quiz.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        quiz_id: z.number().describe('The Canvas quiz ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const quiz_id = params.quiz_id as number
        return canvas.quizzes.listSubmissions(course_id, quiz_id)
      },
    },
    {
      name: 'list_quiz_questions',
      description: 'List all questions in a quiz.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        quiz_id: z.number().describe('The Canvas quiz ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const quiz_id = params.quiz_id as number
        return canvas.quizzes.listQuestions(course_id, quiz_id)
      },
    },
    {
      name: 'get_quiz_submission_answers',
      description: "Get a student's answers for a quiz submission.",
      inputSchema: {
        quiz_submission_id: z.number().describe('The Canvas quiz submission ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const quiz_submission_id = params.quiz_submission_id as number
        return canvas.quizzes.getSubmissionAnswers(quiz_submission_id)
      },
    },
    {
      name: 'score_quiz_question',
      description:
        'Score a specific question in a quiz submission. Specify attempt to score a particular attempt (omit for latest). Requires grading permissions.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        quiz_id: z.number().describe('The Canvas quiz ID'),
        submission_id: z.number().describe('The Canvas quiz submission ID'),
        question_id: z.number().describe('The Canvas quiz question ID'),
        score: z.number().describe('The score to assign'),
        comment: z.string().optional().describe('Optional feedback comment'),
        attempt: z.number().optional().describe('Quiz attempt number to score (omit for latest)'),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const quiz_id = params.quiz_id as number
        const submission_id = params.submission_id as number
        const question_id = params.question_id as number
        const score = params.score as number
        const comment = params.comment as string | undefined
        const attempt = params.attempt as number | undefined
        await canvas.quizzes.scoreQuestion(
          course_id,
          quiz_id,
          submission_id,
          question_id,
          score,
          comment,
          attempt,
        )
        return { success: true }
      },
    },
    {
      name: 'get_quiz_submission_events',
      // `shared`: the submitting student can read their own attempt's events
      // (the #182 user story explicitly serves "a student reviewing their own
      // attempt"), matching the `shared` audience on get_quiz / list_quizzes.
      // Canvas still enforces real permissions server-side.
      audience: 'shared',
      description: `Get the event log for a Classic Quiz submission in chronological order. Events include session_started, question_answered, question_flagged, page_blurred, and page_focused. Use this to understand the timeline of a student's attempt. Classic Quizzes only — New Quizzes does not expose event logs via the Canvas REST API. Events are scoped to a single submission; Canvas enforces access permissions (instructors and the submitting student only). Do not use event logs as the sole basis for academic-integrity conclusions; present them with context.`,
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        quiz_id: z.number().describe('The Canvas quiz ID (Classic Quizzes only)'),
        submission_id: z.number().describe('The quiz submission ID'),
        attempt: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Attempt number (1-based). Omit for the most recent attempt.'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const quiz_id = params.quiz_id as number
        const submission_id = params.submission_id as number
        const attempt = params.attempt as number | undefined
        return canvas.quizzes.getSubmissionEvents(course_id, quiz_id, submission_id, attempt)
      },
    },
  ]
}
