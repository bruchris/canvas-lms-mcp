import type { CanvasHttpClient } from './client'
import type { CanvasPeerReview } from './types'

export class PeerReviewsModule {
  constructor(private client: CanvasHttpClient) {}

  async listForAssignment(courseId: number, assignmentId: number): Promise<CanvasPeerReview[]> {
    return this.client.paginate<CanvasPeerReview>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/peer_reviews`,
    )
  }

  async listForSubmission(
    courseId: number,
    assignmentId: number,
    submissionId: number,
  ): Promise<CanvasPeerReview[]> {
    return this.client.paginate<CanvasPeerReview>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${submissionId}/peer_reviews`,
    )
  }

  async create(
    courseId: number,
    assignmentId: number,
    submissionId: number,
    userId: number,
  ): Promise<CanvasPeerReview> {
    return this.client.request<CanvasPeerReview>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${submissionId}/peer_reviews`,
      {
        method: 'POST',
        body: JSON.stringify({ user_id: userId }),
      },
    )
  }

  async delete(
    courseId: number,
    assignmentId: number,
    submissionId: number,
    userId: number,
  ): Promise<CanvasPeerReview> {
    return this.client.request<CanvasPeerReview>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${submissionId}/peer_reviews?user_id=${userId}`,
      { method: 'DELETE' },
    )
  }
}
