import type { CanvasHttpClient } from './client'
import type { CanvasQueryParams } from './query'
import type { CanvasEnrollment } from './types'
import type { CanvasId } from './id'

export type EnrollmentType =
  | 'StudentEnrollment'
  | 'TeacherEnrollment'
  | 'TaEnrollment'
  | 'DesignerEnrollment'
  | 'ObserverEnrollment'

export type EnrollmentState =
  | 'active'
  | 'invited'
  | 'creation_pending'
  | 'deleted'
  | 'rejected'
  | 'completed'
  | 'inactive'
  | 'current_and_invited'
  | 'current_and_future'
  | 'current_and_concluded'

export type EnrollmentInclude =
  | 'avatar_url'
  | 'group_ids'
  | 'locked'
  | 'observed_users'
  | 'can_be_removed'
  | 'uuid'
  | 'current_points'
  | 'grades'

export interface ListCourseEnrollmentsOptions {
  type?: ReadonlyArray<EnrollmentType>
  role?: ReadonlyArray<string>
  state?: ReadonlyArray<EnrollmentState>
  include?: ReadonlyArray<EnrollmentInclude>
  user_id?: CanvasId
  grading_period_id?: CanvasId
  enrollment_term_id?: CanvasId
  sis_account_id?: ReadonlyArray<string>
  sis_course_id?: ReadonlyArray<string>
  sis_section_id?: ReadonlyArray<string>
  sis_user_id?: ReadonlyArray<string>
  created_for_sis_id?: ReadonlyArray<boolean>
}

export interface ListUserEnrollmentsOptions {
  type?: ReadonlyArray<EnrollmentType>
  role?: ReadonlyArray<string>
  state?: ReadonlyArray<EnrollmentState>
  include?: ReadonlyArray<EnrollmentInclude>
  grading_period_id?: CanvasId
  enrollment_term_id?: CanvasId
}

/**
 * The two optional `enrollment[...]` fields `enroll` forwards beyond
 * role and state.
 *
 * `course_section_id` is the section to enroll into; Canvas ignores it on the
 * section-scoped URL variant, which this client does not use.
 * `limit_privileges_to_course_section` confines the user to that section — for
 * teachers and TAs that includes grading privileges, and a section-limited
 * student sees no user (teachers included) outside their own sections. Canvas
 * documents it as taking effect relative to `course_section_id`, so passing it
 * without a section restricts the user to whichever section Canvas picks.
 */
export interface EnrollUserOptions {
  course_section_id?: CanvasId
  limit_privileges_to_course_section?: boolean
}

function buildParams(opts: object): CanvasQueryParams {
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

export class EnrollmentsModule {
  constructor(private client: CanvasHttpClient) {}

  async list(opts: ListUserEnrollmentsOptions = {}): Promise<CanvasEnrollment[]> {
    return this.client.paginate<CanvasEnrollment>(
      '/api/v1/users/self/enrollments',
      buildParams(opts),
    )
  }

  async listForCourse(
    courseId: CanvasId,
    opts: ListCourseEnrollmentsOptions = {},
  ): Promise<CanvasEnrollment[]> {
    return this.client.paginate<CanvasEnrollment>(
      `/api/v1/courses/${courseId}/enrollments`,
      buildParams(opts),
    )
  }

  /**
   * `POST /api/v1/courses/:course_id/enrollments`, under the `enrollment[...]`
   * envelope Canvas documents.
   *
   * `opts` keys are spread last and only when present, so a call that omits
   * them produces the same request body as before they existed.
   */
  async enroll(
    courseId: CanvasId,
    userId: CanvasId,
    type: string,
    enrollmentState?: string,
    opts: EnrollUserOptions = {},
  ): Promise<CanvasEnrollment> {
    const body: Record<string, unknown> = {
      enrollment: {
        user_id: userId,
        type,
        ...(enrollmentState ? { enrollment_state: enrollmentState } : {}),
        ...(opts.course_section_id !== undefined
          ? { course_section_id: opts.course_section_id }
          : {}),
        ...(opts.limit_privileges_to_course_section !== undefined
          ? { limit_privileges_to_course_section: opts.limit_privileges_to_course_section }
          : {}),
      },
    }
    return this.client.request<CanvasEnrollment>(`/api/v1/courses/${courseId}/enrollments`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async remove(
    courseId: CanvasId,
    enrollmentId: CanvasId,
    task: string,
  ): Promise<CanvasEnrollment> {
    return this.client.request<CanvasEnrollment>(
      `/api/v1/courses/${courseId}/enrollments/${enrollmentId}?task=${encodeURIComponent(task)}`,
      { method: 'DELETE' },
    )
  }

  async listMyGrades(courseId?: CanvasId): Promise<CanvasEnrollment[]> {
    if (courseId !== undefined) {
      return this.client.paginate<CanvasEnrollment>(`/api/v1/courses/${courseId}/enrollments`, {
        user_id: 'self',
        include: ['grades'],
      })
    }
    return this.client.paginate<CanvasEnrollment>('/api/v1/users/self/enrollments', {
      include: ['grades'],
    })
  }
}
