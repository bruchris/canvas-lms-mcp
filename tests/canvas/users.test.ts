import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UsersModule } from '../../src/canvas/users'
import { CanvasHttpClient } from '../../src/canvas/client'

describe('UsersModule', () => {
  let client: CanvasHttpClient
  let users: UsersModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    users = new UsersModule(client)
  })

  it('lists students for a course', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ])
    const result = await users.listStudents(100)
    expect(result).toHaveLength(2)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/users', {
      'enrollment_type[]': 'student',
    })
  })

  it('gets a single user', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ id: 1, name: 'Alice' })
    const result = await users.get(1)
    expect(result).toMatchObject({ id: 1, name: 'Alice' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/users/1')
  })

  it('gets current user profile', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      id: 1,
      name: 'Alice',
      primary_email: 'alice@example.com',
      login_id: 'alice',
      avatar_url: 'https://example.com/avatar.png',
      time_zone: 'America/New_York',
      locale: 'en',
    })
    const result = await users.getProfile()
    expect(result).toMatchObject({ id: 1, name: 'Alice' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/users/self/profile')
  })

  it('searches users in an account', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 1, name: 'Alice' }])
    const result = await users.searchUsers(1, 'alice')
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/accounts/1/users', {
      search_term: 'alice',
    })
  })

  it('searches users with sort and order', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 1, name: 'Alice' }])
    await users.searchUsers(1, 'alice', 'username', 'asc')
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/accounts/1/users', {
      search_term: 'alice',
      sort: 'username',
      order: 'asc',
    })
  })

  it('lists all users in a course', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ])
    const result = await users.listCourseUsers(100)
    expect(result).toHaveLength(2)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/users', {})
  })

  it('lists course users filtered by enrollment type', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 2, name: 'Bob' }])
    await users.listCourseUsers(100, 'teacher')
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/users', {
      'enrollment_type[]': 'teacher',
    })
  })

  it('fetches upcoming assignment events filtered by type=Assignment', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce([])
    await users.getUpcomingAssignments()
    expect(client.request).toHaveBeenCalledWith(
      '/api/v1/users/self/upcoming_events?type=Assignment',
    )
  })
})
