import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DashboardModule } from '../../src/canvas/dashboard'
import { CanvasHttpClient } from '../../src/canvas/client'

describe('DashboardModule', () => {
  let client: CanvasHttpClient
  let dashboard: DashboardModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    dashboard = new DashboardModule(client)
  })

  it('fetches dashboard cards', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 1, shortName: 'CS101' }])
    const result = await dashboard.getDashboardCards()
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/dashboard/dashboard_cards')
  })

  it('returns empty array when no dashboard cards', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
    const result = await dashboard.getDashboardCards()
    expect(result).toEqual([])
  })

  it('fetches todo items', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ type: 'submitting', context_type: 'Course' }])
    const result = await dashboard.getTodoItems()
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/users/self/todo')
  })

  it('returns empty array when no todo items', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
    const result = await dashboard.getTodoItems()
    expect(result).toEqual([])
  })

  it('fetches upcoming events', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 1, title: 'Lecture', start_at: '2026-04-20T10:00:00Z', type: 'event', context_code: 'course_1' }])
    const result = await dashboard.getUpcomingEvents()
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/users/self/upcoming_events')
  })

  it('returns empty array when no upcoming events', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
    const result = await dashboard.getUpcomingEvents()
    expect(result).toEqual([])
  })

  it('fetches missing submissions', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 10, name: 'Assignment 1', due_at: '2026-04-10T23:59:00Z', course_id: 1, points_possible: 100, submission_types: ['online_text_entry'], html_url: 'https://canvas.example.com/courses/1/assignments/10' }])
    const result = await dashboard.getMissingSubmissions()
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/users/self/missing_submissions')
  })

  it('returns empty array when no missing submissions', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
    const result = await dashboard.getMissingSubmissions()
    expect(result).toEqual([])
  })
})
