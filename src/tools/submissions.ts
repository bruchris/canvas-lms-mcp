import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type {
  GetSubmissionOptions,
  ListSubmissionsOptions,
  SubmissionGetInclude,
  SubmissionListInclude,
  SubmissionWorkflowState,
} from '../canvas/submissions'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'
import { type CanvasId, canvasIdInput, canvasIdList } from '../canvas/id'

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

export function submissionTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
  return [
    {
      name: 'list_submissions',
      title: 'List Submissions',
      description:
        'List all submissions for an assignment. Use `include` to attach user, assignment, rubric_assessment, submission_history, or visibility. Filter with `student_ids`, `workflow_state`, or `grading_period_id`. Defaults to including submission_comments.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        assignment_id: canvasIdInput().describe('The Canvas assignment ID'),
        include: z
          .array(z.enum(SUBMISSION_LIST_INCLUDE))
          .optional()
          .describe(
            'Extra fields to include (Canvas include[] param). Defaults to ["submission_comments"] when omitted.',
          ),
        student_ids: canvasIdList({ sentinels: ['all', 'self'] })
          .optional()
          .describe(
            'Restrict to submissions for these user IDs (pass large IDs as strings). ' +
              'Use "all" or "self" for shortcuts.',
          ),
        section_ids: z
          .array(canvasIdInput())
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
        grading_period_id: canvasIdInput().optional().describe('Restrict to a grading period'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const opts: ListSubmissionsOptions = {}
        if (params.include !== undefined)
          opts.include = params.include as ReadonlyArray<SubmissionListInclude>
        if (params.student_ids !== undefined)
          opts.student_ids = params.student_ids as ReadonlyArray<CanvasId>
        if (params.section_ids !== undefined)
          opts.section_ids = params.section_ids as ReadonlyArray<CanvasId>
        if (params.grouped !== undefined) opts.grouped = params.grouped as boolean
        if (params.workflow_state !== undefined)
          opts.workflow_state = params.workflow_state as SubmissionWorkflowState
        if (params.grading_period_id !== undefined)
          opts.grading_period_id = params.grading_period_id as CanvasId
        const submissions = await canvas.submissions.list(
          course_id,
          params.assignment_id as CanvasId,
          opts,
        )
        if (!pseudonymizer?.isEnabled()) return submissions
        return Promise.all(submissions.map((s) => pseudonymizer.anonymizeSubmission(course_id, s)))
      },
    },
    {
      name: 'get_submission',
      title: 'Get Submission',
      description:
        "Get one student's submission for an assignment by user_id, returning the Canvas submission object (score, grade, workflow_state, submitted_at, body/url, submission_comments). user_id can be any user in the course, not only the caller's own. Use list_submissions to fetch every student's submission for the assignment in a single call instead of one get_submission call per student, or get_my_submissions when the caller wants their own submissions across a whole course rather than one assignment. Defaults to including submission_comments; pass `include` to add submission_history, rubric_assessment, visibility, course, user, or read_status instead.",
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        assignment_id: canvasIdInput().describe('The Canvas assignment ID'),
        user_id: canvasIdInput().describe('The Canvas user ID'),
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
        const course_id = params.course_id as CanvasId
        const opts: GetSubmissionOptions = {}
        if (params.include !== undefined)
          opts.include = params.include as ReadonlyArray<SubmissionGetInclude>
        const submission = await canvas.submissions.get(
          course_id,
          params.assignment_id as CanvasId,
          params.user_id as CanvasId,
          opts,
        )
        if (!pseudonymizer?.isEnabled()) return submission
        return pseudonymizer.anonymizeSubmission(course_id, submission)
      },
    },
    {
      name: 'grade_submission',
      title: 'Grade Submission',
      description:
        "Post or update the grade for one student's submission on a regular assignment and return the updated Canvas submission object (score, grade, workflow_state, graded_at). Only `grade` is sent; nothing else on the submission changes. Idempotent: calling it again with the same grade string overwrites the previous `posted_grade` rather than creating a second grade. This sets only the top-level grade — for a rubric-based assignment use submit_rubric_assessment to score each criterion instead, and for a Classic Quiz use score_quiz_question to grade one question at a time rather than the assignment as a whole. Requires grading permission in the course.",
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        assignment_id: canvasIdInput().describe('The Canvas assignment ID'),
        user_id: canvasIdInput().describe('The Canvas user ID'),
        grade: z.string().describe('The grade to assign (e.g. "95", "A", "pass")'),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const assignment_id = params.assignment_id as CanvasId
        const user_id = params.user_id as CanvasId
        const grade = params.grade as string
        return canvas.submissions.grade(course_id, assignment_id, user_id, grade)
      },
    },
    {
      name: 'comment_on_submission',
      title: 'Comment on Submission',
      description:
        "Add a text comment to a submission and return the updated Canvas submission object, with the new entry appended to `submission_comments`. Not idempotent: each call posts another comment rather than editing or replacing a prior one, so a retried call leaves duplicate comments behind instead of one. This only adds a comment — it never changes `grade` or `score`; use grade_submission for that, on the same course_id/assignment_id/user_id. Use list_submission_comments_needing_attention to find submissions where the student's most recent comment has not yet been answered by staff. Requires the same grading permission as grade_submission, since both send a PUT to the same submission endpoint — one with a `comment` body, the other with `submission`.",
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        assignment_id: canvasIdInput().describe('The Canvas assignment ID'),
        user_id: canvasIdInput().describe('The Canvas user ID'),
        comment: z.string().describe('The comment text to add'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const assignment_id = params.assignment_id as CanvasId
        const user_id = params.user_id as CanvasId
        const comment = params.comment as string
        return canvas.submissions.comment(course_id, assignment_id, user_id, comment)
      },
    },
  ]
}
