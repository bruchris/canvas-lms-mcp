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

  describe('searchCourseContent', () => {
    it('searches all content types by default', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValue([])
      await analytics.searchCourseContent(100, 'syllabus')
      expect(client.paginate).toHaveBeenCalledTimes(4)
    })

    it('searches only specified content types', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValue([])
      await analytics.searchCourseContent(100, 'quiz', ['assignments'])
      expect(client.paginate).toHaveBeenCalledTimes(1)
      expect(client.paginate).toHaveBeenCalledWith(
        '/api/v1/courses/100/assignments',
        { search_term: 'quiz' },
      )
    })

    it('returns tagged results from pages', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([
        { page_id: 1, title: 'Intro', url: 'intro' },
      ])
      const results = await analytics.searchCourseContent(100, 'intro', ['pages'])
      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({ id: 1, title: 'Intro', type: 'page', course_id: 100 })
    })

    it('returns tagged results from assignments', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 5, name: 'Essay' }])
      const results = await analytics.searchCourseContent(100, 'essay', ['assignments'])
      expect(results[0]).toMatchObject({ id: 5, title: 'Essay', type: 'assignment' })
    })

    it('returns tagged results from discussions', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 10, title: 'Week 1 Discussion' }])
      const results = await analytics.searchCourseContent(100, 'week', ['discussions'])
      expect(results[0]).toMatchObject({ id: 10, title: 'Week 1 Discussion', type: 'discussion' })
    })

    it('returns tagged results from announcements', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 20, title: 'Important Notice' }])
      const results = await analytics.searchCourseContent(100, 'notice', ['announcements'])
      expect(results[0]).toMatchObject({ id: 20, title: 'Important Notice', type: 'announcement' })
      expect(client.paginate).toHaveBeenCalledWith(
        '/api/v1/courses/100/discussion_topics',
        { search_term: 'notice', only_announcements: 'true' },
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
      vi.spyOn(client, 'request').mockResolvedValueOnce({ page_views: 120, participations: 8 })
      const result = await analytics.getStudentActivity(100, 42)
      expect(result).toMatchObject({ page_views: 120, participations: 8 })
      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/100/analytics/users/42/activity',
      )
    })
  })

  describe('getCourseActivityStream', () => {
    it('requests the activity stream summary endpoint', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce([
        { type: 'Submission', count: 5 },
        { type: 'DiscussionTopic', count: 2 },
      ])
      const result = await analytics.getCourseActivityStream(100)
      expect(result).toHaveLength(2)
      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/100/activity_stream/summary',
      )
    })
  })
})
