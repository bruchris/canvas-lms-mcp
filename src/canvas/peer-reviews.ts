import type { CanvasHttpClient } from './client'
import type { CanvasPeerReview } from './types'
import type { CanvasId } from './id'

export class PeerReviewsModule {
  constructor(private client: CanvasHttpClient) {}

  async listForAssignment(courseId: CanvasId, assignmentId: CanvasId): Promise<CanvasPeerReview[]> {
    return this.client.paginate<CanvasPeerReview>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/peer_reviews`,
    )
  }

  async listForSubmission(
    courseId: CanvasId,
    assignmentId: CanvasId,
    submissionId: CanvasId,
  ): Promise<CanvasPeerReview[]> {
    return this.client.paginate<CanvasPeerReview>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${submissionId}/peer_reviews`,
    )
  }

  async create(
    courseId: CanvasId,
    assignmentId: CanvasId,
    submissionId: CanvasId,
    userId: CanvasId,
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
    courseId: CanvasId,
    assignmentId: CanvasId,
    submissionId: CanvasId,
    userId: CanvasId,
  ): Promise<void> {
    await this.client.request<void>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${submissionId}/peer_reviews?user_id=${userId}`,
      { method: 'DELETE' },
    )
  }
}
