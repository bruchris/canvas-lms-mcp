import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AnalyticsModule } from '../../src/canvas/analytics'
import { CanvasHttpClient } from '../../src/canvas/client'

describe('AnalyticsModule', () => {
  let client: CanvasHttpClient
  let analytics: AnalyticsModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    analytics = new AnalyticsModule(client)
  })

  describe('searchContentType', () => {
    it('fetches pages and maps to CourseSearchResult', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([
        { page_id: 1, title: 'Intro', url: 'intro' },
      ])
      const results = await analytics.searchContentType(100, 'intro', 'pages')
      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({
        id: 1,
        title: 'Intro',
        type: 'page',
        url: 'intro',
        course_id: 100,
      })
    })

    it('fetches assignments and maps to CourseSearchResult', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 5, name: 'Essay' }])
      const results = await analytics.searchContentType(100, 'essay', 'assignments')
      expect(results[0]).toMatchObject({
        id: 5,
        title: 'Essay',
        type: 'assignment',
        course_id: 100,
      })
    })

    it('fetches discussions and maps to CourseSearchResult', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 10, title: 'Week 1 Discussion' }])
      const results = await analytics.searchContentType(100, 'week', 'discussions')
      expect(results[0]).toMatchObject({ id: 10, title: 'Week 1 Discussion', type: 'discussion' })
    })

    it('fetches announcements with only_announcements param', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 20, title: 'Important Notice' }])
      const results = await analytics.searchContentType(100, 'notice', 'announcements')
      expect(results[0]).toMatchObject({ id: 20, title: 'Important Notice', type: 'announcement' })
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/discussion_topics', {
        search_term: 'notice',
        only_announcements: 'true',
      })
    })

    it('throws on API failure', async () => {
      const error = new Error('403 Forbidden')
      vi.spyOn(client, 'paginate').mockRejectedValueOnce(error)
      await expect(analytics.searchContentType(100, 'test', 'assignments')).rejects.toThrow(
        '403 Forbidden',
      )
    })
  })

  describe('getCourseActivity', () => {
    it('requests the course analytics activity endpoint', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce([
        { date: '2024-01-01', views: 50, participations: 10 },
      ])
      const result = await analytics.getCourseActivity(100)
      expect(result).toHaveLength(1)
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/analytics/activity')
    })
  })

  describe('getStudentActivity', () => {
    it('requests the student analytics activity endpoint', async () => {
      const mockData = {
        page_views: { '2024-01-01': 5, '2024-01-02': 3 },
        participations: [{ created_at: '2024-01-01T10:00:00Z', url: '/courses/1/assignments/2' }],
      }
      vi.spyOn(client, 'request').mockResolvedValueOnce(mockData)
      const result = await analytics.getStudentActivity(100, 42)
      expect(result.page_views).toEqual({ '2024-01-01': 5, '2024-01-02': 3 })
      expect(result.participations).toHaveLength(1)
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/analytics/users/42/activity')
    })
  })

  describe('getCourseActivityStream', () => {
    it('requests the activity stream summary endpoint', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce([
        { type: 'Submission', count: 5, unread_count: 0 },
        { type: 'DiscussionTopic', count: 2, unread_count: 1 },
      ])
      const result = await analytics.getCourseActivityStream(100)
      expect(result).toHaveLength(2)
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/activity_stream/summary')
    })
  })
})
