import type { CanvasHttpClient } from './client'
import type { CanvasContentExport, ContentExportType } from './types'

/**
 * Canvas `content_exports` API — exports a course (or its assessments) as a
 * Common Cartridge / QTI / zip package. Exports are asynchronous: `create`
 * starts the job and returns immediately; `get` polls until the package is ready
 * and surfaces a time-limited `attachment.url` download link.
 */
export class ContentExportsModule {
  constructor(private client: CanvasHttpClient) {}

  /** Start a content export. Returns the export in its initial `created` state. */
  async create(courseId: number, exportType: ContentExportType): Promise<CanvasContentExport> {
    // Canvas accepts `export_type` as a top-level param here (no `content_export:` envelope).
    return this.client.request<CanvasContentExport>(`/api/v1/courses/${courseId}/content_exports`, {
      method: 'POST',
      body: JSON.stringify({ export_type: exportType }),
    })
  }

  /** Poll a single export's status; `attachment` is populated only once `exported`. */
  async get(courseId: number, exportId: number): Promise<CanvasContentExport> {
    return this.client.request<CanvasContentExport>(
      `/api/v1/courses/${courseId}/content_exports/${exportId}`,
    )
  }

  /** List all content exports for a course (most recent first, per Canvas). */
  async list(courseId: number): Promise<CanvasContentExport[]> {
    return this.client.paginate<CanvasContentExport>(`/api/v1/courses/${courseId}/content_exports`)
  }
}
