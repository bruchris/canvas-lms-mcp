import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function peerReviewTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_peer_reviews',
      description: 'List all peer reviews for an assignment in a course.',
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
        return canvas.peerReviews.listForAssignment(course_id, assignment_id)
      },
    },
    {
      name: 'get_submission_peer_reviews',
      description: 'List peer reviews assigned to a specific submission.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID'),
        submission_id: z.number().describe('The Canvas submission ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const assignment_id = params.assignment_id as number
        const submission_id = params.submission_id as number
        return canvas.peerReviews.listForSubmission(course_id, assignment_id, submission_id)
      },
    },
    {
      name: 'create_peer_review',
      description: 'Assign a user to peer-review a submission.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID'),
        submission_id: z.number().describe('The Canvas submission ID'),
        user_id: z.number().describe('The Canvas user ID of the reviewer to assign'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const assignment_id = params.assignment_id as number
        const submission_id = params.submission_id as number
        const user_id = params.user_id as number
        return canvas.peerReviews.create(course_id, assignment_id, submission_id, user_id)
      },
    },
    {
      name: 'delete_peer_review',
      description: 'Remove a peer review assignment from a submission.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID'),
        submission_id: z.number().describe('The Canvas submission ID'),
        user_id: z.number().describe('The Canvas user ID of the reviewer to remove'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const assignment_id = params.assignment_id as number
        const submission_id = params.submission_id as number
        const user_id = params.user_id as number
        await canvas.peerReviews.delete(course_id, assignment_id, submission_id, user_id)
      },
    },
  ]
}
