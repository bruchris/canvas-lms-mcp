import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type {
  EnrollmentInclude,
  EnrollmentState,
  EnrollmentType,
  ListCourseEnrollmentsOptions,
  ListUserEnrollmentsOptions,
} from '../canvas/enrollments'
import type { ToolDefinition } from './types'

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

export function enrollmentTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_enrollments',
      description:
        'List all enrollments for the authenticated user across courses. Optional filters and includes mirror Canvas `GET /users/self/enrollments`.',
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
        grading_period_id: z
          .number()
          .int()
          .optional()
          .describe('Return enrollments scoped to this grading period'),
        enrollment_term_id: z
          .number()
          .int()
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
          opts.grading_period_id = params.grading_period_id as number
        if (params.enrollment_term_id !== undefined)
          opts.enrollment_term_id = params.enrollment_term_id as number
        return canvas.enrollments.list(opts)
      },
    },
    {
      name: 'list_course_enrollments',
      description:
        'List enrollments within a specific course with Canvas filters. Use `include=grades` / `include=current_points` for richer grade data, `type[]` to limit to a role, and `user_id` to focus on a single user.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
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
        user_id: z
          .union([z.number(), z.string()])
          .optional()
          .describe('Filter to a specific user (may be numeric ID or "self")'),
        grading_period_id: z
          .number()
          .int()
          .optional()
          .describe('Scope grade-related includes to this grading period'),
        enrollment_term_id: z
          .number()
          .int()
          .optional()
          .describe('Limit to enrollments in the given term'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const opts: ListCourseEnrollmentsOptions = {}
        if (params.type !== undefined) opts.type = params.type as ReadonlyArray<EnrollmentType>
        if (params.state !== undefined) opts.state = params.state as ReadonlyArray<EnrollmentState>
        if (params.role !== undefined) opts.role = params.role as ReadonlyArray<string>
        if (params.include !== undefined)
          opts.include = params.include as ReadonlyArray<EnrollmentInclude>
        if (params.user_id !== undefined) opts.user_id = params.user_id as number | string
        if (params.grading_period_id !== undefined)
          opts.grading_period_id = params.grading_period_id as number
        if (params.enrollment_term_id !== undefined)
          opts.enrollment_term_id = params.enrollment_term_id as number
        return canvas.enrollments.listForCourse(params.course_id as number, opts)
      },
    },
    {
      name: 'enroll_user',
      description: 'Enroll a user in a course with a specified role.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        user_id: z.number().describe('The Canvas user ID to enroll'),
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
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        return canvas.enrollments.enroll(
          params.course_id as number,
          params.user_id as number,
          params.type as string,
          params.enrollment_state as string | undefined,
        )
      },
    },
    {
      name: 'remove_enrollment',
      description: 'Remove or conclude an enrollment from a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        enrollment_id: z.number().describe('The enrollment ID to remove'),
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
          params.course_id as number,
          params.enrollment_id as number,
          params.task as string,
        )
      },
    },
  ]
}
