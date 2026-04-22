import type { CanvasHttpClient } from './client'
import type { CanvasQueryParams } from './query'
import type { CanvasCourse, CreateCourseParams, UpdateCourseParams } from './types'

export type CourseEnrollmentState = 'active' | 'invited_or_pending' | 'completed'

export type CourseWorkflowState = 'unpublished' | 'available' | 'completed' | 'deleted'

export type CourseListInclude =
  | 'needs_grading_count'
  | 'syllabus_body'
  | 'public_description'
  | 'total_scores'
  | 'current_grading_period_scores'
  | 'grading_periods'
  | 'term'
  | 'account'
  | 'course_progress'
  | 'sections'
  | 'storage_quota_used_mb'
  | 'total_students'
  | 'passback_status'
  | 'favorites'
  | 'teachers'
  | 'observed_users'
  | 'tabs'
  | 'course_image'
  | 'banner_image'
  | 'concluded'
  | 'lti_context_id'
  | 'post_manually'

export type CourseGetInclude =
  | CourseListInclude
  | 'all_courses'
  | 'permissions'
  | 'public_description'

export interface ListCoursesOptions {
  enrollment_state?: CourseEnrollmentState
  state?: ReadonlyArray<CourseWorkflowState>
  enrollment_role_id?: number
  include?: ReadonlyArray<CourseListInclude>
  exclude_blueprint_courses?: boolean
}

export interface GetCourseOptions {
  include?: ReadonlyArray<CourseGetInclude>
  teacher_limit?: number
}

const DEFAULT_LIST_INCLUDE: ReadonlyArray<CourseListInclude> = ['term']
const DEFAULT_GET_INCLUDE: ReadonlyArray<CourseGetInclude> = ['term', 'total_students']

export class CoursesModule {
  constructor(private client: CanvasHttpClient) {}

  async list(opts: ListCoursesOptions = {}): Promise<CanvasCourse[]> {
    const params: CanvasQueryParams = {}
    params.include = opts.include && opts.include.length > 0 ? opts.include : DEFAULT_LIST_INCLUDE
    if (opts.enrollment_state) params.enrollment_state = opts.enrollment_state
    if (opts.state && opts.state.length > 0) params.state = opts.state
    if (opts.enrollment_role_id !== undefined) params.enrollment_role_id = opts.enrollment_role_id
    if (opts.exclude_blueprint_courses !== undefined) {
      params.exclude_blueprint_courses = opts.exclude_blueprint_courses
    }
    return this.client.paginate<CanvasCourse>('/api/v1/courses', params)
  }

  async get(courseId: number, opts: GetCourseOptions = {}): Promise<CanvasCourse> {
    const include = opts.include && opts.include.length > 0 ? opts.include : DEFAULT_GET_INCLUDE
    const query: CanvasQueryParams = { include }
    if (opts.teacher_limit !== undefined) query.teacher_limit = opts.teacher_limit
    return this.client.request<CanvasCourse>(`/api/v1/courses/${courseId}`, { query })
  }

  async getSyllabus(courseId: number): Promise<string | null> {
    const course = await this.client.request<CanvasCourse>(`/api/v1/courses/${courseId}`, {
      query: { include: ['syllabus_body'] },
    })
    return course.syllabus_body ?? null
  }

  async create(params: CreateCourseParams): Promise<CanvasCourse> {
    const { account_id, ...courseFields } = params
    return this.client.request<CanvasCourse>(`/api/v1/accounts/${account_id}/courses`, {
      method: 'POST',
      body: JSON.stringify({ course: courseFields }),
    })
  }

  async update(courseId: number, params: UpdateCourseParams): Promise<CanvasCourse> {
    return this.client.request<CanvasCourse>(`/api/v1/courses/${courseId}`, {
      method: 'PUT',
      body: JSON.stringify({ course: params }),
    })
  }
}
