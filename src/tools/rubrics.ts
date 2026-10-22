import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type {
  GetRubricOptions,
  RubricAssociationInput,
  RubricAttachOptions,
  RubricCriterionInput,
  RubricCreateInput,
  RubricInclude,
} from '../canvas/rubrics'
import type { ToolDefinition } from './types'
import { type CanvasId, canvasIdInput } from '../canvas/id'

const RUBRIC_INCLUDE = [
  'assessments',
  'graded_assessments',
  'peer_assessments',
  'associations',
  'assignment_associations',
  'course_associations',
  'account_associations',
] as const

export function rubricTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_rubrics',
      title: 'List Rubrics',
      description:
        "List every rubric defined in a course, returning each rubric's title, points_possible, and criteria/ratings. Fetches every page (100 per request) and fails with a 'Results are incomplete' error instead of silently truncating. Use get_rubric to fetch one rubric by ID once you have it, get_rubric_assessment for a specific student's completed assessment rather than the rubric definition, or create_rubric to add a new one. Requires the manage_rubrics permission in the course, so most students cannot call this.",
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        return canvas.rubrics.list(course_id)
      },
    },
    {
      name: 'get_rubric',
      title: 'Get Rubric',
      description:
        'Get a single rubric\'s definition (title, points_possible, criteria, and rating levels) by ID. Use list_rubrics to find the rubric_id for a course first. Pass include=["assignment_associations"] to also retrieve the rubric association IDs that submit_rubric_assessment needs, or include=["assessments"|"graded_assessments"|"peer_assessments"] for assessor_id-only assessment summaries (no assessor name is returned). This returns the rubric\'s structure, not any one student\'s completed assessment — use get_rubric_assessment for that. Requires the manage_rubrics permission in the course, so most students cannot call this.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        rubric_id: canvasIdInput().describe('The Canvas rubric ID'),
        include: z
          .array(z.enum(RUBRIC_INCLUDE))
          .optional()
          .describe(
            'Related Canvas records to include. Use assignment_associations to retrieve association IDs for linked assignments. Canvas honours only one association scope per request; extra association values are ignored.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const rubric_id = params.rubric_id as CanvasId
        if (params.include === undefined) return canvas.rubrics.get(course_id, rubric_id)
        const options: GetRubricOptions = {}
        options.include = params.include as ReadonlyArray<RubricInclude>
        return canvas.rubrics.get(course_id, rubric_id, options)
      },
    },
    {
      name: 'get_rubric_assessment',
      title: 'Get Rubric Assessment',
      description:
        "Get one student's submission for an assignment with the Canvas rubric_assessment attached, keyed by criterion_id (rating_id, comments, points per criterion) — this does not carry the assessor's name or any grader identity. This is the same full submission object (score, grade, workflow_state, submitted_at) that get_submission returns, requested here with `include[]=rubric_assessment` instead of get_submission's default `submission_comments`; use get_submission when you also need comments or the submitted text/URL. Use submit_rubric_assessment to post a rubric assessment for a student rather than read one back.",
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        assignment_id: canvasIdInput().describe('The Canvas assignment ID'),
        user_id: canvasIdInput().describe('The Canvas user ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const assignment_id = params.assignment_id as CanvasId
        const user_id = params.user_id as CanvasId
        return canvas.rubrics.getAssessment(course_id, assignment_id, user_id)
      },
    },
    {
      name: 'submit_rubric_assessment',
      title: 'Submit Rubric Assessment',
      description: 'Submit a rubric assessment with scores and comments for each criterion.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        association_id: canvasIdInput().describe('The rubric association ID'),
        data: z
          .array(
            z.object({
              criterion_id: z.string().describe('The rubric criterion ID'),
              points: z.number().describe('Points awarded for this criterion'),
              comments: z.string().describe('Feedback comment for this criterion'),
            }),
          )
          .describe('Array of criterion assessments'),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const association_id = params.association_id as CanvasId
        const data = params.data as Array<{
          criterion_id: string
          points: number
          comments: string
        }>
        return canvas.rubrics.submitAssessment(course_id, association_id, data)
      },
    },
    {
      name: 'create_rubric',
      title: 'Create Rubric',
      description:
        'Create a new rubric in a course with criteria and rating levels. Optionally link it to an assignment immediately. Returns { rubric, rubric_association? }; when an assignment association was requested, rubric_association.id is the association_id that submit_rubric_assessment takes.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        title: z.string().describe('The rubric title'),
        criteria: z
          .array(
            z.object({
              description: z.string().describe('Criterion description'),
              points: z.number().describe('Maximum points for this criterion'),
              ratings: z
                .array(
                  z.object({
                    description: z.string().describe('Rating level description'),
                    points: z.number().describe('Points for this rating level'),
                  }),
                )
                .min(2, 'Each criterion must have at least 2 rating levels')
                .describe('Rating levels for this criterion (highest to lowest)'),
            }),
          )
          .min(1, 'At least one criterion is required')
          .describe('Rubric criteria'),
        association: z
          .object({
            assignment_id: canvasIdInput().describe('Assignment ID to link this rubric to'),
            use_for_grading: z
              .boolean()
              .optional()
              .describe('Whether to use this rubric for grading'),
            purpose: z.string().optional().describe('Purpose of the association (e.g., "grading")'),
          })
          .optional()
          .describe('Optional assignment association'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const rubric: RubricCreateInput = {
          title: params.title as string,
          criteria: params.criteria as RubricCriterionInput[],
        }
        const association = params.association as RubricAssociationInput | undefined
        return canvas.rubrics.create(course_id, rubric, association)
      },
    },
    {
      name: 'attach_rubric',
      title: 'Attach Rubric',
      description:
        'Attach an existing course rubric to an assignment, so one rubric can be shared across many assignments instead of creating a duplicate per assignment with create_rubric. Returns the new rubric association.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        rubric_id: canvasIdInput().describe('The ID of the existing rubric to attach'),
        assignment_id: canvasIdInput().describe('The Canvas assignment ID to attach the rubric to'),
        use_for_grading: z
          .boolean()
          .optional()
          .describe('Whether the rubric drives the assignment grade'),
        hide_score_total: z
          .boolean()
          .optional()
          .describe('Whether to hide the rubric score total from students'),
        purpose: z
          .string()
          .optional()
          .describe('Association purpose, e.g. "grading" (the default) or "bookmark"'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const rubric_id = params.rubric_id as CanvasId
        const assignment_id = params.assignment_id as CanvasId
        const options: RubricAttachOptions = {
          use_for_grading: params.use_for_grading as boolean | undefined,
          hide_score_total: params.hide_score_total as boolean | undefined,
          purpose: params.purpose as string | undefined,
        }
        return canvas.rubrics.associate(course_id, rubric_id, assignment_id, options)
      },
    },
    {
      name: 'delete_rubric',
      title: 'Delete Rubric',
      description:
        'Permanently delete a rubric from a course, removing it from every assignment it is attached to. Returns the deleted rubric.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        rubric_id: canvasIdInput().describe('The Canvas rubric ID to delete'),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const rubric_id = params.rubric_id as CanvasId
        return canvas.rubrics.delete(course_id, rubric_id)
      },
    },
  ]
}
