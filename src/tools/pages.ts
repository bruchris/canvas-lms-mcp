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
    {
      name: 'create_page',
      description: 'Create a new wiki page in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        title: z.string().describe('Title of the page'),
        body: z.string().optional().describe('HTML body content of the page'),
        published: z.boolean().optional().describe('Whether the page is published'),
        editing_roles: z
          .string()
          .optional()
          .describe('Who can edit: "teachers", "students", "members", or "public"'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.pages.create(course_id, {
          title: params.title as string,
          body: params.body as string | undefined,
          published: params.published as boolean | undefined,
          editing_roles: params.editing_roles as string | undefined,
        })
      },
    },
    {
      name: 'update_page',
      description: 'Update an existing wiki page.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        page_url: z.string().describe('The page URL slug'),
        title: z.string().optional().describe('New title for the page'),
        body: z.string().optional().describe('New HTML body content'),
        published: z.boolean().optional().describe('Whether the page is published'),
        editing_roles: z
          .string()
          .optional()
          .describe('Who can edit: "teachers", "students", "members", or "public"'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const page_url = params.page_url as string
        return canvas.pages.update(course_id, page_url, {
          title: params.title as string | undefined,
          body: params.body as string | undefined,
          published: params.published as boolean | undefined,
          editing_roles: params.editing_roles as string | undefined,
        })
      },
    },
    {
      name: 'delete_page',
      description: 'Delete a wiki page from a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        page_url: z.string().describe('The page URL slug to delete'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const page_url = params.page_url as string
        await canvas.pages.delete(course_id, page_url)
        return { deleted: true, page_url }
      },
    },
  ]
}
