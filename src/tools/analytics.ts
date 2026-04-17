import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'
import { SEARCH_CONTENT_TYPES } from '../canvas/analytics'
import type { SearchContentType } from '../canvas/analytics'
import type { CanvasCourseSearchResult } from '../canvas/types'

export function analyticsTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'search_course_content',
      description:
        'Search for content within a course. Searches pages, assignments, discussions, and announcements by keyword.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        search_term: z.string().describe('The keyword or phrase to search for'),
        content_types: z
          .array(z.enum(SEARCH_CONTENT_TYPES))
          .optional()
          .describe(
            'Content types to search. Defaults to all types: pages, discussions, assignments, announcements.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const searchTerm = params.search_term as string
        const types = (params.content_types as SearchContentType[] | undefined) ?? [
          ...SEARCH_CONTENT_TYPES,
        ]

        if (types.length === 0) return { results: [] }

        const settled = await Promise.allSettled(
          types.map((type) => canvas.analytics.searchContentType(courseId, searchTerm, type)),
        )

        const fulfilled = settled.filter(
          (r): r is PromiseFulfilledResult<CanvasCourseSearchResult[]> => r.status === 'fulfilled',
        )

        if (fulfilled.length === 0) {
          const firstRejected = settled.find(
            (r): r is PromiseRejectedResult => r.status === 'rejected',
          )
          throw firstRejected!.reason
        }

        const results = fulfilled.flatMap((r) => r.value)
        const warnings = settled
          .map((r, i) =>
            r.status === 'rejected'
              ? `${types[i]} failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`
              : null,
          )
          .filter((w): w is string => w !== null)

        return warnings.length > 0 ? { results, warnings } : { results }
      },
    },
    {
      name: 'get_course_analytics',
      description:
        'Get course-level activity analytics. Returns daily page view and participation counts.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.analytics.getCourseActivity(course_id)
      },
    },
    {
      name: 'get_student_analytics',
      description:
        'Get per-student activity analytics for a course. Returns page views, participations, and submission timeline for a specific student.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        student_id: z.number().describe('The Canvas user ID of the student'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const student_id = params.student_id as number
        return canvas.analytics.getStudentActivity(course_id, student_id)
      },
    },
    {
      name: 'get_course_activity_stream',
      description:
        'Get a summary of recent activity in a course. Returns counts of recent events grouped by type (submissions, discussions, announcements, etc.).',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.analytics.getCourseActivityStream(course_id)
      },
    },
  ]
}
