import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CalendarModule } from '../../src/canvas/calendar'
import { CanvasHttpClient } from '../../src/canvas/client'

describe('CalendarModule', () => {
  let client: CanvasHttpClient
  let calendar: CalendarModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    calendar = new CalendarModule(client)
  })

  it('lists calendar events for a course', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      {
        id: 1,
        title: 'Lecture',
        start_at: '2026-04-15T10:00:00Z',
        end_at: '2026-04-15T11:00:00Z',
        type: 'event',
        context_code: 'course_100',
      },
    ])
    const result = await calendar.list(100)
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/calendar_events', {
      'context_codes[]': 'course_100',
    })
  })

  it('returns empty array when no events', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
    const result = await calendar.list(100)
    expect(result).toEqual([])
  })

  describe('createEvent', () => {
    it('POSTs to /api/v1/calendar_events with wrapped params', async () => {
      const created = {
        id: 5,
        title: 'Office Hours',
        start_at: '2026-05-01T14:00:00Z',
        end_at: '2026-05-01T15:00:00Z',
        context_code: 'course_100',
        workflow_state: 'active',
      }
      vi.spyOn(client, 'request').mockResolvedValueOnce(created)

      const result = await calendar.createEvent({
        context_code: 'course_100',
        title: 'Office Hours',
        start_at: '2026-05-01T14:00:00Z',
        end_at: '2026-05-01T15:00:00Z',
      })

      expect(client.request).toHaveBeenCalledWith('/api/v1/calendar_events', {
        method: 'POST',
        body: JSON.stringify({
          calendar_event: {
            context_code: 'course_100',
            title: 'Office Hours',
            start_at: '2026-05-01T14:00:00Z',
            end_at: '2026-05-01T15:00:00Z',
          },
        }),
      })
      expect(result).toMatchObject({ id: 5, title: 'Office Hours' })
    })

    it('includes optional fields when provided', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({ id: 6, title: 'Exam', start_at: '2026-05-10T09:00:00Z', end_at: null, context_code: 'course_1' })

      await calendar.createEvent({
        context_code: 'course_1',
        title: 'Exam',
        start_at: '2026-05-10T09:00:00Z',
        description: '<p>Midterm exam</p>',
        location_name: 'Room 101',
      })

      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/calendar_events',
        expect.objectContaining({
          body: expect.stringContaining('Room 101'),
        }),
      )
    })
  })

  describe('updateEvent', () => {
    it('PUTs to /api/v1/calendar_events/:id with wrapped params', async () => {
      const updated = {
        id: 5,
        title: 'Office Hours (Updated)',
        start_at: '2026-05-01T15:00:00Z',
        end_at: '2026-05-01T16:00:00Z',
        context_code: 'course_100',
      }
      vi.spyOn(client, 'request').mockResolvedValueOnce(updated)

      const result = await calendar.updateEvent(5, {
        title: 'Office Hours (Updated)',
        start_at: '2026-05-01T15:00:00Z',
        end_at: '2026-05-01T16:00:00Z',
      })

      expect(client.request).toHaveBeenCalledWith('/api/v1/calendar_events/5', {
        method: 'PUT',
        body: JSON.stringify({
          calendar_event: {
            title: 'Office Hours (Updated)',
            start_at: '2026-05-01T15:00:00Z',
            end_at: '2026-05-01T16:00:00Z',
          },
        }),
      })
      expect(result).toMatchObject({ id: 5, title: 'Office Hours (Updated)' })
    })
  })
})
