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
        create: vi.fn().mockResolvedValue(mockModule),
        update: vi.fn().mockResolvedValue(mockModule),
        createItem: vi.fn().mockResolvedValue(mockItem),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 6 tool definitions', () => {
    expect(moduleTools(buildMockCanvas())).toHaveLength(6)
  })

  it('exports tools with correct names', () => {
    const names = moduleTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'list_modules',
      'get_module',
      'list_module_items',
      'create_module',
      'update_module',
      'create_module_item',
    ])
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

  describe('create_module', () => {
    it('has destructive annotations', () => {
      const tool = moduleTools(buildMockCanvas()).find((t) => t.name === 'create_module')!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.modules.create', async () => {
      const canvas = buildMockCanvas()
      const tool = moduleTools(canvas).find((t) => t.name === 'create_module')!
      await tool.handler({ course_id: 1, name: 'Week 2', position: 2 })
      expect(canvas.modules.create).toHaveBeenCalledWith(1, {
        name: 'Week 2',
        position: 2,
        unlock_at: undefined,
        prerequisite_module_ids: undefined,
      })
    })
  })

  describe('update_module', () => {
    it('has destructive annotations', () => {
      const tool = moduleTools(buildMockCanvas()).find((t) => t.name === 'update_module')!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.modules.update', async () => {
      const canvas = buildMockCanvas()
      const tool = moduleTools(canvas).find((t) => t.name === 'update_module')!
      await tool.handler({ course_id: 1, module_id: 1, published: true })
      expect(canvas.modules.update).toHaveBeenCalledWith(1, 1, {
        name: undefined,
        position: undefined,
        published: true,
      })
    })
  })

  describe('create_module_item', () => {
    it('has destructive annotations', () => {
      const tool = moduleTools(buildMockCanvas()).find((t) => t.name === 'create_module_item')!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.modules.createItem', async () => {
      const canvas = buildMockCanvas()
      const tool = moduleTools(canvas).find((t) => t.name === 'create_module_item')!
      await tool.handler({ course_id: 1, module_id: 1, title: 'HW1', type: 'Assignment', content_id: 42 })
      expect(canvas.modules.createItem).toHaveBeenCalledWith(1, 1, {
        title: 'HW1',
        type: 'Assignment',
        content_id: 42,
        external_url: undefined,
        position: undefined,
      })
    })
  })
})
