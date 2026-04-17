import type { CanvasHttpClient } from './client'
import type {
  CanvasCourseActivitySummary,
  CanvasStudentActivitySummary,
  CanvasActivityStreamItem,
  CanvasSearchResult,
} from './types'

export const SEARCH_CONTENT_TYPES = [
  'pages',
  'discussions',
  'assignments',
  'announcements',
] as const
export type SearchContentType = (typeof SEARCH_CONTENT_TYPES)[number]

export class AnalyticsModule {
  constructor(private client: CanvasHttpClient) {}

  async searchCourseContent(
    courseId: number,
    searchTerm: string,
    contentTypes?: SearchContentType[],
  ): Promise<CanvasSearchResult[]> {
    const types: SearchContentType[] = contentTypes ?? [...SEARCH_CONTENT_TYPES]
    const fetches: Promise<CanvasSearchResult[]>[] = []

    if (types.includes('pages')) {
      fetches.push(
        this.client
          .paginate<{
            page_id: number
            title: string
            url: string
          }>(`/api/v1/courses/${courseId}/pages`, { search_term: searchTerm })
          .then((pages) =>
            pages.map((p) => ({
              id: p.page_id,
              title: p.title,
              type: 'page' as const,
              url: p.url,
              course_id: courseId,
            })),
          ),
      )
    }

    if (types.includes('assignments')) {
      fetches.push(
        this.client
          .paginate<{
            id: number
            name: string
          }>(`/api/v1/courses/${courseId}/assignments`, { search_term: searchTerm })
          .then((assignments) =>
            assignments.map((a) => ({
              id: a.id,
              title: a.name,
              type: 'assignment' as const,
              course_id: courseId,
            })),
          ),
      )
    }

    if (types.includes('discussions')) {
      fetches.push(
        this.client
          .paginate<{
            id: number
            title: string
          }>(`/api/v1/courses/${courseId}/discussion_topics`, { search_term: searchTerm })
          .then((discussions) =>
            discussions.map((d) => ({
              id: d.id,
              title: d.title,
              type: 'discussion' as const,
              course_id: courseId,
            })),
          ),
      )
    }

    if (types.includes('announcements')) {
      fetches.push(
        this.client
          .paginate<{
            id: number
            title: string
          }>(`/api/v1/courses/${courseId}/discussion_topics`, {
            search_term: searchTerm,
            only_announcements: 'true',
          })
          .then((announcements) =>
            announcements.map((a) => ({
              id: a.id,
              title: a.title,
              type: 'announcement' as const,
              course_id: courseId,
            })),
          ),
      )
    }

    const settled = await Promise.allSettled(fetches)
    const fulfilled = settled.filter(
      (r): r is PromiseFulfilledResult<CanvasSearchResult[]> => r.status === 'fulfilled',
    )
    if (fulfilled.length === 0) {
      const firstRejected = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      throw firstRejected!.reason
    }
    return fulfilled.flatMap((r) => r.value)
  }

  async getCourseActivity(courseId: number): Promise<CanvasCourseActivitySummary[]> {
    return this.client.request<CanvasCourseActivitySummary[]>(
      `/api/v1/courses/${courseId}/analytics/activity`,
    )
  }

  async getStudentActivity(
    courseId: number,
    studentId: number,
  ): Promise<CanvasStudentActivitySummary> {
    return this.client.request<CanvasStudentActivitySummary>(
      `/api/v1/courses/${courseId}/analytics/users/${studentId}/activity`,
    )
  }

  async getCourseActivityStream(courseId: number): Promise<CanvasActivityStreamItem[]> {
    return this.client.request<CanvasActivityStreamItem[]>(
      `/api/v1/courses/${courseId}/activity_stream/summary`,
    )
  }
}
