import { describe, it, expect, vi, afterEach } from 'vitest'
import { PlannerModule } from '../../src/canvas/planner'
import { CanvasHttpClient } from '../../src/canvas/client'

describe('PlannerModule', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function buildClient(): CanvasHttpClient {
    return new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
  }

  function page(items: unknown[], nextUrl?: string): Response {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (nextUrl) headers.Link = `<${nextUrl}>; rel="next"`
    return new Response(JSON.stringify(items), { status: 200, headers })
  }

  function plannerItems(from: number, count: number): unknown[] {
    return Array.from({ length: count }, (_, i) => ({
      context_type: 'Course',
      course_id: 101,
      plannable_id: from + i,
      plannable_type: 'assignment',
      planner_override: null,
      submissions: false,
      new_activity: false,
      plannable_date: '2026-10-10T00:00:00Z',
      plannable: { id: from + i, title: 'x', course_id: 101 },
      html_url: 'https://canvas.example.com/x',
    }))
  }

  it('requests the planner endpoint with per_page=100 (paginate, not request)', async () => {
    // `Api.paginate(items, self, …)` sets no default_per_page, so Canvas falls
    // back to Api::PER_PAGE = 10 absent an explicit per_page param. Switching
    // listItems to request() would drop per_page from the URL and make this
    // assertion fail.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(page([]))
    const planner = new PlannerModule(buildClient())

    await planner.listItems()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const calledUrl = fetchSpy.mock.calls[0][0] as string
    expect(calledUrl).toBe('https://canvas.example.com/api/v1/planner/items?per_page=100')
  })

  it('serializes start_date, end_date and filter on the wire', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(page([]))
    const planner = new PlannerModule(buildClient())

    await planner.listItems({
      startDate: '2026-10-01',
      endDate: '2026-10-15',
      filter: 'incomplete_items',
    })

    const calledUrl = fetchSpy.mock.calls[0][0] as string
    expect(calledUrl).toContain('start_date=2026-10-01')
    expect(calledUrl).toContain('end_date=2026-10-15')
    expect(calledUrl).toContain('filter=incomplete_items')
  })

  it('serializes context_codes in bracket form via appendCanvasQuery', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(page([]))
    const planner = new PlannerModule(buildClient())

    await planner.listItems({ contextCodes: ['course_123', 'group_7'] })

    const calledUrl = fetchSpy.mock.calls[0][0] as string
    const parsed = new URL(calledUrl)
    expect(parsed.searchParams.getAll('context_codes[]')).toEqual(['course_123', 'group_7'])
  })

  it('omits context_codes, start_date, end_date and filter when not passed', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(page([]))
    const planner = new PlannerModule(buildClient())

    await planner.listItems()

    const calledUrl = fetchSpy.mock.calls[0][0] as string
    for (const absent of ['context_codes', 'start_date', 'end_date', 'filter']) {
      expect(calledUrl).not.toContain(absent)
    }
  })

  it('follows Link rel="next" across pages', async () => {
    const next = 'https://canvas.example.com/api/v1/planner/items?page=2&per_page=100'
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(page(plannerItems(1, 100), next))
      .mockResolvedValueOnce(page(plannerItems(101, 10)))
    const planner = new PlannerModule(buildClient())

    const result = await planner.listItems()

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[1][0]).toBe(next)
    expect(result).toHaveLength(110)
  })

  it('stops following Link once maxItems is reached, bounding the FETCHES not just the result', async () => {
    const p2 = 'https://canvas.example.com/api/v1/planner/items?page=2&per_page=100'
    const p3 = 'https://canvas.example.com/api/v1/planner/items?page=3&per_page=100'
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(page(plannerItems(1, 100), p2))
      .mockResolvedValueOnce(page(plannerItems(101, 100), p3))
      .mockResolvedValueOnce(page(plannerItems(201, 50)))
    const planner = new PlannerModule(buildClient())

    const result = await planner.listItems({ maxItems: 150 })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(150)
  })

  it('does not throw assertNotTruncated on a deliberate maxItems stop', async () => {
    const p2 = 'https://canvas.example.com/api/v1/planner/items?page=2&per_page=100'
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(page(plannerItems(1, 100), p2))
    const planner = new PlannerModule(buildClient())

    await expect(planner.listItems({ maxItems: 100 })).resolves.toHaveLength(100)
  })

  it('normalizes identifiers to canonical strings at the HTTP boundary', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      page([
        {
          context_type: 'Group',
          group_id: 7,
          plannable_id: 401,
          plannable_type: 'planner_note',
          planner_override: null,
          submissions: false,
          new_activity: false,
          plannable_date: '2026-10-08T00:00:00Z',
          plannable: { id: 401, user_id: 55 },
        },
      ]),
    )
    const planner = new PlannerModule(buildClient())

    const [item] = await planner.listItems()

    expect(item!.group_id).toBe('7')
    expect(item!.plannable_id).toBe('401')
    expect((item!.plannable as { id: string }).id).toBe('401')
  })
})
