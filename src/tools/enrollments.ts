import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type {
  EnrollUserOptions,
  EnrollmentInclude,
  EnrollmentState,
  EnrollmentType,
  ListCourseEnrollmentsOptions,
  ListUserEnrollmentsOptions,
} from '../canvas/enrollments'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'
import { type CanvasId, canvasIdInput } from '../canvas/id'

const ENROLLMENT_TYPE = [
  'StudentEnrollment',
  'TeacherEnrollment',
  'TaEnrollment',
  'DesignerEnrollment',
  'ObserverEnrollment',
] as const

const ENROLLMENT_STATE = [
  'active',
  'invited',
  'creation_pending',
  'deleted',
  'rejected',
  'completed',
  'inactive',
  'current_and_invited',
  'current_and_future',
  'current_and_concluded',
] as const

const ENROLLMENT_INCLUDE = [
  'avatar_url',
  'group_ids',
  'locked',
  'observed_users',
  'can_be_removed',
  'uuid',
  'current_points',
  'grades',
] as const

export function enrollmentTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
  return [
    {
      name: 'list_enrollments',
      title: 'List Enrollments',
      description:
        'List every enrollment the authenticated user holds across all of their Canvas ' +
        "courses — the caller's own enrollments only. Use `list_course_enrollments` for a " +
        "single course's full roster, including a `user_id` filter to focus on one person. " +
        'Optional `type`, `state`, and `role` filters and the `include` array mirror ' +
        "Canvas's own `GET /users/self/enrollments` endpoint. Fetches every page (100 per " +
        "request) and fails with a 'Results are incomplete' error instead of silently " +
        'truncating. When pseudonymization is enabled, each enrollment classified as ' +
        "student or unknown has its nested `user` object replaced with that course's " +
        'pseudonym and `sis_user_id` cleared before the result is returned; staff ' +
        'enrollments (TeacherEnrollment, TaEnrollment, DesignerEnrollment) are left as-is.',
      inputSchema: {
        type: z
          .array(z.enum(ENROLLMENT_TYPE))
          .optional()
          .describe('Filter by one or more enrollment types'),
        state: z
          .array(z.enum(ENROLLMENT_STATE))
          .optional()
          .describe('Filter by one or more enrollment states'),
        role: z
          .array(z.string())
          .optional()
          .describe('Filter by enrollment role names (as defined in the Canvas account)'),
        include: z
          .array(z.enum(ENROLLMENT_INCLUDE))
          .optional()
          .describe('Extra fields to include on each enrollment (Canvas include[] param)'),
        grading_period_id: canvasIdInput()
          .optional()
          .describe('Return enrollments scoped to this grading period'),
        enrollment_term_id: canvasIdInput()
          .optional()
          .describe('Limit to enrollments in the given term'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const opts: ListUserEnrollmentsOptions = {}
        if (params.type !== undefined) opts.type = params.type as ReadonlyArray<EnrollmentType>
        if (params.state !== undefined) opts.state = params.state as ReadonlyArray<EnrollmentState>
        if (params.role !== undefined) opts.role = params.role as ReadonlyArray<string>
        if (params.include !== undefined)
          opts.include = params.include as ReadonlyArray<EnrollmentInclude>
        if (params.grading_period_id !== undefined)
          opts.grading_period_id = params.grading_period_id as CanvasId
        if (params.enrollment_term_id !== undefined)
          opts.enrollment_term_id = params.enrollment_term_id as CanvasId
        const enrollments = await canvas.enrollments.list(opts)
        if (!pseudonymizer?.isEnabled()) return enrollments
        return Promise.all(
          enrollments.map((e) => pseudonymizer.anonymizeEnrollment(e.course_id, e)),
        )
      },
    },
    {
      name: 'list_course_enrollments',
      title: 'List Course Enrollments',
      audience: 'educator',
      description:
        'List enrollments within a specific course with Canvas filters. Use `include=grades` / `include=current_points` for richer grade data, `type[]` to limit to a role, and `user_id` to focus on a single user.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        type: z
          .array(z.enum(ENROLLMENT_TYPE))
          .optional()
          .describe('Filter by one or more enrollment types'),
        state: z.array(z.enum(ENROLLMENT_STATE)).optional().describe('Filter by enrollment states'),
        role: z.array(z.string()).optional().describe('Filter by custom role names'),
        include: z
          .array(z.enum(ENROLLMENT_INCLUDE))
          .optional()
          .describe('Extra fields to include (Canvas include[] param)'),
        user_id: canvasIdInput({ sentinels: ['self'] })
          .optional()
          .describe('Filter to a specific user. Canvas ID (pass large IDs as a string) or "self".'),
        grading_period_id: canvasIdInput()
          .optional()
          .describe('Scope grade-related includes to this grading period'),
        enrollment_term_id: canvasIdInput()
          .optional()
          .describe('Limit to enrollments in the given term'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const opts: ListCourseEnrollmentsOptions = {}
        if (params.type !== undefined) opts.type = params.type as ReadonlyArray<EnrollmentType>
        if (params.state !== undefined) opts.state = params.state as ReadonlyArray<EnrollmentState>
        if (params.role !== undefined) opts.role = params.role as ReadonlyArray<string>
        if (params.include !== undefined)
          opts.include = params.include as ReadonlyArray<EnrollmentInclude>
        if (params.user_id !== undefined) opts.user_id = params.user_id as CanvasId | string
        if (params.grading_period_id !== undefined)
          opts.grading_period_id = params.grading_period_id as CanvasId
        if (params.enrollment_term_id !== undefined)
          opts.enrollment_term_id = params.enrollment_term_id as CanvasId
        const enrollments = await canvas.enrollments.listForCourse(course_id, opts)
        if (!pseudonymizer?.isEnabled()) return enrollments
        return Promise.all(enrollments.map((e) => pseudonymizer.anonymizeEnrollment(course_id, e)))
      },
    },
    {
      name: 'enroll_user',
      title: 'Enroll User',
      description:
        'Enroll a user in a course with a given role (StudentEnrollment, TeacherEnrollment, ' +
        'TaEnrollment, ObserverEnrollment, or DesignerEnrollment) and return the created ' +
        'enrollment object, including its `id` and `enrollment_state`. Use ' +
        '`list_course_enrollments` with a `user_id` filter to ' +
        "check a user's existing enrollments before enrolling them again, and " +
        '`remove_enrollment` to conclude, deactivate, or permanently delete this ' +
        'enrollment afterward — `enroll_user` itself has no way to undo what it creates. ' +
        'Omitting ' +
        '`enrollment_state` leaves it at Canvas\'s documented default of "invited", so the ' +
        'user must accept a course invitation before the enrollment becomes active; pass ' +
        '`enrollment_state: "active"` to skip that step. Omitting `course_section_id` leaves ' +
        "Canvas to place the enrollment in the course's default section — read " +
        '`list_sections` for the ID of a specific one. `limit_privileges_to_course_section` ' +
        'confines the user to that section: for teachers and TAs that includes grading ' +
        'privileges, and a section-limited student sees no user outside their own sections, ' +
        'teachers included. Both are left entirely unset when omitted, so the request is ' +
        'unchanged from a call that does not pass them. Requires permission to manage ' +
        'enrollments in the course; Canvas rejects the call otherwise.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        user_id: canvasIdInput().describe('The Canvas user ID to enroll'),
        type: z
          .enum([
            'StudentEnrollment',
            'TeacherEnrollment',
            'TaEnrollment',
            'ObserverEnrollment',
            'DesignerEnrollment',
          ])
          .describe('The enrollment type'),
        enrollment_state: z
          .enum(['active', 'invited', 'inactive'])
          .optional()
          .describe('Initial enrollment state (defaults to invited)'),
        course_section_id: canvasIdInput()
          .optional()
          .describe(
            "The section to enroll the user into (from `list_sections`); omitted = the course's default section",
          ),
        limit_privileges_to_course_section: z
          .boolean()
          .optional()
          .describe(
            'Restrict the user to seeing and interacting with users in course_section_id only',
          ),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const opts: EnrollUserOptions = {}
        if (params.course_section_id !== undefined)
          opts.course_section_id = params.course_section_id as CanvasId
        if (params.limit_privileges_to_course_section !== undefined)
          opts.limit_privileges_to_course_section =
            params.limit_privileges_to_course_section as boolean
        // Pass the options object only when one of the two new fields is set, so
        // a call that omits both reaches the client with the exact argument list
        // it had before they existed.
        return Object.keys(opts).length > 0
          ? canvas.enrollments.enroll(
              params.course_id as CanvasId,
              params.user_id as CanvasId,
              params.type as string,
              params.enrollment_state as string | undefined,
              opts,
            )
          : canvas.enrollments.enroll(
              params.course_id as CanvasId,
              params.user_id as CanvasId,
              params.type as string,
              params.enrollment_state as string | undefined,
            )
      },
    },
    {
      name: 'remove_enrollment',
      title: 'Remove Enrollment',
      description:
        "Remove or conclude an enrollment from a course. The 'delete' task is permanent; 'conclude' and 'deactivate' are reversible.",
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        enrollment_id: canvasIdInput().describe('The enrollment ID to remove'),
        task: z
          .enum(['conclude', 'delete', 'deactivate'])
          .describe('The action to perform on the enrollment'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        return canvas.enrollments.remove(
          params.course_id as CanvasId,
          params.enrollment_id as CanvasId,
          params.task as string,
        )
      },
    },
  ]
}
