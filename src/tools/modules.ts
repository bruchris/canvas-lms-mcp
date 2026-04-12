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
  ]
}
