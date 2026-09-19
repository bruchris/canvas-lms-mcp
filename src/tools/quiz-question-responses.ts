import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type {
  CanvasQuizQuestion,
  CanvasQuizSubmission,
  CanvasQuizSubmissionQuestion,
} from '../canvas/types'
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
  // null for a question resolved from students' attempts (a bank draw, or one
  // removed from the quiz after it was answered): it has no fixed quiz position.
  position: number | null
  points_possible: number
  needs_manual_grading: boolean
  responses: QuestionResponse[]
}

function toGroup(question: CanvasQuizQuestion, position: number | null): QuestionGroup {
  return {
    question_id: question.id,
    question_text: question.question_text,
    question_type: question.question_type,
    position,
    points_possible: question.points_possible,
    needs_manual_grading: MANUALLY_GRADED_QUESTION_TYPES.has(question.question_type),
    responses: [],
  }
}

/**
 * Resolve question ids that students answered but listQuestions() did not
 * return, by asking Canvas which questions each attempt was actually served.
 *
 * Why such ids exist (instructure/canvas-lms@1c9f0bb): a bank draw, or a
 * duplicate draw from an in-quiz group, is materialised as a separate
 * `generated` QuizQuestion row (AssessmentQuestion#create_quiz_question), and
 * the attempt's quiz_data records that row's id. The answers endpoint renders
 * QuizQuestion.where(id: <quiz_data ids>) with no workflow_state filter
 * (QuizSubmission#quiz_questions), so it answers under the generated id, while
 * listQuestions() renders only quiz.active_quiz_questions (workflow_state
 * 'active' or NULL). The attempt's own question list (index_submission_questions)
 * is keyed off the same quiz_data ids, so it does contain them, uncensored for
 * quiz editors and with the attempt's points_possible (the group's
 * question_points). The answers endpoint's include[]=quiz_question sideload is
 * no substitute: quiz_submission_questions_json forces censoring on
 * (`meta[:censored] ||= true`), which strips points_possible.
 *
 * Generated rows are reused by every attempt that drew the same bank question
 * (AssessmentQuestion.find_or_create_quiz_questions), so a few attempts usually
 * cover every id. They are picked greedily (most still-uncovered ids first) and
 * fetched in parallel. A failed lookup is logged and its ids stay unresolved;
 * the caller reports those responses as unmatched instead of dropping them.
 */
async function resolveAttemptQuestions(
  canvas: CanvasClient,
  courseId: number,
  quizId: number,
  submissions: CanvasQuizSubmission[],
  answersBySubmission: Map<number, CanvasQuizSubmissionQuestion[]>,
  missing: ReadonlySet<number>,
): Promise<CanvasQuizQuestion[]> {
  const uncovered = new Set(missing)
  const picked: CanvasQuizSubmission[] = []
  while (uncovered.size > 0) {
    let best: CanvasQuizSubmission | undefined
    let bestCount = 0
    for (const submission of submissions) {
      const answers = answersBySubmission.get(submission.id) ?? []
      const count = answers.filter((answer) => uncovered.has(answer.id)).length
      if (count > bestCount) {
        best = submission
        bestCount = count
      }
    }
    if (!best) break // unreachable: every missing id came from some submission's answers
    picked.push(best)
    for (const answer of answersBySubmission.get(best.id) ?? []) uncovered.delete(answer.id)
  }

  const settled = await Promise.allSettled(
    picked.map((s) => canvas.quizzes.listSubmissionQuestions(courseId, quizId, s.id, s.attempt)),
  )
  const resolved = new Map<number, CanvasQuizQuestion>()
  settled.forEach((outcome, i) => {
    const submission = picked[i]
    if (!submission) return // index-aligned with `settled`; guard for the type checker
    if (outcome.status === 'fulfilled') {
      for (const question of outcome.value) {
        if (missing.has(question.id) && !resolved.has(question.id)) {
          resolved.set(question.id, question)
        }
      }
    } else {
      console.error(
        `get_quiz_question_responses: failed fetching the questions served in quiz submission ` +
          `${submission.id} attempt ${submission.attempt} (course ${courseId}, quiz ${quizId}):`,
        outcome.reason,
      )
    }
  })
  return [...resolved.values()]
}

export function quizQuestionResponseTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
  return [
    {
      name: 'get_quiz_question_responses',
      title: 'Get Quiz Question Responses',
      description:
        "Review every student's answer to one or all questions in a Classic Quiz, pivoted by " +
        'question instead of by student — for grading essay/short-answer/file-upload questions ' +
        'consistently across a class instead of paging through SpeedGrader one student at a time. ' +
        'Classic Quizzes only (quiz_type: assignment, practice_quiz, graded_survey, survey) — New ' +
        'Quizzes exposes responses through a different API. Omit question_id to get every question; ' +
        'provide it to scope to one. Each question reports needs_manual_grading (true for essay and ' +
        'file-upload questions) and points_possible. Questions drawn from a question bank are ' +
        "included: Canvas stores each draw as a generated question that the quiz's question list " +
        "omits, so they are resolved from the students' own attempts, listed after the quiz's " +
        'fixed questions, and report position: null. Scans one Canvas API call per completed or pending-review ' +
        'submission, plus one per attempt needed to resolve such questions. A failed ' +
        'per-submission fetch is recorded in submissions_failed, and a response whose question ' +
        'cannot be resolved is counted in unmatched_response_count and unmatched_question_ids, ' +
        'rather than aborting the whole call. When CANVAS_PSEUDONYMIZE_STUDENTS is enabled, ' +
        'student names are replaced with stable pseudonyms.',
      inputSchema: {
        course_id: z.number().int().positive().describe('The Canvas course ID'),
        quiz_id: z.number().int().positive().describe('The Canvas quiz ID (Classic Quizzes only)'),
        question_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Scope the result to a single question ID (from list_quiz_questions, or a ' +
              'bank-drawn question_id returned by this tool). ' +
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

        // An id absent from this list may still be a bank-drawn question, so an
        // unknown question_id is only rejected once the attempts have been scanned.
        let questions = await canvas.quizzes.listQuestions(courseId, quizId)
        if (questionId !== undefined) {
          questions = questions.filter((q) => q.id === questionId)
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
          questions.map((q) => [q.id, toGroup(q, q.position)]),
        )
        const inScope = (id: number) => questionId === undefined || id === questionId

        // Answer ids that are not active quiz questions: bank draws, or questions
        // removed from the quiz after the attempt. See resolveAttemptQuestions.
        const missing = new Set<number>()
        for (const answers of answersBySubmission.values()) {
          for (const answer of answers) {
            if (inScope(answer.id) && !groups.has(answer.id)) missing.add(answer.id)
          }
        }
        if (missing.size > 0) {
          const resolved = await resolveAttemptQuestions(
            canvas,
            courseId,
            quizId,
            submissions,
            answersBySubmission,
            missing,
          )
          // After the fixed questions, in id order: a bank draw's per-attempt
          // position differs between students, so it is not a stable sort key.
          for (const question of resolved.sort((a, b) => a.id - b.id)) {
            groups.set(question.id, toGroup(question, null))
          }
        }

        if (questionId !== undefined && !groups.has(questionId) && !missing.has(questionId)) {
          const failedNote =
            submissionsFailed.length > 0
              ? ` (answers could not be fetched for ${submissionsFailed.length} submission(s), ` +
                `so a question drawn only in those attempts would not be found)`
              : ''
          throw new Error(`Question ${questionId} not found on quiz ${quizId}${failedNote}.`)
        }

        // Responses whose question is neither an active question nor resolvable
        // from the attempt are counted, so an identifier mismatch cannot look like
        // a complete result.
        const unmatchedQuestionIds = new Set<number>()
        let unmatchedResponseCount = 0
        for (const submission of submissions) {
          const answers = answersBySubmission.get(submission.id)
          if (!answers) continue
          for (const answer of answers) {
            if (!inScope(answer.id)) continue // another question, excluded by question_id
            const group = groups.get(answer.id)
            if (!group) {
              unmatchedQuestionIds.add(answer.id)
              unmatchedResponseCount++
              continue
            }
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
          unmatched_response_count: unmatchedResponseCount,
          unmatched_question_ids: [...unmatchedQuestionIds].sort((a, b) => a - b),
        }
      },
    },
  ]
}
