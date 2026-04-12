import type { CanvasHttpClient } from './client'
import type {
  CanvasQuiz,
  CanvasQuizSubmission,
  CanvasQuizQuestion,
  CanvasQuizSubmissionQuestion,
} from './types'

export class QuizzesModule {
  constructor(private client: CanvasHttpClient) {}

  async get(courseId: number, quizId: number): Promise<CanvasQuiz> {
    return this.client.request<CanvasQuiz>(
      `/api/v1/courses/${courseId}/quizzes/${quizId}`,
    )
  }

  async listSubmissions(
    courseId: number,
    quizId: number,
  ): Promise<CanvasQuizSubmission[]> {
    return this.client.paginateEnvelope<CanvasQuizSubmission>(
      `/api/v1/courses/${courseId}/quizzes/${quizId}/submissions`,
      'quiz_submissions',
    )
  }

  async listQuestions(
    courseId: number,
    quizId: number,
  ): Promise<CanvasQuizQuestion[]> {
    return this.client.paginate<CanvasQuizQuestion>(
      `/api/v1/courses/${courseId}/quizzes/${quizId}/questions`,
    )
  }

  async getSubmissionAnswers(
    quizSubmissionId: number,
  ): Promise<CanvasQuizSubmissionQuestion[]> {
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
  ): Promise<void> {
    const body: Record<string, unknown> = {
      quiz_submissions: [
        {
          attempt: 1,
          questions: {
            [questionId]: { score, comment },
          },
        },
      ],
    }
    await this.client.request(
      `/api/v1/courses/${courseId}/quizzes/${quizId}/submissions/${submissionId}`,
      {
        method: 'PUT',
        body: JSON.stringify(body),
      },
    )
  }
}
