import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type {
  RubricAssociationInput,
  RubricCriterionInput,
  RubricCreateInput,
} from '../canvas/rubrics'
import type { ToolDefinition } from './types'

export function rubricTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_rubrics',
      description: 'List all rubrics in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.rubrics.list(course_id)
      },
    },
    {
      name: 'get_rubric',
      description: 'Get details for a single rubric by ID, including criteria.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        rubric_id: z.number().describe('The Canvas rubric ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const rubric_id = params.rubric_id as number
        return canvas.rubrics.get(course_id, rubric_id)
      },
    },
    {
      name: 'get_rubric_assessment',
      description: 'Get the rubric assessment for a specific student submission on an assignment.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID'),
        user_id: z.number().describe('The Canvas user ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const assignment_id = params.assignment_id as number
        const user_id = params.user_id as number
        return canvas.rubrics.getAssessment(course_id, assignment_id, user_id)
      },
    },
    {
      name: 'submit_rubric_assessment',
      description: 'Submit a rubric assessment with scores and comments for each criterion.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        association_id: z.number().describe('The rubric association ID'),
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
        const course_id = params.course_id as number
        const association_id = params.association_id as number
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
      description:
        'Create a new rubric in a course with criteria and rating levels. Optionally link it to an assignment immediately.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
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
            assignment_id: z.number().describe('Assignment ID to link this rubric to'),
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
        const course_id = params.course_id as number
        const rubric: RubricCreateInput = {
          title: params.title as string,
          criteria: params.criteria as RubricCriterionInput[],
        }
        const association = params.association as RubricAssociationInput | undefined
        return canvas.rubrics.create(course_id, rubric, association)
      },
    },
  ]
}
