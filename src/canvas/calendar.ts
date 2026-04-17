import type { CanvasHttpClient } from './client'
import type { CanvasCalendarEvent } from './types'

export class CalendarModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: number): Promise<CanvasCalendarEvent[]> {
    return this.client.paginate<CanvasCalendarEvent>('/api/v1/calendar_events', {
      'context_codes[]': `course_${courseId}`,
    })
  }

  async createEvent(params: {
    context_code: string
    title: string
    start_at: string
    end_at?: string
    description?: string
    location_name?: string
  }): Promise<CanvasCalendarEvent> {
    return this.client.request<CanvasCalendarEvent>('/api/v1/calendar_events', {
      method: 'POST',
      body: JSON.stringify({ calendar_event: params }),
    })
  }

  async updateEvent(
    eventId: number,
    params: {
      title?: string
      start_at?: string
      end_at?: string
      description?: string
      location_name?: string
    },
  ): Promise<CanvasCalendarEvent> {
    return this.client.request<CanvasCalendarEvent>(`/api/v1/calendar_events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify({ calendar_event: params }),
    })
  }
}
