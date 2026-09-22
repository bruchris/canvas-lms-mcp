import type { CanvasHttpClient } from './client'
import { type CanvasQueryParams } from './query'
import type {
  CanvasQuiz,
  CanvasQuizSubmission,
  CanvasQuizQuestion,
  CanvasQuizSubmissionQuestion,
  CanvasQuizSubmissionEvent,
  CanvasQuizSubmissionEventsResponse,
  CanvasQuizExtension,
} from './types'

export class QuizzesModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: number): Promise<CanvasQuiz[]> {
    return this.client.paginate<CanvasQuiz>(`/api/v1/courses/${courseId}/quizzes`)
  }

  async get(courseId: number, quizId: number): Promise<CanvasQuiz> {
    return this.client.request<CanvasQuiz>(`/api/v1/courses/${courseId}/quizzes/${quizId}`)
  }

  /**
   * Delete a Classic quiz. Canvas answers with the deleted quiz's body (with
   * its `version_number` bumped) rather than a 204, and it removes the module
   * item that pointed at the quiz on its own.
   */
  async delete(courseId: number, quizId: number): Promise<CanvasQuiz> {
    return this.client.request<CanvasQuiz>(`/api/v1/courses/${courseId}/quizzes/${quizId}`, {
      method: 'DELETE',
    })
  }

  async deleteQuestion(courseId: number, quizId: number, questionId: number): Promise<void> {
    await this.client.request<void>(
      `/api/v1/courses/${courseId}/quizzes/${quizId}/questions/${questionId}`,
      { method: 'DELETE' },
    )
  }

  async listSubmissions(courseId: number, quizId: number): Promise<CanvasQuizSubmission[]> {
    return this.client.paginateEnvelope<CanvasQuizSubmission>(
      `/api/v1/courses/${courseId}/quizzes/${quizId}/submissions`,
      'quiz_submissions',
    )
  }

  async listQuestions(courseId: number, quizId: number): Promise<CanvasQuizQuestion[]> {
    return this.client.paginate<CanvasQuizQuestion>(
      `/api/v1/courses/${courseId}/quizzes/${quizId}/questions`,
    )
  }

  /**
   * The questions one quiz-submission attempt was actually served, via
   * `GET /courses/:id/quizzes/:id/questions?quiz_submission_id=&quiz_submission_attempt=`.
   * Unlike `listQuestions` (the quiz's active questions only), this includes the
   * `generated` QuizQuestion rows Canvas creates for bank draws, with the text,
   * type and points_possible that attempt saw. Canvas needs BOTH parameters: with
   * either missing it silently returns the active list instead.
   */
  async listSubmissionQuestions(
    courseId: number,
    quizId: number,
    quizSubmissionId: number,
    attempt: number,
  ): Promise<CanvasQuizQuestion[]> {
    return this.client.paginate<CanvasQuizQuestion>(
      `/api/v1/courses/${courseId}/quizzes/${quizId}/questions`,
      { quiz_submission_id: quizSubmissionId, quiz_submission_attempt: attempt },
    )
  }

  async getSubmissionAnswers(quizSubmissionId: number): Promise<CanvasQuizSubmissionQuestion[]> {
    return this.client.paginateEnvelope<CanvasQuizSubmissionQuestion>(
      `/api/v1/quiz_submissions/${quizSubmissionId}/questions`,
      'quiz_submission_questions',
      { 'include[]': 'quiz_question' },
    )
  }

  async scoreQuestion(
    courseId: number,
    quizId: number,
    submissionId: number,
    questionId: number,
    score: number,
    comment?: string,
    attempt?: number,
  ): Promise<void> {
    const submission: Record<string, unknown> = {
      questions: {
        [questionId]: { score, comment },
      },
    }
    if (attempt !== undefined) {
      submission.attempt = attempt
    }
    const body: Record<string, unknown> = {
      quiz_submissions: [submission],
    }
    await this.client.request(
      `/api/v1/courses/${courseId}/quizzes/${quizId}/submissions/${submissionId}`,
      {
        method: 'PUT',
        body: JSON.stringify(body),
      },
    )
  }

  async getSubmissionEvents(
    courseId: number,
    quizId: number,
    submissionId: number,
    attempt?: number,
  ): Promise<CanvasQuizSubmissionEvent[]> {
    const query: CanvasQueryParams = {}
    if (attempt !== undefined) {
      query.attempt = attempt
    }
    const response = await this.client.request<CanvasQuizSubmissionEventsResponse>(
      `/api/v1/courses/${courseId}/quizzes/${quizId}/submissions/${submissionId}/events`,
      { query },
    )
    // Defensive: Canvas returns [] for an empty log; the guard also tolerates a
    // null field without throwing. Real errors surface as CanvasApiError above.
    return response.quiz_submission_events ?? []
  }

  /**
   * Apply a quiz extension (extra time / extra attempts) for one student on one
   * Classic Quiz via `POST /courses/:id/quizzes/:id/extensions`. Canvas accepts a
   * batch (`quiz_extensions` array), but callers operate per-student-per-quiz, so
   * the array always holds a single element. Omitted fields are left out of the
   * body — never pass `extra_time: 0` (Canvas rejects zero/negative extensions).
   */
  async setExtension(
    courseId: number,
    quizId: number,
    userId: number,
    extra_time?: number,
    extra_attempts?: number,
  ): Promise<CanvasQuizExtension[]> {
    const extension: Record<string, number> = { user_id: userId }
    if (extra_time !== undefined) extension.extra_time = extra_time
    if (extra_attempts !== undefined) extension.extra_attempts = extra_attempts
    const response = await this.client.request<{ quiz_extensions: CanvasQuizExtension[] }>(
      `/api/v1/courses/${courseId}/quizzes/${quizId}/extensions`,
      {
        method: 'POST',
        body: JSON.stringify({ quiz_extensions: [extension] }),
      },
    )
    return response.quiz_extensions
  }
}
