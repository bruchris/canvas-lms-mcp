import type { CanvasHttpClient } from './client'
import type {
  CanvasCourseActivitySummary,
  CanvasStudentActivitySummary,
  CanvasActivityStreamItem,
  CourseSearchResult,
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

  async searchContentType(
    courseId: number,
    searchTerm: string,
    type: SearchContentType,
  ): Promise<CourseSearchResult[]> {
    if (type === 'pages') {
      const pages = await this.client.paginate<{ page_id: number; title: string; url: string }>(
        `/api/v1/courses/${courseId}/pages`,
        { search_term: searchTerm },
      )
      return pages.map((p) => ({
        id: p.page_id,
        title: p.title,
        type: 'page' as const,
        url: p.url,
        course_id: courseId,
      }))
    }

    if (type === 'assignments') {
      const assignments = await this.client.paginate<{ id: number; name: string }>(
        `/api/v1/courses/${courseId}/assignments`,
        { search_term: searchTerm },
      )
      return assignments.map((a) => ({
        id: a.id,
        title: a.name,
        type: 'assignment' as const,
        course_id: courseId,
      }))
    }

    if (type === 'discussions') {
      const discussions = await this.client.paginate<{ id: number; title: string }>(
        `/api/v1/courses/${courseId}/discussion_topics`,
        { search_term: searchTerm },
      )
      return discussions.map((d) => ({
        id: d.id,
        title: d.title,
        type: 'discussion' as const,
        course_id: courseId,
      }))
    }

    // announcements
    const announcements = await this.client.paginate<{ id: number; title: string }>(
      `/api/v1/courses/${courseId}/discussion_topics`,
      { search_term: searchTerm, only_announcements: 'true' },
    )
    return announcements.map((a) => ({
      id: a.id,
      title: a.title,
      type: 'announcement' as const,
      course_id: courseId,
    }))
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
