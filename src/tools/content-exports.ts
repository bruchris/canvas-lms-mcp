import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ContentExportType } from '../canvas/types'
import type { ToolDefinition } from './types'

export function contentExportsTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'create_content_export',
      description:
        'Start a Canvas course content export (Common Cartridge / QTI / zip). Exports are asynchronous — this tool returns immediately with an export ID and initial workflow_state ("created"). Call get_content_export to poll progress and retrieve the time-limited download link when the export finishes.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        export_type: z
          .enum(['common_cartridge', 'qti', 'zip'])
          .describe(
            'Export format: common_cartridge (IMS CC, widely portable for migration/backup), qti (assessments only), zip (Canvas-native files archive)',
          ),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.contentExports.create(
          params.course_id as number,
          params.export_type as ContentExportType,
        ),
    },
    {
      name: 'get_content_export',
      description:
        'Get the status of a content export. When workflow_state is "exported", attachment.url contains a time-limited download link — download it promptly, as the URL expires (re-fetch to get a fresh one). Returns attachment: null while still "created"/"exporting" or on "failed".',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        export_id: z.number().describe('The export ID returned by create_content_export'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.contentExports.get(params.course_id as number, params.export_id as number),
    },
    {
      name: 'list_content_exports',
      description: 'List all content exports for a course (most recent first).',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) => canvas.contentExports.list(params.course_id as number),
    },
  ]
}
