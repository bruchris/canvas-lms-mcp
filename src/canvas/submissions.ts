import type { CanvasHttpClient } from './client'
import type { CanvasQueryParams } from './query'
import type { CanvasSubmission } from './types'

export type SubmissionListInclude =
  | 'submission_history'
  | 'submission_comments'
  | 'rubric_assessment'
  | 'assignment'
  | 'visibility'
  | 'course'
  | 'user'
  | 'group'
  | 'read_status'
  | 'sub_assignment_submissions'

export type SubmissionGetInclude =
  | 'submission_history'
  | 'submission_comments'
  | 'rubric_assessment'
  | 'visibility'
  | 'course'
  | 'user'
  | 'read_status'

export type SubmissionWorkflowState = 'submitted' | 'unsubmitted' | 'graded' | 'pending_review'

export interface ListSubmissionsOptions {
  include?: ReadonlyArray<SubmissionListInclude>
  student_ids?: ReadonlyArray<number | string>
  assignment_ids?: ReadonlyArray<number>
  section_ids?: ReadonlyArray<number>
  grouped?: boolean
  workflow_state?: SubmissionWorkflowState
  grading_period_id?: number
  post_to_sis?: boolean
  submitted_since?: string
  graded_since?: string
}

export interface GetSubmissionOptions {
  include?: ReadonlyArray<SubmissionGetInclude>
}

const DEFAULT_LIST_INCLUDE: ReadonlyArray<SubmissionListInclude> = ['submission_comments']
const DEFAULT_GET_INCLUDE: ReadonlyArray<SubmissionGetInclude> = ['submission_comments']

function buildListParams(opts: ListSubmissionsOptions): CanvasQueryParams {
  const params: CanvasQueryParams = {}
  params.include = opts.include && opts.include.length > 0 ? opts.include : DEFAULT_LIST_INCLUDE
  if (opts.student_ids && opts.student_ids.length > 0) params.student_ids = opts.student_ids
  if (opts.assignment_ids && opts.assignment_ids.length > 0)
    params.assignment_ids = opts.assignment_ids
  if (opts.section_ids && opts.section_ids.length > 0) params.section_ids = opts.section_ids
  if (opts.grouped !== undefined) params.grouped = opts.grouped
  if (opts.workflow_state) params.workflow_state = opts.workflow_state
  if (opts.grading_period_id !== undefined) params.grading_period_id = opts.grading_period_id
  if (opts.post_to_sis !== undefined) params.post_to_sis = opts.post_to_sis
  if (opts.submitted_since) params.submitted_since = opts.submitted_since
  if (opts.graded_since) params.graded_since = opts.graded_since
  return params
}

export class SubmissionsModule {
  constructor(private client: CanvasHttpClient) {}

  async list(
    courseId: number,
    assignmentId: number,
    opts: ListSubmissionsOptions = {},
  ): Promise<CanvasSubmission[]> {
    return this.client.paginate<CanvasSubmission>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions`,
      buildListParams(opts),
    )
  }

  async get(
    courseId: number,
    assignmentId: number,
    userId: number,
    opts: GetSubmissionOptions = {},
  ): Promise<CanvasSubmission> {
    const include = opts.include && opts.include.length > 0 ? opts.include : DEFAULT_GET_INCLUDE
    return this.client.request<CanvasSubmission>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}`,
      { query: { include } },
    )
  }

  async grade(
    courseId: number,
    assignmentId: number,
    userId: number,
    grade: string,
  ): Promise<CanvasSubmission> {
    return this.client.request<CanvasSubmission>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}`,
      {
        method: 'PUT',
        body: JSON.stringify({ submission: { posted_grade: grade } }),
      },
    )
  }

  async comment(
    courseId: number,
    assignmentId: number,
    userId: number,
    comment: string,
  ): Promise<CanvasSubmission> {
    return this.client.request<CanvasSubmission>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          comment: { text_comment: comment },
        }),
      },
    )
  }

  async listMy(courseId: number): Promise<CanvasSubmission[]> {
    return this.client.paginate<CanvasSubmission>(
      `/api/v1/courses/${courseId}/students/submissions`,
      { student_ids: ['self'] },
    )
  }
}
