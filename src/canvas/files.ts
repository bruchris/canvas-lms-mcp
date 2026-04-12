import type { CanvasHttpClient } from './client'
import type { CanvasFile, CanvasFolder } from './types'

export class FilesModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: number): Promise<CanvasFile[]> {
    return this.client.paginate<CanvasFile>(
      `/api/v1/courses/${courseId}/files`,
    )
  }

  async listFolders(courseId: number): Promise<CanvasFolder[]> {
    return this.client.paginate<CanvasFolder>(
      `/api/v1/courses/${courseId}/folders`,
    )
  }

  async get(courseId: number, fileId: number): Promise<CanvasFile> {
    return this.client.request<CanvasFile>(
      `/api/v1/courses/${courseId}/files/${fileId}`,
    )
  }
}
