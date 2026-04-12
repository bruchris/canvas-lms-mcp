import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function fileTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_files',
      description: 'List all files in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.files.list(course_id)
      },
    },
    {
      name: 'list_folders',
      description: 'List all folders in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.files.listFolders(course_id)
      },
    },
    {
      name: 'get_file',
      description: 'Get metadata for a single file by ID, including download URL.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        file_id: z.number().describe('The Canvas file ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const file_id = params.file_id as number
        return canvas.files.get(course_id, file_id)
      },
    },
  ]
}
