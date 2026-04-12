import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function userTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_students',
      description: 'List all students enrolled in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.users.listStudents(course_id)
      },
    },
    {
      name: 'get_user',
      description: 'Get details for a single user by ID.',
      inputSchema: {
        user_id: z.number().describe('The Canvas user ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const user_id = params.user_id as number
        return canvas.users.get(user_id)
      },
    },
    {
      name: 'get_profile',
      description: 'Get the profile of the currently authenticated user.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        return canvas.users.getProfile()
      },
    },
  ]
}
