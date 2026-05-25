import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'

export function groupTools(canvas: CanvasClient, pseudonymizer?: Pseudonymizer): ToolDefinition[] {
  return [
    {
      name: 'list_groups',
      description: 'List all groups in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.groups.list(course_id)
      },
    },
    {
      name: 'list_group_members',
      description: 'List all members of a group.',
      inputSchema: {
        group_id: z.number().describe('The Canvas group ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const group_id = params.group_id as number
        const users = await canvas.groups.listMembers(group_id)
        if (!pseudonymizer?.isEnabled()) return users
        // No course context — use group_id as map key (group members share a pseudonym pool).
        return pseudonymizer.anonymizeUsers(`_group_${group_id}`, users)
      },
    },
  ]
}
