import type { CanvasHttpClient } from './client'
import type { CanvasQueryParams } from './query'
import type { CanvasUpcomingEvent, CanvasUser, CanvasUserProfile } from './types'

export type CourseUserEnrollmentType = 'student' | 'teacher' | 'ta' | 'observer' | 'designer'

export type CourseUserEnrollmentState = 'active' | 'invited' | 'rejected' | 'completed' | 'inactive'

export type CourseUserInclude =
  | 'email'
  | 'enrollments'
  | 'locked'
  | 'avatar_url'
  | 'test_student'
  | 'bio'
  | 'custom_links'
  | 'current_grading_period_scores'
  | 'uuid'

export type UserSort = 'username' | 'email' | 'sis_id' | 'integration_id' | 'last_login'

export type SearchUserInclude = 'email' | 'last_login' | 'avatar_url' | 'time_zone' | 'uuid'

export interface ListCourseUsersOptions {
  enrollment_type?: CourseUserEnrollmentType | ReadonlyArray<CourseUserEnrollmentType>
  enrollment_state?: ReadonlyArray<CourseUserEnrollmentState>
  enrollment_role_id?: number
  include?: ReadonlyArray<CourseUserInclude>
  user_ids?: ReadonlyArray<number | string>
  user_id?: number | string
  search_term?: string
  sort?: UserSort
  order?: 'asc' | 'desc'
}

export interface SearchUsersOptions {
  sort?: UserSort
  order?: 'asc' | 'desc'
  include?: ReadonlyArray<SearchUserInclude>
}

/**
 * Public interface for the users module. Lets `CanvasClient` swap between
 * the hand-written `UsersModule` and the prototype generated-client
 * implementation (see GitHub issue #78) without tool callers caring.
 */
export interface UsersModuleApi {
  listStudents(courseId: number): Promise<CanvasUser[]>
  get(userId: number): Promise<CanvasUser>
  getProfile(): Promise<CanvasUserProfile>
  searchUsers(
    accountId: number,
    searchTerm: string,
    opts?: SearchUsersOptions,
  ): Promise<CanvasUser[]>
  listCourseUsers(courseId: number, opts?: ListCourseUsersOptions): Promise<CanvasUser[]>
  getUpcomingAssignments(): Promise<CanvasUpcomingEvent[]>
}

export class UsersModule implements UsersModuleApi {
  constructor(private client: CanvasHttpClient) {}

  async listStudents(courseId: number): Promise<CanvasUser[]> {
    return this.client.paginate<CanvasUser>(`/api/v1/courses/${courseId}/users`, {
      enrollment_type: ['student'],
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
    opts: SearchUsersOptions = {},
  ): Promise<CanvasUser[]> {
    const params: CanvasQueryParams = { search_term: searchTerm }
    if (opts.sort) params.sort = opts.sort
    if (opts.order) params.order = opts.order
    if (opts.include && opts.include.length > 0) params.include = opts.include
    return this.client.paginate<CanvasUser>(`/api/v1/accounts/${accountId}/users`, params)
  }

  async listCourseUsers(
    courseId: number,
    opts: ListCourseUsersOptions = {},
  ): Promise<CanvasUser[]> {
    const params: CanvasQueryParams = {}
    if (opts.enrollment_type !== undefined) {
      params.enrollment_type = Array.isArray(opts.enrollment_type)
        ? opts.enrollment_type
        : [opts.enrollment_type]
    }
    if (opts.enrollment_state && opts.enrollment_state.length > 0) {
      params.enrollment_state = opts.enrollment_state
    }
    if (opts.enrollment_role_id !== undefined) params.enrollment_role_id = opts.enrollment_role_id
    if (opts.include && opts.include.length > 0) params.include = opts.include
    if (opts.user_ids && opts.user_ids.length > 0) params.user_ids = opts.user_ids
    if (opts.user_id !== undefined) params.user_id = opts.user_id
    if (opts.search_term) params.search_term = opts.search_term
    if (opts.sort) params.sort = opts.sort
    if (opts.order) params.order = opts.order
    return this.client.paginate<CanvasUser>(`/api/v1/courses/${courseId}/users`, params)
  }

  async getUpcomingAssignments(): Promise<CanvasUpcomingEvent[]> {
    return this.client.request<CanvasUpcomingEvent[]>(
      '/api/v1/users/self/upcoming_events?type=Assignment',
    )
  }
}
