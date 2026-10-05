import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ModulesModule } from '../../src/canvas/modules'
import { CanvasHttpClient, CanvasApiError } from '../../src/canvas/client'

describe('ModulesModule', () => {
  let client: CanvasHttpClient
  let modules: ModulesModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    modules = new ModulesModule(client)
  })

  it('lists modules for a course', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      { id: 1, name: 'Week 1', position: 1, items_count: 5 },
      { id: 2, name: 'Week 2', position: 2, items_count: 3 },
    ])
    const result = await modules.list(100)
    expect(result).toHaveLength(2)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/modules')
  })

  it('gets a single module', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      id: 1,
      name: 'Week 1',
      position: 1,
      items_count: 5,
    })
    const result = await modules.get(100, 1)
    expect(result).toMatchObject({ id: 1, name: 'Week 1' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/modules/1')
  })

  it('lists items for a module', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      { id: 1, module_id: 1, title: 'Intro', position: 1, type: 'Page' },
      { id: 2, module_id: 1, title: 'HW1', position: 2, type: 'Assignment', content_id: 10 },
    ])
    const result = await modules.listItems(100, 1)
    expect(result).toHaveLength(2)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/modules/1/items')
  })

  it('creates a module', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      id: 3,
      name: 'Week 3',
      position: 3,
      items_count: 0,
    })
    const result = await modules.create(100, { name: 'Week 3', position: 3 })
    expect(result).toMatchObject({ id: 3, name: 'Week 3' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/modules', {
      method: 'POST',
      body: JSON.stringify({ module: { name: 'Week 3', position: 3 } }),
    })
  })

  it('updates a module', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      id: 1,
      name: 'Week 1 Updated',
      position: 1,
      items_count: 5,
      published: true,
    })
    const result = await modules.update(100, 1, { name: 'Week 1 Updated', published: true })
    expect(result).toMatchObject({ name: 'Week 1 Updated', published: true })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/modules/1', {
      method: 'PUT',
      body: JSON.stringify({ module: { name: 'Week 1 Updated', published: true } }),
    })
  })

  it('creates a module item', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      id: 5,
      module_id: 1,
      title: 'Assignment 1',
      position: 1,
      type: 'Assignment',
      content_id: 42,
    })
    const result = await modules.createItem(100, 1, {
      title: 'Assignment 1',
      type: 'Assignment',
      content_id: 42,
    })
    expect(result).toMatchObject({ id: 5, type: 'Assignment', content_id: 42 })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/modules/1/items', {
      method: 'POST',
      body: JSON.stringify({
        module_item: { title: 'Assignment 1', type: 'Assignment', content_id: 42 },
      }),
    })
  })

  it('creates a Page module item by page_url', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      id: 6,
      module_id: 1,
      title: 'Syllabus',
      position: 2,
      type: 'Page',
      page_url: 'syllabus',
    })
    const result = await modules.createItem(100, 1, {
      title: 'Syllabus',
      type: 'Page',
      page_url: 'syllabus',
    })
    expect(result).toMatchObject({ id: 6, type: 'Page', page_url: 'syllabus' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/modules/1/items', {
      method: 'POST',
      body: JSON.stringify({
        module_item: { title: 'Syllabus', type: 'Page', page_url: 'syllabus' },
      }),
    })
  })

  it('updates a module item', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      id: 5,
      module_id: 1,
      title: 'Discord',
      position: 1,
      type: 'ExternalUrl',
      external_url: 'https://discord.gg/new-invite',
      published: true,
    })
    const result = await modules.updateItem(100, 1, 5, {
      external_url: 'https://discord.gg/new-invite',
      published: true,
    })
    expect(result).toMatchObject({ id: 5, external_url: 'https://discord.gg/new-invite' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/modules/1/items/5', {
      method: 'PUT',
      body: JSON.stringify({
        module_item: { external_url: 'https://discord.gg/new-invite', published: true },
      }),
    })
  })

  it('moves a module item to another module via module_id', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      id: 5,
      module_id: 2,
      title: 'HW1',
      position: 1,
      type: 'Assignment',
    })
    const result = await modules.updateItem(100, 1, 5, { module_id: 2 })
    expect(result.module_id).toBe(2)
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/modules/1/items/5', {
      method: 'PUT',
      body: JSON.stringify({ module_item: { module_id: 2 } }),
    })
  })

  it('deletes a module item and returns the deleted item body', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      id: 5,
      module_id: 1,
      title: 'Old link',
      position: 1,
      type: 'ExternalUrl',
    })
    const result = await modules.deleteItem(100, 1, 5)
    expect(result).toMatchObject({ id: 5, type: 'ExternalUrl' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/modules/1/items/5', {
      method: 'DELETE',
    })
  })

  it('surfaces a Canvas error from deleteItem', async () => {
    vi.spyOn(client, 'request').mockRejectedValueOnce(
      new CanvasApiError(404, 'The specified resource does not exist.'),
    )
    await expect(modules.deleteItem(100, 1, 999)).rejects.toBeInstanceOf(CanvasApiError)
  })

  it('getCourseStructure returns module tree with summary', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      {
        id: 1,
        name: 'Week 1',
        position: 1,
        items_count: 2,
        state: 'active',
        published: true,
        unlock_at: null,
        items: [
          {
            id: 10,
            module_id: 1,
            title: 'HW1',
            position: 1,
            type: 'Assignment',
            content_id: 100,
            published: true,
          },
          { id: 11, module_id: 1, title: 'Reading', position: 2, type: 'Page', published: false },
        ],
      },
    ])
    const result = await modules.getCourseStructure(100)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/modules', {
      include: ['items'],
    })
    expect(result.modules).toHaveLength(1)
    expect(result.modules[0].items).toHaveLength(2)
    expect(result.summary).toEqual({
      total_modules: 1,
      total_items: 2,
      items_by_type: { Assignment: 1, Page: 1 },
    })
  })

  it('getCourseStructure filters unpublished items when includePublishedOnly is true', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      {
        id: 1,
        name: 'Week 1',
        position: 1,
        items_count: 2,
        state: 'active',
        published: true,
        unlock_at: null,
        items: [
          { id: 10, module_id: 1, title: 'HW1', position: 1, type: 'Assignment', published: true },
          { id: 11, module_id: 1, title: 'Draft', position: 2, type: 'Page', published: false },
        ],
      },
    ])
    const result = await modules.getCourseStructure(100, { includePublishedOnly: true })
    expect(result.modules[0].items).toHaveLength(1)
    expect(result.summary.total_items).toBe(1)
  })

  it('getCourseStructure passes content_details include when requested', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
    await modules.getCourseStructure(100, { includeContentDetails: true })
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/modules', {
      include: ['items', 'content_details'],
    })
  })

  it('getCourseStructure returns empty structure for a course with no modules', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
    const result = await modules.getCourseStructure(100)
    expect(result.modules).toHaveLength(0)
    expect(result.summary).toEqual({ total_modules: 0, total_items: 0, items_by_type: {} })
  })

  describe('listWithItems', () => {
    it('returns modules with their items inlined', async () => {
      const fixture = [
        {
          id: 1,
          name: 'Module 1',
          position: 1,
          items_count: 2,
          published: true,
          items: [
            { id: 10, module_id: 1, title: 'Reading', position: 1, type: 'Page', published: true },
            { id: 11, module_id: 1, title: 'Quiz 1', position: 2, type: 'Quiz', published: false },
          ],
        },
      ]
      vi.spyOn(client, 'paginate').mockResolvedValueOnce(fixture)
      const result = await modules.listWithItems(42)
      expect(result).toEqual(fixture)
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/42/modules', {
        include: ['items'],
      })
    })

    it('returns an empty array for a course with no modules', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
      const result = await modules.listWithItems(42)
      expect(result).toEqual([])
    })

    it('propagates CanvasApiError from the client', async () => {
      vi.spyOn(client, 'paginate').mockRejectedValueOnce(
        new CanvasApiError('Not Found', 404, '/api/v1/courses/42/modules'),
      )
      await expect(modules.listWithItems(42)).rejects.toThrow(CanvasApiError)
    })
  })
})
