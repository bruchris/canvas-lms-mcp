import { z } from 'zod'
import type { CanvasClient } from '../canvas'
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
  ]
}
