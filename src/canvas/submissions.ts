import type { CanvasHttpClient } from './client'
import type { CanvasQueryParams } from './query'
import type { CanvasSubmission } from './types'
import type { CanvasId } from './id'

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
  student_ids?: ReadonlyArray<CanvasId>
  assignment_ids?: ReadonlyArray<CanvasId>
  section_ids?: ReadonlyArray<CanvasId>
  grouped?: boolean
  workflow_state?: SubmissionWorkflowState
  grading_period_id?: CanvasId
  post_to_sis?: boolean
  submitted_since?: string
  graded_since?: string
}

export interface GetSubmissionOptions {
  include?: ReadonlyArray<SubmissionGetInclude>
}

export interface ListStudentSubmissionsOptions {
  student_ids?: ReadonlyArray<CanvasId>
  assignment_ids?: ReadonlyArray<CanvasId>
  include?: ReadonlyArray<SubmissionListInclude>
  workflow_state?: SubmissionWorkflowState
}

export interface ListMySubmissionsOptions {
  include?: ReadonlyArray<SubmissionListInclude>
}

export interface SubmitAssignmentParams {
  submission_type: 'online_text_entry' | 'online_url' | 'online_upload'
  body?: string
  url?: string
  file_ids?: ReadonlyArray<CanvasId>
  comment?: string
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
    courseId: CanvasId,
    assignmentId: CanvasId,
    opts: ListSubmissionsOptions = {},
  ): Promise<CanvasSubmission[]> {
    return this.client.paginate<CanvasSubmission>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions`,
      buildListParams(opts),
    )
  }

  async get(
    courseId: CanvasId,
    assignmentId: CanvasId,
    userId: CanvasId,
    opts: GetSubmissionOptions = {},
  ): Promise<CanvasSubmission> {
    const include = opts.include && opts.include.length > 0 ? opts.include : DEFAULT_GET_INCLUDE
    return this.client.request<CanvasSubmission>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}`,
      { query: { include } },
    )
  }

  async grade(
    courseId: CanvasId,
    assignmentId: CanvasId,
    userId: CanvasId,
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
    courseId: CanvasId,
    assignmentId: CanvasId,
    userId: CanvasId,
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

  async listMy(
    courseId: CanvasId,
    opts: ListMySubmissionsOptions = {},
  ): Promise<CanvasSubmission[]> {
    const params: CanvasQueryParams = { student_ids: ['self'] }
    if (opts.include && opts.include.length > 0) params.include = opts.include
    return this.client.paginate<CanvasSubmission>(
      `/api/v1/courses/${courseId}/students/submissions`,
      params,
    )
  }

  async submit(
    courseId: CanvasId,
    assignmentId: CanvasId,
    params: SubmitAssignmentParams,
  ): Promise<CanvasSubmission> {
    const submission: Record<string, unknown> = { submission_type: params.submission_type }
    if (params.body !== undefined) submission.body = params.body
    if (params.url !== undefined) submission.url = params.url
    if (params.file_ids !== undefined) submission.file_ids = params.file_ids
    const payload: Record<string, unknown> = { submission }
    if (params.comment !== undefined) payload.comment = { text_comment: params.comment }
    return this.client.request<CanvasSubmission>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions`,
      { method: 'POST', body: JSON.stringify(payload) },
    )
  }

  async listForStudents(
    courseId: CanvasId,
    opts: ListStudentSubmissionsOptions = {},
  ): Promise<CanvasSubmission[]> {
    const params: CanvasQueryParams = {}
    params.student_ids =
      opts.student_ids && opts.student_ids.length > 0 ? opts.student_ids : ['all']
    if (opts.assignment_ids && opts.assignment_ids.length > 0)
      params.assignment_ids = opts.assignment_ids
    if (opts.include && opts.include.length > 0) params.include = opts.include
    if (opts.workflow_state) params.workflow_state = opts.workflow_state
    return this.client.paginate<CanvasSubmission>(
      `/api/v1/courses/${courseId}/students/submissions`,
      params,
    )
  }
}
