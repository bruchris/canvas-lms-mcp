import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { CanvasQuizSubmissionQuestion } from '../canvas/types'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'

// Classic Quiz `quiz_type` values. An allow-list (not a `!== 'quizzes.next'`
// deny-list) so an unrecognized future quiz_type fails closed rather than being
// treated as Classic. Mirrors src/tools/quiz-accommodations.ts's CLASSIC_QUIZ_TYPES.
const CLASSIC_QUIZ_TYPES = new Set(['assignment', 'practice_quiz', 'graded_survey', 'survey'])

// The two Classic Quiz question types Canvas never auto-grades. short_answer is
// auto-graded by exact text match, so it is deliberately excluded even though the
// issue mentions "short answer" colloquially.
const MANUALLY_GRADED_QUESTION_TYPES = new Set(['essay_question', 'file_upload_question'])

// Only submissions in these workflow states carry answers worth scanning.
// `pending_review` is the state of an essay attempt awaiting manual grading — the
// core case for this tool — so it must be included, not excluded.
const RESPONDED_WORKFLOW_STATES = new Set(['complete', 'pending_review'])

interface QuestionResponse {
  user_id: number
  user_name: string | null
  quiz_submission_id: number
  attempt: number
  answer: CanvasQuizSubmissionQuestion['answer']
  correct: boolean | null
  flagged: boolean
}

interface QuestionGroup {
  question_id: number
  question_text: string
  question_type: string
  position: number
  points_possible: number
  needs_manual_grading: boolean
  responses: QuestionResponse[]
}

export function quizQuestionResponseTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
  return [
    {
      name: 'get_quiz_question_responses',
      description:
        "Review every student's answer to one or all questions in a Classic Quiz, pivoted by " +
        'question instead of by student — for grading essay/short-answer/file-upload questions ' +
        'consistently across a class instead of paging through SpeedGrader one student at a time. ' +
        'Classic Quizzes only (quiz_type: assignment, practice_quiz, graded_survey, survey) — New ' +
        'Quizzes exposes responses through a different API. Omit question_id to get every question; ' +
        'provide it to scope to one. Each question reports needs_manual_grading (true for essay and ' +
        'file-upload questions) and points_possible. Scans one Canvas API call per completed or ' +
        'pending-review submission; a failed per-submission fetch is recorded in submissions_failed ' +
        'rather than aborting the whole call. When CANVAS_PSEUDONYMIZE_STUDENTS is enabled, student ' +
        'names are replaced with stable pseudonyms.',
      inputSchema: {
        course_id: z.number().int().positive().describe('The Canvas course ID'),
        quiz_id: z.number().int().positive().describe('The Canvas quiz ID (Classic Quizzes only)'),
        question_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Scope the result to a single question ID (from list_quiz_questions). ' +
              "Omit to return every question with every student's response.",
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const quizId = params.quiz_id as number
        const questionId = params.question_id as number | undefined

        // Gate Classic vs New Quizzes first, before any further Canvas calls, so a
        // New Quiz fails fast with a clear message instead of an opaque 404 later.
        const quiz = await canvas.quizzes.get(courseId, quizId)
        if (!CLASSIC_QUIZ_TYPES.has(quiz.quiz_type)) {
          throw new Error(
            `This tool only supports Classic Quizzes (assignment, practice_quiz, graded_survey, ` +
              `survey). Quiz ${quizId} has quiz_type "${quiz.quiz_type}" (New Quizzes), which ` +
              `exposes responses through a different API not covered by this tool.`,
          )
        }

        let questions = await canvas.quizzes.listQuestions(courseId, quizId)
        if (questionId !== undefined) {
          questions = questions.filter((q) => q.id === questionId)
          if (questions.length === 0) {
            throw new Error(`Question ${questionId} not found on quiz ${quizId}.`)
          }
        }
        questions = [...questions].sort((a, b) => a.position - b.position)

        const allSubmissions = await canvas.quizzes.listSubmissions(courseId, quizId)
        const submissions = allSubmissions.filter((s) =>
          RESPONDED_WORKFLOW_STATES.has(s.workflow_state),
        )

        // Resolve user_id -> name once. listStudents' users carry no `enrollments`,
        // so classifyRole() sees them as 'unknown' and the conservative default
        // pseudonymizes them anyway when the flag is on. user_id itself is never
        // scrubbed — it is the stable join key, not FERPA-identifying in isolation.
        const students = await canvas.users.listStudents(courseId)
        const anonymizedStudents =
          pseudonymizer?.isEnabled() === true
            ? await pseudonymizer.anonymizeUsers(courseId, students)
            : students
        const nameById = new Map(anonymizedStudents.map((u) => [u.id, u.name]))

        // One answer-fetch per submission, tolerating individual failures: a single
        // broken submission must not blank out the whole grade-by-question view.
        const settled = await Promise.allSettled(
          submissions.map((s) => canvas.quizzes.getSubmissionAnswers(s.id)),
        )

        const answersBySubmission = new Map<number, CanvasQuizSubmissionQuestion[]>()
        const submissionsFailed: number[] = []
        settled.forEach((outcome, i) => {
          const submission = submissions[i]
          if (!submission) return // index-aligned with `settled`; guard for the type checker
          if (outcome.status === 'fulfilled') {
            answersBySubmission.set(submission.id, outcome.value)
          } else {
            submissionsFailed.push(submission.id)
            console.error(
              `get_quiz_question_responses: failed fetching answers for quiz submission ` +
                `${submission.id} (course ${courseId}, quiz ${quizId}):`,
              outcome.reason,
            )
          }
        })

        const groups = new Map<number, QuestionGroup>(
          questions.map((q) => [
            q.id,
            {
              question_id: q.id,
              question_text: q.question_text,
              question_type: q.question_type,
              position: q.position,
              points_possible: q.points_possible,
              needs_manual_grading: MANUALLY_GRADED_QUESTION_TYPES.has(q.question_type),
              responses: [],
            },
          ]),
        )

        for (const submission of submissions) {
          const answers = answersBySubmission.get(submission.id)
          if (!answers) continue
          for (const answer of answers) {
            // Assumes CanvasQuizSubmissionQuestion.id === CanvasQuizQuestion.id (the
            // quiz's question ID). If Canvas ever returns a different identifier here,
            // this lookup silently misses and responses[] comes back empty — see spec
            // 2026-07-09-issue-240 design unknown §3 (the pivot's single highest risk).
            const group = groups.get(answer.id)
            if (!group) continue // not one of the (possibly question_id-filtered) target questions
            group.responses.push({
              user_id: submission.user_id,
              user_name: nameById.get(submission.user_id) ?? null,
              quiz_submission_id: submission.id,
              attempt: submission.attempt,
              answer: answer.answer,
              correct: answer.correct ?? null,
              flagged: answer.flagged,
            })
          }
        }

        return {
          quiz_id: quiz.id,
          quiz_title: quiz.title,
          question_count: groups.size,
          questions: [...groups.values()],
          submissions_scanned: submissions.length,
          submissions_failed: submissionsFailed,
        }
      },
    },
  ]
}
