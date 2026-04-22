import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function gradebookHistoryTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_gradebook_history_days',
      description:
        'List the dates in a course gradebook history that contain grading activity, grouped by grader and assignment.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.gradebookHistory.listDays(course_id)
      },
    },
    {
      name: 'get_gradebook_history_day',
      description:
        'Get the graders and assignment IDs that had gradebook activity on a specific course date.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        date: z.string().describe('The gradebook history date to inspect, in YYYY-MM-DD format'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const date = params.date as string
        return canvas.gradebookHistory.getDay(course_id, date)
      },
    },
    {
      name: 'list_gradebook_history_submissions',
      description:
        'List versioned submission history for one grader and assignment on a specific gradebook history date.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        date: z.string().describe('The gradebook history date to inspect, in YYYY-MM-DD format'),
        grader_id: z.number().describe('The Canvas user ID of the grader'),
        assignment_id: z.number().describe('The Canvas assignment ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const date = params.date as string
        const grader_id = params.grader_id as number
        const assignment_id = params.assignment_id as number
        return canvas.gradebookHistory.listSubmissions(course_id, date, grader_id, assignment_id)
      },
    },
    {
      name: 'get_gradebook_history_feed',
      description:
        'Get the paginated gradebook history feed for a course, optionally filtered by assignment or user and optionally sorted oldest-first.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z
          .number()
          .optional()
          .describe('Optional Canvas assignment ID to filter the feed'),
        user_id: z.number().optional().describe('Optional Canvas user ID to filter the feed'),
        ascending: z
          .boolean()
          .optional()
          .describe('Set true to return the oldest gradebook history entries first'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const assignment_id = params.assignment_id as number | undefined
        const user_id = params.user_id as number | undefined
        const ascending = params.ascending as boolean | undefined
        return canvas.gradebookHistory.getFeed(course_id, { assignment_id, user_id, ascending })
      },
    },
  ]
}
