import type { CanvasHttpClient } from './client'
import type { CanvasDashboardCard, CanvasTodoItem, CanvasUpcomingEvent, CanvasMissingSubmission } from './types'

export class DashboardModule {
  constructor(private client: CanvasHttpClient) {}

  async getDashboardCards(): Promise<CanvasDashboardCard[]> {
    return this.client.paginate<CanvasDashboardCard>('/api/v1/dashboard/dashboard_cards')
  }

  async getTodoItems(): Promise<CanvasTodoItem[]> {
    return this.client.paginate<CanvasTodoItem>('/api/v1/users/self/todo')
  }

  async getUpcomingEvents(): Promise<CanvasUpcomingEvent[]> {
    return this.client.paginate<CanvasUpcomingEvent>('/api/v1/users/self/upcoming_events')
  }

  async getMissingSubmissions(): Promise<CanvasMissingSubmission[]> {
    return this.client.paginate<CanvasMissingSubmission>('/api/v1/users/self/missing_submissions')
  }
}
