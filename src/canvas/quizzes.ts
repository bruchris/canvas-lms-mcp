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
import type { CanvasId } from './id'

export class QuizzesModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: CanvasId): Promise<CanvasQuiz[]> {
    return this.client.paginate<CanvasQuiz>(`/api/v1/courses/${courseId}/quizzes`)
  }

  async get(courseId: CanvasId, quizId: CanvasId): Promise<CanvasQuiz> {
    return this.client.request<CanvasQuiz>(`/api/v1/courses/${courseId}/quizzes/${quizId}`)
  }

  async listSubmissions(courseId: CanvasId, quizId: CanvasId): Promise<CanvasQuizSubmission[]> {
    return this.client.paginateEnvelope<CanvasQuizSubmission>(
      `/api/v1/courses/${courseId}/quizzes/${quizId}/submissions`,
      'quiz_submissions',
    )
  }

  async listQuestions(courseId: CanvasId, quizId: CanvasId): Promise<CanvasQuizQuestion[]> {
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
    courseId: CanvasId,
    quizId: CanvasId,
    quizSubmissionId: CanvasId,
    attempt: number,
  ): Promise<CanvasQuizQuestion[]> {
    return this.client.paginate<CanvasQuizQuestion>(
      `/api/v1/courses/${courseId}/quizzes/${quizId}/questions`,
      { quiz_submission_id: quizSubmissionId, quiz_submission_attempt: attempt },
    )
  }

  async getSubmissionAnswers(quizSubmissionId: CanvasId): Promise<CanvasQuizSubmissionQuestion[]> {
    return this.client.paginateEnvelope<CanvasQuizSubmissionQuestion>(
      `/api/v1/quiz_submissions/${quizSubmissionId}/questions`,
      'quiz_submission_questions',
      { 'include[]': 'quiz_question' },
    )
  }

  async scoreQuestion(
    courseId: CanvasId,
    quizId: CanvasId,
    submissionId: CanvasId,
    questionId: CanvasId,
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
    courseId: CanvasId,
    quizId: CanvasId,
    submissionId: CanvasId,
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
    courseId: CanvasId,
    quizId: CanvasId,
    userId: CanvasId,
    extra_time?: number,
    extra_attempts?: number,
  ): Promise<CanvasQuizExtension[]> {
    // Not `Record<string, number>` any more (BRU-2730 §8 PR 1b): `user_id` is
    // an identifier and `extra_time` / `extra_attempts` are quantities, so the
    // two cannot share one value type. Spelling the three keys out is what
    // makes that split checkable instead of a comment. Emitting `user_id` as a
    // JSON string is also the correct form — a numeric `user_id` in a request
    // body reaches Canvas's `Api::ID_REGEX.match?(42)` and raises there (§2.4).
    const extension: { user_id: CanvasId; extra_time?: number; extra_attempts?: number } = {
      user_id: userId,
    }
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
