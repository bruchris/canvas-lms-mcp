import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function healthTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'health_check',
      description:
        'Check if the Canvas API is reachable and the token is valid. Returns ok/error status.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        try {
          await canvas.courses.list()
          return { status: 'ok', message: 'Canvas API is reachable' }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return { status: 'error', message }
        }
      },
    },
  ]
}
