import { describe, it, expect, vi } from 'vitest'
import { type CanvasId, compareCanvasIds } from '../../src/canvas/id'
import type { CanvasClient } from '../../src/canvas'
import type {
  CanvasQuiz,
  CanvasQuizQuestion,
  CanvasQuizSubmission,
  CanvasQuizSubmissionQuestion,
  CanvasSubmission,
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
  answer: Record<string, unknown> | null
  correct: boolean | 'partial' | 'no_score' | 'undefined' | 'defined' | null
  scoring_state: string
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
  answer_text_available: boolean
  answer_text_unavailable_reason: string | null
}

// ── Fixtures — built to match src/canvas/types.ts, not copied from the existing
//    quizzes.test.ts mocks which carry fields absent from the real interfaces. ──

const defaultQuiz: CanvasQuiz = {
  id: '1',
  title: 'Essay Quiz',
  quiz_type: 'assignment',
  points_possible: 20,
  question_count: 2,
  due_at: null,
  published: true,
  assignment_id: '900',
}

// Q1 is an essay (manually graded); Q2 is auto-graded. listQuestions returns them
// out of position order to exercise the position sort.
const q1Essay: CanvasQuizQuestion = {
  id: '10',
  quiz_id: '1',
  position: 1,
  question_text: 'Explain photosynthesis.',
  question_type: 'essay_question',
  points_possible: 10,
}
const q2Mc: CanvasQuizQuestion = {
  id: '20',
  quiz_id: '1',
  position: 2,
  question_text: 'What is 2 + 2?',
  question_type: 'multiple_choice_question',
  points_possible: 10,
}

const subComplete: CanvasQuizSubmission = {
  id: '100',
  quiz_id: '1',
  user_id: '5',
  submission_id: '500',
  attempt: 1,
  score: null,
  kept_score: null,
  workflow_state: 'complete',
}
const subPendingReview: CanvasQuizSubmission = {
  id: '101',
  quiz_id: '1',
  user_id: '6',
  submission_id: '501',
  attempt: 2,
  score: null,
  kept_score: null,
  workflow_state: 'pending_review',
}

// Real graded shape (BRU-3080): `answer` is NEVER present for a submitted
// attempt (the else-branch of quiz_submission_question_json never assigns
// it); `correct` carries the real five-value-plus-absent domain; `flagged`
// is `false` when a graded entry exists and absent otherwise — never the
// student's real flag state post-submission.
const answersForSub100: CanvasQuizSubmissionQuestion[] = [
  { id: '10', quiz_id: '1', correct: 'undefined', flagged: false }, // essay awaiting manual grading
  { id: '20', quiz_id: '1', correct: true, flagged: false },
]
const answersForSub101: CanvasQuizSubmissionQuestion[] = [
  // `return data if question_data.empty?`: no graded entry for this question
  // at all, so neither `correct` nor `flagged` is present.
  { id: '10', quiz_id: '1' },
  { id: '20', quiz_id: '1', correct: false, flagged: false },
]

const alice: CanvasUser = { id: '5', name: 'Alice Anderson' }
const bob: CanvasUser = { id: '6', name: 'Bob Brown' }

// The submitted answer TEXT lives in the Submissions API's quiz branch
// (`include[]=submission_history`), joined on (user_id, attempt, question_id)
// — a completely separate Canvas call from `getSubmissionAnswers` above.
function historySubmission(
  userId: CanvasId,
  attempt: number,
  submissionData: ReadonlyArray<Record<string, unknown>>,
): CanvasSubmission {
  return {
    user_id: userId,
    submission_history: [{ attempt, submission_data: submissionData }],
  } as unknown as CanvasSubmission
}

const defaultAssignmentSubmissions: CanvasSubmission[] = [
  historySubmission('5', 1, [
    {
      question_id: '10',
      correct: 'undefined',
      points: null,
      text: 'Plants convert light to chemical energy.',
    },
    { question_id: '20', correct: true, points: 10, text: '4', answer_id: '201' },
  ]),
  historySubmission('6', 2, [
    { question_id: '20', correct: false, points: 0, text: '5', answer_id: '202' },
  ]),
]

interface MockOpts {
  quiz?: CanvasQuiz
  questions?: CanvasQuizQuestion[]
  submissions?: CanvasQuizSubmission[]
  answersBySubmission?: Record<number, CanvasQuizSubmissionQuestion[]>
  answersImpl?: (subId: CanvasId) => Promise<CanvasQuizSubmissionQuestion[]>
  // Questions Canvas returns for one submission attempt (listSubmissionQuestions).
  attemptQuestionsImpl?: (subId: CanvasId, attempt: number) => Promise<CanvasQuizQuestion[]>
  students?: CanvasUser[]
  // canvas.submissions.list mock for the submission-history answer-text fetch.
  // Defaults to an empty, successful fetch (answer_text_available: true, every
  // answer null) unless a test needs the real join exercised or a failure path.
  assignmentSubmissions?: CanvasSubmission[]
  submissionsListImpl?: (
    courseId: CanvasId,
    assignmentId: CanvasId,
    opts: unknown,
  ) => Promise<CanvasSubmission[]>
}

function buildMockCanvas(opts: MockOpts = {}): CanvasClient {
  const answers = opts.answersBySubmission ?? { 100: answersForSub100, 101: answersForSub101 }
  const getSubmissionAnswers = opts.answersImpl
    ? vi.fn().mockImplementation(opts.answersImpl)
    : vi.fn().mockImplementation((subId: number) => Promise.resolve(answers[subId] ?? []))
  const submissionsList = opts.submissionsListImpl
    ? vi.fn().mockImplementation(opts.submissionsListImpl)
    : vi.fn().mockResolvedValue(opts.assignmentSubmissions ?? [])
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
          (_courseId: CanvasId, _quizId: CanvasId, subId: CanvasId, attempt: number) =>
            opts.attemptQuestionsImpl?.(subId, attempt) ?? Promise.resolve([]),
        ),
    },
    users: {
      listStudents: vi.fn().mockResolvedValue(opts.students ?? [alice, bob]),
      listCourseUsers: vi.fn().mockResolvedValue([]),
    },
    submissions: {
      list: submissionsList,
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
    it('pivots every question with every response, ordered by position, with submitted answer text joined in', async () => {
      const canvas = buildMockCanvas({ assignmentSubmissions: defaultAssignmentSubmissions })
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: '1', quiz_id: '1' })) as Result

      expect(result.quiz_id).toBe('1')
      expect(result.quiz_title).toBe('Essay Quiz')
      expect(result.question_count).toBe(2)
      expect(result.submissions_scanned).toBe(2)
      expect(result.submissions_failed).toEqual([])
      expect(result.unmatched_response_count).toBe(0)
      expect(result.unmatched_question_ids).toEqual([])
      expect(result.answer_text_available).toBe(true)
      expect(result.answer_text_unavailable_reason).toBeNull()
      // Every answer matched an active question, so no per-attempt lookup is made.
      expect(canvas.quizzes.listSubmissionQuestions).not.toHaveBeenCalled()
      // Fetched once per quiz call, not once per submission.
      expect(canvas.submissions.list).toHaveBeenCalledTimes(1)
      expect(canvas.submissions.list).toHaveBeenCalledWith('1', '900', {
        include: ['submission_history'],
      })

      // Sorted by position: Q1 (essay, pos 1) then Q2 (mc, pos 2).
      expect(result.questions.map((q) => q.question_id)).toEqual(['10', '20'])

      const [essay, mc] = result.questions
      expect(essay.needs_manual_grading).toBe(true)
      expect(essay.points_possible).toBe(10)
      expect(mc.needs_manual_grading).toBe(false)

      // Each question has one response per scanned submission, in submission order.
      expect(essay.responses.map((r) => r.user_id)).toEqual(['5', '6'])
      expect(essay.responses[0]).toEqual({
        user_id: '5',
        user_name: 'Alice Anderson',
        quiz_submission_id: '100',
        attempt: 1,
        answer: { text: 'Plants convert light to chemical energy.' },
        correct: 'undefined',
        scoring_state: 'awaiting_manual_grading',
      })
      // Bob's essay has no submission-history entry for q10 (see fixture) and
      // no graded entry either (answersForSub101): both diagnostics are null/unscored.
      expect(essay.responses[1]).toEqual({
        user_id: '6',
        user_name: 'Bob Brown',
        quiz_submission_id: '101',
        attempt: 2,
        answer: null,
        correct: null,
        scoring_state: 'unscored',
      })

      expect(mc.responses.map((r) => r.answer)).toEqual([
        { text: '4', answer_id: '201' },
        { text: '5', answer_id: '202' },
      ])
      expect(mc.responses.map((r) => r.correct)).toEqual([true, false])
      expect(mc.responses.map((r) => r.scoring_state)).toEqual(['correct', 'incorrect'])
    })

    it('scopes to a single question when question_id is provided', async () => {
      const canvas = buildMockCanvas()
      const tool = getTool(canvas)
      const result = (await tool.handler({
        course_id: '1',
        quiz_id: '1',
        question_id: '20',
      })) as Result

      expect(result.question_count).toBe(1)
      expect(result.questions).toHaveLength(1)
      expect(result.questions[0].question_id).toBe('20')
      expect(result.questions[0].responses).toHaveLength(2)
    })

    it('rejects an unknown question_id with a "not found" message', async () => {
      const canvas = buildMockCanvas()
      const tool = getTool(canvas)
      let message = ''
      try {
        await tool.handler({ course_id: '1', quiz_id: '1', question_id: '999' })
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
        await tool.handler({ course_id: '1', quiz_id: '1' })
      } catch (err) {
        message = (err as Error).message
      }
      expect(message).toContain('quizzes.next')
      expect(message).toContain('New Quizzes')

      expect(canvas.quizzes.listQuestions).not.toHaveBeenCalled()
      expect(canvas.quizzes.listSubmissions).not.toHaveBeenCalled()
      expect(canvas.quizzes.getSubmissionAnswers).not.toHaveBeenCalled()
      expect(canvas.users.listStudents).not.toHaveBeenCalled()
      expect(canvas.submissions.list).not.toHaveBeenCalled()
    })
  })

  describe('workflow-state filtering', () => {
    it('scans only responded submissions (excludes untaken)', async () => {
      const untaken: CanvasQuizSubmission = {
        ...subComplete,
        id: '102',
        user_id: '7',
        workflow_state: 'untaken',
      }
      const canvas = buildMockCanvas({ submissions: [subComplete, untaken] })
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: '1', quiz_id: '1' })) as Result

      expect(result.submissions_scanned).toBe(1)
      expect(canvas.quizzes.getSubmissionAnswers).toHaveBeenCalledTimes(1)
      expect(canvas.quizzes.getSubmissionAnswers).toHaveBeenCalledWith('100')
    })

    it('includes pending_review submissions (essays awaiting grading)', async () => {
      const canvas = buildMockCanvas({ submissions: [subPendingReview] })
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: '1', quiz_id: '1' })) as Result

      expect(result.submissions_scanned).toBe(1)
      expect(canvas.quizzes.getSubmissionAnswers).toHaveBeenCalledWith('101')
      expect(result.questions[0].responses.map((r) => r.quiz_submission_id)).toContain('101')
    })
  })

  describe('per-submission failure tolerance', () => {
    it('records a failed answer-fetch without aborting the whole call', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const canvas = buildMockCanvas({
        answersImpl: (subId) =>
          subId === '100' ? Promise.resolve(answersForSub100) : Promise.reject(new Error('boom')),
      })
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: '1', quiz_id: '1' })) as Result

      expect(result.submissions_failed).toEqual(['101'])
      // The healthy submission's answers are still pivoted in.
      const essay = result.questions.find((q) => q.question_id === '10')!
      expect(essay.responses.map((r) => r.quiz_submission_id)).toEqual(['100'])
      expect(errorSpy).toHaveBeenCalled()
      errorSpy.mockRestore()
    })
  })

  describe('correct passthrough and scoring_state mapping', () => {
    // The full real CanvasQuizCorrectness domain, plus "no graded entry at
    // all" (undefined) — the derived scoring_state must cover all seven so an
    // LLM caller never has to interpret the raw Canvas string "undefined" or
    // "no_score" itself. BRU-3080 §8 item 2.
    it.each([
      [true, 'correct'],
      [false, 'incorrect'],
      ['partial', 'partial'],
      ['no_score', 'not_scored'],
      ['undefined', 'awaiting_manual_grading'],
      ['defined', 'graded'],
      [undefined, 'unscored'],
    ] as const)('maps raw correct %j to scoring_state %j', async (rawCorrect, expectedState) => {
      const answer: CanvasQuizSubmissionQuestion =
        rawCorrect === undefined
          ? { id: '10', quiz_id: '1' }
          : { id: '10', quiz_id: '1', correct: rawCorrect, flagged: false }
      const canvas = buildMockCanvas({
        submissions: [subComplete],
        answersBySubmission: { 100: [answer] },
      })
      const result = (await getTool(canvas).handler({ course_id: '1', quiz_id: '1' })) as Result

      const essay = result.questions.find((q) => q.question_id === '10')!
      expect(essay.responses[0].correct).toBe(rawCorrect ?? null)
      expect(essay.responses[0].scoring_state).toBe(expectedState)
    })
  })

  describe('submission-history answer text', () => {
    it('reports no_assignment and leaves every answer null for a practice quiz', async () => {
      const canvas = buildMockCanvas({ quiz: { ...defaultQuiz, assignment_id: null } })
      const result = (await getTool(canvas).handler({ course_id: '1', quiz_id: '1' })) as Result

      expect(result.answer_text_available).toBe(false)
      expect(result.answer_text_unavailable_reason).toBe('no_assignment')
      expect(canvas.submissions.list).not.toHaveBeenCalled()
      expect(result.questions.flatMap((q) => q.responses).every((r) => r.answer === null)).toBe(
        true,
      )
    })

    it('reports anonymous_survey and skips the fetch for an anonymous survey', async () => {
      const canvas = buildMockCanvas({
        quiz: { ...defaultQuiz, quiz_type: 'survey', anonymous_submissions: true },
      })
      const result = (await getTool(canvas).handler({ course_id: '1', quiz_id: '1' })) as Result

      expect(result.answer_text_available).toBe(false)
      expect(result.answer_text_unavailable_reason).toBe('anonymous_survey')
      expect(canvas.submissions.list).not.toHaveBeenCalled()
    })

    it('does not skip a non-anonymous survey', async () => {
      const canvas = buildMockCanvas({
        quiz: { ...defaultQuiz, quiz_type: 'survey', anonymous_submissions: false },
        assignmentSubmissions: defaultAssignmentSubmissions,
      })
      const result = (await getTool(canvas).handler({ course_id: '1', quiz_id: '1' })) as Result

      expect(result.answer_text_available).toBe(true)
      expect(canvas.submissions.list).toHaveBeenCalledTimes(1)
    })

    it('reports history_fetch_failed and leaves every answer null when the fetch rejects', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const canvas = buildMockCanvas({
        submissionsListImpl: () => Promise.reject(new Error('Canvas 503')),
      })
      const result = (await getTool(canvas).handler({ course_id: '1', quiz_id: '1' })) as Result

      expect(result.answer_text_available).toBe(false)
      expect(result.answer_text_unavailable_reason).toBe('history_fetch_failed')
      expect(result.questions.flatMap((q) => q.responses).every((r) => r.answer === null)).toBe(
        true,
      )
      expect(errorSpy).toHaveBeenCalled()
      errorSpy.mockRestore()
    })

    describe('answer_details shapes per question type', () => {
      const cases: ReadonlyArray<{
        name: string
        submissionData: Record<string, unknown>
        expectedAnswer: Record<string, unknown>
      }> = [
        {
          name: 'essay_question (text only)',
          submissionData: { question_id: '10', correct: 'undefined', text: 'My essay answer.' },
          expectedAnswer: { text: 'My essay answer.' },
        },
        {
          name: 'file_upload_question (attachment_ids, no text)',
          submissionData: { question_id: '10', correct: 'undefined', attachment_ids: ['55', '56'] },
          expectedAnswer: { attachment_ids: ['55', '56'] },
        },
        {
          name: 'a choice type (text + answer_id)',
          submissionData: { question_id: '10', correct: true, text: 'Paris', answer_id: '301' },
          expectedAnswer: { text: 'Paris', answer_id: '301' },
        },
        {
          name: 'multiple_answers_question (text + per-option answer_<id> keys)',
          submissionData: {
            question_id: '10',
            correct: 'partial',
            text: 'A, C',
            answer_401: '1',
            answer_402: '0',
            answer_403: '1',
          },
          expectedAnswer: { text: 'A, C', answer_401: '1', answer_402: '0', answer_403: '1' },
        },
        {
          name: 'fill_in_multiple_blanks_question (answer_for_<blank> / answer_id_for_<blank> per blank)',
          submissionData: {
            question_id: '10',
            correct: true,
            text: 'blue, 7',
            answer_for_1: 'blue',
            answer_id_for_1: '501',
            answer_for_2: '7',
            answer_id_for_2: '502',
          },
          expectedAnswer: {
            text: 'blue, 7',
            answer_for_1: 'blue',
            answer_id_for_1: '501',
            answer_for_2: '7',
            answer_id_for_2: '502',
          },
        },
        {
          name: 'matching_question (per-part keys)',
          submissionData: { question_id: '10', correct: 'partial', answer_1: '10', answer_2: '11' },
          expectedAnswer: { answer_1: '10', answer_2: '11' },
        },
      ]

      for (const { name, submissionData, expectedAnswer } of cases) {
        it(`joins the ${name} shape through verbatim, stripping only question_id/correct/points`, async () => {
          const canvas = buildMockCanvas({
            submissions: [subComplete],
            answersBySubmission: {
              100: [{ id: '10', quiz_id: '1', correct: true, flagged: false }],
            },
            assignmentSubmissions: [historySubmission('5', 1, [submissionData])],
          })
          const result = (await getTool(canvas).handler({ course_id: '1', quiz_id: '1' })) as Result
          const essay = result.questions.find((q) => q.question_id === '10')!
          expect(essay.responses[0].answer).toEqual(expectedAnswer)
        })
      }
    })
  })

  describe('pseudonymizer', () => {
    it('uses raw student names when no pseudonymizer is passed', async () => {
      const canvas = buildMockCanvas()
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: '1', quiz_id: '1' })) as Result

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
      const result = (await tool.handler({ course_id: '1', quiz_id: '1' })) as Result

      const names = result.questions[0].responses.map((r) => r.user_name)
      expect(names).toEqual(['Student 5', 'Student 6'])
      expect(canvas.users.listStudents).toHaveBeenCalledWith('1')
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
      const result = (await tool.handler({ course_id: '1', quiz_id: '1' })) as Result

      expect(anonymizeUsers).not.toHaveBeenCalled()
      expect(result.questions[0].responses[0].user_name).toBe('Alice Anderson')
    })

    it('replaces the structured user_name even when the essay answer text carries a name', async () => {
      // The disclosed, by-design exception: student-authored prose is never
      // scrubbed (there is no structured field to rewrite inside free text),
      // but the STRUCTURED user_name field must still be pseudonymized. This
      // proves the two are independent — one real name surviving in `answer`
      // is expected; one surviving in `user_name` would be a defect.
      const canvas = buildMockCanvas({
        submissions: [subComplete],
        answersBySubmission: {
          100: [{ id: '10', quiz_id: '1', correct: 'undefined', flagged: false }],
        },
        assignmentSubmissions: [
          historySubmission('5', 1, [
            { question_id: '10', correct: 'undefined', text: "Hi, it's Alice Anderson here!" },
          ]),
        ],
      })
      const pseudonymizer = {
        isEnabled: () => true,
        anonymizeUsers: vi.fn(async (_courseId: number, users: CanvasUser[]) =>
          users.map((u) => ({ ...u, name: `Student ${u.id}` })),
        ),
      } as unknown as Pseudonymizer

      const result = (await getTool(canvas, pseudonymizer).handler({
        course_id: '1',
        quiz_id: '1',
      })) as Result

      const essay = result.questions.find((q) => q.question_id === '10')!
      expect(essay.responses[0].user_name).toBe('Student 5')
      expect(essay.responses[0].user_id).toBe('5')
      // No nested user object or sibling identity field is introduced by the join.
      expect(Object.keys(essay.responses[0]).sort()).toEqual(
        [
          'answer',
          'attempt',
          'correct',
          'quiz_submission_id',
          'scoring_state',
          'user_id',
          'user_name',
        ].sort(),
      )
      expect(essay.responses[0].answer).toEqual({ text: "Hi, it's Alice Anderson here!" })
    })
  })

  describe('unrostered submitter', () => {
    it('sets user_name to null when the submitter is not on the roster', async () => {
      const strayUser: CanvasQuizSubmission = { ...subComplete, id: '103', user_id: '99' }
      const canvas = buildMockCanvas({
        submissions: [strayUser],
        answersBySubmission: {
          103: [{ id: '10', quiz_id: '1', correct: 'undefined', flagged: false }],
        },
        students: [alice, bob], // user 99 absent
      })
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: '1', quiz_id: '1' })) as Result

      const essay = result.questions.find((q) => q.question_id === '10')!
      expect(essay.responses).toHaveLength(1)
      expect(essay.responses[0]).toMatchObject({ user_id: '99', user_name: null })
    })
  })

  describe('empty states', () => {
    it('returns questions with empty responses when no submissions exist', async () => {
      const canvas = buildMockCanvas({ submissions: [] })
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: '1', quiz_id: '1' })) as Result

      expect(result.submissions_scanned).toBe(0)
      expect(result.submissions_failed).toEqual([])
      expect(result.question_count).toBe(2)
      expect(result.questions.every((q) => q.responses.length === 0)).toBe(true)
      expect(canvas.quizzes.getSubmissionAnswers).not.toHaveBeenCalled()
    })

    it('returns an empty question list when the quiz has no questions', async () => {
      const canvas = buildMockCanvas({ questions: [] })
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: '1', quiz_id: '1' })) as Result

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
    const carol: CanvasUser = { id: '7', name: 'Carol Chen' }
    const subCarol: CanvasQuizSubmission = { ...subComplete, id: '102', user_id: '7', attempt: 1 }

    function bankQuestion(id: number, type: string, position: number): CanvasQuizQuestion {
      // As served per attempt: position is that attempt's order and
      // points_possible is the group's question_points. `id` is stringified
      // because a response identifier is a canonical decimal string after
      // PR 2a (BRU-2730 §4.3) — the number was what the shorthand hid.
      return {
        id: String(id),
        quiz_id: '1',
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
        { id: '10', quiz_id: '1', correct: 'undefined', flagged: false },
        { id: '7002', quiz_id: '1', correct: true, flagged: false },
      ],
      101: [
        { id: '10', quiz_id: '1', correct: 'undefined', flagged: false },
        { id: '7001', quiz_id: '1', correct: 'undefined', flagged: false },
      ],
      102: [
        { id: '10', quiz_id: '1', correct: 'undefined', flagged: false },
        { id: '7002', quiz_id: '1', correct: false, flagged: false },
      ],
    }
    const attemptQuestions: Record<number, CanvasQuizQuestion[]> = {
      100: [fixedInAttempt, bankMc],
      101: [fixedInAttempt, bankEssay],
      102: [fixedInAttempt, bankMc],
    }
    const bankSubmissionHistory: CanvasSubmission[] = [
      historySubmission('5', 1, [
        { question_id: '10', correct: 'undefined', text: 'Alice essay' },
        { question_id: '7002', correct: true, text: '3', answer_id: '601' },
      ]),
      historySubmission('6', 2, [
        { question_id: '10', correct: 'undefined', text: 'Bob essay' },
        { question_id: '7001', correct: 'undefined', text: 'Bob bank essay' },
      ]),
      historySubmission('7', 1, [
        { question_id: '10', correct: 'undefined', text: 'Carol essay' },
        { question_id: '7002', correct: false, text: '4', answer_id: '602' },
      ]),
    ]

    function bankCanvas(overrides: Partial<MockOpts> = {}): CanvasClient {
      return buildMockCanvas({
        questions: [q1Essay],
        submissions: [subComplete, subPendingReview, subCarol],
        answersBySubmission: bankAnswers,
        attemptQuestionsImpl: (subId) => Promise.resolve(attemptQuestions[subId] ?? []),
        students: [alice, bob, carol],
        assignmentSubmissions: bankSubmissionHistory,
        ...overrides,
      })
    }

    it('retains responses to questions absent from listQuestions', async () => {
      const canvas = bankCanvas()
      const result = (await getTool(canvas).handler({ course_id: '1', quiz_id: '1' })) as Result

      expect(result.question_count).toBe(3)
      // Fixed questions by position first, then attempt-resolved questions by id.
      expect(result.questions.map((q) => q.question_id)).toEqual(['10', '7001', '7002'])
      expect(result.unmatched_response_count).toBe(0)
      expect(result.unmatched_question_ids).toEqual([])

      const essay = result.questions.find((q) => q.question_id === '7001')!
      expect(essay).toEqual({
        question_id: '7001',
        question_text: 'Bank question 7001',
        question_type: 'essay_question',
        // Bank draws are shuffled per attempt, so there is no quiz-level position.
        position: null,
        points_possible: 3,
        needs_manual_grading: true,
        responses: [
          {
            user_id: '6',
            user_name: 'Bob Brown',
            quiz_submission_id: '101',
            attempt: 2,
            answer: { text: 'Bob bank essay' },
            correct: 'undefined',
            scoring_state: 'awaiting_manual_grading',
          },
        ],
      })

      const mc = result.questions.find((q) => q.question_id === '7002')!
      expect(mc.needs_manual_grading).toBe(false)
      expect(mc.responses.map((r) => [r.quiz_submission_id, r.user_name, r.answer])).toEqual([
        ['100', 'Alice Anderson', { text: '3', answer_id: '601' }],
        ['102', 'Carol Chen', { text: '4', answer_id: '602' }],
      ])

      // The fixed question keeps its listQuestions metadata and all three responses.
      const fixed = result.questions.find((q) => q.question_id === '10')!
      expect(fixed.position).toBe(1)
      expect(fixed.responses.map((r) => r.quiz_submission_id)).toEqual(['100', '101', '102'])
    })

    it('looks up only the attempts needed to cover the unmatched ids', async () => {
      const canvas = bankCanvas()
      await getTool(canvas).handler({ course_id: '1', quiz_id: '1' })

      // 102 drew the same generated row as 100, so it needs no lookup of its own.
      expect(canvas.quizzes.listSubmissionQuestions).toHaveBeenCalledTimes(2)
      expect(canvas.quizzes.listSubmissionQuestions).toHaveBeenCalledWith('1', '1', '100', 1)
      expect(canvas.quizzes.listSubmissionQuestions).toHaveBeenCalledWith('1', '1', '101', 2)
    })

    it('selects a bank-drawn question by question_id', async () => {
      const canvas = bankCanvas()
      const result = (await getTool(canvas).handler({
        course_id: '1',
        quiz_id: '1',
        question_id: '7002',
      })) as Result

      expect(result.question_count).toBe(1)
      expect(result.questions.map((q) => q.question_id)).toEqual(['7002'])
      expect(result.questions[0].responses.map((r) => r.quiz_submission_id)).toEqual(['100', '102'])
      expect(result.unmatched_response_count).toBe(0)
      expect(canvas.quizzes.listSubmissionQuestions).toHaveBeenCalledTimes(1)
      expect(canvas.quizzes.listSubmissionQuestions).toHaveBeenCalledWith('1', '1', '100', 1)
    })

    it('makes no attempt lookup when question_id names a fixed question', async () => {
      const canvas = bankCanvas()
      const result = (await getTool(canvas).handler({
        course_id: '1',
        quiz_id: '1',
        question_id: '10',
      })) as Result

      expect(result.questions.map((q) => q.question_id)).toEqual(['10'])
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
          subId === '100'
            ? Promise.reject(new Error('boom'))
            : Promise.resolve(attemptQuestions[subId] ?? []),
      })
      const result = (await getTool(canvas).handler({ course_id: '1', quiz_id: '1' })) as Result

      // 7002 (answered in 100 and 102) could not be resolved; 7001 still was.
      expect(result.questions.map((q) => q.question_id)).toEqual(['10', '7001'])
      expect(result.question_count).toBe(2)
      expect(result.unmatched_question_ids).toEqual(['7002'])
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
        course_id: '1',
        quiz_id: '1',
        question_id: '7002',
      })) as Result

      expect(result.question_count).toBe(0)
      expect(result.questions).toEqual([])
      expect(result.unmatched_question_ids).toEqual(['7002'])
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
            { id: '999', quiz_id: '1', correct: 'undefined', flagged: false },
            { id: '10', quiz_id: '1', correct: 'undefined', flagged: false },
          ],
        },
        assignmentSubmissions: [
          historySubmission('5', 1, [
            { question_id: '10', correct: 'undefined', text: 'real essay answer' },
          ]),
        ],
        // The attempt lookup succeeds but does not know id 999 either.
        attemptQuestionsImpl: () => Promise.resolve([q1Essay]),
      })
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: '1', quiz_id: '1' })) as Result

      const essay = result.questions.find((q) => q.question_id === '10')!
      expect(essay.responses.map((r) => r.answer)).toEqual([{ text: 'real essay answer' }])
      expect(result.questions.some((q) => q.question_id === '999')).toBe(false)
      expect(result.unmatched_question_ids).toEqual(['999'])
      expect(result.unmatched_response_count).toBe(1)
    })

    it('orders unmatched_question_ids by magnitude, not lexicographically', () => {
      // The ordering of this field was previously unasserted, which made the
      // call site's use of `compareCanvasIds` (BRU-2730 §4.4 - an ID sort must
      // not use `a - b`) invisible to the suite: reverting it to a plain
      // `.sort()` changed nothing any test looked at.
      //
      // The two ids below are chosen so the two orderings disagree: numerically
      // 999 < 7002, lexicographically '7002' < '999'. The magnitude case that
      // only `compareCanvasIds` gets right - two ids differing above 2**53 -
      // cannot be built from a `number`-typed response fixture at all, because
      // both literals collapse to the same double. That case becomes testable
      // when PR 2a widens the response ids to `CanvasId`.
      expect(['7002', '999'].sort(compareCanvasIds)).toEqual(['999', '7002'])
      expect(['7002', '999'].sort()).toEqual(['7002', '999'])
    })

    it('surfaces two unmatched answers in ascending numeric order', async () => {
      const canvas = buildMockCanvas({
        submissions: [subComplete],
        answersBySubmission: {
          100: [
            { id: '7002', quiz_id: '1', correct: 'undefined', flagged: false },
            { id: '999', quiz_id: '1', correct: 'undefined', flagged: false },
          ],
        },
        attemptQuestionsImpl: () => Promise.resolve([]),
      })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = (await getTool(canvas).handler({
        course_id: '1',
        quiz_id: '1',
      })) as Result

      // Input order is descending, so a comparator-less `.sort()` would leave
      // '7002' first. This is the end-to-end half of the assertion above.
      expect(result.unmatched_question_ids).toEqual(['999', '7002'])
      errorSpy.mockRestore()
    })
  })

  describe('multiple submissions per student', () => {
    it('keeps one response row per submission when a user appears twice', async () => {
      const attempt1: CanvasQuizSubmission = { ...subComplete, id: '100', user_id: '5', attempt: 1 }
      const attempt2: CanvasQuizSubmission = { ...subComplete, id: '101', user_id: '5', attempt: 2 }
      const canvas = buildMockCanvas({
        submissions: [attempt1, attempt2],
        answersBySubmission: {
          100: [{ id: '10', quiz_id: '1', correct: 'undefined', flagged: false }],
          101: [{ id: '10', quiz_id: '1', correct: 'undefined', flagged: false }],
        },
        assignmentSubmissions: [
          historySubmission('5', 1, [
            { question_id: '10', correct: 'undefined', text: 'first attempt' },
          ]),
          historySubmission('5', 2, [
            { question_id: '10', correct: 'undefined', text: 'second attempt' },
          ]),
        ],
      })
      const tool = getTool(canvas)
      const result = (await tool.handler({ course_id: '1', quiz_id: '1' })) as Result

      const essay = result.questions.find((q) => q.question_id === '10')!
      expect(essay.responses.map((r) => r.quiz_submission_id)).toEqual(['100', '101'])
      expect(essay.responses.map((r) => r.attempt)).toEqual([1, 2])
      expect(essay.responses.map((r) => r.answer)).toEqual([
        { text: 'first attempt' },
        { text: 'second attempt' },
      ])
      // Both rows resolve to the same student identity.
      expect(essay.responses.every((r) => r.user_name === 'Alice Anderson')).toBe(true)
    })
  })
})
