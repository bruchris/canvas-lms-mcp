import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import { listOutput, objectOutput } from './output/contract'
import { canvasPageSchema, pageDeletionSchema } from './output/entities'
import type { ToolDefinition } from './types'
import { type CanvasId, canvasIdInput } from '../canvas/id'

export function pageTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_pages',
      title: 'List Pages',
      audience: 'shared',
      description:
        'List every wiki page in a course, returning page stubs — title, url slug, published ' +
        'state and editing_roles — without the HTML body; the paginated list endpoint omits ' +
        "body entirely. Use get_page to fetch one page's full body by its url slug, or " +
        'search_course_content to search page content across the whole course. Fetches every ' +
        "page (100 per request) and fails with a 'Results are incomplete' error instead of " +
        'silently truncating.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
      },
      output: listOutput('pages', canvasPageSchema),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        return canvas.pages.list(course_id)
      },
    },
    {
      name: 'get_page',
      title: 'Get Page',
      audience: 'shared',
      description:
        'Get one wiki page by its page_url slug — not a numeric ID — obtained from list_pages. ' +
        "Returns the page's title, published state, editing_roles and full HTML body, unlike " +
        "the list endpoint's body-less stubs. Use list_pages to discover a course's pages and " +
        "find a page_url, and update_page to edit this page's title, body, published state or " +
        'editing_roles afterward.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        page_url: z.string().describe('The page URL slug (e.g. "welcome-page")'),
      },
      output: objectOutput(canvasPageSchema),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const page_url = params.page_url as string
        return canvas.pages.get(course_id, page_url)
      },
    },
    {
      name: 'create_page',
      title: 'Create Page',
      description:
        'Create a new wiki page in a course with a title and optional HTML body, published ' +
        'state and editing_roles, and return the created page — including its url slug, used ' +
        'as page_url by get_page, update_page and delete_page. Not idempotent: each call ' +
        'creates another page; Canvas does not deduplicate by title, so check list_pages first ' +
        'to avoid creating a duplicate. Use update_page to edit an existing page instead of ' +
        "creating a new one, and create_module_item's page_url parameter (with type Page) to " +
        'place this page inside a module. Requires permission to manage wiki content in the ' +
        'course.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        title: z.string().describe('Title of the page'),
        body: z.string().optional().describe('HTML body content of the page'),
        published: z.boolean().optional().describe('Whether the page is published'),
        editing_roles: z
          .string()
          .optional()
          .describe('Who can edit: "teachers", "students", "members", or "public"'),
      },
      output: objectOutput(canvasPageSchema),
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
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
      title: 'Update Page',
      description:
        "Update an existing wiki page's title, body, published state or editing_roles. Only " +
        'the fields you pass are sent to Canvas; omitted fields are left unchanged. body is ' +
        'not merged — it replaces the entire HTML body, so read the current content with ' +
        'get_page first and send back the full edited body, not just the changed part. ' +
        'Returns the updated page. Idempotent: calling it again with the same fields produces ' +
        'the same resulting page. Use create_page to make a new page instead, delete_page to ' +
        "remove this one, and update_course's syllabus_body parameter to edit the course " +
        'syllabus, which is not a wiki page editable here. Requires permission to manage wiki ' +
        'content in the course.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        page_url: z.string().describe('The page URL slug'),
        title: z.string().optional().describe('New title for the page'),
        body: z.string().optional().describe('New HTML body content'),
        published: z.boolean().optional().describe('Whether the page is published'),
        editing_roles: z
          .string()
          .optional()
          .describe('Who can edit: "teachers", "students", "members", or "public"'),
      },
      output: objectOutput(canvasPageSchema),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
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
      title: 'Delete Page',
      description: 'Delete a wiki page from a course. This action is permanent.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        page_url: z.string().describe('The page URL slug to delete'),
      },
      output: objectOutput(pageDeletionSchema),
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const page_url = params.page_url as string
        await canvas.pages.delete(course_id, page_url)
        return { deleted: true, page_url }
      },
    },
  ]
}
