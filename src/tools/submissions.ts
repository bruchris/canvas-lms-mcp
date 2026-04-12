import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function submissionTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_submissions',
      description: 'List all submissions for an assignment in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const assignment_id = params.assignment_id as number
        return canvas.submissions.list(course_id, assignment_id)
      },
    },
    {
      name: 'get_submission',
      description:
        'Get a single submission for a specific user on an assignment, including comments.',
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
        return canvas.submissions.get(course_id, assignment_id, user_id)
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
