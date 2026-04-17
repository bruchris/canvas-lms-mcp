import type { CanvasHttpClient } from './client'
import type { CanvasUpcomingEvent, CanvasUser, CanvasUserProfile } from './types'

export class UsersModule {
  constructor(private client: CanvasHttpClient) {}

  async listStudents(courseId: number): Promise<CanvasUser[]> {
    return this.client.paginate<CanvasUser>(`/api/v1/courses/${courseId}/users`, {
      'enrollment_type[]': 'student',
    })
  }

  async get(userId: number): Promise<CanvasUser> {
    return this.client.request<CanvasUser>(`/api/v1/users/${userId}`)
  }

  async getProfile(): Promise<CanvasUserProfile> {
    return this.client.request<CanvasUserProfile>('/api/v1/users/self/profile')
  }

  async searchUsers(
    accountId: number,
    searchTerm: string,
    sort?: string,
    order?: string,
  ): Promise<CanvasUser[]> {
    const params: Record<string, string> = { search_term: searchTerm }
    if (sort) params.sort = sort
    if (order) params.order = order
    return this.client.paginate<CanvasUser>(`/api/v1/accounts/${accountId}/users`, params)
  }

  async listCourseUsers(courseId: number, enrollmentType?: string): Promise<CanvasUser[]> {
    const params: Record<string, string> = {}
    if (enrollmentType) params['enrollment_type[]'] = enrollmentType
    return this.client.paginate<CanvasUser>(`/api/v1/courses/${courseId}/users`, params)
  }

  async getUpcomingAssignments(): Promise<CanvasUpcomingEvent[]> {
    return this.client.request<CanvasUpcomingEvent[]>(
      '/api/v1/users/self/upcoming_events?type=Assignment',
    )
  }
}
