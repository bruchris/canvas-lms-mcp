import type { CanvasHttpClient } from './client'
import type { CanvasAssignment, CanvasAssignmentGroup } from './types'

export class AssignmentsModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: number): Promise<CanvasAssignment[]> {
    return this.client.paginate<CanvasAssignment>(
      `/api/v1/courses/${courseId}/assignments`,
    )
  }

  async get(courseId: number, assignmentId: number): Promise<CanvasAssignment> {
    return this.client.request<CanvasAssignment>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}`,
    )
  }

  async listGroups(courseId: number): Promise<CanvasAssignmentGroup[]> {
    return this.client.paginate<CanvasAssignmentGroup>(
      `/api/v1/courses/${courseId}/assignment_groups`,
    )
  }
}
