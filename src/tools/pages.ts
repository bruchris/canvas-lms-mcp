import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function pageTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_pages',
      description: 'List all wiki pages in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.pages.list(course_id)
      },
    },
    {
      name: 'get_page',
      description: 'Get a single wiki page by its URL slug.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        page_url: z.string().describe('The page URL slug (e.g. "welcome-page")'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const page_url = params.page_url as string
        return canvas.pages.get(course_id, page_url)
      },
    },
  ]
}
