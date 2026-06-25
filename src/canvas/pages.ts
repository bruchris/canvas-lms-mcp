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

  /**
   * List every page in a course with its full HTML `body`. The paginated list
   * endpoint returns page stubs without `body`, so this fans out a `get()` per
   * page (mirroring the `listWithItems` pattern in `modules.ts`). Used by the
   * link-audit tool to scan page content. `CanvasApiError` from either the list
   * or any individual fetch propagates unchanged.
   */
  async listWithBodies(courseId: number): Promise<CanvasPage[]> {
    const stubs = await this.client.paginate<CanvasPage>(`/api/v1/courses/${courseId}/pages`)
    return Promise.all(stubs.map((stub) => this.get(courseId, stub.url)))
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
