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

  describe('getStream', () => {
    function page(items: unknown[], nextUrl?: string): Response {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (nextUrl) headers.Link = `<${nextUrl}>; rel="next"`
      return new Response(JSON.stringify(items), { status: 200, headers })
    }

    function streamItems(from: number, count: number): unknown[] {
      return Array.from({ length: count }, (_, i) => ({
        id: from + i,
        created_at: '2026-10-01T08:00:00Z',
        updated_at: '2026-10-01T08:00:00Z',
        title: null,
        message: null,
        type: 'ContextMessage',
        read_state: true,
        context_type: 'Course',
        course_id: 101,
      }))
    }

    it('requests the stream endpoint with per_page=100 (paginate, not request)', async () => {
      // The inverse of AC-1 above, and deliberately not a copy of it. Canvas
      // renders this endpoint through `Api.paginate(scope, self, …,
      // default_per_page: 21)`, so a `request()`-based implementation would
      // return 21 items with no error and no Link header followed. Switching
      // getStream to `this.client.request(...)` makes this assertion fail
      // because the fetched URL would lose `per_page=100`.
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(page([]))
      const activityStream = new ActivityStreamModule(buildClient())

      await activityStream.getStream()

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const calledUrl = fetchSpy.mock.calls[0][0] as string
      expect(calledUrl).toBe(
        'https://canvas.example.com/api/v1/users/self/activity_stream?per_page=100',
      )
    })

    it('sends only_active_courses=true when passed and omits it otherwise', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(page([]))
        .mockResolvedValueOnce(page([]))
      const activityStream = new ActivityStreamModule(buildClient())

      await activityStream.getStream({ onlyActiveCourses: true })
      await activityStream.getStream()

      expect(fetchSpy.mock.calls[0][0]).toContain('only_active_courses=true')
      expect(fetchSpy.mock.calls[1][0]).not.toContain('only_active_courses')
    })

    it('follows Link rel="next" across pages', async () => {
      const next =
        'https://canvas.example.com/api/v1/users/self/activity_stream?page=2&per_page=100'
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(page(streamItems(1, 100), next))
        .mockResolvedValueOnce(page(streamItems(101, 10)))
      const activityStream = new ActivityStreamModule(buildClient())

      const result = await activityStream.getStream()

      expect(fetchSpy).toHaveBeenCalledTimes(2)
      expect(fetchSpy.mock.calls[1][0]).toBe(next)
      expect(result).toHaveLength(110)
    })

    it('stops following Link once maxItems is reached, and bounds the FETCHES not just the result', async () => {
      // An output cap bounds the result, never the work. Asserting the fetch
      // count is what distinguishes a real early exit from a post-hoc slice:
      // without the maxItems stop, all three pages would be fetched and a
      // length-only assertion would still pass.
      const p2 = 'https://canvas.example.com/api/v1/users/self/activity_stream?page=2&per_page=100'
      const p3 = 'https://canvas.example.com/api/v1/users/self/activity_stream?page=3&per_page=100'
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(page(streamItems(1, 100), p2))
        .mockResolvedValueOnce(page(streamItems(101, 100), p3))
        .mockResolvedValueOnce(page(streamItems(201, 50)))
      const activityStream = new ActivityStreamModule(buildClient())

      const result = await activityStream.getStream({ maxItems: 150 })

      expect(fetchSpy).toHaveBeenCalledTimes(2)
      expect(result).toHaveLength(150)
    })

    it('does not throw assertNotTruncated on a deliberate maxItems stop', async () => {
      // The stop leaves a non-null nextUrl on purpose, which is exactly the
      // state assertNotTruncated exists to reject for the page-cap case.
      const p2 = 'https://canvas.example.com/api/v1/users/self/activity_stream?page=2&per_page=100'
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(page(streamItems(1, 100), p2))
      const activityStream = new ActivityStreamModule(buildClient())

      await expect(activityStream.getStream({ maxItems: 100 })).resolves.toHaveLength(100)
    })

    it('normalizes identifiers to canonical strings at the HTTP boundary', async () => {
      // Every fixture in tests/fixtures/activity-stream.ts uses string ids
      // because of this: `normalizeCanvasIds` converts `(^|_)id$` and
      // `(^|_)ids$` keys on the way in, so numeric ids are a shape no
      // downstream code ever sees.
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        page([
          {
            id: 9001,
            type: 'Conversation',
            conversation_id: 2001,
            latest_messages: [{ id: 5001, author_id: 9, participating_user_ids: [42, 9] }],
          },
        ]),
      )
      const activityStream = new ActivityStreamModule(buildClient())

      const [item] = await activityStream.getStream()

      expect(item!.id).toBe('9001')
      expect(item!.conversation_id).toBe('2001')
      expect(item!.latest_messages![0]!.author_id).toBe('9')
      expect(item!.latest_messages![0]!.participating_user_ids).toEqual(['42', '9'])
    })
  })
})
