import type { CanvasHttpClient } from './client'
import type { CanvasCalendarEvent } from './types'

export class CalendarModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: number): Promise<CanvasCalendarEvent[]> {
    return this.client.paginate<CanvasCalendarEvent>(
      '/api/v1/calendar_events',
      { 'context_codes[]': `course_${courseId}` },
    )
  }
}
