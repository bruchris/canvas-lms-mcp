import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PagesModule } from '../../src/canvas/pages'
import { CanvasHttpClient, CanvasApiError } from '../../src/canvas/client'

describe('PagesModule', () => {
  let client: CanvasHttpClient
  let pages: PagesModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    pages = new PagesModule(client)
  })

  it('lists pages for a course', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      {
        page_id: 1,
        url: 'welcome',
        title: 'Welcome',
        published: true,
        updated_at: '2026-04-01T00:00:00Z',
      },
    ])
    const result = await pages.list(100)
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/pages')
  })

  it('gets a single page by URL slug', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      page_id: 1,
      url: 'welcome',
      title: 'Welcome',
      body: '<p>Hello</p>',
      published: true,
      updated_at: '2026-04-01T00:00:00Z',
    })
    const result = await pages.get(100, 'welcome')
    expect(result).toMatchObject({ page_id: 1, title: 'Welcome' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/pages/welcome')
  })

  it('creates a page', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      page_id: 2,
      url: 'new-page',
      title: 'New Page',
      body: '<p>Content</p>',
      published: false,
      updated_at: '2026-04-01T00:00:00Z',
    })
    const result = await pages.create(100, { title: 'New Page', body: '<p>Content</p>' })
    expect(result).toMatchObject({ page_id: 2, title: 'New Page' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/pages', {
      method: 'POST',
      body: JSON.stringify({ wiki_page: { title: 'New Page', body: '<p>Content</p>' } }),
    })
  })

  it('updates a page', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      page_id: 1,
      url: 'welcome',
      title: 'Updated Welcome',
      published: true,
      updated_at: '2026-04-02T00:00:00Z',
    })
    const result = await pages.update(100, 'welcome', { title: 'Updated Welcome', published: true })
    expect(result).toMatchObject({ title: 'Updated Welcome' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/pages/welcome', {
      method: 'PUT',
      body: JSON.stringify({ wiki_page: { title: 'Updated Welcome', published: true } }),
    })
  })

  it('deletes a page', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(undefined)
    await pages.delete(100, 'old-page')
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/pages/old-page', {
      method: 'DELETE',
    })
  })

  describe('listWithBodies', () => {
    it('fans out to fetch each page body', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([
        { page_id: 1, url: 'introduction', title: 'Introduction', published: true, updated_at: '' },
        { page_id: 2, url: 'week-1', title: 'Week 1', published: true, updated_at: '' },
      ])
      vi.spyOn(client, 'request').mockResolvedValue({
        page_id: 1,
        url: 'introduction',
        title: 'Introduction',
        body: '<p>Hello</p>',
        published: true,
        updated_at: '',
      })

      const result = await pages.listWithBodies(42)

      expect(result).toHaveLength(2)
      expect(result.every((p) => p.body != null)).toBe(true)
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/42/pages')
      expect(client.request).toHaveBeenCalledTimes(2)
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/42/pages/introduction')
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/42/pages/week-1')
    })

    it('returns an empty array without fetching bodies for a course with no pages', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
      const requestSpy = vi.spyOn(client, 'request')

      const result = await pages.listWithBodies(42)

      expect(result).toEqual([])
      expect(requestSpy).not.toHaveBeenCalled()
    })

    it('propagates a CanvasApiError thrown by paginate', async () => {
      vi.spyOn(client, 'paginate').mockRejectedValueOnce(
        new CanvasApiError('Not Found', 404, '/api/v1/courses/42/pages'),
      )

      await expect(pages.listWithBodies(42)).rejects.toBeInstanceOf(CanvasApiError)
    })

    it('propagates a CanvasApiError thrown while fetching a page body', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([
        { page_id: 1, url: 'introduction', title: 'Introduction', published: true, updated_at: '' },
      ])
      vi.spyOn(client, 'request').mockRejectedValueOnce(
        new CanvasApiError('Forbidden', 403, '/api/v1/courses/42/pages/introduction'),
      )

      await expect(pages.listWithBodies(42)).rejects.toBeInstanceOf(CanvasApiError)
    })
  })
})
