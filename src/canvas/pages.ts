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

  async create(
    courseId: number,
    params: { title: string; body?: string; published?: boolean; editing_roles?: string },
  ): Promise<CanvasPage> {
    return this.client.request<CanvasPage>(`/api/v1/courses/${courseId}/pages`, {
      method: 'POST',
      body: JSON.stringify({ wiki_page: params }),
    })
  }

  async update(
    courseId: number,
    pageUrl: string,
    params: { title?: string; body?: string; published?: boolean; editing_roles?: string },
  ): Promise<CanvasPage> {
    return this.client.request<CanvasPage>(
      `/api/v1/courses/${courseId}/pages/${encodeURIComponent(pageUrl)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ wiki_page: params }),
      },
    )
  }

  async delete(courseId: number, pageUrl: string): Promise<void> {
    await this.client.request<void>(
      `/api/v1/courses/${courseId}/pages/${encodeURIComponent(pageUrl)}`,
      { method: 'DELETE' },
    )
  }
}
