import type { CanvasHttpClient } from './client'
import type { CalendarEventType } from './calendar'
import type {
  CanvasDashboardCard,
  CanvasTodoItem,
  CanvasUpcomingEvent,
  CanvasMissingSubmission,
} from './types'

export interface GetUpcomingEventsOptions {
  type?: CalendarEventType
}

export class DashboardModule {
  constructor(private client: CanvasHttpClient) {}

  async getDashboardCards(): Promise<CanvasDashboardCard[]> {
    return this.client.request<CanvasDashboardCard[]>('/api/v1/dashboard/dashboard_cards')
  }

  async getTodoItems(): Promise<CanvasTodoItem[]> {
    return this.client.paginate<CanvasTodoItem>('/api/v1/users/self/todo')
  }

  // Canvas's upcoming_events endpoint ignores query params entirely (it calls
  // user.upcoming_events with only context_codes) and always returns a mix of calendar
  // events, assignments, and sub-assignments. Each item's own `type` field
  // ("event" | "assignment" | "sub_assignment", set server-side in
  // assignment_event_json/sub_assignment_event_json/calendar_event_json) is the only
  // reliable discriminator, so `type` here filters client-side instead — see
  // UsersModule.getUpcomingAssignments, which does the same for the assignment-only case.
  async getUpcomingEvents(opts: GetUpcomingEventsOptions = {}): Promise<CanvasUpcomingEvent[]> {
    const events = await this.client.request<CanvasUpcomingEvent[]>(
      '/api/v1/users/self/upcoming_events',
    )
    if (!opts.type) return events
    return events.filter((event) => event.type === opts.type)
  }

  async getMissingSubmissions(): Promise<CanvasMissingSubmission[]> {
    return this.client.paginate<CanvasMissingSubmission>('/api/v1/users/self/missing_submissions')
  }
}
