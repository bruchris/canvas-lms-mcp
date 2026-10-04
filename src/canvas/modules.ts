import type { CanvasHttpClient } from './client'
import type { CanvasModule, CanvasModuleItem, CanvasCourseStructure } from './types'

export interface CreateModuleItemParams {
  title: string
  type: string
  content_id?: number
  /** Page slug — Page items are addressed by URL slug, not by `content_id`. */
  page_url?: string
  external_url?: string
  position?: number
  indent?: number
  new_tab?: boolean
}

export interface UpdateModuleItemParams {
  title?: string
  external_url?: string
  position?: number
  indent?: number
  new_tab?: boolean
  published?: boolean
  /** Move the item to a different module. */
  module_id?: number
}

export class ModulesModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: number): Promise<CanvasModule[]> {
    return this.client.paginate<CanvasModule>(`/api/v1/courses/${courseId}/modules`)
  }

  /**
   * List a course's modules with each module's items inlined via `include[]=items`.
   * Unlike `getCourseStructure`, this returns the raw Canvas shapes (including the
   * `published` state on every module and item, even unpublished ones), which the
   * course-setup health check needs to detect unpublished content.
   */
  async listWithItems(
    courseId: number,
  ): Promise<(CanvasModule & { items?: CanvasModuleItem[] })[]> {
    return this.client.paginate<CanvasModule & { items?: CanvasModuleItem[] }>(
      `/api/v1/courses/${courseId}/modules`,
      { include: ['items'] },
    )
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
    params: CreateModuleItemParams,
  ): Promise<CanvasModuleItem> {
    return this.client.request<CanvasModuleItem>(
      `/api/v1/courses/${courseId}/modules/${moduleId}/items`,
      {
        method: 'POST',
        body: JSON.stringify({ module_item: params }),
      },
    )
  }

  async updateItem(
    courseId: number,
    moduleId: number,
    itemId: number,
    params: UpdateModuleItemParams,
  ): Promise<CanvasModuleItem> {
    return this.client.request<CanvasModuleItem>(
      `/api/v1/courses/${courseId}/modules/${moduleId}/items/${itemId}`,
      {
        method: 'PUT',
        body: JSON.stringify({ module_item: params }),
      },
    )
  }

  /** Canvas answers a module-item DELETE with the deleted item's body. */
  async deleteItem(courseId: number, moduleId: number, itemId: number): Promise<CanvasModuleItem> {
    return this.client.request<CanvasModuleItem>(
      `/api/v1/courses/${courseId}/modules/${moduleId}/items/${itemId}`,
      { method: 'DELETE' },
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
