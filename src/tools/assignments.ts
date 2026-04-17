import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function assignmentTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_assignments',
      description: 'List all assignments in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.assignments.list(course_id)
      },
    },
    {
      name: 'get_assignment',
      description: 'Get details for a single assignment by ID.',
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
        return canvas.assignments.get(course_id, assignment_id)
      },
    },
    {
      name: 'list_assignment_groups',
      description: 'List assignment groups (categories like Homework, Exams) in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.assignments.listGroups(course_id)
      },
    },
    {
      name: 'create_assignment',
      description: 'Create a new assignment in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        name: z.string().describe('Assignment name'),
        description: z.string().optional().describe('Assignment description (HTML supported)'),
        points_possible: z.number().optional().describe('Maximum points for this assignment'),
        due_at: z
          .string()
          .optional()
          .describe('Due date in ISO 8601 format (e.g. 2026-05-01T23:59:00Z)'),
        submission_types: z
          .array(z.string())
          .optional()
          .describe(
            'Allowed submission types (e.g. ["online_upload", "online_text_entry", "none"])',
          ),
        assignment_group_id: z
          .number()
          .optional()
          .describe('ID of the assignment group to place this assignment in'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const { course_id, ...rest } = params as {
          course_id: number
          name: string
          description?: string
          points_possible?: number
          due_at?: string
          submission_types?: string[]
          assignment_group_id?: number
        }
        return canvas.assignments.create(course_id, rest)
      },
    },
    {
      name: 'update_assignment',
      description: 'Update an existing assignment in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID'),
        name: z.string().optional().describe('New assignment name'),
        description: z.string().optional().describe('New assignment description (HTML supported)'),
        points_possible: z.number().optional().describe('New maximum points'),
        due_at: z
          .string()
          .optional()
          .describe('New due date in ISO 8601 format (e.g. 2026-05-01T23:59:00Z)'),
        submission_types: z
          .array(z.string())
          .optional()
          .describe('New allowed submission types'),
        assignment_group_id: z
          .number()
          .optional()
          .describe('New assignment group ID'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const { course_id, assignment_id, ...rest } = params as {
          course_id: number
          assignment_id: number
          name?: string
          description?: string
          points_possible?: number
          due_at?: string
          submission_types?: string[]
          assignment_group_id?: number
        }
        return canvas.assignments.update(course_id, assignment_id, rest)
      },
    },
    {
      name: 'delete_assignment',
      description: 'Delete an assignment from a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID to delete'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const assignment_id = params.assignment_id as number
        await canvas.assignments.delete(course_id, assignment_id)
        return { success: true }
      },
    },
  ]
}
