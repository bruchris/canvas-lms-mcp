import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { CanvasGradebookHistorySubmissionVersion } from '../canvas/types'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'

// Pseudonymize the student `user_name` string on a gradebook history version.
// The embedded `user_id` lets us assign a stable pseudonym keyed by course.
// Grader name fields (current_grader, new_grader, previous_grader) are staff
// and pass through unchanged per the FERPA spec.
async function anonymizeHistoryVersion(
  courseId: number,
  version: CanvasGradebookHistorySubmissionVersion,
  pseudonymizer: Pseudonymizer,
): Promise<CanvasGradebookHistorySubmissionVersion> {
  if (!version.user_name || !version.user_id) return version
  // Construct a minimal CanvasUser so anonymizeUser can allocate a stable pseudonym.
  const minimalUser = {
    id: version.user_id,
    name: version.user_name,
    sortable_name: version.user_name,
    short_name: version.user_name,
  }
  const pseudo = await pseudonymizer.anonymizeUser(courseId, minimalUser as never)
  return { ...version, user_name: pseudo.name }
}

export function gradebookHistoryTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
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
        const submissions = await canvas.gradebookHistory.listSubmissions(
          course_id,
          date,
          grader_id,
          assignment_id,
        )
        if (!pseudonymizer?.isEnabled()) return submissions
        return Promise.all(
          submissions.map(async (s) => ({
            ...s,
            versions: s.versions
              ? await Promise.all(
                  s.versions.map((v) => anonymizeHistoryVersion(course_id, v, pseudonymizer)),
                )
              : s.versions,
          })),
        )
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
        const versions = await canvas.gradebookHistory.getFeed(course_id, {
          assignment_id,
          user_id,
          ascending,
        })
        if (!pseudonymizer?.isEnabled()) return versions
        return Promise.all(
          versions.map((v) => anonymizeHistoryVersion(course_id, v, pseudonymizer)),
        )
      },
    },
  ]
}
