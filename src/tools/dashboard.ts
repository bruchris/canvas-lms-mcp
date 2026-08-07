import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function dashboardTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'get_dashboard_cards',
      title: 'Get Dashboard Cards',
      audience: 'shared',
      description: "Get the current user's dashboard course cards with position, color, and image.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        return canvas.dashboard.getDashboardCards()
      },
    },
    {
      name: 'get_todo_items',
      title: 'Get To-Do Items',
      audience: 'shared',
      description:
        "Get the current user's to-do items, including upcoming assignments and grading tasks.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        return canvas.dashboard.getTodoItems()
      },
    },
    {
      name: 'get_upcoming_events',
      title: 'Get Upcoming Events',
      audience: 'shared',
      description:
        "Get the current user's upcoming calendar events and assignments. Canvas caps this " +
        'endpoint at roughly the next 1 week and at most 20 events server-side — neither limit ' +
        'is adjustable, and results silently stop there even if more events fall later. For a ' +
        'longer or specific date range, use `list_calendar_events` with explicit `start_date`/' +
        '`end_date` instead.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        return canvas.dashboard.getUpcomingEvents()
      },
    },
    {
      name: 'get_missing_submissions',
      title: 'Get Missing Submissions',
      description: 'Get assignments with missing submissions for the current user.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        return canvas.dashboard.getMissingSubmissions()
      },
    },
  ]
}
