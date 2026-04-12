import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function calendarTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_calendar_events',
      description: 'List calendar events for a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.calendar.list(course_id)
      },
    },
  ]
}
