import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CanvasHttpClient, CanvasApiError } from '../../src/canvas/client'

describe('CanvasHttpClient', () => {
  let client: CanvasHttpClient

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('request', () => {
    it('sends GET with auth header and user-agent', async () => {
      const mockResponse = { id: 1, name: 'Test Course' }
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const result = await client.request<{ id: number; name: string }>('/api/v1/courses/1')

      expect(fetch).toHaveBeenCalledWith(
        'https://canvas.example.com/api/v1/courses/1',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'User-Agent': 'canvas-lms-mcp/1.0',
          }),
        }),
      )
      expect(result).toEqual(mockResponse)
    })

    it('passes through custom request options', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      )

      await client.request('/api/v1/courses', {
        method: 'POST',
        body: JSON.stringify({ name: 'New Course' }),
      })

      expect(fetch).toHaveBeenCalledWith(
        'https://canvas.example.com/api/v1/courses',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'New Course' }),
        }),
      )
    })

    it('throws if a body is passed with a GET request (no method specified)', async () => {
      await expect(
        client.request('/api/v1/courses', { body: JSON.stringify({ foo: 'bar' }) }),
      ).rejects.toThrow('GET requests must not include a body')
    })

    it('throws if a body is passed with an explicit GET method', async () => {
      await expect(
        client.request('/api/v1/courses', { method: 'GET', body: JSON.stringify({ foo: 'bar' }) }),
      ).rejects.toThrow('GET requests must not include a body')
    })

    it('throws if a body is passed with a HEAD request', async () => {
      await expect(
        client.request('/api/v1/courses', {
          method: 'HEAD',
          body: JSON.stringify({ foo: 'bar' }),
        }),
      ).rejects.toThrow('GET requests must not include a body')
    })

    it('does not throw when a body is passed with POST', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      )
      await expect(
        client.request('/api/v1/courses', { method: 'POST', body: JSON.stringify({ name: 'x' }) }),
      ).resolves.toBeDefined()
    })

    it('handles absolute URLs without prepending baseUrl', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }),
      )

      await client.request('https://other.example.com/api/v1/courses')

      expect(fetch).toHaveBeenCalledWith(
        'https://other.example.com/api/v1/courses',
        expect.anything(),
      )
    })

    it('strips trailing slashes from baseUrl', async () => {
      const slashClient = new CanvasHttpClient({
        token: 'test-token',
        baseUrl: 'https://canvas.example.com///',
      })

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 }),
      )

      await slashClient.request('/api/v1/courses/1')

      expect(fetch).toHaveBeenCalledWith(
        'https://canvas.example.com/api/v1/courses/1',
        expect.anything(),
      )
    })

    it('throws CanvasApiError on 403', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ errors: [{ message: 'Forbidden' }] }), {
          status: 403,
        }),
      )

      await expect(client.request('/api/v1/courses/1')).rejects.toThrow(CanvasApiError)
      await expect(client.request('/api/v1/courses/1')).rejects.toMatchObject({
        status: 403,
        endpoint: '/api/v1/courses/1',
      })
    })

    it('throws CanvasApiError on 404 with message field', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'The specified resource does not exist' }), {
          status: 404,
        }),
      )

      const error = await client.request('/api/v1/courses/999').catch((e) => e)
      expect(error).toBeInstanceOf(CanvasApiError)
      expect(error.status).toBe(404)
      expect(error.message).toBe('The specified resource does not exist')
    })

    it('throws CanvasApiError with fallback message on non-JSON error body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500 }),
      )

      const error = await client.request('/api/v1/courses/1').catch((e) => e)
      expect(error).toBeInstanceOf(CanvasApiError)
      expect(error.status).toBe(500)
      expect(error.message).toContain('500')
    })

    it('returns undefined for 204 No Content without throwing', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }))

      const result = await client.request('/api/v1/courses/1/peer_reviews?user_id=5', {
        method: 'DELETE',
      })
      expect(result).toBeUndefined()
    })

    it('attempts to parse body on 200 with content-length: 0', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1 }), {
          status: 200,
          headers: { 'content-length': '0' },
        }),
      )

      const result = await client.request('/api/v1/courses/1/something')
      expect(result).toEqual({ id: 1 })
    })
  })

  describe('paginate', () => {
    it('follows Link header rel="next" and merges results', async () => {
      const page1 = [{ id: 1 }, { id: 2 }]
      const page2 = [{ id: 3 }]

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify(page1), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              Link: '<https://canvas.example.com/api/v1/courses?page=2&per_page=100>; rel="next"',
            },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(page2), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )

      const result = await client.paginate<{ id: number }>('/api/v1/courses')
      expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('sets per_page=100 by default', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      await client.paginate('/api/v1/courses')

      const calledUrl = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
      expect(calledUrl).toContain('per_page=100')
    })

    it('passes custom params as query parameters', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      await client.paginate('/api/v1/courses', { enrollment_type: 'teacher' })

      const calledUrl = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
      expect(calledUrl).toContain('enrollment_type=teacher')
    })

    it('sends auth headers on paginated requests', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }),
      )

      await client.paginate('/api/v1/courses')

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      )
    })

    it('respects maxPaginationPages limit', async () => {
      const limitedClient = new CanvasHttpClient({
        token: 'test-token',
        baseUrl: 'https://canvas.example.com',
        maxPaginationPages: 1,
      })

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 1 }]), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            Link: '<https://canvas.example.com/api/v1/courses?page=2>; rel="next"',
          },
        }),
      )

      const result = await limitedClient.paginate<{ id: number }>('/api/v1/courses')
      expect(result).toEqual([{ id: 1 }])
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('throws CanvasApiError on paginated request failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ message: 'Unauthorized' }] }), {
          status: 401,
        }),
      )

      await expect(client.paginate('/api/v1/courses')).rejects.toThrow(CanvasApiError)
    })

    it('returns empty array when no results', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const result = await client.paginate('/api/v1/courses')
      expect(result).toEqual([])
    })
  })

  describe('paginateEnvelope', () => {
    it('extracts array from envelope key', async () => {
      const response = { quiz_submissions: [{ id: 1 }, { id: 2 }] }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const result = await client.paginateEnvelope<{ id: number }>(
        '/api/v1/quizzes/1/submissions',
        'quiz_submissions',
      )
      expect(result).toEqual([{ id: 1 }, { id: 2 }])
    })

    it('follows pagination with envelope responses', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ items: [{ id: 1 }] }), {
            status: 200,
            headers: {
              Link: '<https://canvas.example.com/api/v1/items?page=2&per_page=100>; rel="next"',
            },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ items: [{ id: 2 }] }), {
            status: 200,
          }),
        )

      const result = await client.paginateEnvelope<{ id: number }>('/api/v1/items', 'items')
      expect(result).toEqual([{ id: 1 }, { id: 2 }])
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('returns empty array when envelope key is missing', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ other_key: [{ id: 1 }] }), {
          status: 200,
        }),
      )

      const result = await client.paginateEnvelope<{ id: number }>(
        '/api/v1/quizzes/1/submissions',
        'quiz_submissions',
      )
      expect(result).toEqual([])
    })

    it('throws CanvasApiError on envelope request failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }),
      )

      await expect(
        client.paginateEnvelope('/api/v1/quizzes/999/submissions', 'quiz_submissions'),
      ).rejects.toThrow(CanvasApiError)
    })
  })

  describe('CanvasApiError', () => {
    it('has correct name, status, and endpoint properties', () => {
      const error = new CanvasApiError('Forbidden', 403, '/api/v1/courses/1')
      expect(error.name).toBe('CanvasApiError')
      expect(error.message).toBe('Forbidden')
      expect(error.status).toBe(403)
      expect(error.endpoint).toBe('/api/v1/courses/1')
      expect(error).toBeInstanceOf(Error)
    })
  })
})
