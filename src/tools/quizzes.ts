import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function quizTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'get_quiz',
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
      name: 'get_submission_answers',
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
      description: 'Score a specific question in a quiz submission. Requires grading permissions.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        quiz_id: z.number().describe('The Canvas quiz ID'),
        submission_id: z.number().describe('The Canvas quiz submission ID'),
        question_id: z.number().describe('The Canvas quiz question ID'),
        score: z.number().describe('The score to assign'),
        comment: z.string().optional().describe('Optional feedback comment'),
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
        await canvas.quizzes.scoreQuestion(
          course_id,
          quiz_id,
          submission_id,
          question_id,
          score,
          comment,
        )
        return { success: true }
      },
    },
  ]
}
