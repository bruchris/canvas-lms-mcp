import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type {
  GetSubmissionOptions,
  ListSubmissionsOptions,
  SubmissionGetInclude,
  SubmissionListInclude,
  SubmissionWorkflowState,
} from '../canvas/submissions'
import type { ToolDefinition } from './types'

const SUBMISSION_LIST_INCLUDE = [
  'submission_history',
  'submission_comments',
  'rubric_assessment',
  'assignment',
  'visibility',
  'course',
  'user',
  'group',
  'read_status',
  'sub_assignment_submissions',
] as const

const SUBMISSION_GET_INCLUDE = [
  'submission_history',
  'submission_comments',
  'rubric_assessment',
  'visibility',
  'course',
  'user',
  'read_status',
] as const

const SUBMISSION_WORKFLOW_STATE = ['submitted', 'unsubmitted', 'graded', 'pending_review'] as const

export function submissionTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_submissions',
      description:
        'List all submissions for an assignment. Use `include` to attach user, assignment, rubric_assessment, submission_history, or visibility. Filter with `student_ids`, `workflow_state`, or `grading_period_id`. Defaults to including submission_comments.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID'),
        include: z
          .array(z.enum(SUBMISSION_LIST_INCLUDE))
          .optional()
          .describe(
            'Extra fields to include (Canvas include[] param). Defaults to ["submission_comments"] when omitted.',
          ),
        student_ids: z
          .array(z.union([z.number(), z.string()]))
          .optional()
          .describe(
            'Restrict to submissions for these user IDs. Use "all" or "self" for shortcuts.',
          ),
        section_ids: z
          .array(z.number())
          .optional()
          .describe('Restrict to submissions in these sections'),
        grouped: z
          .boolean()
          .optional()
          .describe('Return one submission per group rather than per student'),
        workflow_state: z
          .enum(SUBMISSION_WORKFLOW_STATE)
          .optional()
          .describe('Only include submissions in this workflow state'),
        grading_period_id: z.number().int().optional().describe('Restrict to a grading period'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const opts: ListSubmissionsOptions = {}
        if (params.include !== undefined)
          opts.include = params.include as ReadonlyArray<SubmissionListInclude>
        if (params.student_ids !== undefined)
          opts.student_ids = params.student_ids as ReadonlyArray<number | string>
        if (params.section_ids !== undefined)
          opts.section_ids = params.section_ids as ReadonlyArray<number>
        if (params.grouped !== undefined) opts.grouped = params.grouped as boolean
        if (params.workflow_state !== undefined)
          opts.workflow_state = params.workflow_state as SubmissionWorkflowState
        if (params.grading_period_id !== undefined)
          opts.grading_period_id = params.grading_period_id as number
        return canvas.submissions.list(
          params.course_id as number,
          params.assignment_id as number,
          opts,
        )
      },
    },
    {
      name: 'get_submission',
      description:
        'Get a single submission for a specific user on an assignment. Defaults to including submission_comments. Pass `include` to add rubric_assessment, submission_history, visibility, course, user, or read_status.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID'),
        user_id: z.number().describe('The Canvas user ID'),
        include: z
          .array(z.enum(SUBMISSION_GET_INCLUDE))
          .optional()
          .describe(
            'Extra fields to include (Canvas include[] param). Defaults to ["submission_comments"] when omitted.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const opts: GetSubmissionOptions = {}
        if (params.include !== undefined)
          opts.include = params.include as ReadonlyArray<SubmissionGetInclude>
        return canvas.submissions.get(
          params.course_id as number,
          params.assignment_id as number,
          params.user_id as number,
          opts,
        )
      },
    },
    {
      name: 'grade_submission',
      description: 'Post or update a grade for a submission. Requires grading permissions.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID'),
        user_id: z.number().describe('The Canvas user ID'),
        grade: z.string().describe('The grade to assign (e.g. "95", "A", "pass")'),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const assignment_id = params.assignment_id as number
        const user_id = params.user_id as number
        const grade = params.grade as string
        return canvas.submissions.grade(course_id, assignment_id, user_id, grade)
      },
    },
    {
      name: 'comment_on_submission',
      description: 'Add a text comment to a submission.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID'),
        user_id: z.number().describe('The Canvas user ID'),
        comment: z.string().describe('The comment text to add'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const assignment_id = params.assignment_id as number
        const user_id = params.user_id as number
        const comment = params.comment as string
        return canvas.submissions.comment(course_id, assignment_id, user_id, comment)
      },
    },
  ]
}
