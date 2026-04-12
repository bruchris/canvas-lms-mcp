import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasCalendarEvent } from '../../src/canvas/types'
import { calendarTools } from '../../src/tools/calendar'

describe('calendarTools', () => {
  const mockEvent: CanvasCalendarEvent = {
    id: 1,
    title: 'Office Hours',
    description: '<p>Weekly office hours</p>',
    start_at: '2026-04-15T14:00:00Z',
    end_at: '2026-04-15T15:00:00Z',
    workflow_state: 'active',
    context_code: 'course_1',
    all_day: false,
    location_name: null,
  }

  function buildMockCanvas(): CanvasClient {
    return {
      calendar: {
        list: vi.fn().mockResolvedValue([mockEvent]),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 1 tool definition', () => {
    expect(calendarTools(buildMockCanvas())).toHaveLength(1)
  })

  it('exports tools with correct names', () => {
    const names = calendarTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual(['list_calendar_events'])
  })

  describe('list_calendar_events', () => {
    it('has read-only annotations', () => {
      const tool = calendarTools(buildMockCanvas()).find((t) => t.name === 'list_calendar_events')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.calendar.list', async () => {
      const canvas = buildMockCanvas()
      const tool = calendarTools(canvas).find((t) => t.name === 'list_calendar_events')!
      const result = await tool.handler({ course_id: 1 })
      expect(canvas.calendar.list).toHaveBeenCalledWith(1)
      expect(result).toEqual([mockEvent])
    })
  })
})
