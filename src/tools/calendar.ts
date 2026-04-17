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
    {
      name: 'create_calendar_event',
      description: 'Create a new calendar event in Canvas.',
      inputSchema: {
        context_code: z
          .string()
          .describe('Canvas context code, e.g. "course_123" for a course event'),
        title: z.string().describe('Event title'),
        start_at: z.string().describe('Start time in ISO 8601 format, e.g. "2026-05-01T10:00:00Z"'),
        end_at: z
          .string()
          .optional()
          .describe('End time in ISO 8601 format. Omit for all-day events.'),
        description: z.string().optional().describe('Event description (HTML allowed)'),
        location_name: z.string().optional().describe('Location name'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        return canvas.calendar.createEvent({
          context_code: params.context_code as string,
          title: params.title as string,
          start_at: params.start_at as string,
          end_at: params.end_at as string | undefined,
          description: params.description as string | undefined,
          location_name: params.location_name as string | undefined,
        })
      },
    },
    {
      name: 'update_calendar_event',
      description: 'Update an existing calendar event. Only provided fields are changed.',
      inputSchema: {
        event_id: z.number().describe('The Canvas calendar event ID'),
        title: z.string().optional().describe('New event title'),
        start_at: z.string().optional().describe('New start time in ISO 8601 format'),
        end_at: z.string().optional().describe('New end time in ISO 8601 format'),
        description: z.string().optional().describe('New description (HTML allowed)'),
        location_name: z.string().optional().describe('New location name'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const event_id = params.event_id as number
        return canvas.calendar.updateEvent(event_id, {
          title: params.title as string | undefined,
          start_at: params.start_at as string | undefined,
          end_at: params.end_at as string | undefined,
          description: params.description as string | undefined,
          location_name: params.location_name as string | undefined,
        })
      },
    },
  ]
}
