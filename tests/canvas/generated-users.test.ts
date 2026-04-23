import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GeneratedUsersModule } from '../../src/canvas/generated/users-client'
import { CanvasApiError } from '../../src/canvas/client'

type FetchMock = ReturnType<typeof vi.fn>

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  })
}

describe('GeneratedUsersModule', () => {
  let fetchMock: FetchMock
  let users: GeneratedUsersModule
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    users = new GeneratedUsersModule({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function lastCallUrl(): URL {
    expect(fetchMock).toHaveBeenCalled()
    const call = fetchMock.mock.calls.at(-1)!
    const arg = call[0] as string | URL | Request
    const raw = typeof arg === 'string' ? arg : arg instanceof URL ? arg.toString() : arg.url
    return new URL(raw)
  }

  function lastCallHeaders(): Headers {
    expect(fetchMock).toHaveBeenCalled()
    const call = fetchMock.mock.calls.at(-1)!
    const arg = call[0]
    if (arg instanceof Request) return arg.headers
    const init = call[1] as RequestInit | undefined
    return new Headers(init?.headers ?? [])
  }

  describe('auth + base URL', () => {
    it('sends Bearer token and custom User-Agent on every request', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, name: 'Alice' }))
      await users.get(1)
      const headers = lastCallHeaders()
      expect(headers.get('Authorization')).toBe('Bearer test-token')
      expect(headers.get('User-Agent')).toMatch(/canvas-lms-mcp/)
    })

    it('resolves requests against the configured base URL', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1 }))
      await users.get(1)
      expect(lastCallUrl().origin).toBe('https://canvas.example.com')
      expect(lastCallUrl().pathname).toBe('/api/v1/users/1')
    })
  })

  describe('single-request endpoints', () => {
    it('gets a single user', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, name: 'Alice' }))
      const result = await users.get(1)
      expect(result).toMatchObject({ id: 1, name: 'Alice' })
      expect(lastCallUrl().pathname).toBe('/api/v1/users/1')
    })

    it('gets current user profile', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ id: 1, name: 'Alice', primary_email: 'alice@example.com' }),
      )
      const result = await users.getProfile()
      expect(result).toMatchObject({ id: 1, primary_email: 'alice@example.com' })
      expect(lastCallUrl().pathname).toBe('/api/v1/users/self/profile')
    })

    it('fetches upcoming assignments filtered by type=Assignment', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 1, title: 'HW1' }]))
      const result = await users.getUpcomingAssignments()
      expect(result).toEqual([{ id: 1, title: 'HW1' }])
      const url = lastCallUrl()
      expect(url.pathname).toBe('/api/v1/users/self/upcoming_events')
      expect(url.searchParams.get('type')).toBe('Assignment')
    })
  })

  describe('listStudents', () => {
    it('lists students for a course with enrollment_type[]=student', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ]),
      )
      const result = await users.listStudents(100)
      expect(result).toHaveLength(2)
      const url = lastCallUrl()
      expect(url.pathname).toBe('/api/v1/courses/100/users')
      expect(url.searchParams.getAll('enrollment_type[]')).toEqual(['student'])
    })
  })

  describe('searchUsers', () => {
    it('searches users in an account with just a search_term', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 1 }]))
      const result = await users.searchUsers(1, 'alice')
      expect(result).toHaveLength(1)
      const url = lastCallUrl()
      expect(url.pathname).toBe('/api/v1/accounts/1/users')
      expect(url.searchParams.get('search_term')).toBe('alice')
      expect(url.searchParams.has('sort')).toBe(false)
    })

    it('forwards sort, order, include[]', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([]))
      await users.searchUsers(1, 'alice', {
        sort: 'username',
        order: 'asc',
        include: ['email', 'last_login'],
      })
      const url = lastCallUrl()
      expect(url.searchParams.get('sort')).toBe('username')
      expect(url.searchParams.get('order')).toBe('asc')
      expect(url.searchParams.getAll('include[]')).toEqual(['email', 'last_login'])
    })
  })

  describe('listCourseUsers', () => {
    it('lists without filters', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ]),
      )
      const result = await users.listCourseUsers(100)
      expect(result).toHaveLength(2)
      const url = lastCallUrl()
      expect(url.pathname).toBe('/api/v1/courses/100/users')
      // No filter params should be sent at all
      expect(url.searchParams.has('enrollment_type[]')).toBe(false)
      expect(url.searchParams.has('include[]')).toBe(false)
      expect(url.searchParams.has('search_term')).toBe(false)
    })

    it('wraps a single-string enrollment_type as an array', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([]))
      await users.listCourseUsers(100, { enrollment_type: 'ta' })
      const url = lastCallUrl()
      expect(url.searchParams.getAll('enrollment_type[]')).toEqual(['ta'])
    })

    it('forwards include, enrollment_state, user_ids, search_term, sort, order, enrollment_role_id', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([]))
      await users.listCourseUsers(100, {
        enrollment_type: ['student'],
        enrollment_state: ['active', 'invited'],
        include: ['email', 'enrollments'],
        user_ids: [10, 'sis_user_id:abc'],
        search_term: 'alice',
        sort: 'last_login',
        order: 'desc',
        enrollment_role_id: 42,
      })
      const url = lastCallUrl()
      expect(url.searchParams.getAll('enrollment_type[]')).toEqual(['student'])
      expect(url.searchParams.getAll('enrollment_state[]')).toEqual(['active', 'invited'])
      expect(url.searchParams.getAll('include[]')).toEqual(['email', 'enrollments'])
      expect(url.searchParams.getAll('user_ids[]')).toEqual(['10', 'sis_user_id:abc'])
      expect(url.searchParams.get('search_term')).toBe('alice')
      expect(url.searchParams.get('sort')).toBe('last_login')
      expect(url.searchParams.get('order')).toBe('desc')
      expect(url.searchParams.get('enrollment_role_id')).toBe('42')
    })

    it('drops empty arrays so Canvas does not receive empty include[]', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([]))
      await users.listCourseUsers(100, {
        include: [],
        enrollment_state: [],
        user_ids: [],
      })
      const url = lastCallUrl()
      expect(url.searchParams.has('include[]')).toBe(false)
      expect(url.searchParams.has('enrollment_state[]')).toBe(false)
      expect(url.searchParams.has('user_ids[]')).toBe(false)
    })
  })

  describe('Link-header pagination', () => {
    it('follows rel="next" until exhausted and concatenates pages', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse([{ id: 1 }, { id: 2 }], {
            headers: {
              Link: '<https://canvas.example.com/api/v1/courses/100/users?page=2&per_page=100>; rel="next"',
            },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse([{ id: 3 }, { id: 4 }], {
            headers: {
              Link: '<https://canvas.example.com/api/v1/courses/100/users?page=3&per_page=100>; rel="next"',
            },
          }),
        )
        .mockResolvedValueOnce(jsonResponse([{ id: 5 }]))

      const result = await users.listCourseUsers(100)
      expect(result.map((u) => u.id)).toEqual([1, 2, 3, 4, 5])
      expect(fetchMock).toHaveBeenCalledTimes(3)

      // Each subsequent request must carry the Bearer token too
      for (const call of fetchMock.mock.calls) {
        const headers = new Headers((call[1] as RequestInit | undefined)?.headers ?? [])
        expect(headers.get('Authorization')).toBe('Bearer test-token')
      }
    })

    it('stops paginating when Link has no rel="next"', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse([{ id: 1 }], {
          headers: {
            Link: '<https://canvas.example.com/api/v1/courses/100/users?page=1>; rel="first", <https://canvas.example.com/api/v1/courses/100/users?page=1>; rel="last"',
          },
        }),
      )
      const result = await users.listCourseUsers(100)
      expect(result).toHaveLength(1)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('respects maxPaginationPages cap', async () => {
      const capped = new GeneratedUsersModule({
        token: 'test-token',
        baseUrl: 'https://canvas.example.com',
        maxPaginationPages: 2,
      })
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse([{ id: 1 }], {
            headers: {
              Link: '<https://canvas.example.com/api/v1/courses/100/users?page=2>; rel="next"',
            },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse([{ id: 2 }], {
            headers: {
              Link: '<https://canvas.example.com/api/v1/courses/100/users?page=3>; rel="next"',
            },
          }),
        )
      const result = await capped.listCourseUsers(100)
      expect(result.map((u) => u.id)).toEqual([1, 2])
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('sets per_page=100 by default on paginated endpoints', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([]))
      await users.listCourseUsers(100)
      expect(lastCallUrl().searchParams.get('per_page')).toBe('100')
    })
  })

  describe('error handling', () => {
    it('throws CanvasApiError on non-2xx with endpoint and status preserved', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ message: 'Forbidden' }] }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      await expect(users.get(99)).rejects.toMatchObject({
        name: 'CanvasApiError',
        status: 403,
        endpoint: '/api/v1/users/99',
        message: 'Forbidden',
      })
    })

    it('throws CanvasApiError with the expected message when body has no errors field', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
      await expect(users.get(99)).rejects.toBeInstanceOf(CanvasApiError)
    })
  })
})
