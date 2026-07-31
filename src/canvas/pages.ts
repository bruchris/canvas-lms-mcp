import type { CanvasHttpClient } from './client'
import type { CanvasPage } from './types'
import { mapWithConcurrency } from './concurrency'

/**
 * Max concurrent page-body fetches issued by {@link PagesModule.listWithBodies}.
 * Matches the `CONCURRENT_COURSE_LIMIT` precedent in `student-search.ts`; kept
 * as a named export so the cap is greppable and adjustable in one place.
 */
export const PAGE_BODY_CONCURRENCY_LIMIT = 10

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
   * page, bounded to at most {@link PAGE_BODY_CONCURRENCY_LIMIT} concurrent
   * fetches so a large course does not open one Canvas request per page all at
   * once. Result order matches the listed page order. Used by the link-audit and
   * accessibility-audit tools to scan page content. `CanvasApiError` from either
   * the list or any individual fetch propagates unchanged.
   */
  async listWithBodies(courseId: number): Promise<CanvasPage[]> {
    const stubs = await this.client.paginate<CanvasPage>(`/api/v1/courses/${courseId}/pages`)
    return mapWithConcurrency(stubs, PAGE_BODY_CONCURRENCY_LIMIT, (stub) =>
      this.get(courseId, stub.url),
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
