import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'
import { type CanvasId, canvasIdInput } from '../canvas/id'

export function peerReviewTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_peer_reviews',
      title: 'List Peer Reviews',
      description:
        'List every peer review assigned on an assignment, across every submission, returning ' +
        "each review's id, assessor_id (the reviewer), user_id (the reviewee whose submission is " +
        "being reviewed), asset_id, and workflow_state ('assigned' or 'completed'). Fetches every " +
        "page (100 per request) and fails with a 'Results are incomplete' error instead of " +
        'silently truncating. Pass submission_id to scope the results to the reviews assigned ' +
        'to that one submission instead of the whole assignment — the same result ' +
        'get_submission_peer_reviews returns, kept here as a shortcut. Omit it to see every ' +
        'review across the assignment. Use create_peer_review to assign a new reviewer, and ' +
        'delete_peer_review to remove one.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        assignment_id: canvasIdInput().describe('The Canvas assignment ID'),
        submission_id: canvasIdInput()
          .optional()
          .describe(
            'Optional Canvas submission ID. When provided, scopes results to the peer reviews ' +
              'assigned to this submission instead of every peer review on the assignment.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const assignment_id = params.assignment_id as CanvasId
        const submission_id = params.submission_id as CanvasId | undefined
        if (submission_id !== undefined) {
          return canvas.peerReviews.listForSubmission(course_id, assignment_id, submission_id)
        }
        return canvas.peerReviews.listForAssignment(course_id, assignment_id)
      },
    },
    {
      name: 'get_submission_peer_reviews',
      title: 'Get Submission Peer Reviews',
      description:
        'List the peer reviews assigned to one submission within an assignment — a single ' +
        "submission can have more than one assigned reviewer — returning each review's id, " +
        'assessor_id (the reviewer), user_id (the reviewee), asset_id, and workflow_state ' +
        "('assigned' or 'completed'). Fetches every page (100 per request) and fails with a " +
        "'Results are incomplete' error instead of silently truncating. Use list_peer_reviews " +
        'instead to see every review assigned across the whole assignment rather than one ' +
        'submission, create_peer_review to assign another reviewer to this submission, and ' +
        'delete_peer_review to remove one.',
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
      description:
        'Remove a peer-review assignment — identified by its assessor_id/user_id pairing — from ' +
        'one submission, unassigning that reviewer; the submission and the assignment itself are ' +
        'untouched, only the peer-review relationship goes away. Returns a confirmation message; ' +
        "Canvas's own response body is discarded. This is a reversible relationship removal, not " +
        'an irreversible content delete: re-create the assignment with create_peer_review, though ' +
        'the new review gets a new id and workflow_state starts over at "assigned". Find the ' +
        "reviewer's user_id to remove with list_peer_reviews or get_submission_peer_reviews. " +
        'Requires instructor/TA permission in the course.',
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
