import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QuizzesModule } from '../../src/canvas/quizzes'
import { CanvasHttpClient } from '../../src/canvas/client'

describe('QuizzesModule', () => {
  let client: CanvasHttpClient
  let quizzes: QuizzesModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    quizzes = new QuizzesModule(client)
  })

  it('gets a single quiz', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      id: 1,
      title: 'Midterm',
      quiz_type: 'assignment',
      points_possible: 100,
      question_count: 20,
      due_at: null,
      published: true,
    })
    const result = await quizzes.get(100, 1)
    expect(result).toMatchObject({ id: 1, title: 'Midterm' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/quizzes/1')
  })

  it('lists quiz submissions using envelope pagination', async () => {
    vi.spyOn(client, 'paginateEnvelope').mockResolvedValueOnce([
      {
        id: 1,
        quiz_id: 1,
        user_id: 10,
        submission_id: 100,
        attempt: 1,
        score: 85,
        kept_score: 85,
        workflow_state: 'complete',
      },
    ])
    const result = await quizzes.listSubmissions(100, 1)
    expect(result).toHaveLength(1)
    expect(client.paginateEnvelope).toHaveBeenCalledWith(
      '/api/v1/courses/100/quizzes/1/submissions',
      'quiz_submissions',
    )
  })

  it('lists quiz questions', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      {
        id: 1,
        quiz_id: 1,
        position: 1,
        question_text: 'What is 2+2?',
        question_type: 'multiple_choice_question',
        points_possible: 5,
      },
    ])
    const result = await quizzes.listQuestions(100, 1)
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/quizzes/1/questions')
  })

  it('gets submission answers using envelope pagination', async () => {
    vi.spyOn(client, 'paginateEnvelope').mockResolvedValueOnce([
      { id: 1, quiz_id: 1, answer: '4', flagged: false },
    ])
    const result = await quizzes.getSubmissionAnswers(99)
    expect(result).toHaveLength(1)
    expect(client.paginateEnvelope).toHaveBeenCalledWith(
      '/api/v1/quiz_submissions/99/questions',
      'quiz_submission_questions',
      { 'include[]': 'quiz_question' },
    )
  })

  it('lists quizzes in a course', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      {
        id: 1,
        title: 'Midterm',
        quiz_type: 'assignment',
        points_possible: 100,
        question_count: 20,
        published: true,
      },
    ])
    const result = await quizzes.list(100)
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/quizzes')
  })

  it('scores a quiz question without attempt', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(undefined)
    await quizzes.scoreQuestion(100, 1, 50, 10, 5, 'Correct!')
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/quizzes/1/submissions/50', {
      method: 'PUT',
      body: JSON.stringify({
        quiz_submissions: [
          {
            questions: {
              10: { score: 5, comment: 'Correct!' },
            },
          },
        ],
      }),
    })
  })

  it('scores a quiz question with specific attempt', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(undefined)
    await quizzes.scoreQuestion(100, 1, 50, 10, 5, 'Correct!', 2)
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/quizzes/1/submissions/50', {
      method: 'PUT',
      body: JSON.stringify({
        quiz_submissions: [
          {
            questions: {
              10: { score: 5, comment: 'Correct!' },
            },
            attempt: 2,
          },
        ],
      }),
    })
  })
})
