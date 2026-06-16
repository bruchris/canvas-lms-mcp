import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QuizzesModule } from '../../src/canvas/quizzes'
import { CanvasHttpClient, CanvasApiError } from '../../src/canvas/client'

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

  describe('getSubmissionEvents', () => {
    it('returns the ordered events for a submission (no attempt)', async () => {
      // Shapes mirror the real Canvas API: event_data is a single object or
      // null (never an array), and each event carries a string id.
      vi.spyOn(client, 'request').mockResolvedValueOnce({
        quiz_submission_events: [
          {
            id: '100',
            event_type: 'session_started',
            created_at: '2026-01-01T10:00:00Z',
            event_data: { user_agent: 'Mozilla/5.0' },
          },
          {
            id: '101',
            event_type: 'question_answered',
            created_at: '2026-01-01T10:01:00Z',
            event_data: { quiz_question_id: '9', answer: '2' },
          },
          {
            id: '102',
            event_type: 'page_blurred',
            created_at: '2026-01-01T10:05:00Z',
            event_data: null,
          },
        ],
      })
      const result = await quizzes.getSubmissionEvents(1, 2, 3)
      expect(result).toHaveLength(3)
      expect(result.map((e) => e.event_type)).toEqual([
        'session_started',
        'question_answered',
        'page_blurred',
      ])
      // The null-per-event event_data round-trips unchanged (no transform).
      expect(result[2].event_data).toBeNull()
      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/1/quizzes/2/submissions/3/events',
        { query: {} },
      )
    })

    it('carries no student identity fields in the event payload', async () => {
      // Pins the no-pseudonymizer-wrap assumption: the events envelope exposes
      // no name / email / login_id / user_name (envelope or event_data keys).
      vi.spyOn(client, 'request').mockResolvedValueOnce({
        quiz_submission_events: [
          {
            id: '200',
            event_type: 'question_answered',
            created_at: '2026-01-01T10:01:00Z',
            event_data: { quiz_question_id: '9', answer: '2' },
          },
        ],
      })
      const result = await quizzes.getSubmissionEvents(1, 2, 3)
      const identityKeys = ['name', 'email', 'login_id', 'user_name', 'sis_user_id']
      for (const event of result) {
        for (const key of identityKeys) {
          expect(event).not.toHaveProperty(key)
          expect(event.event_data ?? {}).not.toHaveProperty(key)
        }
      }
    })

    it('passes the attempt query param when provided', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({ quiz_submission_events: [] })
      await quizzes.getSubmissionEvents(1, 2, 3, 2)
      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/1/quizzes/2/submissions/3/events',
        { query: { attempt: 2 } },
      )
    })

    it('returns an empty array for an empty event log', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({ quiz_submission_events: [] })
      const result = await quizzes.getSubmissionEvents(1, 2, 3)
      expect(result).toEqual([])
    })

    it('returns an empty array when the envelope field is null', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({ quiz_submission_events: null })
      const result = await quizzes.getSubmissionEvents(1, 2, 3)
      expect(result).toEqual([])
    })

    it('propagates Canvas API errors', async () => {
      vi.spyOn(client, 'request').mockRejectedValueOnce(
        new CanvasApiError('Forbidden', 403, '/api/v1/courses/1/quizzes/2/submissions/3/events'),
      )
      await expect(quizzes.getSubmissionEvents(1, 2, 3)).rejects.toBeInstanceOf(CanvasApiError)
    })
  })
})
