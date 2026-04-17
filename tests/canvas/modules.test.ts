import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ModulesModule } from '../../src/canvas/modules'
import { CanvasHttpClient } from '../../src/canvas/client'

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
      body: JSON.stringify({ module_item: { title: 'Assignment 1', type: 'Assignment', content_id: 42 } }),
    })
  })
})
