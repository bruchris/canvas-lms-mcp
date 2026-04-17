import type { CanvasHttpClient } from './client'
import type {
  CanvasCourseActivitySummary,
  CanvasStudentActivitySummary,
  CanvasActivityStreamItem,
  CanvasSearchResult,
} from './types'

export type SearchContentType = 'pages' | 'discussions' | 'assignments' | 'announcements'

export class AnalyticsModule {
  constructor(private client: CanvasHttpClient) {}

  async searchCourseContent(
    courseId: number,
    searchTerm: string,
    contentTypes?: SearchContentType[],
  ): Promise<CanvasSearchResult[]> {
    const types: SearchContentType[] = contentTypes ?? [
      'pages',
      'discussions',
      'assignments',
      'announcements',
    ]
    const results: CanvasSearchResult[] = []

    if (types.includes('pages')) {
      const pages = await this.client.paginate<{ page_id: number; title: string; url: string }>(
        `/api/v1/courses/${courseId}/pages`,
        { search_term: searchTerm },
      )
      for (const p of pages) {
        results.push({ id: p.page_id, title: p.title, type: 'page', url: p.url, course_id: courseId })
      }
    }

    if (types.includes('assignments')) {
      const assignments = await this.client.paginate<{ id: number; name: string }>(
        `/api/v1/courses/${courseId}/assignments`,
        { search_term: searchTerm },
      )
      for (const a of assignments) {
        results.push({ id: a.id, title: a.name, type: 'assignment', course_id: courseId })
      }
    }

    if (types.includes('discussions')) {
      const discussions = await this.client.paginate<{ id: number; title: string }>(
        `/api/v1/courses/${courseId}/discussion_topics`,
        { search_term: searchTerm },
      )
      for (const d of discussions) {
        results.push({ id: d.id, title: d.title, type: 'discussion', course_id: courseId })
      }
    }

    if (types.includes('announcements')) {
      const announcements = await this.client.paginate<{ id: number; title: string }>(
        `/api/v1/courses/${courseId}/discussion_topics`,
        { search_term: searchTerm, only_announcements: 'true' },
      )
      for (const a of announcements) {
        results.push({ id: a.id, title: a.title, type: 'announcement', course_id: courseId })
      }
    }

    return results
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
