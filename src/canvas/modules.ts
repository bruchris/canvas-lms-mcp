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
}
