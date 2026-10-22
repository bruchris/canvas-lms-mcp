import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type {
  CourseEnrollmentState,
  CourseGetInclude,
  CourseListInclude,
  CourseSectionInclude,
  CourseWorkflowState,
  GetCourseOptions,
  ListCourseSectionsOptions,
  ListCoursesOptions,
} from '../canvas/courses'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'
import { type CanvasId, canvasIdInput } from '../canvas/id'

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

const COURSE_SECTION_INCLUDE = ['total_students', 'permissions'] as const

export function courseTools(canvas: CanvasClient, pseudonymizer?: Pseudonymizer): ToolDefinition[] {
  return [
    {
      name: 'list_courses',
      title: 'List Courses',
      description:
        'List courses for the authenticated user. Use fields="slim" when enumerating courses for selection; switch to "full" once you have identified the target. slim returns id, name, course_code, term name, and workflow_state only. "full" (default) includes all Canvas fields plus `include` extras (teachers, total_students, syllabus_body, etc.). `state[]` narrows by course workflow state; `enrollment_state` narrows by the caller\'s enrollment state.',
      inputSchema: {
        fields: z
          .enum(['slim', 'full'])
          .optional()
          .describe(
            'Projection mode: "slim" returns id/name/course_code/term/workflow_state only; "full" (default) returns all fields',
          ),
        enrollment_state: z
          .enum(COURSE_ENROLLMENT_STATE)
          .optional()
          .describe("Filter courses by the caller's enrollment state"),
        state: z
          .array(z.enum(COURSE_WORKFLOW_STATE))
          .optional()
          .describe('Filter by course workflow state'),
        include: z
          .array(z.enum(COURSE_LIST_INCLUDE))
          .optional()
          .describe(
            'Extra fields to include on each course (Canvas include[] param); ignored when fields="slim"',
          ),
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
        const slim = params.fields === 'slim'
        const opts: ListCoursesOptions = {}
        if (params.enrollment_state !== undefined)
          opts.enrollment_state = params.enrollment_state as CourseEnrollmentState
        if (params.state !== undefined)
          opts.state = params.state as ReadonlyArray<CourseWorkflowState>
        if (!slim && params.include !== undefined)
          opts.include = params.include as ReadonlyArray<CourseListInclude>
        if (params.exclude_blueprint_courses !== undefined)
          opts.exclude_blueprint_courses = params.exclude_blueprint_courses as boolean
        const courses = await canvas.courses.list(opts)
        if (!slim) return courses
        return courses.map((c) => ({
          id: c.id,
          name: c.name,
          course_code: c.course_code,
          term: c.term?.name ?? null,
          workflow_state: c.workflow_state,
        }))
      },
    },
    {
      name: 'get_course',
      title: 'Get Course',
      description:
        'Get details for a single course. Defaults to requesting `term` and `total_students`. Pass `include` to replace the default set with custom Canvas include[] fields (teachers, permissions, syllabus_body, sections, etc.).',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
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
        return canvas.courses.get(params.course_id as CanvasId, opts)
      },
    },
    {
      name: 'get_syllabus',
      title: 'Get Syllabus',
      description:
        "Get just the syllabus HTML body for a course, returning { course_id, syllabus_body } where syllabus_body is null if the course has none set. Use get_course with include: ['syllabus_body'] instead when you also need other course fields in the same call, or update_course to change the syllabus body. If the course has public_syllabus or public_syllabus_to_auth enabled, the body may be readable even by callers without an enrollment in the course.",
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const syllabus_body = await canvas.courses.getSyllabus(course_id)
        return { course_id, syllabus_body }
      },
    },
    {
      name: 'list_sections',
      title: 'List Course Sections',
      description:
        "List the sections of a course, returning each section's id, name, course_id, " +
        'start_at, end_at and restrict_enrollments_to_section_dates. Use it to resolve the ' +
        'section ID that `create_assignment_override` needs for a section-specific due date, ' +
        'that `enroll_user` takes as `course_section_id`, and that the ' +
        '`needs_grading_count_by_section` option on `list_assignments` reports against; use ' +
        '`list_course_enrollments` or `list_course_users` for the people in a section rather ' +
        "than the sections themselves, or `get_course` with include: ['sections'] when you " +
        'also need other course fields in the same call. Fetches every page (100 per request) ' +
        "and fails with a 'Results are incomplete' error instead of silently truncating. This " +
        "tool never requests Canvas's student roster include, so no student names are " +
        'returned. The SIS fields (sis_section_id, sis_course_id, integration_id) appear only ' +
        'for callers with SIS read permission, and Canvas silently drops the total_students ' +
        'and permissions extras — rather than erroring — unless the caller can read the course ' +
        'roster or grades. search_term must be at least 2 characters; Canvas ignores shorter ' +
        'ones. Requires read access to the course.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        include: z
          .array(z.enum(COURSE_SECTION_INCLUDE))
          .optional()
          .describe('Extra fields to include on each section (Canvas include[] param)'),
        search_term: z
          .string()
          .optional()
          .describe('Return only sections whose name matches this term (at least 2 characters)'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const opts: ListCourseSectionsOptions = {}
        if (params.include !== undefined)
          opts.include = params.include as ReadonlyArray<CourseSectionInclude>
        if (params.search_term !== undefined) opts.search_term = params.search_term as string
        const sections = await canvas.courses.listSections(course_id, opts)
        // Fail-closed: today's `include` union cannot produce `students`, but a
        // Canvas instance that returns it unasked — or a later widening of that
        // union — must not leak names. See `Pseudonymizer#anonymizeSections`.
        if (!pseudonymizer?.isEnabled()) return sections
        return pseudonymizer.anonymizeSections(course_id, sections)
      },
    },
    {
      name: 'create_course',
      title: 'Create Course',
      audience: 'admin',
      description:
        "Create a new course in a Canvas account and return the created Canvas course object (id, name, course_code, workflow_state, and the fields passed in). Not idempotent: calling it again with the same name creates a second, separate course rather than reusing or updating the first — use update_course afterward to change it, or list_courses first to check whether a matching course already exists. Canvas silently drops start_at and end_at unless the course also restricts enrollment to course dates, which this tool does not expose, so the dates you pass may not take effect; set them with update_course if they don't. Requires the account-level permission to create courses.",
      inputSchema: {
        account_id: canvasIdInput().describe('The Canvas account ID to create the course in'),
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
          account_id: CanvasId
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
      title: 'Update Course',
      audience: 'educator',
      description:
        'Update an existing course and return the updated Canvas course object. Only the fields you pass are changed; omitted fields are left as-is, and calling it again with the same values leaves the course in the same state (idempotent). Requires permission to update course details; a caller who has only that lesser permission (not full course update rights) can still change syllabus_body through this same call, but every other field they pass is silently dropped rather than erroring. Use create_course for a new course, or get_course to see the current values before changing them.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID to update'),
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
        apply_assignment_group_weights: z
          .boolean()
          .optional()
          .describe('Whether the final grade is weighted by assignment group percentages'),
        hide_final_grades: z
          .boolean()
          .optional()
          .describe('Whether to hide the totals in the student grades summary'),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const { course_id, ...fields } = params as {
          course_id: CanvasId
          name?: string
          course_code?: string
          start_at?: string
          end_at?: string
          default_view?: 'feed' | 'wiki' | 'modules' | 'assignments' | 'syllabus'
          syllabus_body?: string
          apply_assignment_group_weights?: boolean
          hide_final_grades?: boolean
        }
        return canvas.courses.update(course_id, fields)
      },
    },
  ]
}
