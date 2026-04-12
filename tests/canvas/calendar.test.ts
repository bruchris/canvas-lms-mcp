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
      { id: 1, title: 'Lecture', start_at: '2026-04-15T10:00:00Z', end_at: '2026-04-15T11:00:00Z', type: 'event', context_code: 'course_100' },
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
})
