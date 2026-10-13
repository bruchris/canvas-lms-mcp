import type { CanvasHttpClient } from './client'
import type { CanvasContentMigration, CanvasContentMigrator, CanvasMigrationIssue } from './types'
import type { CanvasId } from './id'

export class ContentMigrationsModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: CanvasId): Promise<CanvasContentMigration[]> {
    return this.client.paginate<CanvasContentMigration>(
      `/api/v1/courses/${courseId}/content_migrations`,
    )
  }

  async get(courseId: CanvasId, migrationId: CanvasId): Promise<CanvasContentMigration> {
    return this.client.request<CanvasContentMigration>(
      `/api/v1/courses/${courseId}/content_migrations/${migrationId}`,
    )
  }

  async listMigrators(courseId: CanvasId): Promise<CanvasContentMigrator[]> {
    return this.client.request<CanvasContentMigrator[]>(
      `/api/v1/courses/${courseId}/content_migrations/migrators`,
    )
  }

  async getSelectiveData(
    courseId: CanvasId,
    migrationId: CanvasId,
    type?: string,
  ): Promise<unknown[]> {
    const url = `/api/v1/courses/${courseId}/content_migrations/${migrationId}/selective_data`
    return this.client.paginate<unknown>(url, type ? { type } : undefined)
  }

  async getAssetIdMapping(
    courseId: CanvasId,
    migrationId: CanvasId,
  ): Promise<Record<string, unknown>> {
    return this.client.request<Record<string, unknown>>(
      `/api/v1/courses/${courseId}/content_migrations/${migrationId}/asset_id_mapping`,
    )
  }

  async listMigrationIssues(
    courseId: CanvasId,
    migrationId: CanvasId,
  ): Promise<CanvasMigrationIssue[]> {
    return this.client.paginate<CanvasMigrationIssue>(
      `/api/v1/courses/${courseId}/content_migrations/${migrationId}/migration_issues`,
    )
  }

  async create(
    courseId: CanvasId,
    params: {
      migration_type: string
      settings?: Record<string, unknown>
      date_shift_options?: Record<string, unknown>
      selective_import?: boolean
    },
  ): Promise<CanvasContentMigration> {
    return this.client.request<CanvasContentMigration>(
      `/api/v1/courses/${courseId}/content_migrations`,
      {
        method: 'POST',
        body: JSON.stringify(params),
      },
    )
  }
}
