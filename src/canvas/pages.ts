import type { CanvasHttpClient } from './client'
import type { CanvasPage } from './types'

export class PagesModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: number): Promise<CanvasPage[]> {
    return this.client.paginate<CanvasPage>(`/api/v1/courses/${courseId}/pages`)
  }

  async get(courseId: number, pageUrl: string): Promise<CanvasPage> {
    return this.client.request<CanvasPage>(
      `/api/v1/courses/${courseId}/pages/${encodeURIComponent(pageUrl)}`,
    )
  }
}
