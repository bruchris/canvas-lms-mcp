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

  const mockCourseStructure = {
    modules: [],
    summary: { total_modules: 0, total_items: 0, items_by_type: {} },
  }

  function buildMockCanvas(): CanvasClient {
    return {
      modules: {
        list: vi.fn().mockResolvedValue([mockModule]),
        get: vi.fn().mockResolvedValue(mockModule),
        listItems: vi.fn().mockResolvedValue([mockItem]),
        getCourseStructure: vi.fn().mockResolvedValue(mockCourseStructure),
        create: vi.fn().mockResolvedValue(mockModule),
        update: vi.fn().mockResolvedValue(mockModule),
        createItem: vi.fn().mockResolvedValue(mockItem),
        updateItem: vi.fn().mockResolvedValue(mockItem),
        deleteItem: vi.fn().mockResolvedValue(mockItem),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 10 tool definitions', () => {
    expect(moduleTools(buildMockCanvas())).toHaveLength(10)
  })

  it('exports tools with correct names', () => {
    const names = moduleTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'list_modules',
      'get_module',
      'list_module_items',
      'get_course_structure',
      'view_course_structure',
      'create_module',
      'update_module',
      'create_module_item',
      'update_module_item',
      'delete_module_item',
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

  describe('get_course_structure', () => {
    it('has read-only annotations', () => {
      const tool = moduleTools(buildMockCanvas()).find((t) => t.name === 'get_course_structure')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.modules.getCourseStructure with defaults', async () => {
      const canvas = buildMockCanvas()
      const tool = moduleTools(canvas).find((t) => t.name === 'get_course_structure')!
      await tool.handler({ course_id: 1 })
      expect(canvas.modules.getCourseStructure).toHaveBeenCalledWith(1, {
        includePublishedOnly: undefined,
        includeContentDetails: undefined,
      })
    })

    it('passes options through to getCourseStructure', async () => {
      const canvas = buildMockCanvas()
      const tool = moduleTools(canvas).find((t) => t.name === 'get_course_structure')!
      await tool.handler({
        course_id: 1,
        include_published_only: true,
        include_content_details: true,
      })
      expect(canvas.modules.getCourseStructure).toHaveBeenCalledWith(1, {
        includePublishedOnly: true,
        includeContentDetails: true,
      })
    })
  })

  describe('view_course_structure', () => {
    it('has read-only annotations', () => {
      const tool = moduleTools(buildMockCanvas()).find((t) => t.name === 'view_course_structure')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('declares the UI resource URI', () => {
      const tool = moduleTools(buildMockCanvas()).find((t) => t.name === 'view_course_structure')!
      expect(tool.ui?.resourceUri).toBe('ui://canvas-lms-mcp/course-structure.html')
    })

    it('keeps CSP empty (widget is self-contained)', () => {
      const tool = moduleTools(buildMockCanvas()).find((t) => t.name === 'view_course_structure')!
      expect(tool.ui?.csp).toEqual({
        connectDomains: [],
        resourceDomains: [],
        frameDomains: [],
      })
    })

    it('delegates to canvas.modules.getCourseStructure with defaults', async () => {
      const canvas = buildMockCanvas()
      const tool = moduleTools(canvas).find((t) => t.name === 'view_course_structure')!
      await tool.handler({ course_id: 1 })
      expect(canvas.modules.getCourseStructure).toHaveBeenCalledWith(1, {
        includePublishedOnly: undefined,
        includeContentDetails: undefined,
      })
    })

    it('passes options through to getCourseStructure', async () => {
      const canvas = buildMockCanvas()
      const tool = moduleTools(canvas).find((t) => t.name === 'view_course_structure')!
      await tool.handler({
        course_id: 1,
        include_published_only: true,
        include_content_details: true,
      })
      expect(canvas.modules.getCourseStructure).toHaveBeenCalledWith(1, {
        includePublishedOnly: true,
        includeContentDetails: true,
      })
    })

    it('returns the same payload shape as get_course_structure', async () => {
      const canvas = buildMockCanvas()
      const tools = moduleTools(canvas)
      const get = tools.find((t) => t.name === 'get_course_structure')!
      const view = tools.find((t) => t.name === 'view_course_structure')!
      const getResult = await get.handler({ course_id: 1 })
      const viewResult = await view.handler({ course_id: 1 })
      expect(viewResult).toEqual(getResult)
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
      await tool.handler({
        course_id: 1,
        module_id: 1,
        title: 'HW1',
        type: 'Assignment',
        content_id: 42,
      })
      expect(canvas.modules.createItem).toHaveBeenCalledWith(1, 1, {
        title: 'HW1',
        type: 'Assignment',
        content_id: 42,
        page_url: undefined,
        external_url: undefined,
        position: undefined,
      })
    })

    it('passes page_url through for Page items', async () => {
      const canvas = buildMockCanvas()
      const tool = moduleTools(canvas).find((t) => t.name === 'create_module_item')!
      await tool.handler({
        course_id: 1,
        module_id: 1,
        title: 'Syllabus',
        type: 'Page',
        page_url: 'syllabus',
      })
      expect(canvas.modules.createItem).toHaveBeenCalledWith(1, 1, {
        title: 'Syllabus',
        type: 'Page',
        content_id: undefined,
        page_url: 'syllabus',
        external_url: undefined,
        position: undefined,
      })
    })
  })

  describe('update_module_item', () => {
    it('has destructive + idempotent annotations', () => {
      const tool = moduleTools(buildMockCanvas()).find((t) => t.name === 'update_module_item')!
      expect(tool.annotations).toEqual({
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      })
    })

    it('delegates to canvas.modules.updateItem with only the provided fields', async () => {
      const canvas = buildMockCanvas()
      const tool = moduleTools(canvas).find((t) => t.name === 'update_module_item')!
      await tool.handler({
        course_id: 1,
        module_id: 1,
        item_id: 5,
        external_url: 'https://example.com/new',
        published: true,
      })
      expect(canvas.modules.updateItem).toHaveBeenCalledWith(1, 1, 5, {
        external_url: 'https://example.com/new',
        published: true,
      })
    })

    it('maps target_module_id onto the Canvas module_id field', async () => {
      const canvas = buildMockCanvas()
      const tool = moduleTools(canvas).find((t) => t.name === 'update_module_item')!
      await tool.handler({ course_id: 1, module_id: 1, item_id: 5, target_module_id: 2 })
      expect(canvas.modules.updateItem).toHaveBeenCalledWith(1, 1, 5, { module_id: 2 })
    })

    it('returns the updated item', async () => {
      const canvas = buildMockCanvas()
      const tool = moduleTools(canvas).find((t) => t.name === 'update_module_item')!
      const result = await tool.handler({ course_id: 1, module_id: 1, item_id: 5, title: 'x' })
      expect(result).toEqual(mockItem)
    })
  })

  describe('delete_module_item', () => {
    it('has destructive + idempotent annotations', () => {
      const tool = moduleTools(buildMockCanvas()).find((t) => t.name === 'delete_module_item')!
      expect(tool.annotations).toEqual({
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      })
    })

    it('delegates to canvas.modules.deleteItem and returns the deleted item', async () => {
      const canvas = buildMockCanvas()
      const tool = moduleTools(canvas).find((t) => t.name === 'delete_module_item')!
      const result = await tool.handler({ course_id: 1, module_id: 1, item_id: 5 })
      expect(canvas.modules.deleteItem).toHaveBeenCalledWith(1, 1, 5)
      expect(result).toEqual(mockItem)
    })
  })
})
