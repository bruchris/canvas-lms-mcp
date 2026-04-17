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
    {
      name: 'search_users',
      description: 'Search for users in a Canvas account by name, login, or email.',
      inputSchema: {
        account_id: z.number().describe('The Canvas account ID'),
        search_term: z.string().describe('The search term (name, login, or email)'),
        sort: z
          .enum(['username', 'email', 'sis_id', 'last_login'])
          .optional()
          .describe('Sort field'),
        order: z.enum(['asc', 'desc']).optional().describe('Sort order'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        return canvas.users.searchUsers(
          params.account_id as number,
          params.search_term as string,
          params.sort as string | undefined,
          params.order as string | undefined,
        )
      },
    },
    {
      name: 'list_course_users',
      description: 'List all users in a course, optionally filtered by enrollment type.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        enrollment_type: z
          .enum(['student', 'teacher', 'ta', 'observer', 'designer'])
          .optional()
          .describe('Filter by enrollment type'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        return canvas.users.listCourseUsers(
          params.course_id as number,
          params.enrollment_type as string | undefined,
        )
      },
    },
  ]
}
