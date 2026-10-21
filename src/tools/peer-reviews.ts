import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'
import { type CanvasId, canvasIdInput } from '../canvas/id'

export function peerReviewTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_peer_reviews',
      title: 'List Peer Reviews',
      description: 'List all peer reviews for an assignment in a course.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        assignment_id: canvasIdInput().describe('The Canvas assignment ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const assignment_id = params.assignment_id as CanvasId
        return canvas.peerReviews.listForAssignment(course_id, assignment_id)
      },
    },
    {
      name: 'get_submission_peer_reviews',
      title: 'Get Submission Peer Reviews',
      description: 'List peer reviews assigned to a specific submission.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        assignment_id: canvasIdInput().describe('The Canvas assignment ID'),
        submission_id: canvasIdInput().describe('The Canvas submission ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const assignment_id = params.assignment_id as CanvasId
        const submission_id = params.submission_id as CanvasId
        return canvas.peerReviews.listForSubmission(course_id, assignment_id, submission_id)
      },
    },
    {
      name: 'create_peer_review',
      title: 'Create Peer Review',
      audience: 'educator',
      description:
        'Assign a Canvas user as a peer reviewer for one submission, and return the created peer ' +
        'review object (id, assessor_id, user_id, asset_id, workflow_state). The user_id parameter ' +
        'you pass is the reviewer being assigned; in the returned object assessor_id holds that same ' +
        "reviewer, while the response's own user_id field instead identifies the submission owner " +
        '(the reviewee) — the two user_id values are not the same person. The new review starts in ' +
        'workflow_state "assigned". submission_id must already exist on this assignment. Use ' +
        'list_peer_reviews to see every review assigned on the whole assignment, or ' +
        'get_submission_peer_reviews to see only the reviews assigned to one submission, before ' +
        'assigning another reviewer; use delete_peer_review to unassign one. Requires instructor/TA ' +
        'permission in the course.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        assignment_id: canvasIdInput().describe('The Canvas assignment ID'),
        submission_id: canvasIdInput().describe('The Canvas submission ID'),
        user_id: canvasIdInput().describe('The Canvas user ID of the reviewer to assign'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const assignment_id = params.assignment_id as CanvasId
        const submission_id = params.submission_id as CanvasId
        const user_id = params.user_id as CanvasId
        return canvas.peerReviews.create(course_id, assignment_id, submission_id, user_id)
      },
    },
    {
      name: 'delete_peer_review',
      title: 'Delete Peer Review',
      audience: 'educator',
      description: 'Remove a peer review assignment from a submission. This action is permanent.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        assignment_id: canvasIdInput().describe('The Canvas assignment ID'),
        submission_id: canvasIdInput().describe('The Canvas submission ID'),
        user_id: canvasIdInput().describe('The Canvas user ID of the reviewer to remove'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const assignment_id = params.assignment_id as CanvasId
        const submission_id = params.submission_id as CanvasId
        const user_id = params.user_id as CanvasId
        await canvas.peerReviews.delete(course_id, assignment_id, submission_id, user_id)
      },
    },
  ]
}
