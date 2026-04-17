import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function studentTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'get_my_courses',
      description: 'List active courses for the authenticated student.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        return canvas.courses.list({ enrollment_state: 'active' })
      },
    },
    {
      name: 'get_my_grades',
      description:
        'Get grade data for the authenticated student. If course_id is omitted, returns grades across all enrolled courses.',
      inputSchema: {
        course_id: z.number().optional().describe('The Canvas course ID (omit for all courses)'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number | undefined
        return canvas.enrollments.listMyGrades(course_id)
      },
    },
    {
      name: 'get_my_submissions',
      description: 'List all submissions for the authenticated student in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.submissions.listMy(course_id)
      },
    },
    {
      name: 'get_my_upcoming_assignments',
      description: 'List upcoming assignment events for the authenticated student.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        return canvas.users.getUpcomingAssignments()
      },
    },
    {
      name: 'get_my_peer_reviews',
      description:
        'List peer reviews assigned to the authenticated student for a given assignment.',
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
  ]
}
