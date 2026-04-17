import type { CanvasHttpClient } from './client'
import type { CanvasAssignment, CanvasAssignmentGroup } from './types'

export interface CreateAssignmentParams {
  name: string
  description?: string
  points_possible?: number
  due_at?: string
  submission_types?: string[]
  assignment_group_id?: number
}

export interface UpdateAssignmentParams {
  name?: string
  description?: string
  points_possible?: number
  due_at?: string
  submission_types?: string[]
  assignment_group_id?: number
}

export class AssignmentsModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: number): Promise<CanvasAssignment[]> {
    return this.client.paginate<CanvasAssignment>(`/api/v1/courses/${courseId}/assignments`)
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

  async create(courseId: number, params: CreateAssignmentParams): Promise<CanvasAssignment> {
    return this.client.request<CanvasAssignment>(`/api/v1/courses/${courseId}/assignments`, {
      method: 'POST',
      body: JSON.stringify({ assignment: params }),
    })
  }

  async update(
    courseId: number,
    assignmentId: number,
    params: UpdateAssignmentParams,
  ): Promise<CanvasAssignment> {
    return this.client.request<CanvasAssignment>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}`,
      {
        method: 'PUT',
        body: JSON.stringify({ assignment: params }),
      },
    )
  }

  async delete(courseId: number, assignmentId: number): Promise<void> {
    await this.client.request<void>(`/api/v1/courses/${courseId}/assignments/${assignmentId}`, {
      method: 'DELETE',
    })
  }
}
