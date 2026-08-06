import type { CanvasHttpClient } from './client'
import type { CanvasQueryParams } from './query'
import type { CanvasCalendarEvent } from './types'

export type CalendarEventType = 'event' | 'assignment' | 'sub_assignment'

export interface ListCalendarEventsOptions {
  type?: CalendarEventType
  start_date?: string
  end_date?: string
}

export class CalendarModule {
  constructor(private client: CanvasHttpClient) {}

  async list(
    courseId: number,
    opts: ListCalendarEventsOptions = {},
  ): Promise<CanvasCalendarEvent[]> {
    const params: CanvasQueryParams = {
      'context_codes[]': `course_${courseId}`,
    }
    if (opts.type) params.type = opts.type
    if (opts.start_date) params.start_date = opts.start_date
    if (opts.end_date) params.end_date = opts.end_date
    return this.client.paginate<CanvasCalendarEvent>('/api/v1/calendar_events', params)
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
