import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function contentMigrationsTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_content_migrations',
      description: 'List all content migrations for a course (most recent first).',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) => canvas.contentMigrations.list(params.course_id as number),
    },
    {
      name: 'get_content_migration',
      description:
        'Get the status of a single content migration. When workflow_state is "running", poll progress_url for live updates. When "completed", the migration is done.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        migration_id: z.number().describe('The content migration ID'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.contentMigrations.get(params.course_id as number, params.migration_id as number),
    },
    {
      name: 'list_content_migration_types',
      description:
        'List available migration types (migrators) for a course. Returns migrator type keys such as course_copy_importer, common_cartridge_importer, zip_file_importer, qti_converter, moodle_converter.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) => canvas.contentMigrations.listMigrators(params.course_id as number),
    },
    {
      name: 'get_migration_selective_data',
      description:
        'Get the selective import tree for a migration — the list of content items available to selectively import. Only meaningful for migrations in the "waiting_for_select" state.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        migration_id: z.number().describe('The content migration ID'),
        type: z
          .string()
          .optional()
          .describe(
            'Filter to a specific content type (e.g. "course_settings", "syllabus_body", "context_modules", "assignments")',
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.contentMigrations.getSelectiveData(
          params.course_id as number,
          params.migration_id as number,
          params.type as string | undefined,
        ),
    },
    {
      name: 'get_migration_asset_id_mapping',
      description:
        'Get the old-to-new asset ID mapping for a completed migration. Useful for resolving references to content that existed in the source course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        migration_id: z.number().describe('The content migration ID'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.contentMigrations.getAssetIdMapping(
          params.course_id as number,
          params.migration_id as number,
        ),
    },
    {
      name: 'list_migration_issues',
      description:
        'List issues encountered during a content migration. Each issue has a type (todo, warning, or error) and a description.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        migration_id: z.number().describe('The content migration ID'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.contentMigrations.listMigrationIssues(
          params.course_id as number,
          params.migration_id as number,
        ),
    },
    {
      name: 'create_content_migration',
      description:
        'Start a content migration (course copy, Common Cartridge import, zip import, QTI conversion, or Moodle conversion). Migrations are asynchronous — this tool returns immediately with a migration ID and progress_url. Poll get_content_migration or progress_url to track completion.',
      inputSchema: {
        course_id: z.number().describe('The destination Canvas course ID'),
        migration_type: z
          .enum([
            'course_copy_importer',
            'common_cartridge_importer',
            'zip_file_importer',
            'qti_converter',
            'moodle_converter',
          ])
          .describe('The type of migration to run'),
        settings: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'Migration-type-specific settings. For course_copy_importer, pass { source_course_id: <id> }.',
          ),
        date_shift_options: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'Options for shifting dates during the migration (e.g. { shift_dates: true, old_start_date: "...", new_start_date: "..." }).',
          ),
        selective_import: z
          .boolean()
          .optional()
          .describe(
            'If true, migration enters "waiting_for_select" state so you can choose which content to import via get_migration_selective_data.',
          ),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.contentMigrations.create(params.course_id as number, {
          migration_type: params.migration_type as string,
          settings: params.settings as Record<string, unknown> | undefined,
          date_shift_options: params.date_shift_options as Record<string, unknown> | undefined,
          selective_import: params.selective_import as boolean | undefined,
        }),
    },
  ]
}
