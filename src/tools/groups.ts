import type { CanvasClient } from '../canvas'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'
import { type CanvasId, canvasIdInput } from '../canvas/id'

export function groupTools(canvas: CanvasClient, pseudonymizer?: Pseudonymizer): ToolDefinition[] {
  return [
    {
      name: 'list_groups',
      title: 'List Groups',
      description: 'List all groups in a course.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        return canvas.groups.list(course_id)
      },
    },
    {
      name: 'list_group_members',
      title: 'List Group Members',
      description: 'List all members of a group.',
      inputSchema: {
        group_id: canvasIdInput().describe('The Canvas group ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const group_id = params.group_id as CanvasId
        const users = await canvas.groups.listMembers(group_id)
        if (!pseudonymizer?.isEnabled()) return users
        // No course context — use group_id as map key (group members share a pseudonym pool).
        return pseudonymizer.anonymizeUsers(`_group_${group_id}`, users)
      },
    },
  ]
}
