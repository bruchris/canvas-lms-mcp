import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { UpdateModuleItemParams } from '../canvas/modules'
import type { ToolDefinition } from './types'

export function moduleTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_modules',
      title: 'List Modules',
      audience: 'shared',
      description: 'List all modules in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.modules.list(course_id)
      },
    },
    {
      name: 'get_module',
      title: 'Get Module',
      audience: 'shared',
      description: 'Get details for a single module by ID.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        module_id: z.number().describe('The Canvas module ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const module_id = params.module_id as number
        return canvas.modules.get(course_id, module_id)
      },
    },
    {
      name: 'list_module_items',
      title: 'List Module Items',
      audience: 'shared',
      description: 'List all items within a module.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        module_id: z.number().describe('The Canvas module ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const module_id = params.module_id as number
        return canvas.modules.listItems(course_id, module_id)
      },
    },
    {
      name: 'get_course_structure',
      title: 'Get Course Structure',
      audience: 'shared',
      description:
        'Return the full module → items tree for a course in a single call, with summary stats. Avoids N+1 round-trips when an agent needs to reason over the whole course shape.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        include_published_only: z
          .boolean()
          .optional()
          .describe('When true, exclude unpublished items from each module (default: false)'),
        include_content_details: z
          .boolean()
          .optional()
          .describe(
            'When true, fetch content_details for each item (adds extra Canvas API data; default: false)',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.modules.getCourseStructure(course_id, {
          includePublishedOnly: params.include_published_only as boolean | undefined,
          includeContentDetails: params.include_content_details as boolean | undefined,
        })
      },
    },
    {
      // See docs/superpowers/specs/2026-06-11-mcp-apps-spike-course-structure.md.
      // Payload is content metadata only — no student PII. If a future revision adds
      // include_progress, instructors[], or per-student fields, this tool MUST be added
      // to PSEUDONYMIZER_WRAPPED_TOOLS and wrapped at the handler.
      name: 'view_course_structure',
      title: 'View Course Structure',
      audience: 'shared',
      description:
        "Interactive tree view of a course's modules and items. Returns the same payload as `get_course_structure` and additionally links to an MCP Apps UI resource that renders an explorable tree with type filters and search. Hosts that do not support MCP Apps fall back to the JSON payload (same as `get_course_structure`).",
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        include_published_only: z
          .boolean()
          .optional()
          .describe('When true, exclude unpublished items (default: false)'),
        include_content_details: z
          .boolean()
          .optional()
          .describe('When true, fetch content_details for each item (default: false)'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      ui: {
        resourceUri: 'ui://canvas-lms-mcp/course-structure.html',
        csp: {
          connectDomains: [],
          resourceDomains: [],
          frameDomains: [],
        },
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.modules.getCourseStructure(course_id, {
          includePublishedOnly: params.include_published_only as boolean | undefined,
          includeContentDetails: params.include_content_details as boolean | undefined,
        })
      },
    },
    {
      name: 'create_module',
      title: 'Create Module',
      description: 'Create a new module in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        name: z.string().describe('Name of the module'),
        position: z.number().optional().describe('Position of the module in the list'),
        unlock_at: z.string().optional().describe('Date/time the module unlocks (ISO 8601)'),
        prerequisite_module_ids: z
          .array(z.number())
          .optional()
          .describe('IDs of modules that must be completed before this one'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.modules.create(course_id, {
          name: params.name as string,
          position: params.position as number | undefined,
          unlock_at: params.unlock_at as string | undefined,
          prerequisite_module_ids: params.prerequisite_module_ids as number[] | undefined,
        })
      },
    },
    {
      name: 'update_module',
      title: 'Update Module',
      description: 'Update an existing module (rename, reposition, publish/unpublish).',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        module_id: z.number().describe('The Canvas module ID'),
        name: z.string().optional().describe('New name for the module'),
        position: z.number().optional().describe('New position in the module list'),
        published: z.boolean().optional().describe('Whether the module is published'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const module_id = params.module_id as number
        return canvas.modules.update(course_id, module_id, {
          name: params.name as string | undefined,
          position: params.position as number | undefined,
          published: params.published as boolean | undefined,
        })
      },
    },
    {
      name: 'create_module_item',
      title: 'Create Module Item',
      description:
        'Add an item (Assignment, Page, Quiz, File, Discussion, ExternalUrl, ExternalTool, SubHeader) to a module.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        module_id: z.number().describe('The Canvas module ID'),
        title: z.string().describe('Title of the module item'),
        type: z
          .enum([
            'File',
            'Page',
            'Discussion',
            'Assignment',
            'Quiz',
            'ExternalUrl',
            'ExternalTool',
            'SubHeader',
          ])
          .describe('Type of content to add'),
        content_id: z
          .number()
          .optional()
          .describe('Canvas ID of the content (required for File, Discussion, Assignment, Quiz)'),
        page_url: z
          .string()
          .optional()
          .describe('Page URL slug (required for Page items, which are addressed by slug, not ID)'),
        external_url: z.string().optional().describe('URL for ExternalUrl or ExternalTool items'),
        position: z.number().optional().describe('Position within the module'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const module_id = params.module_id as number
        return canvas.modules.createItem(course_id, module_id, {
          title: params.title as string,
          type: params.type as string,
          content_id: params.content_id as number | undefined,
          page_url: params.page_url as string | undefined,
          external_url: params.external_url as string | undefined,
          position: params.position as number | undefined,
        })
      },
    },
    {
      name: 'update_module_item',
      title: 'Update Module Item',
      description:
        'Edit an existing module item in place: rename it, repoint an ExternalUrl/ExternalTool item, reposition or re-indent it, publish/unpublish it, or move it to another module. ExternalUrl items exist only as module items, so a stale link carried in by a course copy can only be fixed here.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        module_id: z.number().describe('The Canvas module ID the item currently belongs to'),
        item_id: z.number().describe('The Canvas module item ID'),
        title: z.string().optional().describe('New title for the module item'),
        external_url: z
          .string()
          .optional()
          .describe('New URL for an ExternalUrl or ExternalTool item'),
        position: z.number().optional().describe('New 1-based position within the module'),
        indent: z.number().optional().describe('New indent level (0 = flush left)'),
        new_tab: z.boolean().optional().describe('Whether an external item opens in a new tab'),
        published: z.boolean().optional().describe('Whether the item is published'),
        target_module_id: z
          .number()
          .optional()
          .describe('Move the item to this module ID (omit to leave it where it is)'),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const { course_id, module_id, item_id, target_module_id, ...rest } = params as {
          course_id: number
          module_id: number
          item_id: number
          target_module_id?: number
        } & Omit<UpdateModuleItemParams, 'module_id'>
        const patch: UpdateModuleItemParams = { ...rest }
        if (target_module_id !== undefined) patch.module_id = target_module_id
        return canvas.modules.updateItem(course_id, module_id, item_id, patch)
      },
    },
    {
      name: 'delete_module_item',
      title: 'Delete Module Item',
      description:
        'Remove an item from a module. For ExternalUrl, ExternalTool and SubHeader items the item is the content, so this deletes it outright; for Assignment, Page, Quiz, File and Discussion items it only unlinks the item and the underlying content survives. Re-add with create_module_item.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        module_id: z.number().describe('The Canvas module ID'),
        item_id: z.number().describe('The Canvas module item ID to remove'),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const module_id = params.module_id as number
        const item_id = params.item_id as number
        return canvas.modules.deleteItem(course_id, module_id, item_id)
      },
    },
  ]
}
