import { describe, it, expect, vi, afterEach } from 'vitest'
import { ActivityStreamModule } from '../../src/canvas/activity-stream'
import { CanvasHttpClient } from '../../src/canvas/client'

describe('ActivityStreamModule', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function buildClient(): CanvasHttpClient {
    return new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
  }

  describe('getSummary', () => {
    it('requests the summary endpoint with no per_page parameter (AC-1)', async () => {
      // The summary endpoint is the one stream endpoint Canvas does not
      // paginate (api_render_stream_summary has no Api.paginate call). A
      // request() call never adds per_page, unlike paginate() which always
      // sets per_page=100 — asserting the exact URL proves this module uses
      // request(), not paginate(). Switching getSummary to
      // `this.client.paginate(...)` makes this assertion fail because the
      // fetched URL would gain `?per_page=100`.
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      const client = buildClient()
      const activityStream = new ActivityStreamModule(client)

      await activityStream.getSummary()

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const calledUrl = fetchSpy.mock.calls[0][0] as string
      expect(calledUrl).toBe('https://canvas.example.com/api/v1/users/self/activity_stream/summary')
      expect(calledUrl).not.toContain('per_page')
    })

    it('sends only_active_courses=true on the wire when passed (AC-2)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      const client = buildClient()
      const activityStream = new ActivityStreamModule(client)

      await activityStream.getSummary(true)

      const calledUrl = fetchSpy.mock.calls[0][0] as string
      expect(calledUrl).toBe(
        'https://canvas.example.com/api/v1/users/self/activity_stream/summary?only_active_courses=true',
      )
    })

    it('sends no only_active_courses parameter when omitted (AC-2)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      const client = buildClient()
      const activityStream = new ActivityStreamModule(client)

      await activityStream.getSummary()

      const calledUrl = fetchSpy.mock.calls[0][0] as string
      expect(calledUrl).not.toContain('only_active_courses')
    })

    it('returns the parsed summary entries', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { type: 'Submission', count: 5, unread_count: 2 },
            { type: 'DiscussionTopic', count: 3, unread_count: 0 },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      const client = buildClient()
      const activityStream = new ActivityStreamModule(client)

      const result = await activityStream.getSummary()

      expect(result).toEqual([
        { type: 'Submission', count: 5, unread_count: 2 },
        { type: 'DiscussionTopic', count: 3, unread_count: 0 },
      ])
    })
  })
})
