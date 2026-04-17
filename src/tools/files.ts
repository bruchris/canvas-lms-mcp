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
    {
      name: 'upload_file',
      description:
        'Upload a file to a course. Content must be base64-encoded. Canvas performs a multi-step upload internally.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        name: z.string().describe('File name including extension'),
        content: z.string().describe('Base64-encoded file content'),
        content_type: z.string().describe('MIME type, e.g. "application/pdf" or "image/png"'),
        parent_folder_path: z
          .string()
          .optional()
          .describe('Destination folder path within the course, e.g. "subfolder/nested"'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const name = params.name as string
        const content = params.content as string
        const content_type = params.content_type as string
        const parent_folder_path = params.parent_folder_path as string | undefined
        return canvas.files.upload(course_id, name, content, content_type, parent_folder_path)
      },
    },
    {
      name: 'delete_file',
      description: 'Delete a file by ID. This action is permanent.',
      inputSchema: {
        file_id: z.number().describe('The Canvas file ID'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const file_id = params.file_id as number
        await canvas.files.delete(file_id)
        return { deleted: true, file_id }
      },
    },
  ]
}
