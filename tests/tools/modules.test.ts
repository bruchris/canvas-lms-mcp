import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasModule, CanvasModuleItem } from '../../src/canvas/types'
import { moduleTools } from '../../src/tools/modules'

describe('moduleTools', () => {
  const mockModule: CanvasModule = {
    id: 1,
    name: 'Week 1',
    position: 1,
    state: 'active',
    items_count: 5,
    items_url: 'https://canvas.example.com/api/v1/courses/1/modules/1/items',
    published: true,
    unlock_at: null,
  }

  const mockItem: CanvasModuleItem = {
    id: 1,
    module_id: 1,
    title: 'Intro Lecture',
    position: 1,
    type: 'Assignment',
    content_id: 101,
    html_url: 'https://canvas.example.com/courses/1/assignments/101',
    indent: 0,
    published: true,
  }

  function buildMockCanvas(): CanvasClient {
    return {
      modules: {
        list: vi.fn().mockResolvedValue([mockModule]),
        get: vi.fn().mockResolvedValue(mockModule),
        listItems: vi.fn().mockResolvedValue([mockItem]),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 3 tool definitions', () => {
    expect(moduleTools(buildMockCanvas())).toHaveLength(3)
  })

  it('exports tools with correct names', () => {
    const names = moduleTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual(['list_modules', 'get_module', 'list_module_items'])
  })

  describe('list_modules', () => {
    it('has read-only annotations', () => {
      const tool = moduleTools(buildMockCanvas()).find((t) => t.name === 'list_modules')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.modules.list', async () => {
      const canvas = buildMockCanvas()
      const tool = moduleTools(canvas).find((t) => t.name === 'list_modules')!
      await tool.handler({ course_id: 1 })
      expect(canvas.modules.list).toHaveBeenCalledWith(1)
    })
  })

  describe('get_module', () => {
    it('has read-only annotations', () => {
      const tool = moduleTools(buildMockCanvas()).find((t) => t.name === 'get_module')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.modules.get', async () => {
      const canvas = buildMockCanvas()
      const tool = moduleTools(canvas).find((t) => t.name === 'get_module')!
      await tool.handler({ course_id: 1, module_id: 1 })
      expect(canvas.modules.get).toHaveBeenCalledWith(1, 1)
    })
  })

  describe('list_module_items', () => {
    it('has read-only annotations', () => {
      const tool = moduleTools(buildMockCanvas()).find((t) => t.name === 'list_module_items')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.modules.listItems', async () => {
      const canvas = buildMockCanvas()
      const tool = moduleTools(canvas).find((t) => t.name === 'list_module_items')!
      await tool.handler({ course_id: 1, module_id: 1 })
      expect(canvas.modules.listItems).toHaveBeenCalledWith(1, 1)
    })
  })
})
