import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import type {
  CanvasQuiz,
  CanvasQuizSubmission,
  CanvasQuizQuestion,
  CanvasQuizSubmissionQuestion,
} from '../../src/canvas/types'
import { quizTools } from '../../src/tools/quizzes'

describe('quizTools', () => {
  const mockQuiz: CanvasQuiz = {
    id: 1,
    title: 'Midterm Quiz',
    description: '<p>Midterm</p>',
    quiz_type: 'assignment',
    time_limit: 60,
    question_count: 10,
    points_possible: 100,
    published: true,
  }

  const mockQuizSubmission: CanvasQuizSubmission = {
    id: 1,
    quiz_id: 1,
    user_id: 5,
    submission_id: 201,
    started_at: '2026-04-10T12:00:00Z',
    finished_at: '2026-04-10T13:00:00Z',
    score: 80,
    kept_score: 80,
    attempt: 1,
    workflow_state: 'complete',
  }

  const mockQuestion: CanvasQuizQuestion = {
    id: 1,
    quiz_id: 1,
    question_name: 'Q1',
    question_type: 'multiple_choice_question',
    question_text: '<p>What is 2+2?</p>',
    points_possible: 10,
    position: 1,
  }

  const mockSubQuestion: CanvasQuizSubmissionQuestion = {
    id: 1,
    quiz_id: 1,
    question_text: '<p>What is 2+2?</p>',
    position: 1,
    correct: true,
  }

  function buildMockCanvas(): CanvasClient {
    return {
      quizzes: {
        list: vi.fn().mockResolvedValue([mockQuiz]),
        get: vi.fn().mockResolvedValue(mockQuiz),
        listSubmissions: vi.fn().mockResolvedValue([mockQuizSubmission]),
        listQuestions: vi.fn().mockResolvedValue([mockQuestion]),
        getSubmissionAnswers: vi.fn().mockResolvedValue([mockSubQuestion]),
        scoreQuestion: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 6 tool definitions', () => {
    expect(quizTools(buildMockCanvas())).toHaveLength(6)
  })

  it('exports tools with correct names', () => {
    const names = quizTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'list_quizzes',
      'get_quiz',
      'list_quiz_submissions',
      'list_quiz_questions',
      'get_quiz_submission_answers',
      'score_quiz_question',
    ])
  })

  describe('get_quiz', () => {
    it('has read-only annotations', () => {
      const tool = quizTools(buildMockCanvas()).find((t) => t.name === 'get_quiz')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.quizzes.get', async () => {
      const canvas = buildMockCanvas()
      const tool = quizTools(canvas).find((t) => t.name === 'get_quiz')!
      const result = await tool.handler({ course_id: 1, quiz_id: 1 })
      expect(canvas.quizzes.get).toHaveBeenCalledWith(1, 1)
      expect(result).toEqual(mockQuiz)
    })
  })

  describe('list_quiz_submissions', () => {
    it('has read-only annotations', () => {
      const tool = quizTools(buildMockCanvas()).find((t) => t.name === 'list_quiz_submissions')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.quizzes.listSubmissions', async () => {
      const canvas = buildMockCanvas()
      const tool = quizTools(canvas).find((t) => t.name === 'list_quiz_submissions')!
      await tool.handler({ course_id: 1, quiz_id: 1 })
      expect(canvas.quizzes.listSubmissions).toHaveBeenCalledWith(1, 1)
    })
  })

  describe('list_quiz_questions', () => {
    it('has read-only annotations', () => {
      const tool = quizTools(buildMockCanvas()).find((t) => t.name === 'list_quiz_questions')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.quizzes.listQuestions', async () => {
      const canvas = buildMockCanvas()
      const tool = quizTools(canvas).find((t) => t.name === 'list_quiz_questions')!
      await tool.handler({ course_id: 1, quiz_id: 1 })
      expect(canvas.quizzes.listQuestions).toHaveBeenCalledWith(1, 1)
    })
  })

  describe('list_quizzes', () => {
    it('has read-only annotations', () => {
      const tool = quizTools(buildMockCanvas()).find((t) => t.name === 'list_quizzes')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.quizzes.list', async () => {
      const canvas = buildMockCanvas()
      const tool = quizTools(canvas).find((t) => t.name === 'list_quizzes')!
      const result = await tool.handler({ course_id: 1 })
      expect(canvas.quizzes.list).toHaveBeenCalledWith(1)
      expect(result).toEqual([mockQuiz])
    })
  })

  describe('get_quiz_submission_answers', () => {
    it('has read-only annotations', () => {
      const tool = quizTools(buildMockCanvas()).find(
        (t) => t.name === 'get_quiz_submission_answers',
      )!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.quizzes.getSubmissionAnswers', async () => {
      const canvas = buildMockCanvas()
      const tool = quizTools(canvas).find((t) => t.name === 'get_quiz_submission_answers')!
      await tool.handler({ quiz_submission_id: 1 })
      expect(canvas.quizzes.getSubmissionAnswers).toHaveBeenCalledWith(1)
    })
  })

  describe('score_quiz_question', () => {
    it('has destructive, idempotent, and openWorld annotations', () => {
      const tool = quizTools(buildMockCanvas()).find((t) => t.name === 'score_quiz_question')!
      expect(tool.annotations).toEqual({
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      })
    })

    it('delegates to canvas.quizzes.scoreQuestion', async () => {
      const canvas = buildMockCanvas()
      const tool = quizTools(canvas).find((t) => t.name === 'score_quiz_question')!
      await tool.handler({
        course_id: 1,
        quiz_id: 1,
        submission_id: 1,
        question_id: 1,
        score: 10,
        comment: 'Correct!',
      })
      expect(canvas.quizzes.scoreQuestion).toHaveBeenCalledWith(
        1,
        1,
        1,
        1,
        10,
        'Correct!',
        undefined,
      )
    })

    it('returns success object', async () => {
      const canvas = buildMockCanvas()
      const tool = quizTools(canvas).find((t) => t.name === 'score_quiz_question')!
      const result = await tool.handler({
        course_id: 1,
        quiz_id: 1,
        submission_id: 1,
        question_id: 1,
        score: 10,
      })
      expect(result).toEqual({ success: true })
    })

    it('passes attempt parameter when provided', async () => {
      const canvas = buildMockCanvas()
      const tool = quizTools(canvas).find((t) => t.name === 'score_quiz_question')!
      await tool.handler({
        course_id: 1,
        quiz_id: 1,
        submission_id: 1,
        question_id: 1,
        score: 10,
        attempt: 2,
      })
      expect(canvas.quizzes.scoreQuestion).toHaveBeenCalledWith(1, 1, 1, 1, 10, undefined, 2)
    })
  })
})
