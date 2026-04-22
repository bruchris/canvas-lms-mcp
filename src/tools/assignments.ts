import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type {
  AssignmentBucket,
  AssignmentGetInclude,
  AssignmentGroupInclude,
  AssignmentListInclude,
  AssignmentOrderBy,
  GetAssignmentOptions,
  ListAssignmentGroupsOptions,
  ListAssignmentsOptions,
} from '../canvas/assignments'
import type { ToolDefinition } from './types'

const ASSIGNMENT_LIST_INCLUDE = [
  'submission',
  'assignment_visibility',
  'all_dates',
  'overrides',
  'observed_users',
  'can_edit',
  'score_statistics',
] as const

const ASSIGNMENT_GET_INCLUDE = [
  'submission',
  'assignment_visibility',
  'overrides',
  'observed_users',
  'can_edit',
  'score_statistics',
  'all_dates',
] as const

const ASSIGNMENT_BUCKET = [
  'past',
  'overdue',
  'undated',
  'ungraded',
  'unsubmitted',
  'upcoming',
  'future',
] as const

const ASSIGNMENT_ORDER_BY = ['position', 'name', 'due_at'] as const

const ASSIGNMENT_GROUP_INCLUDE = [
  'assignments',
  'discussion_topic',
  'all_dates',
  'assignment_visibility',
  'overrides',
  'submission',
  'observed_users',
  'can_edit',
  'score_statistics',
] as const

export function assignmentTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_assignments',
      description:
        'List all assignments in a course. Use `include` to request submission, all_dates, overrides, score_statistics, etc. Use `bucket` to filter by past/upcoming/overdue/etc. Other filters: `search_term`, `assignment_ids`, `order_by`.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        include: z
          .array(z.enum(ASSIGNMENT_LIST_INCLUDE))
          .optional()
          .describe('Extra fields to include on each assignment (Canvas include[] param)'),
        search_term: z
          .string()
          .optional()
          .describe('Partial name substring to filter assignments by'),
        bucket: z
          .enum(ASSIGNMENT_BUCKET)
          .optional()
          .describe('Only include assignments in the given bucket'),
        assignment_ids: z
          .array(z.number())
          .optional()
          .describe('Restrict to the given list of assignment IDs'),
        order_by: z.enum(ASSIGNMENT_ORDER_BY).optional().describe('Field to sort the result by'),
        override_assignment_dates: z
          .boolean()
          .optional()
          .describe(
            'Apply assignment overrides to due/unlock/lock dates (default Canvas behavior: true)',
          ),
        needs_grading_count_by_section: z
          .boolean()
          .optional()
          .describe('Break needs_grading_count down by section'),
        post_to_sis: z
          .boolean()
          .optional()
          .describe('Filter to assignments that are/are not posted to SIS'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const opts: ListAssignmentsOptions = {}
        if (params.include !== undefined)
          opts.include = params.include as ReadonlyArray<AssignmentListInclude>
        if (params.search_term !== undefined) opts.search_term = params.search_term as string
        if (params.bucket !== undefined) opts.bucket = params.bucket as AssignmentBucket
        if (params.assignment_ids !== undefined)
          opts.assignment_ids = params.assignment_ids as ReadonlyArray<number>
        if (params.order_by !== undefined) opts.order_by = params.order_by as AssignmentOrderBy
        if (params.override_assignment_dates !== undefined)
          opts.override_assignment_dates = params.override_assignment_dates as boolean
        if (params.needs_grading_count_by_section !== undefined)
          opts.needs_grading_count_by_section = params.needs_grading_count_by_section as boolean
        if (params.post_to_sis !== undefined) opts.post_to_sis = params.post_to_sis as boolean
        return canvas.assignments.list(params.course_id as number, opts)
      },
    },
    {
      name: 'get_assignment',
      description:
        'Get details for a single assignment by ID. Use `include` to request submission, overrides, all_dates, score_statistics, and other optional fields.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID'),
        include: z
          .array(z.enum(ASSIGNMENT_GET_INCLUDE))
          .optional()
          .describe('Extra fields to include on the assignment (Canvas include[] param)'),
        override_assignment_dates: z
          .boolean()
          .optional()
          .describe('Apply assignment overrides to due/unlock/lock dates'),
        needs_grading_count_by_section: z
          .boolean()
          .optional()
          .describe('Break needs_grading_count down by section'),
        all_dates: z
          .boolean()
          .optional()
          .describe('Return all dates associated with this assignment'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const opts: GetAssignmentOptions = {}
        if (params.include !== undefined)
          opts.include = params.include as ReadonlyArray<AssignmentGetInclude>
        if (params.override_assignment_dates !== undefined)
          opts.override_assignment_dates = params.override_assignment_dates as boolean
        if (params.needs_grading_count_by_section !== undefined)
          opts.needs_grading_count_by_section = params.needs_grading_count_by_section as boolean
        if (params.all_dates !== undefined) opts.all_dates = params.all_dates as boolean
        return canvas.assignments.get(
          params.course_id as number,
          params.assignment_id as number,
          opts,
        )
      },
    },
    {
      name: 'list_assignment_groups',
      description:
        'List assignment groups (categories like Homework, Exams) in a course. Use `include=assignments` to nest assignments under each group; other includes add submission, overrides, score_statistics, etc.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        include: z
          .array(z.enum(ASSIGNMENT_GROUP_INCLUDE))
          .optional()
          .describe('Extra fields to include (Canvas include[] param)'),
        assignment_ids: z
          .array(z.number())
          .optional()
          .describe(
            'When combined with include=assignments, restrict nested assignments to these IDs',
          ),
        exclude_assignment_submission_types: z
          .array(z.string())
          .optional()
          .describe('Exclude assignments whose submission_types match any of these values'),
        override_assignment_dates: z
          .boolean()
          .optional()
          .describe('Apply assignment overrides to due/unlock/lock dates'),
        grading_period_id: z
          .number()
          .int()
          .optional()
          .describe('Scope to a specific grading period'),
        scope_assignments_to_student: z
          .boolean()
          .optional()
          .describe('Limit assignments to what the current student can see'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const opts: ListAssignmentGroupsOptions = {}
        if (params.include !== undefined)
          opts.include = params.include as ReadonlyArray<AssignmentGroupInclude>
        if (params.assignment_ids !== undefined)
          opts.assignment_ids = params.assignment_ids as ReadonlyArray<number>
        if (params.exclude_assignment_submission_types !== undefined)
          opts.exclude_assignment_submission_types =
            params.exclude_assignment_submission_types as ReadonlyArray<string>
        if (params.override_assignment_dates !== undefined)
          opts.override_assignment_dates = params.override_assignment_dates as boolean
        if (params.grading_period_id !== undefined)
          opts.grading_period_id = params.grading_period_id as number
        if (params.scope_assignments_to_student !== undefined)
          opts.scope_assignments_to_student = params.scope_assignments_to_student as boolean
        return canvas.assignments.listGroups(params.course_id as number, opts)
      },
    },
    {
      name: 'create_assignment',
      description: 'Create a new assignment in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        name: z.string().describe('Assignment name'),
        description: z.string().optional().describe('Assignment description (HTML supported)'),
        points_possible: z.number().optional().describe('Maximum points for this assignment'),
        due_at: z
          .string()
          .optional()
          .describe('Due date in ISO 8601 format (e.g. 2026-05-01T23:59:00Z)'),
        submission_types: z
          .array(z.string())
          .optional()
          .describe(
            'Allowed submission types (e.g. ["online_upload", "online_text_entry", "none"])',
          ),
        assignment_group_id: z
          .number()
          .optional()
          .describe('ID of the assignment group to place this assignment in'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const { course_id, ...rest } = params as {
          course_id: number
          name: string
          description?: string
          points_possible?: number
          due_at?: string
          submission_types?: string[]
          assignment_group_id?: number
        }
        return canvas.assignments.create(course_id, rest)
      },
    },
    {
      name: 'update_assignment',
      description: 'Update an existing assignment in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID'),
        name: z.string().optional().describe('New assignment name'),
        description: z.string().optional().describe('New assignment description (HTML supported)'),
        points_possible: z.number().optional().describe('New maximum points'),
        due_at: z
          .string()
          .optional()
          .describe('New due date in ISO 8601 format (e.g. 2026-05-01T23:59:00Z)'),
        submission_types: z.array(z.string()).optional().describe('New allowed submission types'),
        assignment_group_id: z.number().optional().describe('New assignment group ID'),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const { course_id, assignment_id, ...rest } = params as {
          course_id: number
          assignment_id: number
          name?: string
          description?: string
          points_possible?: number
          due_at?: string
          submission_types?: string[]
          assignment_group_id?: number
        }
        return canvas.assignments.update(course_id, assignment_id, rest)
      },
    },
    {
      name: 'delete_assignment',
      description: 'Delete an assignment from a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID to delete'),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const assignment_id = params.assignment_id as number
        await canvas.assignments.delete(course_id, assignment_id)
      },
    },
  ]
}
