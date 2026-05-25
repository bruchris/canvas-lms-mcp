import type { CanvasHttpClient } from './client'
import type { CanvasModule, CanvasModuleItem, CanvasCourseStructure } from './types'

export class ModulesModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: number): Promise<CanvasModule[]> {
    return this.client.paginate<CanvasModule>(`/api/v1/courses/${courseId}/modules`)
  }

  async get(courseId: number, moduleId: number): Promise<CanvasModule> {
    return this.client.request<CanvasModule>(`/api/v1/courses/${courseId}/modules/${moduleId}`)
  }

  async listItems(courseId: number, moduleId: number): Promise<CanvasModuleItem[]> {
    return this.client.paginate<CanvasModuleItem>(
      `/api/v1/courses/${courseId}/modules/${moduleId}/items`,
    )
  }

  async create(
    courseId: number,
    params: {
      name: string
      position?: number
      unlock_at?: string
      prerequisite_module_ids?: number[]
    },
  ): Promise<CanvasModule> {
    return this.client.request<CanvasModule>(`/api/v1/courses/${courseId}/modules`, {
      method: 'POST',
      body: JSON.stringify({ module: params }),
    })
  }

  async update(
    courseId: number,
    moduleId: number,
    params: { name?: string; position?: number; published?: boolean },
  ): Promise<CanvasModule> {
    return this.client.request<CanvasModule>(`/api/v1/courses/${courseId}/modules/${moduleId}`, {
      method: 'PUT',
      body: JSON.stringify({ module: params }),
    })
  }

  async createItem(
    courseId: number,
    moduleId: number,
    params: {
      title: string
      type: string
      content_id?: number
      external_url?: string
      position?: number
    },
  ): Promise<CanvasModuleItem> {
    return this.client.request<CanvasModuleItem>(
      `/api/v1/courses/${courseId}/modules/${moduleId}/items`,
      {
        method: 'POST',
        body: JSON.stringify({ module_item: params }),
      },
    )
  }

  async getCourseStructure(
    courseId: number,
    opts: { includePublishedOnly?: boolean; includeContentDetails?: boolean } = {},
  ): Promise<CanvasCourseStructure> {
    const include: string[] = ['items']
    if (opts.includeContentDetails) include.push('content_details')

    const modules = await this.client.paginate<CanvasModule & { items?: CanvasModuleItem[] }>(
      `/api/v1/courses/${courseId}/modules`,
      { include },
    )

    const itemsByType: Record<string, number> = {}
    let totalItems = 0

    const filteredModules = modules.map((mod) => {
      let items = mod.items ?? []
      if (opts.includePublishedOnly) {
        items = items.filter((item) => item.published)
      }
      for (const item of items) {
        itemsByType[item.type] = (itemsByType[item.type] ?? 0) + 1
        totalItems++
      }
      return {
        id: mod.id,
        name: mod.name,
        position: mod.position,
        state: mod.state ?? (mod.published ? 'active' : 'unpublished'),
        unlock_at: mod.unlock_at,
        items: items.map((item) => ({
          id: item.id,
          title: item.title,
          type: item.type,
          position: item.position,
          published: item.published,
          html_url: item.html_url,
          page_url: item.page_url,
          content_id: item.content_id,
          content_details: item.content_details,
        })),
      }
    })

    return {
      modules: filteredModules,
      summary: {
        total_modules: filteredModules.length,
        total_items: totalItems,
        items_by_type: itemsByType,
      },
    }
  }
}
