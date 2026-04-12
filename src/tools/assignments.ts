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
  ]
}
