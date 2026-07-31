import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ContentMigrationsModule } from '../../src/canvas/content-migrations'
import { CanvasApiError } from '../../src/canvas/client'
import type { CanvasHttpClient } from '../../src/canvas/client'
import type {
  CanvasContentMigration,
  CanvasContentMigrator,
  CanvasMigrationIssue,
} from '../../src/canvas/types'

const COURSE_ID = 99
const MIGRATION_ID = 10

const mockMigration: CanvasContentMigration = {
  id: MIGRATION_ID,
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

function buildMockClient(): CanvasHttpClient {
  return {
    paginate: vi.fn(),
    request: vi.fn(),
  } as unknown as CanvasHttpClient
}

describe('ContentMigrationsModule', () => {
  let client: CanvasHttpClient
  let mod: ContentMigrationsModule

  beforeEach(() => {
    client = buildMockClient()
    mod = new ContentMigrationsModule(client)
  })

  describe('list', () => {
    it('paginates /api/v1/courses/:id/content_migrations', async () => {
      vi.mocked(client.paginate).mockResolvedValueOnce([mockMigration])
      const result = await mod.list(COURSE_ID)
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/99/content_migrations')
      expect(result).toEqual([mockMigration])
    })
  })

  describe('get', () => {
    it('requests /api/v1/courses/:id/content_migrations/:mid', async () => {
      vi.mocked(client.request).mockResolvedValueOnce(mockMigration)
      const result = await mod.get(COURSE_ID, MIGRATION_ID)
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/99/content_migrations/10')
      expect(result).toEqual(mockMigration)
    })
  })

  describe('listMigrators', () => {
    it('requests the migrators endpoint (not paginated) despite returning an array', async () => {
      vi.mocked(client.request).mockResolvedValueOnce(mockMigrators)
      const result = await mod.listMigrators(COURSE_ID)
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/99/content_migrations/migrators')
      expect(client.paginate).not.toHaveBeenCalled()
      expect(result).toEqual(mockMigrators)
    })
  })

  describe('getSelectiveData', () => {
    it('paginates selective_data with no type filter (undefined params)', async () => {
      vi.mocked(client.paginate).mockResolvedValueOnce([])
      const result = await mod.getSelectiveData(COURSE_ID, MIGRATION_ID)
      expect(client.paginate).toHaveBeenCalledWith(
        '/api/v1/courses/99/content_migrations/10/selective_data',
        undefined,
      )
      expect(result).toEqual([])
    })

    it('passes the type query param when provided', async () => {
      vi.mocked(client.paginate).mockResolvedValueOnce([{ type: 'assignments' }])
      await mod.getSelectiveData(COURSE_ID, MIGRATION_ID, 'assignments')
      expect(client.paginate).toHaveBeenCalledWith(
        '/api/v1/courses/99/content_migrations/10/selective_data',
        { type: 'assignments' },
      )
    })
  })

  describe('getAssetIdMapping', () => {
    it('requests the asset_id_mapping endpoint', async () => {
      vi.mocked(client.request).mockResolvedValueOnce({ old_123: 456 })
      const result = await mod.getAssetIdMapping(COURSE_ID, MIGRATION_ID)
      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/99/content_migrations/10/asset_id_mapping',
      )
      expect(result).toEqual({ old_123: 456 })
    })
  })

  describe('listMigrationIssues', () => {
    it('paginates the migration_issues endpoint', async () => {
      vi.mocked(client.paginate).mockResolvedValueOnce(mockIssues)
      const result = await mod.listMigrationIssues(COURSE_ID, MIGRATION_ID)
      expect(client.paginate).toHaveBeenCalledWith(
        '/api/v1/courses/99/content_migrations/10/migration_issues',
      )
      expect(result).toEqual(mockIssues)
    })
  })

  describe('create', () => {
    it('POSTs a JSON body with the migration_type', async () => {
      vi.mocked(client.request).mockResolvedValueOnce(mockMigration)
      const params = { migration_type: 'course_copy_importer' }
      const result = await mod.create(COURSE_ID, params)
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/99/content_migrations', {
        method: 'POST',
        body: JSON.stringify(params),
      })
      expect(result).toEqual(mockMigration)
    })

    it('passes through settings, date_shift_options, and selective_import', async () => {
      vi.mocked(client.request).mockResolvedValueOnce(mockMigration)
      const params = {
        migration_type: 'course_copy_importer',
        settings: { source_course_id: 1 },
        date_shift_options: { shift_dates: true },
        selective_import: true,
      }
      await mod.create(COURSE_ID, params)
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/99/content_migrations', {
        method: 'POST',
        body: JSON.stringify(params),
      })
    })
  })

  describe('error propagation', () => {
    it('lets a CanvasApiError from a request-based method propagate unchanged', async () => {
      const err = new CanvasApiError(
        'Course not found',
        404,
        '/api/v1/courses/99/content_migrations/10',
      )
      vi.mocked(client.request).mockRejectedValueOnce(err)
      await expect(mod.get(COURSE_ID, MIGRATION_ID)).rejects.toBe(err)
    })

    it('lets a CanvasApiError from a paginate-based method propagate unchanged', async () => {
      const err = new CanvasApiError('Forbidden', 403, '/api/v1/courses/99/content_migrations')
      vi.mocked(client.paginate).mockRejectedValueOnce(err)
      await expect(mod.list(COURSE_ID)).rejects.toBe(err)
    })
  })
})
