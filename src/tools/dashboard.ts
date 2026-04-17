import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function dashboardTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'get_dashboard_cards',
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
      description: "Get the current user's upcoming calendar events and assignments.",
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
