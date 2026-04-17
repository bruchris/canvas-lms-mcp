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
      description: 'Get details for a single course by ID, including term and total student count.',
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
    {
      name: 'create_course',
      description: 'Create a new course in a Canvas account. Returns the created course object.',
      inputSchema: {
        account_id: z
          .number()
          .int()
          .positive()
          .describe('The Canvas account ID to create the course in'),
        name: z.string().describe('The name of the course'),
        course_code: z.string().optional().describe('The course code (e.g. CS101)'),
        start_at: z
          .string()
          .datetime()
          .optional()
          .describe('Course start date in ISO 8601 format (e.g. 2026-01-15T00:00:00Z)'),
        end_at: z
          .string()
          .datetime()
          .optional()
          .describe('Course end date in ISO 8601 format (e.g. 2026-05-15T00:00:00Z)'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const { account_id, ...courseFields } = params as {
          account_id: number
          name: string
          course_code?: string
          start_at?: string
          end_at?: string
        }
        return canvas.courses.create({ account_id, ...courseFields })
      },
    },
    {
      name: 'update_course',
      description:
        'Update an existing course. Only provided fields are changed; omitted fields are left as-is.',
      inputSchema: {
        course_id: z.number().int().positive().describe('The Canvas course ID to update'),
        name: z.string().optional().describe('New course name'),
        course_code: z.string().optional().describe('New course code'),
        start_at: z
          .string()
          .datetime()
          .optional()
          .describe('New start date in ISO 8601 format (e.g. 2026-01-15T00:00:00Z)'),
        end_at: z
          .string()
          .datetime()
          .optional()
          .describe('New end date in ISO 8601 format (e.g. 2026-05-15T00:00:00Z)'),
        default_view: z
          .enum(['feed', 'wiki', 'modules', 'assignments', 'syllabus'])
          .optional()
          .describe('Default course home page view'),
        syllabus_body: z.string().optional().describe('HTML body for the course syllabus'),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const { course_id, ...fields } = params as {
          course_id: number
          name?: string
          course_code?: string
          start_at?: string
          end_at?: string
          default_view?: 'feed' | 'wiki' | 'modules' | 'assignments' | 'syllabus'
          syllabus_body?: string
        }
        return canvas.courses.update(course_id, fields)
      },
    },
  ]
}
