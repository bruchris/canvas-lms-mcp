import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import type { CanvasClient } from '../../src/canvas'
import { contentMigrationsTools } from '../../src/tools/content-migrations'
import type {
  CanvasContentMigration,
  CanvasContentMigrator,
  CanvasMigrationIssue,
} from '../../src/canvas/types'

const mockMigrationCreated: CanvasContentMigration = {
  id: 10,
  migration_type: 'course_copy_importer',
  migration_type_title: 'Course Copy',
  workflow_state: 'created',
  progress_url: null,
  migration_issues_url:
    'https://canvas.example.com/api/v1/courses/99/content_migrations/10/migration_issues',
  finished_at: null,
  started_at: null,
  created_at: '2026-07-28T00:00:00Z',
  updated_at: '2026-07-28T00:00:00Z',
}

const mockMigrationRunning: CanvasContentMigration = {
  ...mockMigrationCreated,
  workflow_state: 'running',
  progress_url: 'https://canvas.example.com/api/v1/progress/42',
  started_at: '2026-07-28T00:01:00Z',
}

const mockMigrationCompleted: CanvasContentMigration = {
  ...mockMigrationRunning,
  workflow_state: 'completed',
  finished_at: '2026-07-28T00:03:00Z',
}

const mockMigrators: CanvasContentMigrator[] = [
  {
    type: 'course_copy_importer',
    name: 'Course Copy',
    requires_file_upload: false,
    specification_url: null,
  },
  {
    type: 'common_cartridge_importer',
    name: 'Common Cartridge',
    requires_file_upload: true,
    specification_url: null,
  },
]

const mockIssues: CanvasMigrationIssue[] = [
  {
    id: 1,
    content_migration_url: 'https://canvas.example.com/api/v1/courses/99/content_migrations/10',
    description: 'Could not find assignment XYZ',
    workflow_state: 'active',
    issue_type: 'warning',
    created_at: '2026-07-28T00:02:00Z',
    updated_at: '2026-07-28T00:02:00Z',
  },
]

function buildMockCanvas(): CanvasClient {
  return {
    contentMigrations: {
      list: vi.fn().mockResolvedValue([mockMigrationCompleted, mockMigrationCreated]),
      get: vi.fn().mockResolvedValue(mockMigrationRunning),
      listMigrators: vi.fn().mockResolvedValue(mockMigrators),
      getSelectiveData: vi.fn().mockResolvedValue([]),
      getAssetIdMapping: vi.fn().mockResolvedValue({ old_123: 456 }),
      listMigrationIssues: vi.fn().mockResolvedValue(mockIssues),
      create: vi.fn().mockResolvedValue(mockMigrationCreated),
    },
  } as unknown as CanvasClient
}

describe('contentMigrationsTools', () => {
  it('returns 7 tool definitions', () => {
    expect(contentMigrationsTools(buildMockCanvas())).toHaveLength(7)
  })

  it('exports tools with correct names', () => {
    const names = contentMigrationsTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'list_content_migrations',
      'get_content_migration',
      'list_content_migration_types',
      'get_migration_selective_data',
      'get_migration_asset_id_mapping',
      'list_migration_issues',
      'create_content_migration',
    ])
  })

  describe('annotations', () => {
    it('create_content_migration has destructiveHint + openWorldHint', () => {
      const tool = contentMigrationsTools(buildMockCanvas()).find(
        (t) => t.name === 'create_content_migration',
      )!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('read tools have readOnlyHint + openWorldHint', () => {
      const readTools = contentMigrationsTools(buildMockCanvas()).filter(
        (t) => t.name !== 'create_content_migration',
      )
      for (const tool of readTools) {
        expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
      }
    })
  })

  describe('list_content_migrations', () => {
    it('delegates to canvas.contentMigrations.list', async () => {
      const canvas = buildMockCanvas()
      const tool = contentMigrationsTools(canvas).find((t) => t.name === 'list_content_migrations')!
      const result = await tool.handler({ course_id: 99 })
      expect(canvas.contentMigrations.list).toHaveBeenCalledWith(99)
      expect(result).toEqual([mockMigrationCompleted, mockMigrationCreated])
    })
  })

  describe('get_content_migration', () => {
    it('delegates to canvas.contentMigrations.get and surfaces progress_url', async () => {
      const canvas = buildMockCanvas()
      const tool = contentMigrationsTools(canvas).find((t) => t.name === 'get_content_migration')!
      const result = (await tool.handler({
        course_id: 99,
        migration_id: 10,
      })) as CanvasContentMigration
      expect(canvas.contentMigrations.get).toHaveBeenCalledWith(99, 10)
      expect(result.progress_url).toBe('https://canvas.example.com/api/v1/progress/42')
    })
  })

  describe('list_content_migration_types', () => {
    it('delegates to canvas.contentMigrations.listMigrators', async () => {
      const canvas = buildMockCanvas()
      const tool = contentMigrationsTools(canvas).find(
        (t) => t.name === 'list_content_migration_types',
      )!
      const result = await tool.handler({ course_id: 99 })
      expect(canvas.contentMigrations.listMigrators).toHaveBeenCalledWith(99)
      expect(result).toEqual(mockMigrators)
    })
  })

  describe('get_migration_selective_data', () => {
    it('delegates without type filter', async () => {
      const canvas = buildMockCanvas()
      const tool = contentMigrationsTools(canvas).find(
        (t) => t.name === 'get_migration_selective_data',
      )!
      await tool.handler({ course_id: 99, migration_id: 10 })
      expect(canvas.contentMigrations.getSelectiveData).toHaveBeenCalledWith(99, 10, undefined)
    })

    it('passes type filter when provided', async () => {
      const canvas = buildMockCanvas()
      const tool = contentMigrationsTools(canvas).find(
        (t) => t.name === 'get_migration_selective_data',
      )!
      await tool.handler({ course_id: 99, migration_id: 10, type: 'assignments' })
      expect(canvas.contentMigrations.getSelectiveData).toHaveBeenCalledWith(99, 10, 'assignments')
    })
  })

  describe('get_migration_asset_id_mapping', () => {
    it('delegates to canvas.contentMigrations.getAssetIdMapping', async () => {
      const canvas = buildMockCanvas()
      const tool = contentMigrationsTools(canvas).find(
        (t) => t.name === 'get_migration_asset_id_mapping',
      )!
      const result = await tool.handler({ course_id: 99, migration_id: 10 })
      expect(canvas.contentMigrations.getAssetIdMapping).toHaveBeenCalledWith(99, 10)
      expect(result).toEqual({ old_123: 456 })
    })
  })

  describe('list_migration_issues', () => {
    it('delegates to canvas.contentMigrations.listMigrationIssues', async () => {
      const canvas = buildMockCanvas()
      const tool = contentMigrationsTools(canvas).find((t) => t.name === 'list_migration_issues')!
      const result = await tool.handler({ course_id: 99, migration_id: 10 })
      expect(canvas.contentMigrations.listMigrationIssues).toHaveBeenCalledWith(99, 10)
      expect(result).toEqual(mockIssues)
    })
  })

  describe('create_content_migration', () => {
    it('delegates a course copy to canvas.contentMigrations.create and returns progress_url when present', async () => {
      const canvas = buildMockCanvas()
      const tool = contentMigrationsTools(canvas).find(
        (t) => t.name === 'create_content_migration',
      )!
      const result = (await tool.handler({
        course_id: 99,
        migration_type: 'course_copy_importer',
        settings: { source_course_id: 1 },
      })) as CanvasContentMigration
      expect(canvas.contentMigrations.create).toHaveBeenCalledWith(99, {
        migration_type: 'course_copy_importer',
        settings: { source_course_id: 1 },
        date_shift_options: undefined,
        selective_import: undefined,
      })
      // Initial state has no progress_url yet
      expect(result.workflow_state).toBe('created')
    })

    it('surfaces progress_url once the migration is queued (async passthrough)', async () => {
      const canvas = buildMockCanvas()
      ;(canvas.contentMigrations.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockMigrationRunning,
      )
      const tool = contentMigrationsTools(canvas).find(
        (t) => t.name === 'create_content_migration',
      )!
      const result = (await tool.handler({
        course_id: 99,
        migration_type: 'course_copy_importer',
      })) as CanvasContentMigration
      expect(result.progress_url).toBe('https://canvas.example.com/api/v1/progress/42')
    })

    it.each([
      'course_copy_importer',
      'common_cartridge_importer',
      'zip_file_importer',
      'qti_converter',
      'moodle_converter',
    ] as const)('accepts %s as migration_type', async (migType) => {
      const schema = z.object(
        contentMigrationsTools(buildMockCanvas()).find(
          (t) => t.name === 'create_content_migration',
        )!.inputSchema,
      )
      expect(schema.safeParse({ course_id: 1, migration_type: migType }).success).toBe(true)
    })

    it('rejects an unknown migration_type', () => {
      const schema = z.object(
        contentMigrationsTools(buildMockCanvas()).find(
          (t) => t.name === 'create_content_migration',
        )!.inputSchema,
      )
      expect(schema.safeParse({ course_id: 1, migration_type: 'unknown_type' }).success).toBe(false)
    })
  })
})
