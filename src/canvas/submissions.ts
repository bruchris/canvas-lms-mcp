import type { CanvasHttpClient } from './client'
import type { CanvasSubmission } from './types'

export class SubmissionsModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: number, assignmentId: number): Promise<CanvasSubmission[]> {
    return this.client.paginate<CanvasSubmission>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions`,
      { 'include[]': 'submission_comments' },
    )
  }

  async get(
    courseId: number,
    assignmentId: number,
    userId: number,
  ): Promise<CanvasSubmission> {
    return this.client.request<CanvasSubmission>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}?include[]=submission_comments`,
    )
  }

  async grade(
    courseId: number,
    assignmentId: number,
    userId: number,
    grade: string,
  ): Promise<CanvasSubmission> {
    return this.client.request<CanvasSubmission>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}`,
      {
        method: 'PUT',
        body: JSON.stringify({ submission: { posted_grade: grade } }),
      },
    )
  }

  async comment(
    courseId: number,
    assignmentId: number,
    userId: number,
    comment: string,
  ): Promise<CanvasSubmission> {
    return this.client.request<CanvasSubmission>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          comment: { text_comment: comment },
        }),
      },
    )
  }
}
