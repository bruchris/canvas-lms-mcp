import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'
import { type CanvasId, canvasIdInput } from '../canvas/id'

export function quizTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_quizzes',
      title: 'List Quizzes',
      audience: 'shared',
      description:
        'List every quiz row in a course, including the New Quiz stub Canvas mixes into the ' +
        'same list (quiz_type: quizzes.next, with no question or submission detail of its own). ' +
        'Use quiz_type to tell Classic Quizzes (assignment, practice_quiz, graded_survey, ' +
        "survey) apart from New Quizzes, and list_new_quiz_items for a New Quiz's actual " +
        "questions. Returns each quiz's title, quiz_type, points_possible, question_count, " +
        'due_at and published state. Use get_quiz to fetch one quiz by ID, list_quiz_questions ' +
        'for its fixed questions, and list_quiz_submissions for student attempts. Fetches every ' +
        "page (100 per request) and fails with a 'Results are incomplete' error instead of " +
        'silently truncating.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        return canvas.quizzes.list(course_id)
      },
    },
    {
      name: 'get_quiz',
      title: 'Get Quiz',
      audience: 'shared',
      description:
        'Get one quiz by ID, found with list_quizzes. If the ID belongs to a New Quiz, Canvas ' +
        'returns only its stub row (quiz_type: quizzes.next) — use list_new_quiz_items for the ' +
        'actual question content. Returns title, quiz_type, points_possible, question_count, ' +
        'due_at, published state, and assignment_id (the graded assignment Canvas created for ' +
        'this quiz; null for an ungraded survey or practice quiz). Use list_quiz_questions for ' +
        "a Classic quiz's fixed questions and list_quiz_submissions for student attempts.",
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        quiz_id: canvasIdInput().describe('The Canvas quiz ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const quiz_id = params.quiz_id as CanvasId
        return canvas.quizzes.get(course_id, quiz_id)
      },
    },
    {
      name: 'list_quiz_submissions',
      title: 'List Quiz Submissions',
      description:
        "List every submission (one row per student's attempt history) for a Classic quiz, " +
        "including each submission's score, kept_score, workflow_state, and any extra_time / " +
        'extra_attempts accommodation Canvas has recorded for that student. Find the quiz_id ' +
        "with list_quizzes or get_quiz. To see a submission's actual answers, use " +
        'get_quiz_submission_answers for an in-progress attempt or get_quiz_question_responses ' +
        'for a submitted one; to change a score use score_quiz_question. Fetches every page ' +
        "(100 per request) and fails with a 'Results are incomplete' error instead of silently " +
        'truncating.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        quiz_id: canvasIdInput().describe('The Canvas quiz ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const quiz_id = params.quiz_id as CanvasId
        return canvas.quizzes.listSubmissions(course_id, quiz_id)
      },
    },
    {
      name: 'list_quiz_questions',
      title: 'List Quiz Questions',
      description:
        'List the fixed questions defined on a Classic quiz — id, position, question_text, ' +
        "question_type, points_possible, and answers — in quiz order. This is the quiz's " +
        'static question list only: it does not include the generated questions Canvas serves ' +
        'per attempt when a question-bank draw is configured, and it carries no student answer ' +
        'data. Find the quiz_id with list_quizzes or get_quiz. Use get_quiz_question_responses ' +
        'to see what each student was actually served and answered, including bank-drawn ' +
        'questions, and score_quiz_question to grade an answer. Fetches every page (100 per ' +
        "request) and fails with a 'Results are incomplete' error instead of silently " +
        'truncating.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        quiz_id: canvasIdInput().describe('The Canvas quiz ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const quiz_id = params.quiz_id as CanvasId
        return canvas.quizzes.listQuestions(course_id, quiz_id)
      },
    },
    {
      name: 'get_quiz_submission_answers',
      title: 'Get Quiz Submission Answers',
      description:
        "Get a quiz submission's state for an IN-PROGRESS (untaken) attempt, including the " +
        "student's live answer and flag per question. For a SUBMITTED attempt (complete or " +
        'pending_review), Canvas never returns the answer value or a real flag state through ' +
        'this endpoint — only grading state (correct) is available here. To review a submitted ' +
        "attempt's actual answer text, use get_quiz_question_responses instead.",
      inputSchema: {
        quiz_submission_id: canvasIdInput().describe('The Canvas quiz submission ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const quiz_submission_id = params.quiz_submission_id as CanvasId
        return canvas.quizzes.getSubmissionAnswers(quiz_submission_id)
      },
    },
    {
      name: 'score_quiz_question',
      title: 'Score Quiz Question',
      description:
        "Set the score and an optional feedback comment for one question in one student's " +
        'Classic quiz submission, overwriting any existing score for that question on the ' +
        "chosen attempt — it replaces the question's recorded score rather than adding to it, " +
        'so calling again with the same score and comment leaves the submission unchanged. ' +
        'Omit attempt to score the latest attempt. Find submission_id with ' +
        'list_quiz_submissions and question_id with list_quiz_questions or ' +
        'get_quiz_question_responses. Returns { success: true }; Canvas does not hand back the ' +
        'updated submission to this endpoint. Requires grading permission in the course.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        quiz_id: canvasIdInput().describe('The Canvas quiz ID'),
        submission_id: canvasIdInput().describe('The Canvas quiz submission ID'),
        question_id: canvasIdInput().describe('The Canvas quiz question ID'),
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
        const course_id = params.course_id as CanvasId
        const quiz_id = params.quiz_id as CanvasId
        const submission_id = params.submission_id as CanvasId
        const question_id = params.question_id as CanvasId
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
      title: 'Get Quiz Submission Events',
      // `shared`: the submitting student can read their own attempt's events
      // (the #182 user story explicitly serves "a student reviewing their own
      // attempt"), matching the `shared` audience on get_quiz / list_quizzes.
      // Canvas still enforces real permissions server-side.
      audience: 'shared',
      description: `Get the event log for a Classic Quiz submission in chronological order. Events include session_started, question_answered, question_flagged, page_blurred, and page_focused. Use this to understand the timeline of a student's attempt. Classic Quizzes only — New Quizzes does not expose event logs via the Canvas REST API. Events are scoped to a single submission; Canvas enforces access permissions (instructors and the submitting student only). Do not use event logs as the sole basis for academic-integrity conclusions; present them with context.`,
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        quiz_id: canvasIdInput().describe('The Canvas quiz ID (Classic Quizzes only)'),
        submission_id: canvasIdInput().describe('The quiz submission ID'),
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
        const course_id = params.course_id as CanvasId
        const quiz_id = params.quiz_id as CanvasId
        const submission_id = params.submission_id as CanvasId
        const attempt = params.attempt as number | undefined
        return canvas.quizzes.getSubmissionEvents(course_id, quiz_id, submission_id, attempt)
      },
    },
    {
      name: 'delete_quiz',
      title: 'Delete Quiz',
      description:
        'Permanently delete a Classic quiz from a course, including its questions and every student submission. Classic Quizzes only; use delete_new_quiz for a New Quiz (LTI).',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        quiz_id: canvasIdInput().describe('The Canvas quiz ID to delete (Classic Quizzes only)'),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const quiz_id = params.quiz_id as CanvasId
        return canvas.quizzes.delete(course_id, quiz_id)
      },
    },
    {
      name: 'delete_quiz_question',
      title: 'Delete Quiz Question',
      description:
        'Permanently delete a single question from a Classic quiz. Classic Quizzes only; use delete_new_quiz_item for a New Quiz item.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        quiz_id: canvasIdInput().describe('The Canvas quiz ID (Classic Quizzes only)'),
        question_id: canvasIdInput().describe('The Canvas quiz question ID to delete'),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const quiz_id = params.quiz_id as CanvasId
        const question_id = params.question_id as CanvasId
        await canvas.quizzes.deleteQuestion(course_id, quiz_id, question_id)
        // Canvas answers 204 No Content here, unlike delete_quiz, which passes
        // through the deleted quiz object Canvas returns, so build a receipt.
        return { deleted: true, question_id }
      },
    },
  ]
}
