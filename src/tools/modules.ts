import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function moduleTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_modules',
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
      name: 'create_module',
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
      description:
        'Add an item (Assignment, Page, Quiz, File, Discussion, ExternalUrl, ExternalTool) to a module.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        module_id: z.number().describe('The Canvas module ID'),
        title: z.string().describe('Title of the module item'),
        type: z
          .enum(['File', 'Page', 'Discussion', 'Assignment', 'Quiz', 'ExternalUrl', 'ExternalTool'])
          .describe('Type of content to add'),
        content_id: z
          .number()
          .optional()
          .describe(
            'Canvas ID of the content (required for File, Page, Discussion, Assignment, Quiz)',
          ),
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
          external_url: params.external_url as string | undefined,
          position: params.position as number | undefined,
        })
      },
    },
  ]
}
