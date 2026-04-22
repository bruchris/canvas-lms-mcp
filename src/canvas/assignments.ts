import type { CanvasHttpClient } from './client'
import type { CanvasQueryParams } from './query'
import type {
  CanvasAssignment,
  CanvasAssignmentGroup,
  CreateAssignmentParams,
  UpdateAssignmentParams,
} from './types'

export type AssignmentListInclude =
  | 'submission'
  | 'assignment_visibility'
  | 'all_dates'
  | 'overrides'
  | 'observed_users'
  | 'can_edit'
  | 'score_statistics'

export type AssignmentGetInclude =
  | 'submission'
  | 'assignment_visibility'
  | 'overrides'
  | 'observed_users'
  | 'can_edit'
  | 'score_statistics'
  | 'all_dates'

export type AssignmentBucket =
  | 'past'
  | 'overdue'
  | 'undated'
  | 'ungraded'
  | 'unsubmitted'
  | 'upcoming'
  | 'future'

export type AssignmentOrderBy = 'position' | 'name' | 'due_at'

export type AssignmentGroupInclude =
  | 'assignments'
  | 'discussion_topic'
  | 'all_dates'
  | 'assignment_visibility'
  | 'overrides'
  | 'submission'
  | 'observed_users'
  | 'can_edit'
  | 'score_statistics'

export interface ListAssignmentsOptions {
  include?: ReadonlyArray<AssignmentListInclude>
  search_term?: string
  override_assignment_dates?: boolean
  needs_grading_count_by_section?: boolean
  bucket?: AssignmentBucket
  assignment_ids?: ReadonlyArray<number>
  order_by?: AssignmentOrderBy
  post_to_sis?: boolean
}

export interface GetAssignmentOptions {
  include?: ReadonlyArray<AssignmentGetInclude>
  override_assignment_dates?: boolean
  needs_grading_count_by_section?: boolean
  all_dates?: boolean
}

export interface ListAssignmentGroupsOptions {
  include?: ReadonlyArray<AssignmentGroupInclude>
  assignment_ids?: ReadonlyArray<number>
  exclude_assignment_submission_types?: ReadonlyArray<string>
  override_assignment_dates?: boolean
  grading_period_id?: number
  scope_assignments_to_student?: boolean
}

function toQuery(opts: object): CanvasQueryParams {
  const params: CanvasQueryParams = {}
  for (const [key, value] of Object.entries(opts)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      params[key] = value as ReadonlyArray<string | number | boolean>
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      params[key] = value
    }
  }
  return params
}

export class AssignmentsModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: number, opts: ListAssignmentsOptions = {}): Promise<CanvasAssignment[]> {
    return this.client.paginate<CanvasAssignment>(
      `/api/v1/courses/${courseId}/assignments`,
      toQuery(opts),
    )
  }

  async get(
    courseId: number,
    assignmentId: number,
    opts: GetAssignmentOptions = {},
  ): Promise<CanvasAssignment> {
    return this.client.request<CanvasAssignment>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}`,
      { query: toQuery(opts) },
    )
  }

  async listGroups(
    courseId: number,
    opts: ListAssignmentGroupsOptions = {},
  ): Promise<CanvasAssignmentGroup[]> {
    return this.client.paginate<CanvasAssignmentGroup>(
      `/api/v1/courses/${courseId}/assignment_groups`,
      toQuery(opts),
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
