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
        createEvent: vi.fn().mockResolvedValue(mockEvent),
        updateEvent: vi.fn().mockResolvedValue(mockEvent),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 3 tool definitions', () => {
    expect(calendarTools(buildMockCanvas())).toHaveLength(3)
  })

  it('exports tools with correct names', () => {
    const names = calendarTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'list_calendar_events',
      'create_calendar_event',
      'update_calendar_event',
    ])
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

  describe('create_calendar_event', () => {
    it('has destructive annotations', () => {
      const tool = calendarTools(buildMockCanvas()).find((t) => t.name === 'create_calendar_event')!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.calendar.createEvent with required params', async () => {
      const canvas = buildMockCanvas()
      const tool = calendarTools(canvas).find((t) => t.name === 'create_calendar_event')!
      const result = await tool.handler({
        context_code: 'course_1',
        title: 'Office Hours',
        start_at: '2026-04-15T14:00:00Z',
        end_at: '2026-04-15T15:00:00Z',
      })
      expect(canvas.calendar.createEvent).toHaveBeenCalledWith({
        context_code: 'course_1',
        title: 'Office Hours',
        start_at: '2026-04-15T14:00:00Z',
        end_at: '2026-04-15T15:00:00Z',
        description: undefined,
        location_name: undefined,
      })
      expect(result).toEqual(mockEvent)
    })

    it('passes optional fields when provided', async () => {
      const canvas = buildMockCanvas()
      const tool = calendarTools(canvas).find((t) => t.name === 'create_calendar_event')!
      await tool.handler({
        context_code: 'course_1',
        title: 'Exam',
        start_at: '2026-05-10T09:00:00Z',
        description: '<p>Final</p>',
        location_name: 'Auditorium',
      })
      expect(canvas.calendar.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          description: '<p>Final</p>',
          location_name: 'Auditorium',
        }),
      )
    })
  })

  describe('update_calendar_event', () => {
    it('has destructive annotations', () => {
      const tool = calendarTools(buildMockCanvas()).find((t) => t.name === 'update_calendar_event')!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.calendar.updateEvent', async () => {
      const canvas = buildMockCanvas()
      const tool = calendarTools(canvas).find((t) => t.name === 'update_calendar_event')!
      const result = await tool.handler({
        event_id: 1,
        title: 'Updated Title',
        start_at: '2026-04-16T10:00:00Z',
      })
      expect(canvas.calendar.updateEvent).toHaveBeenCalledWith(1, {
        title: 'Updated Title',
        start_at: '2026-04-16T10:00:00Z',
        end_at: undefined,
        description: undefined,
        location_name: undefined,
      })
      expect(result).toEqual(mockEvent)
    })
  })
})
