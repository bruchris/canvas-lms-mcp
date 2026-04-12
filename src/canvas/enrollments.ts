import type { CanvasHttpClient } from './client'
import type { CanvasEnrollment } from './types'

export class EnrollmentsModule {
  constructor(private client: CanvasHttpClient) {}

  async list(): Promise<CanvasEnrollment[]> {
    return this.client.paginate<CanvasEnrollment>('/api/v1/users/self/enrollments')
  }
}
