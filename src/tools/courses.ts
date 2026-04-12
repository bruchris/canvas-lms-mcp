import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function courseTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_courses',
      description:
        'List courses for the authenticated user. Optionally filter by enrollment state.',
      inputSchema: {
        enrollment_state: z
          .enum(['active', 'completed', 'all'])
          .optional()
          .describe('Filter courses by enrollment state'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const enrollment_state = params.enrollment_state as string | undefined
        return canvas.courses.list({ enrollment_state })
      },
    },
    {
      name: 'get_course',
      description:
        'Get details for a single course by ID, including term and total student count.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.courses.get(course_id)
      },
    },
    {
      name: 'get_syllabus',
      description: 'Get the syllabus HTML body for a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const syllabus_body = await canvas.courses.getSyllabus(course_id)
        return { course_id, syllabus_body }
      },
    },
  ]
}
