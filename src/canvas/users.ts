import type { CanvasHttpClient } from './client'
import type { CanvasUser, CanvasUserProfile } from './types'

export class UsersModule {
  constructor(private client: CanvasHttpClient) {}

  async listStudents(courseId: number): Promise<CanvasUser[]> {
    return this.client.paginate<CanvasUser>(
      `/api/v1/courses/${courseId}/users`,
      { 'enrollment_type[]': 'student' },
    )
  }

  async get(userId: number): Promise<CanvasUser> {
    return this.client.request<CanvasUser>(`/api/v1/users/${userId}`)
  }

  async getProfile(): Promise<CanvasUserProfile> {
    return this.client.request<CanvasUserProfile>('/api/v1/users/self/profile')
  }
}
