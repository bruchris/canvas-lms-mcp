import type { CanvasHttpClient } from './client'
import type { CanvasGroup, CanvasUser } from './types'
import type { CanvasId } from './id'

export class GroupsModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: CanvasId): Promise<CanvasGroup[]> {
    return this.client.paginate<CanvasGroup>(`/api/v1/courses/${courseId}/groups`)
  }

  async listMembers(groupId: CanvasId): Promise<CanvasUser[]> {
    return this.client.paginate<CanvasUser>(`/api/v1/groups/${groupId}/users`)
  }
}
