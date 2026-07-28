import type { CanvasHttpClient } from './client'
import type { CanvasContentMigration, CanvasContentMigrator, CanvasMigrationIssue } from './types'

export class ContentMigrationsModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: number): Promise<CanvasContentMigration[]> {
    return this.client.paginate<CanvasContentMigration>(
      `/api/v1/courses/${courseId}/content_migrations`,
    )
  }

  async get(courseId: number, migrationId: number): Promise<CanvasContentMigration> {
    return this.client.request<CanvasContentMigration>(
      `/api/v1/courses/${courseId}/content_migrations/${migrationId}`,
    )
  }

  async listMigrators(courseId: number): Promise<CanvasContentMigrator[]> {
    return this.client.request<CanvasContentMigrator[]>(
      `/api/v1/courses/${courseId}/content_migrations/migrators`,
    )
  }

  async getSelectiveData(courseId: number, migrationId: number, type?: string): Promise<unknown[]> {
    const url = `/api/v1/courses/${courseId}/content_migrations/${migrationId}/selective_data`
    return this.client.paginate<unknown>(url, type ? { type } : undefined)
  }

  async getAssetIdMapping(courseId: number, migrationId: number): Promise<Record<string, unknown>> {
    return this.client.request<Record<string, unknown>>(
      `/api/v1/courses/${courseId}/content_migrations/${migrationId}/asset_id_mapping`,
    )
  }

  async listMigrationIssues(
    courseId: number,
    migrationId: number,
  ): Promise<CanvasMigrationIssue[]> {
    return this.client.paginate<CanvasMigrationIssue>(
      `/api/v1/courses/${courseId}/content_migrations/${migrationId}/migration_issues`,
    )
  }

  async create(
    courseId: number,
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
