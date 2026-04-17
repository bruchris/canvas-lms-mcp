import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { dashboardTools } from '../../src/tools/dashboard'

describe('dashboardTools', () => {
  function buildMockCanvas(): CanvasClient {
    return {
      dashboard: {
        getDashboardCards: vi.fn().mockResolvedValue([]),
        getTodoItems: vi.fn().mockResolvedValue([]),
        getUpcomingEvents: vi.fn().mockResolvedValue([]),
        getMissingSubmissions: vi.fn().mockResolvedValue([]),
      },
    } as unknown as CanvasClient
  }

  it('returns 4 tool definitions', () => {
    expect(dashboardTools(buildMockCanvas())).toHaveLength(4)
  })

  it('exports tools with correct names', () => {
    const names = dashboardTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'get_dashboard_cards',
      'get_todo_items',
      'get_upcoming_events',
      'get_missing_submissions',
    ])
  })

  it('all tools have readOnlyHint: true and openWorldHint: true', () => {
    const tools = dashboardTools(buildMockCanvas())
    for (const tool of tools) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    }
  })

  describe('get_dashboard_cards', () => {
    it('delegates to canvas.dashboard.getDashboardCards', async () => {
      const canvas = buildMockCanvas()
      const tool = dashboardTools(canvas).find((t) => t.name === 'get_dashboard_cards')!
      await tool.handler({})
      expect(canvas.dashboard.getDashboardCards).toHaveBeenCalled()
    })
  })

  describe('get_todo_items', () => {
    it('delegates to canvas.dashboard.getTodoItems', async () => {
      const canvas = buildMockCanvas()
      const tool = dashboardTools(canvas).find((t) => t.name === 'get_todo_items')!
      await tool.handler({})
      expect(canvas.dashboard.getTodoItems).toHaveBeenCalled()
    })
  })

  describe('get_upcoming_events', () => {
    it('delegates to canvas.dashboard.getUpcomingEvents', async () => {
      const canvas = buildMockCanvas()
      const tool = dashboardTools(canvas).find((t) => t.name === 'get_upcoming_events')!
      await tool.handler({})
      expect(canvas.dashboard.getUpcomingEvents).toHaveBeenCalled()
    })
  })

  describe('get_missing_submissions', () => {
    it('delegates to canvas.dashboard.getMissingSubmissions', async () => {
      const canvas = buildMockCanvas()
      const tool = dashboardTools(canvas).find((t) => t.name === 'get_missing_submissions')!
      await tool.handler({})
      expect(canvas.dashboard.getMissingSubmissions).toHaveBeenCalled()
    })
  })
})
