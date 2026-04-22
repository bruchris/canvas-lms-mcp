import type { CanvasHttpClient } from './client'
import type {
  CanvasGradebookHistoryDay,
  CanvasGradebookHistoryGrader,
  CanvasGradebookHistorySubmission,
  CanvasGradebookHistorySubmissionVersion,
} from './types'

export interface GradebookHistoryFeedParams {
  assignment_id?: number
  user_id?: number
  ascending?: boolean
}

export class GradebookHistoryModule {
  constructor(private client: CanvasHttpClient) {}

  async listDays(courseId: number): Promise<CanvasGradebookHistoryDay[]> {
    return this.client.request<CanvasGradebookHistoryDay[]>(
      `/api/v1/courses/${courseId}/gradebook_history/days`,
    )
  }

  async getDay(courseId: number, date: string): Promise<CanvasGradebookHistoryGrader[]> {
    return this.client.request<CanvasGradebookHistoryGrader[]>(
      `/api/v1/courses/${courseId}/gradebook_history/${encodeURIComponent(date)}`,
    )
  }

  async listSubmissions(
    courseId: number,
    date: string,
    graderId: number,
    assignmentId: number,
  ): Promise<CanvasGradebookHistorySubmission[]> {
    return this.client.request<CanvasGradebookHistorySubmission[]>(
      `/api/v1/courses/${courseId}/gradebook_history/${encodeURIComponent(date)}/graders/${graderId}/assignments/${assignmentId}/submissions`,
    )
  }

  async getFeed(
    courseId: number,
    params: GradebookHistoryFeedParams = {},
  ): Promise<CanvasGradebookHistorySubmissionVersion[]> {
    const searchParams = new URLSearchParams()

    if (params.assignment_id !== undefined) {
      searchParams.set('assignment_id', String(params.assignment_id))
    }
    if (params.user_id !== undefined) {
      searchParams.set('user_id', String(params.user_id))
    }
    if (params.ascending !== undefined) {
      searchParams.set('ascending', String(params.ascending))
    }

    const query = searchParams.toString()

    return this.client.paginate<CanvasGradebookHistorySubmissionVersion>(
      `/api/v1/courses/${courseId}/gradebook_history/feed${query ? `?${query}` : ''}`,
    )
  }
}
