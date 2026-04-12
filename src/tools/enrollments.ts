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
  ]
}
