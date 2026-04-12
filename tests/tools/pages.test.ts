import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasPage } from '../../src/canvas/types'
import { pageTools } from '../../src/tools/pages'

describe('pageTools', () => {
  const mockPage: CanvasPage = {
    page_id: 1,
    url: 'welcome-page',
    title: 'Welcome Page',
    body: '<p>Welcome!</p>',
    published: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    editing_roles: 'teachers',
  }

  function buildMockCanvas(): CanvasClient {
    return {
      pages: {
        list: vi.fn().mockResolvedValue([mockPage]),
        get: vi.fn().mockResolvedValue(mockPage),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 2 tool definitions', () => {
    expect(pageTools(buildMockCanvas())).toHaveLength(2)
  })

  it('exports tools with correct names', () => {
    const names = pageTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual(['list_pages', 'get_page'])
  })

  describe('list_pages', () => {
    it('has read-only annotations', () => {
      const tool = pageTools(buildMockCanvas()).find((t) => t.name === 'list_pages')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.pages.list', async () => {
      const canvas = buildMockCanvas()
      const tool = pageTools(canvas).find((t) => t.name === 'list_pages')!
      await tool.handler({ course_id: 1 })
      expect(canvas.pages.list).toHaveBeenCalledWith(1)
    })
  })

  describe('get_page', () => {
    it('has read-only annotations', () => {
      const tool = pageTools(buildMockCanvas()).find((t) => t.name === 'get_page')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.pages.get', async () => {
      const canvas = buildMockCanvas()
      const tool = pageTools(canvas).find((t) => t.name === 'get_page')!
      await tool.handler({ course_id: 1, page_url: 'welcome-page' })
      expect(canvas.pages.get).toHaveBeenCalledWith(1, 'welcome-page')
    })
  })
})
