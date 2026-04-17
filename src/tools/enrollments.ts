import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function enrollmentTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_enrollments',
      description: 'List all enrollments for the authenticated user across courses.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        return canvas.enrollments.list()
      },
    },
    {
      name: 'enroll_user',
      description: 'Enroll a user in a course with a specified role.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        user_id: z.number().describe('The Canvas user ID to enroll'),
        type: z
          .enum([
            'StudentEnrollment',
            'TeacherEnrollment',
            'TaEnrollment',
            'ObserverEnrollment',
            'DesignerEnrollment',
          ])
          .describe('The enrollment type'),
        enrollment_state: z
          .enum(['active', 'invited', 'inactive'])
          .optional()
          .describe('Initial enrollment state (defaults to invited)'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        return canvas.enrollments.enroll(
          params.course_id as number,
          params.user_id as number,
          params.type as string,
          params.enrollment_state as string | undefined,
        )
      },
    },
    {
      name: 'remove_enrollment',
      description: 'Remove or conclude an enrollment from a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        enrollment_id: z.number().describe('The enrollment ID to remove'),
        task: z
          .enum(['conclude', 'delete', 'deactivate'])
          .describe('The action to perform on the enrollment'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        return canvas.enrollments.remove(
          params.course_id as number,
          params.enrollment_id as number,
          params.task as string,
        )
      },
    },
  ]
}
