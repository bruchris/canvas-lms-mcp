import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type {
  CourseEnrollmentState,
  CourseGetInclude,
  CourseListInclude,
  CourseWorkflowState,
  GetCourseOptions,
  ListCoursesOptions,
} from '../canvas/courses'
import type { ToolDefinition } from './types'

const COURSE_LIST_INCLUDE = [
  'needs_grading_count',
  'syllabus_body',
  'public_description',
  'total_scores',
  'current_grading_period_scores',
  'grading_periods',
  'term',
  'account',
  'course_progress',
  'sections',
  'storage_quota_used_mb',
  'total_students',
  'passback_status',
  'favorites',
  'teachers',
  'observed_users',
  'tabs',
  'course_image',
  'banner_image',
  'concluded',
  'lti_context_id',
  'post_manually',
] as const

const COURSE_GET_INCLUDE = [...COURSE_LIST_INCLUDE, 'all_courses', 'permissions'] as const

const COURSE_WORKFLOW_STATE = ['unpublished', 'available', 'completed', 'deleted'] as const

const COURSE_ENROLLMENT_STATE = ['active', 'invited_or_pending', 'completed'] as const

export function courseTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_courses',
      description:
        'List courses for the authenticated user. `include` adds optional fields (teachers, total_students, term, syllabus_body, etc.). `state[]` narrows by course workflow state; `enrollment_state` narrows by the caller’s enrollment state.',
      inputSchema: {
        enrollment_state: z
          .enum(COURSE_ENROLLMENT_STATE)
          .optional()
          .describe('Filter courses by the caller’s enrollment state'),
        state: z
          .array(z.enum(COURSE_WORKFLOW_STATE))
          .optional()
          .describe('Filter by course workflow state'),
        enrollment_role_id: z
          .number()
          .int()
          .optional()
          .describe('Filter by specific enrollment role ID'),
        include: z
          .array(z.enum(COURSE_LIST_INCLUDE))
          .optional()
          .describe('Extra fields to include on each course (Canvas include[] param)'),
        exclude_blueprint_courses: z
          .boolean()
          .optional()
          .describe('Exclude blueprint courses from the results'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const opts: ListCoursesOptions = {}
        if (params.enrollment_state !== undefined)
          opts.enrollment_state = params.enrollment_state as CourseEnrollmentState
        if (params.state !== undefined)
          opts.state = params.state as ReadonlyArray<CourseWorkflowState>
        if (params.enrollment_role_id !== undefined)
          opts.enrollment_role_id = params.enrollment_role_id as number
        if (params.include !== undefined)
          opts.include = params.include as ReadonlyArray<CourseListInclude>
        if (params.exclude_blueprint_courses !== undefined)
          opts.exclude_blueprint_courses = params.exclude_blueprint_courses as boolean
        return canvas.courses.list(opts)
      },
    },
    {
      name: 'get_course',
      description:
        'Get details for a single course. Defaults to requesting `term` and `total_students`. Pass `include` to replace the default set with custom Canvas include[] fields (teachers, permissions, syllabus_body, sections, etc.).',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        include: z
          .array(z.enum(COURSE_GET_INCLUDE))
          .optional()
          .describe('Extra fields to include on the course (Canvas include[] param)'),
        teacher_limit: z
          .number()
          .int()
          .optional()
          .describe('Limit on the number of teachers returned when include=teachers'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const opts: GetCourseOptions = {}
        if (params.include !== undefined)
          opts.include = params.include as ReadonlyArray<CourseGetInclude>
        if (params.teacher_limit !== undefined) opts.teacher_limit = params.teacher_limit as number
        return canvas.courses.get(params.course_id as number, opts)
      },
    },
    {
      name: 'get_syllabus',
      description: 'Get the syllabus HTML body for a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const syllabus_body = await canvas.courses.getSyllabus(course_id)
        return { course_id, syllabus_body }
      },
    },
    {
      name: 'create_course',
      description: 'Create a new course in a Canvas account. Returns the created course object.',
      inputSchema: {
        account_id: z
          .number()
          .int()
          .positive()
          .describe('The Canvas account ID to create the course in'),
        name: z.string().describe('The name of the course'),
        course_code: z.string().optional().describe('The course code (e.g. CS101)'),
        start_at: z
          .string()
          .datetime()
          .optional()
          .describe('Course start date in ISO 8601 format (e.g. 2026-01-15T00:00:00Z)'),
        end_at: z
          .string()
          .datetime()
          .optional()
          .describe('Course end date in ISO 8601 format (e.g. 2026-05-15T00:00:00Z)'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const { account_id, ...courseFields } = params as {
          account_id: number
          name: string
          course_code?: string
          start_at?: string
          end_at?: string
        }
        return canvas.courses.create({ account_id, ...courseFields })
      },
    },
    {
      name: 'update_course',
      description:
        'Update an existing course. Only provided fields are changed; omitted fields are left as-is.',
      inputSchema: {
        course_id: z.number().int().positive().describe('The Canvas course ID to update'),
        name: z.string().optional().describe('New course name'),
        course_code: z.string().optional().describe('New course code'),
        start_at: z
          .string()
          .datetime()
          .optional()
          .describe('New start date in ISO 8601 format (e.g. 2026-01-15T00:00:00Z)'),
        end_at: z
          .string()
          .datetime()
          .optional()
          .describe('New end date in ISO 8601 format (e.g. 2026-05-15T00:00:00Z)'),
        default_view: z
          .enum(['feed', 'wiki', 'modules', 'assignments', 'syllabus'])
          .optional()
          .describe('Default course home page view'),
        syllabus_body: z.string().optional().describe('HTML body for the course syllabus'),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const { course_id, ...fields } = params as {
          course_id: number
          name?: string
          course_code?: string
          start_at?: string
          end_at?: string
          default_view?: 'feed' | 'wiki' | 'modules' | 'assignments' | 'syllabus'
          syllabus_body?: string
        }
        return canvas.courses.update(course_id, fields)
      },
    },
  ]
}
