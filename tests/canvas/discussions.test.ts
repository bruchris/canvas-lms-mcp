import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DiscussionsModule } from '../../src/canvas/discussions'
import { CanvasHttpClient } from '../../src/canvas/client'

describe('DiscussionsModule', () => {
  let client: CanvasHttpClient
  let discussions: DiscussionsModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    discussions = new DiscussionsModule(client)
  })

  it('lists discussion topics for a course', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      {
        id: 1,
        title: 'Week 1 Discussion',
        message: 'Discuss this.',
        posted_at: '2026-04-01T00:00:00Z',
        discussion_type: 'threaded',
        published: true,
      },
    ])
    const result = await discussions.list(100)
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/discussion_topics')
  })

  it('gets a single discussion topic with all_dates include', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      id: 1,
      title: 'Week 1 Discussion',
      message: 'Discuss this.',
      posted_at: '2026-04-01T00:00:00Z',
      discussion_type: 'threaded',
      published: true,
    })
    const result = await discussions.get(100, 1)
    expect(result).toMatchObject({ id: 1, title: 'Week 1 Discussion' })
    expect(client.request).toHaveBeenCalledWith(
      '/api/v1/courses/100/discussion_topics/1?include[]=all_dates',
    )
  })

  it('lists announcements with only_announcements filter', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      {
        id: 10,
        title: 'Important Announcement',
        message: 'Read this!',
        posted_at: '2026-04-05T00:00:00Z',
      },
    ])
    const result = await discussions.listAnnouncements(100)
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/discussion_topics', {
      only_announcements: 'true',
    })
  })

  it('posts a discussion entry', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      id: 5,
      user_id: 1,
      message: 'My response',
      created_at: '2026-04-10T12:00:00Z',
    })
    await discussions.postEntry(100, 1, 'My response')
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/discussion_topics/1/entries', {
      method: 'POST',
      body: JSON.stringify({ message: 'My response' }),
    })
  })

  it('creates a discussion topic via POST', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      id: 20,
      title: 'New Discussion',
      message: 'Welcome!',
      discussion_type: 'threaded',
      published: false,
    })
    const params = {
      title: 'New Discussion',
      message: 'Welcome!',
      discussion_type: 'threaded' as const,
      published: false,
    }
    const result = await discussions.create(100, params)
    expect(result).toMatchObject({ id: 20, title: 'New Discussion' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/discussion_topics', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  })

  it('updates a discussion topic via PUT', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      id: 20,
      title: 'Updated Title',
      published: true,
    })
    const params = { title: 'Updated Title', published: true }
    const result = await discussions.update(100, 20, params)
    expect(result).toMatchObject({ id: 20, title: 'Updated Title' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/discussion_topics/20', {
      method: 'PUT',
      body: JSON.stringify(params),
    })
  })

  it('deletes a discussion topic via DELETE', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(undefined)
    await discussions.delete(100, 20)
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/discussion_topics/20', {
      method: 'DELETE',
    })
  })
})
