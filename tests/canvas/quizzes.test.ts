import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

  it('deletes a quiz and returns the deleted quiz body', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      id: 1,
      title: 'Midterm',
      quiz_type: 'assignment',
      points_possible: 100,
      question_count: 20,
      due_at: null,
      published: false,
      version_number: 3,
    })
    const result = await quizzes.delete(100, 1)
    expect(result).toMatchObject({ id: 1, title: 'Midterm' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/quizzes/1', {
      method: 'DELETE',
    })
  })

  it('deletes a quiz question without throwing on 204', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(undefined)
    await expect(quizzes.deleteQuestion(100, 1, 55)).resolves.toBeUndefined()
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/quizzes/1/questions/55', {
      method: 'DELETE',
    })
  })

  it('surfaces a Canvas error from delete', async () => {
    vi.spyOn(client, 'request').mockRejectedValueOnce(
      new CanvasApiError(404, 'The specified resource does not exist.'),
    )
    await expect(quizzes.delete(100, 999)).rejects.toBeInstanceOf(CanvasApiError)
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

  describe('listSubmissionQuestions', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    function jsonPage(body: unknown, link?: string): Response {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (link) headers.Link = link
      return new Response(JSON.stringify(body), { status: 200, headers })
    }

    it('sends both attempt params and merges every page of the bare array', async () => {
      // Canvas copies the request's query params into its Link header
      // (Api.build_links_hash @1c9f0bb), so page 2 keeps the submission scope.
      const page2Url =
        'https://canvas.example.com/api/v1/courses/100/quizzes/1/questions' +
        '?quiz_submission_attempt=2&quiz_submission_id=55&page=2&per_page=100'
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          jsonPage(
            [
              {
                id: 7001,
                quiz_id: 1,
                position: 2,
                question_text: 'Drawn from the bank',
                question_type: 'essay_question',
                points_possible: 4,
              },
            ],
            `<${page2Url}>; rel="next"`,
          ),
        )
        .mockResolvedValueOnce(
          jsonPage([
            {
              id: 10,
              quiz_id: 1,
              position: 1,
              question_text: 'Fixed question',
              question_type: 'multiple_choice_question',
              points_possible: 1,
            },
          ]),
        )

      const result = await quizzes.listSubmissionQuestions(100, 1, 55, 2)

      expect(result.map((q) => q.id)).toEqual([7001, 10])
      expect(result[0]).toMatchObject({ question_type: 'essay_question', points_possible: 4 })
      expect(fetchSpy).toHaveBeenCalledTimes(2)

      const first = new URL(String(fetchSpy.mock.calls[0]?.[0]))
      expect(first.origin + first.pathname).toBe(
        'https://canvas.example.com/api/v1/courses/100/quizzes/1/questions',
      )
      // Canvas only takes the submission branch when BOTH are present; with either
      // one missing it silently returns the quiz's active questions instead.
      expect(first.searchParams.get('quiz_submission_id')).toBe('55')
      expect(first.searchParams.get('quiz_submission_attempt')).toBe('2')
      expect(first.searchParams.get('per_page')).toBe('100')
      expect(String(fetchSpy.mock.calls[1]?.[0])).toBe(page2Url)
    })

    it('propagates Canvas API errors', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ message: 'Unauthorized' }] }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      await expect(quizzes.listSubmissionQuestions(100, 1, 55, 2)).rejects.toBeInstanceOf(
        CanvasApiError,
      )
    })
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

  describe('setExtension', () => {
    const mockExtension = { user_id: 42, extra_time: 20, extra_attempts: 1 }

    it('posts both fields and returns the extensions', async () => {
      const spy = vi
        .spyOn(client, 'request')
        .mockResolvedValueOnce({ quiz_extensions: [mockExtension] })
      const result = await quizzes.setExtension(100, 7, 42, 20, 1)
      expect(result).toEqual([mockExtension])
      expect(spy).toHaveBeenCalledWith('/api/v1/courses/100/quizzes/7/extensions', {
        method: 'POST',
        body: expect.any(String),
      })
      const body = JSON.parse(spy.mock.calls[0][1]!.body as string)
      expect(body).toEqual({
        quiz_extensions: [{ user_id: 42, extra_time: 20, extra_attempts: 1 }],
      })
    })

    it('omits extra_attempts when only extra_time is provided', async () => {
      const spy = vi
        .spyOn(client, 'request')
        .mockResolvedValueOnce({ quiz_extensions: [mockExtension] })
      await quizzes.setExtension(100, 7, 42, 30, undefined)
      const body = JSON.parse(spy.mock.calls[0][1]!.body as string)
      expect(body).toEqual({ quiz_extensions: [{ user_id: 42, extra_time: 30 }] })
    })

    it('omits extra_time when only extra_attempts is provided', async () => {
      const spy = vi
        .spyOn(client, 'request')
        .mockResolvedValueOnce({ quiz_extensions: [mockExtension] })
      await quizzes.setExtension(100, 7, 42, undefined, 2)
      const body = JSON.parse(spy.mock.calls[0][1]!.body as string)
      expect(body).toEqual({ quiz_extensions: [{ user_id: 42, extra_attempts: 2 }] })
    })

    it('propagates Canvas API errors', async () => {
      vi.spyOn(client, 'request').mockRejectedValueOnce(
        new CanvasApiError('Forbidden', 403, '/api/v1/courses/100/quizzes/7/extensions'),
      )
      await expect(quizzes.setExtension(100, 7, 42, 20, 1)).rejects.toBeInstanceOf(CanvasApiError)
    })
  })
})
