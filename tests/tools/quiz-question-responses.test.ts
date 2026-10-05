import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import type {
  CanvasQuiz,
  CanvasQuizQuestion,
  CanvasQuizSubmission,
  CanvasQuizSubmissionQuestion,
  CanvasUser,
} from '../../src/canvas/types'
import type { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import { quizQuestionResponseTools } from '../../src/tools/quiz-question-responses'
import { getAllTools } from '../../src/tools'

// ── Output shape (mirrors the handler's return; tests aren't typechecked) ──────

interface ResponseRow {
  user_id: number
  user_name: string | null
  quiz_submission_id: number
  attempt: number
  answer: unknown
  correct: boolean | null
  flagged: boolean
}

interface QuestionGroupOut {
  question_id: number
  question_text: string
  question_type: string
  position: number | null
  points_possible: number
  needs_manual_grading: boolean
  responses: ResponseRow[]
}

interface Result {
  quiz_id: number
  quiz_title: string
  question_count: number
  questions: QuestionGroupOut[]
  submissions_scanned: number
  submissions_failed: number[]
  unmatched_response_count: number
  unmatched_question_ids: number[]
}

// ── Fixtures — built to match src/canvas/types.ts, not copied from the existing
//    quizzes.test.ts mocks which carry fields absent from the real interfaces. ──

const defaultQuiz: CanvasQuiz = {
  id: 1,
  title: 'Essay Quiz',
  quiz_type: 'assignment',
  points_possible: 20,
  question_count: 2,
  due_at: null,
  published: true,
}

// Q1 is an essay (manually graded); Q2 is auto-graded. listQuestions returns them
// out of position order to exercise the position sort.
const q1Essay: CanvasQuizQuestion = {
  id: 10,
  quiz_id: 1,
  position: 1,
  question_text: 'Explain photosynthesis.',
  question_type: 'essay_question',
  points_possible: 10,
}
const q2Mc: CanvasQuizQuestion = {
  id: 20,
  quiz_id: 1,
  position: 2,
  question_text: 'What is 2 + 2?',
  question_type: 'multiple_choice_question',
  points_possible: 10,
}

const subComplete: CanvasQuizSubmission = {
  id: 100,
  quiz_id: 1,
  user_id: 5,
  submission_id: 500,
  attempt: 1,
  score: null,
  kept_score: null,
  workflow_state: 'complete',
}
const subPendingReview: CanvasQuizSubmission = {
  id: 101,
  quiz_id: 1,
  user_id: 6,
  submission_id: 501,
  attempt: 2,
  score: null,
  kept_score: null,
  workflow_state: 'pending_review',
}

const answersForSub100: CanvasQuizSubmissionQuestion[] = [
  {
    id: 10,
    quiz_id: 1,
    answer: 'Plants convert light to chemical energy.',
    correct: null,
    flagged: false,
  },
  { id: 20, quiz_id: 1, answer: '4', correct: true, flagged: false },
]
const answersForSub101: CanvasQuizSubmissionQuestion[] = [
  // `correct` intentionally omitted here to exercise the `?? null` passthrough.
  { id: 10, quiz_id: 1, answer: 'It uses sunlight.', flagged: false },
  { id: 20, quiz_id: 1, answer: '5', correct: false, flagged: true },
]

const alice: CanvasUser = { id: 5, name: 'Alice Anderson' }
const bob: CanvasUser = { id: 6, name: 'Bob Brown' }

interface MockOpts {
  quiz?: CanvasQuiz
  questions?: CanvasQuizQuestion[]
  submissions?: CanvasQuizSubmission[]
  answersBySubmission?: Record<number, CanvasQuizSubmissionQuestion[]>
  answersImpl?: (subId: number) => Promise<CanvasQuizSubmissionQuestion[]>
  // Questions Canvas returns for one submission attempt (listSubmissionQuestions).
  attemptQuestionsImpl?: (subId: number, attempt: number) => Promise<CanvasQuizQuestion[]>
  students?: CanvasUser[]
}

function buildMockCanvas(opts: MockOpts = {}): CanvasClient {
  const answers = opts.answersBySubmission ?? { 100: answersForSub100, 101: answersForSub101 }
  const getSubmissionAnswers = opts.answersImpl
    ? vi.fn().mockImplementation(opts.answersImpl)
    : vi.fn().mockImplementation((subId: number) => Promise.resolve(answers[subId] ?? []))
  return {
    quizzes: {
      get: vi.fn().mockResolvedValue(opts.quiz ?? defaultQuiz),
      listQuestions: vi.fn().mockResolvedValue(opts.questions ?? [q2Mc, q1Essay]),
      listSubmissions: vi
        .fn()
        .mockResolvedValue(opts.submissions ?? [subComplete, subPendingReview]),
      getSubmissionAnswers,
      listSubmissionQuestions: vi
        .fn()
        .mockImplementation(
          (_courseId: number, _quizId: number, subId: number, attempt: number) =>
            opts.attemptQuestionsImpl?.(subId, attempt) ?? Promise.resolve([]),
        ),
    },
    users: {
      listStudents: vi.fn().mockResolvedValue(opts.students ?? [alice, bob]),
      listCourseUsers: vi.fn().mockResolvedValue([]),
    },
  } as unknown as CanvasClient
}

function getTool(canvas: CanvasClient, pseudonymizer?: Pseudonymizer) {
  const tool = quizQuestionResponseTools(canvas, pseudonymizer).find(
    (t) => t.name === 'get_quiz_question_responses',
  )
  if (!tool) throw new Error('get_quiz_question_responses not registered')
  return tool
}

describe('quizQuestionResponseTools', () => {
  it('exports exactly the get_quiz_question_responses tool', () => {
    const names = quizQuestionResponseTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual(['get_quiz_question_responses'])
  })

  describe('annotations and audience', () => {
    it('is read-only with openWorldHint and no destructiveHint', () => {
      const tool = getTool(buildMockCanvas())
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
      expect(tool.annotations.destructiveHint).toBeUndefined()
    })

    it('resolves to the educator audience (no override on the tool)', () => {
      const tool = getTool(buildMockCanvas())
      expect(tool.audience).toBeUndefined()
      const resolved = getAllTools(buildMockCanvas()).find(
        (t) => t.name === 'get_quiz_question_responses',
      )
      expect(resolved?.audience).toBe('educator')
    })
  })

  describe('pivot behaviour', () => {
    it('pivots every question with every response, ordered by position', async () => {
      const canvas = buildMockCanvas()
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: 1, quiz_id: 1 })) as Result

      expect(result.quiz_id).toBe(1)
      expect(result.quiz_title).toBe('Essay Quiz')
      expect(result.question_count).toBe(2)
      expect(result.submissions_scanned).toBe(2)
      expect(result.submissions_failed).toEqual([])
      expect(result.unmatched_response_count).toBe(0)
      expect(result.unmatched_question_ids).toEqual([])
      // Every answer matched an active question, so no per-attempt lookup is made.
      expect(canvas.quizzes.listSubmissionQuestions).not.toHaveBeenCalled()

      // Sorted by position: Q1 (essay, pos 1) then Q2 (mc, pos 2).
      expect(result.questions.map((q) => q.question_id)).toEqual([10, 20])

      const [essay, mc] = result.questions
      expect(essay.needs_manual_grading).toBe(true)
      expect(essay.points_possible).toBe(10)
      expect(mc.needs_manual_grading).toBe(false)

      // Each question has one response per scanned submission, in submission order.
      expect(essay.responses.map((r) => r.user_id)).toEqual([5, 6])
      expect(essay.responses[0]).toMatchObject({
        user_id: 5,
        user_name: 'Alice Anderson',
        quiz_submission_id: 100,
        attempt: 1,
        answer: 'Plants convert light to chemical energy.',
        correct: null,
        flagged: false,
      })
      expect(mc.responses.map((r) => r.answer)).toEqual(['4', '5'])
    })

    it('scopes to a single question when question_id is provided', async () => {
      const canvas = buildMockCanvas()
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: 1, quiz_id: 1, question_id: 20 })) as Result

      expect(result.question_count).toBe(1)
      expect(result.questions).toHaveLength(1)
      expect(result.questions[0].question_id).toBe(20)
      expect(result.questions[0].responses).toHaveLength(2)
    })

    it('rejects an unknown question_id with a "not found" message', async () => {
      const canvas = buildMockCanvas()
      const tool = getTool(canvas)
      let message = ''
      try {
        await tool.handler({ course_id: 1, quiz_id: 1, question_id: 999 })
      } catch (err) {
        message = (err as Error).message
      }
      expect(message).toContain('not found')
      expect(message).toContain('999')
    })
  })

  describe('New Quizzes gating', () => {
    it('rejects a New Quiz before making any further Canvas calls', async () => {
      const canvas = buildMockCanvas({ quiz: { ...defaultQuiz, quiz_type: 'quizzes.next' } })
      const tool = getTool(canvas)

      let message = ''
      try {
        await tool.handler({ course_id: 1, quiz_id: 1 })
      } catch (err) {
        message = (err as Error).message
      }
      expect(message).toContain('quizzes.next')
      expect(message).toContain('New Quizzes')

      expect(canvas.quizzes.listQuestions).not.toHaveBeenCalled()
      expect(canvas.quizzes.listSubmissions).not.toHaveBeenCalled()
      expect(canvas.quizzes.getSubmissionAnswers).not.toHaveBeenCalled()
      expect(canvas.users.listStudents).not.toHaveBeenCalled()
    })
  })

  describe('workflow-state filtering', () => {
    it('scans only responded submissions (excludes untaken)', async () => {
      const untaken: CanvasQuizSubmission = {
        ...subComplete,
        id: 102,
        user_id: 7,
        workflow_state: 'untaken',
      }
      const canvas = buildMockCanvas({ submissions: [subComplete, untaken] })
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: 1, quiz_id: 1 })) as Result

      expect(result.submissions_scanned).toBe(1)
      expect(canvas.quizzes.getSubmissionAnswers).toHaveBeenCalledTimes(1)
      expect(canvas.quizzes.getSubmissionAnswers).toHaveBeenCalledWith(100)
    })

    it('includes pending_review submissions (essays awaiting grading)', async () => {
      const canvas = buildMockCanvas({ submissions: [subPendingReview] })
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: 1, quiz_id: 1 })) as Result

      expect(result.submissions_scanned).toBe(1)
      expect(canvas.quizzes.getSubmissionAnswers).toHaveBeenCalledWith(101)
      expect(result.questions[0].responses.map((r) => r.quiz_submission_id)).toContain(101)
    })
  })

  describe('per-submission failure tolerance', () => {
    it('records a failed answer-fetch without aborting the whole call', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const canvas = buildMockCanvas({
        answersImpl: (subId) =>
          subId === 100 ? Promise.resolve(answersForSub100) : Promise.reject(new Error('boom')),
      })
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: 1, quiz_id: 1 })) as Result

      expect(result.submissions_failed).toEqual([101])
      // The healthy submission's answers are still pivoted in.
      const essay = result.questions.find((q) => q.question_id === 10)!
      expect(essay.responses.map((r) => r.quiz_submission_id)).toEqual([100])
      expect(errorSpy).toHaveBeenCalled()
      errorSpy.mockRestore()
    })
  })

  describe('correct passthrough', () => {
    it('surfaces correct verbatim and null when Canvas omits it', async () => {
      const canvas = buildMockCanvas()
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: 1, quiz_id: 1 })) as Result

      const mc = result.questions.find((q) => q.question_id === 20)!
      const bySub = new Map(mc.responses.map((r) => [r.quiz_submission_id, r.correct]))
      expect(bySub.get(100)).toBe(true) // correct: true
      expect(bySub.get(101)).toBe(false) // correct: false

      const essay = result.questions.find((q) => q.question_id === 10)!
      const essayBySub = new Map(essay.responses.map((r) => [r.quiz_submission_id, r.correct]))
      expect(essayBySub.get(100)).toBeNull() // correct: null
      expect(essayBySub.get(101)).toBeNull() // correct omitted -> null
    })
  })

  describe('pseudonymizer', () => {
    it('uses raw student names when no pseudonymizer is passed', async () => {
      const canvas = buildMockCanvas()
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: 1, quiz_id: 1 })) as Result

      const names = result.questions[0].responses.map((r) => r.user_name)
      expect(names).toEqual(['Alice Anderson', 'Bob Brown'])
    })

    it('replaces names via anonymizeUsers when enabled, using the student roster', async () => {
      const canvas = buildMockCanvas()
      const pseudonymizer = {
        isEnabled: () => true,
        anonymizeUsers: vi.fn(async (_courseId: number, users: CanvasUser[]) =>
          users.map((u) => ({ ...u, name: `Student ${u.id}` })),
        ),
      } as unknown as Pseudonymizer

      const tool = getTool(canvas, pseudonymizer)
      const result = (await tool.handler({ course_id: 1, quiz_id: 1 })) as Result

      const names = result.questions[0].responses.map((r) => r.user_name)
      expect(names).toEqual(['Student 5', 'Student 6'])
      expect(canvas.users.listStudents).toHaveBeenCalledWith(1)
      expect(canvas.users.listCourseUsers).not.toHaveBeenCalled()
    })

    it('does not call anonymizeUsers when the pseudonymizer is disabled', async () => {
      const canvas = buildMockCanvas()
      const anonymizeUsers = vi.fn()
      const pseudonymizer = {
        isEnabled: () => false,
        anonymizeUsers,
      } as unknown as Pseudonymizer

      const tool = getTool(canvas, pseudonymizer)
      const result = (await tool.handler({ course_id: 1, quiz_id: 1 })) as Result

      expect(anonymizeUsers).not.toHaveBeenCalled()
      expect(result.questions[0].responses[0].user_name).toBe('Alice Anderson')
    })
  })

  describe('unrostered submitter', () => {
    it('sets user_name to null when the submitter is not on the roster', async () => {
      const strayUser: CanvasQuizSubmission = { ...subComplete, id: 103, user_id: 99 }
      const canvas = buildMockCanvas({
        submissions: [strayUser],
        answersBySubmission: {
          103: [{ id: 10, quiz_id: 1, answer: 'Ghost answer', flagged: false }],
        },
        students: [alice, bob], // user 99 absent
      })
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: 1, quiz_id: 1 })) as Result

      const essay = result.questions.find((q) => q.question_id === 10)!
      expect(essay.responses).toHaveLength(1)
      expect(essay.responses[0]).toMatchObject({ user_id: 99, user_name: null })
    })
  })

  describe('empty states', () => {
    it('returns questions with empty responses when no submissions exist', async () => {
      const canvas = buildMockCanvas({ submissions: [] })
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: 1, quiz_id: 1 })) as Result

      expect(result.submissions_scanned).toBe(0)
      expect(result.submissions_failed).toEqual([])
      expect(result.question_count).toBe(2)
      expect(result.questions.every((q) => q.responses.length === 0)).toBe(true)
      expect(canvas.quizzes.getSubmissionAnswers).not.toHaveBeenCalled()
    })

    it('returns an empty question list when the quiz has no questions', async () => {
      const canvas = buildMockCanvas({ questions: [] })
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: 1, quiz_id: 1 })) as Result

      expect(result.question_count).toBe(0)
      expect(result.questions).toEqual([])
    })
  })

  describe('question-bank (generated) questions', () => {
    // A quiz with one fixed essay (id 10) plus a question group linked to a bank.
    // Canvas materialises each bank draw as a `generated` QuizQuestion row, which
    // GET .../quizzes/:id/questions (active questions only) never returns, while
    // GET /quiz_submissions/:id/questions answers under the generated id.
    // Source: instructure/canvas-lms@1c9f0bb, see src/tools/quiz-question-responses.ts.
    const carol: CanvasUser = { id: 7, name: 'Carol Chen' }
    const subCarol: CanvasQuizSubmission = { ...subComplete, id: 102, user_id: 7, attempt: 1 }

    function bankQuestion(id: number, type: string, position: number): CanvasQuizQuestion {
      // As served per attempt: position is that attempt's order and
      // points_possible is the group's question_points.
      return {
        id,
        quiz_id: 1,
        position,
        question_text: `Bank question ${id}`,
        question_type: type,
        points_possible: 3,
      }
    }
    const bankEssay = bankQuestion(7001, 'essay_question', 2)
    const bankMc = bankQuestion(7002, 'multiple_choice_question', 2)
    const fixedInAttempt: CanvasQuizQuestion = { ...q1Essay, position: 1 }

    // First-seen order (7002 before 7001) deliberately differs from id order.
    const bankAnswers: Record<number, CanvasQuizSubmissionQuestion[]> = {
      100: [
        { id: 10, quiz_id: 1, answer: 'Alice essay', correct: null, flagged: false },
        { id: 7002, quiz_id: 1, answer: '3', correct: true, flagged: false },
      ],
      101: [
        { id: 10, quiz_id: 1, answer: 'Bob essay', correct: null, flagged: false },
        { id: 7001, quiz_id: 1, answer: 'Bob bank essay', correct: null, flagged: true },
      ],
      102: [
        { id: 10, quiz_id: 1, answer: 'Carol essay', correct: null, flagged: false },
        { id: 7002, quiz_id: 1, answer: '4', correct: false, flagged: false },
      ],
    }
    const attemptQuestions: Record<number, CanvasQuizQuestion[]> = {
      100: [fixedInAttempt, bankMc],
      101: [fixedInAttempt, bankEssay],
      102: [fixedInAttempt, bankMc],
    }

    function bankCanvas(overrides: Partial<MockOpts> = {}): CanvasClient {
      return buildMockCanvas({
        questions: [q1Essay],
        submissions: [subComplete, subPendingReview, subCarol],
        answersBySubmission: bankAnswers,
        attemptQuestionsImpl: (subId) => Promise.resolve(attemptQuestions[subId] ?? []),
        students: [alice, bob, carol],
        ...overrides,
      })
    }

    it('retains responses to questions absent from listQuestions', async () => {
      const canvas = bankCanvas()
      const result = (await getTool(canvas).handler({ course_id: 1, quiz_id: 1 })) as Result

      expect(result.question_count).toBe(3)
      // Fixed questions by position first, then attempt-resolved questions by id.
      expect(result.questions.map((q) => q.question_id)).toEqual([10, 7001, 7002])
      expect(result.unmatched_response_count).toBe(0)
      expect(result.unmatched_question_ids).toEqual([])

      const essay = result.questions.find((q) => q.question_id === 7001)!
      expect(essay).toEqual({
        question_id: 7001,
        question_text: 'Bank question 7001',
        question_type: 'essay_question',
        // Bank draws are shuffled per attempt, so there is no quiz-level position.
        position: null,
        points_possible: 3,
        needs_manual_grading: true,
        responses: [
          {
            user_id: 6,
            user_name: 'Bob Brown',
            quiz_submission_id: 101,
            attempt: 2,
            answer: 'Bob bank essay',
            correct: null,
            flagged: true,
          },
        ],
      })

      const mc = result.questions.find((q) => q.question_id === 7002)!
      expect(mc.needs_manual_grading).toBe(false)
      expect(mc.responses.map((r) => [r.quiz_submission_id, r.user_name, r.answer])).toEqual([
        [100, 'Alice Anderson', '3'],
        [102, 'Carol Chen', '4'],
      ])

      // The fixed question keeps its listQuestions metadata and all three responses.
      const fixed = result.questions.find((q) => q.question_id === 10)!
      expect(fixed.position).toBe(1)
      expect(fixed.responses.map((r) => r.quiz_submission_id)).toEqual([100, 101, 102])
    })

    it('looks up only the attempts needed to cover the unmatched ids', async () => {
      const canvas = bankCanvas()
      await getTool(canvas).handler({ course_id: 1, quiz_id: 1 })

      // 102 drew the same generated row as 100, so it needs no lookup of its own.
      expect(canvas.quizzes.listSubmissionQuestions).toHaveBeenCalledTimes(2)
      expect(canvas.quizzes.listSubmissionQuestions).toHaveBeenCalledWith(1, 1, 100, 1)
      expect(canvas.quizzes.listSubmissionQuestions).toHaveBeenCalledWith(1, 1, 101, 2)
    })

    it('selects a bank-drawn question by question_id', async () => {
      const canvas = bankCanvas()
      const result = (await getTool(canvas).handler({
        course_id: 1,
        quiz_id: 1,
        question_id: 7002,
      })) as Result

      expect(result.question_count).toBe(1)
      expect(result.questions.map((q) => q.question_id)).toEqual([7002])
      expect(result.questions[0].responses.map((r) => r.quiz_submission_id)).toEqual([100, 102])
      expect(result.unmatched_response_count).toBe(0)
      expect(canvas.quizzes.listSubmissionQuestions).toHaveBeenCalledTimes(1)
      expect(canvas.quizzes.listSubmissionQuestions).toHaveBeenCalledWith(1, 1, 100, 1)
    })

    it('makes no attempt lookup when question_id names a fixed question', async () => {
      const canvas = bankCanvas()
      const result = (await getTool(canvas).handler({
        course_id: 1,
        quiz_id: 1,
        question_id: 10,
      })) as Result

      expect(result.questions.map((q) => q.question_id)).toEqual([10])
      expect(result.questions[0].responses).toHaveLength(3)
      // Answers to other questions are out of scope, not unmatched.
      expect(result.unmatched_response_count).toBe(0)
      expect(result.unmatched_question_ids).toEqual([])
      expect(canvas.quizzes.listSubmissionQuestions).not.toHaveBeenCalled()
    })

    it('reports responses whose question lookup failed instead of dropping them', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const canvas = bankCanvas({
        attemptQuestionsImpl: (subId) =>
          subId === 100
            ? Promise.reject(new Error('boom'))
            : Promise.resolve(attemptQuestions[subId] ?? []),
      })
      const result = (await getTool(canvas).handler({ course_id: 1, quiz_id: 1 })) as Result

      // 7002 (answered in 100 and 102) could not be resolved; 7001 still was.
      expect(result.questions.map((q) => q.question_id)).toEqual([10, 7001])
      expect(result.question_count).toBe(2)
      expect(result.unmatched_question_ids).toEqual([7002])
      expect(result.unmatched_response_count).toBe(2)
      expect(result.submissions_scanned).toBe(3)
      expect(result.submissions_failed).toEqual([])
      expect(errorSpy).toHaveBeenCalled()
      errorSpy.mockRestore()
    })

    it('reports rather than throws when a selected bank question cannot be resolved', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const canvas = bankCanvas({ attemptQuestionsImpl: () => Promise.reject(new Error('boom')) })
      const result = (await getTool(canvas).handler({
        course_id: 1,
        quiz_id: 1,
        question_id: 7002,
      })) as Result

      expect(result.question_count).toBe(0)
      expect(result.questions).toEqual([])
      expect(result.unmatched_question_ids).toEqual([7002])
      expect(result.unmatched_response_count).toBe(2)
      errorSpy.mockRestore()
    })
  })

  describe('join-key robustness', () => {
    // The pivot's load-bearing assumption is CanvasQuizSubmissionQuestion.id ===
    // CanvasQuizQuestion.id. If an answer's id resolves to no question even after
    // the attempt lookup, the result must say so rather than look complete.
    it('surfaces an answer whose id matches no question', async () => {
      const canvas = buildMockCanvas({
        submissions: [subComplete],
        answersBySubmission: {
          100: [
            { id: 999, quiz_id: 1, answer: 'orphan answer', flagged: false },
            { id: 10, quiz_id: 1, answer: 'real essay answer', correct: null, flagged: false },
          ],
        },
        // The attempt lookup succeeds but does not know id 999 either.
        attemptQuestionsImpl: () => Promise.resolve([q1Essay]),
      })
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: 1, quiz_id: 1 })) as Result

      const essay = result.questions.find((q) => q.question_id === 10)!
      expect(essay.responses.map((r) => r.answer)).toEqual(['real essay answer'])
      expect(result.questions.some((q) => q.question_id === 999)).toBe(false)
      expect(result.unmatched_question_ids).toEqual([999])
      expect(result.unmatched_response_count).toBe(1)
    })
  })

  describe('multiple submissions per student', () => {
    it('keeps one response row per submission when a user appears twice', async () => {
      const attempt1: CanvasQuizSubmission = { ...subComplete, id: 100, user_id: 5, attempt: 1 }
      const attempt2: CanvasQuizSubmission = { ...subComplete, id: 101, user_id: 5, attempt: 2 }
      const canvas = buildMockCanvas({
        submissions: [attempt1, attempt2],
        answersBySubmission: {
          100: [{ id: 10, quiz_id: 1, answer: 'first attempt', correct: null, flagged: false }],
          101: [{ id: 10, quiz_id: 1, answer: 'second attempt', correct: null, flagged: false }],
        },
      })
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: 1, quiz_id: 1 })) as Result

      const essay = result.questions.find((q) => q.question_id === 10)!
      expect(essay.responses.map((r) => r.quiz_submission_id)).toEqual([100, 101])
      expect(essay.responses.map((r) => r.attempt)).toEqual([1, 2])
      // Both rows resolve to the same student identity.
      expect(essay.responses.every((r) => r.user_name === 'Alice Anderson')).toBe(true)
    })
  })
})
