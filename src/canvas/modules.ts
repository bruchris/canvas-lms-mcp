import type { CanvasHttpClient } from './client'
import type { CanvasModule, CanvasModuleItem } from './types'

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
}
