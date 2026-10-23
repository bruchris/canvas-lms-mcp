import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ModulesModule, MAX_OVERSIZED_MODULE_RECOVERIES } from '../../src/canvas/modules'
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

  it('deletes a module and returns the deleted module', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ id: 7, name: 'Extra Labors' })
    const result = await modules.delete(100, 7)
    expect(result).toMatchObject({ id: 7, name: 'Extra Labors' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/modules/7', {
      method: 'DELETE',
    })
  })

  it('surfaces a Canvas error from delete', async () => {
    vi.spyOn(client, 'request').mockRejectedValueOnce(
      new CanvasApiError(404, 'The specified resource does not exist.'),
    )
    await expect(modules.delete(100, 999)).rejects.toBeInstanceOf(CanvasApiError)
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
      items_truncated: false,
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
    expect(result.summary).toEqual({
      total_modules: 0,
      total_items: 0,
      items_by_type: {},
      items_truncated: false,
    })
  })

  describe('getCourseStructure oversized module recovery', () => {
    const MODULES_ENDPOINT = '/api/v1/courses/100/modules'
    const itemsEndpoint = (moduleId: number): string =>
      `/api/v1/courses/100/modules/${String(moduleId)}/items`

    it('falls back to listItems for a module Canvas omits the items key for, instead of reporting it empty', async () => {
      const fullItems = Array.from({ length: 142 }, (_, i) => ({
        id: i + 1,
        module_id: 1,
        title: `Item ${i + 1}`,
        position: i + 1,
        type: 'Page',
        published: true,
      }))
      vi.spyOn(client, 'paginate').mockImplementation((endpoint: string) => {
        if (endpoint === MODULES_ENDPOINT) {
          return Promise.resolve([
            {
              id: 1,
              name: 'Huge Module',
              position: 1,
              items_count: 142,
              state: 'active',
              published: true,
              unlock_at: null,
              // No `items` key at all — Canvas's behavior past the 100-item cliff.
            },
          ])
        }
        if (endpoint === itemsEndpoint(1)) {
          return Promise.resolve(fullItems)
        }
        throw new Error(`unexpected paginate call: ${endpoint}`)
      })

      const result = await modules.getCourseStructure(100)

      expect(result.modules[0].items).toHaveLength(142)
      expect(result.modules[0].items_truncated).toBe(false)
      expect(result.summary.total_items).toBe(142)
      expect(result.summary.items_truncated).toBe(false)
      expect(client.paginate).toHaveBeenCalledWith(itemsEndpoint(1))
      expect(client.paginate).toHaveBeenCalledTimes(2)
    })

    it('recovers a module whose inlined items array disagrees with items_count, not just an absent key', async () => {
      const recoveredItems = [
        { id: 20, module_id: 3, title: 'A', position: 1, type: 'Page', published: true },
        { id: 21, module_id: 3, title: 'B', position: 2, type: 'Page', published: true },
      ]
      vi.spyOn(client, 'paginate').mockImplementation((endpoint: string) => {
        if (endpoint === MODULES_ENDPOINT) {
          return Promise.resolve([
            {
              id: 3,
              name: 'Stale Module',
              position: 1,
              items_count: 2,
              state: 'active',
              published: true,
              unlock_at: null,
              // `items` is present but stale/partial — length disagrees with items_count.
              items: [
                { id: 20, module_id: 3, title: 'A', position: 1, type: 'Page', published: true },
              ],
            },
          ])
        }
        if (endpoint === itemsEndpoint(3)) {
          return Promise.resolve(recoveredItems)
        }
        throw new Error(`unexpected paginate call: ${endpoint}`)
      })

      const result = await modules.getCourseStructure(100)

      expect(result.modules[0].items).toHaveLength(2)
      expect(result.modules[0].items_truncated).toBe(false)
      expect(client.paginate).toHaveBeenCalledWith(itemsEndpoint(3))
    })

    it('treats items: [] with items_count: 0 as a genuinely empty module and makes no extra request', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([
        {
          id: 2,
          name: 'Empty Module',
          position: 1,
          items_count: 0,
          state: 'active',
          published: true,
          unlock_at: null,
          items: [],
        },
      ])

      const result = await modules.getCourseStructure(100)

      expect(result.modules[0].items).toEqual([])
      expect(result.modules[0].items_truncated).toBe(false)
      expect(result.summary.total_items).toBe(0)
      expect(result.summary.items_truncated).toBe(false)
      // The only call is the modules listing — no per-module items re-read.
      expect(client.paginate).toHaveBeenCalledTimes(1)
    })

    it('caps recovery attempts and marks an unrecovered oversized module truncated, never silently empty', async () => {
      const totalModules = MAX_OVERSIZED_MODULE_RECOVERIES + 1
      const moduleFixtures = Array.from({ length: totalModules }, (_, i) => ({
        id: i + 1,
        name: `Module ${i + 1}`,
        position: i + 1,
        items_count: 101,
        state: 'active',
        published: true,
        unlock_at: null,
        // No `items` key — every module here is past the 100-item cliff.
      }))
      vi.spyOn(client, 'paginate').mockImplementation((endpoint: string) => {
        if (endpoint === MODULES_ENDPOINT) return Promise.resolve(moduleFixtures)
        return Promise.resolve([
          { id: 900, module_id: 1, title: 'Some Item', position: 1, type: 'Page', published: true },
        ])
      })

      const result = await modules.getCourseStructure(100)

      const recovered = result.modules.filter((m) => m.items !== null)
      const unrecovered = result.modules.filter((m) => m.items === null)
      expect(recovered).toHaveLength(MAX_OVERSIZED_MODULE_RECOVERIES)
      expect(unrecovered).toHaveLength(1)
      expect(unrecovered[0].items).toBeNull()
      expect(unrecovered[0].items_truncated).toBe(true)
      expect(result.summary.items_truncated).toBe(true)
      // One modules-list call plus exactly one listItems call per recovered module.
      expect(client.paginate).toHaveBeenCalledTimes(1 + MAX_OVERSIZED_MODULE_RECOVERIES)
    })
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
