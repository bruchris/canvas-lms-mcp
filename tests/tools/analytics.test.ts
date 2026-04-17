import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { CanvasApiError } from '../../src/canvas'
import { analyticsTools } from '../../src/tools/analytics'

describe('analyticsTools', () => {
  function buildMockCanvas(): CanvasClient {
    return {
      analytics: {
        searchContentType: vi
          .fn()
          .mockResolvedValue([{ id: 1, title: 'Intro Page', type: 'page', course_id: 10 }]),
        getCourseActivity: vi
          .fn()
          .mockResolvedValue([{ date: '2024-01-01', views: 30, participations: 5 }]),
        getStudentActivity: vi.fn().mockResolvedValue({
          page_views: { '2024-01-01': 80 },
          participations: [],
        }),
        getCourseActivityStream: vi
          .fn()
          .mockResolvedValue([{ type: 'Submission', count: 7, unread_count: 0 }]),
      },
    } as unknown as CanvasClient
  }

  it('returns 4 tool definitions', () => {
    expect(analyticsTools(buildMockCanvas())).toHaveLength(4)
  })

  it('exports tools with correct names', () => {
    const names = analyticsTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'search_course_content',
      'get_course_analytics',
      'get_student_analytics',
      'get_course_activity_stream',
    ])
  })

  describe('search_course_content', () => {
    it('has read-only annotations', () => {
      const tool = analyticsTools(buildMockCanvas()).find(
        (t) => t.name === 'search_course_content',
      )!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('calls searchContentType for each default content type', async () => {
      const canvas = buildMockCanvas()
      const tool = analyticsTools(canvas).find((t) => t.name === 'search_course_content')!
      await tool.handler({ course_id: 10, search_term: 'quiz' })
      expect(canvas.analytics.searchContentType).toHaveBeenCalledTimes(4)
      expect(canvas.analytics.searchContentType).toHaveBeenCalledWith(10, 'quiz', 'pages')
      expect(canvas.analytics.searchContentType).toHaveBeenCalledWith(10, 'quiz', 'assignments')
      expect(canvas.analytics.searchContentType).toHaveBeenCalledWith(10, 'quiz', 'discussions')
      expect(canvas.analytics.searchContentType).toHaveBeenCalledWith(10, 'quiz', 'announcements')
    })

    it('calls searchContentType only for specified content_types', async () => {
      const canvas = buildMockCanvas()
      const tool = analyticsTools(canvas).find((t) => t.name === 'search_course_content')!
      await tool.handler({ course_id: 10, search_term: 'quiz', content_types: ['assignments'] })
      expect(canvas.analytics.searchContentType).toHaveBeenCalledTimes(1)
      expect(canvas.analytics.searchContentType).toHaveBeenCalledWith(10, 'quiz', 'assignments')
    })

    it('returns empty results when content_types is empty', async () => {
      const canvas = buildMockCanvas()
      const tool = analyticsTools(canvas).find((t) => t.name === 'search_course_content')!
      const result = await tool.handler({ course_id: 10, search_term: 'test', content_types: [] })
      expect(result).toEqual({ results: [] })
      expect(canvas.analytics.searchContentType).not.toHaveBeenCalled()
    })

    it('flattens results from multiple content types', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.analytics.searchContentType)
        .mockResolvedValueOnce([{ id: 1, title: 'Page A', type: 'page', course_id: 10 }])
        .mockResolvedValueOnce([
          { id: 2, title: 'Essay', type: 'assignment', course_id: 10 },
          { id: 3, title: 'Report', type: 'assignment', course_id: 10 },
        ])
      const tool = analyticsTools(canvas).find((t) => t.name === 'search_course_content')!
      const result = (await tool.handler({
        course_id: 10,
        search_term: 'test',
        content_types: ['pages', 'assignments'],
      })) as { results: unknown[] }
      expect(result.results).toHaveLength(3)
      expect(result).not.toHaveProperty('warnings')
    })

    it('returns partial results with warnings when some types fail', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.analytics.searchContentType)
        .mockResolvedValueOnce([{ id: 1, title: 'Intro', type: 'page', course_id: 10 }])
        .mockRejectedValueOnce(new Error('Network error'))
      const tool = analyticsTools(canvas).find((t) => t.name === 'search_course_content')!
      const result = (await tool.handler({
        course_id: 10,
        search_term: 'test',
        content_types: ['pages', 'assignments'],
      })) as { results: unknown[]; warnings: string[] }
      expect(result.results).toHaveLength(1)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toMatch(/assignments search failed:.*Failed to connect to Canvas/)
    })

    it('formats CanvasApiError failures in partial warnings', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.analytics.searchContentType)
        .mockResolvedValueOnce([{ id: 1, title: 'Intro', type: 'page', course_id: 10 }])
        .mockRejectedValueOnce(
          new CanvasApiError('Forbidden', 403, '/api/v1/courses/10/assignments'),
        )
      const tool = analyticsTools(canvas).find((t) => t.name === 'search_course_content')!
      const result = (await tool.handler({
        course_id: 10,
        search_term: 'test',
        content_types: ['pages', 'assignments'],
      })) as { results: unknown[]; warnings: string[] }
      expect(result.results).toHaveLength(1)
      expect(result.warnings[0]).toContain(
        "You don't have permission to perform this action in this course",
      )
    })

    it('throws aggregated errors when all content types fail', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.analytics.searchContentType)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new CanvasApiError('Unauthorized', 401, '/api/v1/courses/10'))
      const tool = analyticsTools(canvas).find((t) => t.name === 'search_course_content')!
      await expect(
        tool.handler({
          course_id: 10,
          search_term: 'test',
          content_types: ['pages', 'assignments'],
        }),
      ).rejects.toThrow(
        /All content type searches failed:\npages: Failed to connect to Canvas.*\nassignments: Canvas token is invalid or expired/,
      )
    })
  })

  describe('get_course_analytics', () => {
    it('has read-only annotations', () => {
      const tool = analyticsTools(buildMockCanvas()).find((t) => t.name === 'get_course_analytics')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.analytics.getCourseActivity', async () => {
      const canvas = buildMockCanvas()
      const tool = analyticsTools(canvas).find((t) => t.name === 'get_course_analytics')!
      await tool.handler({ course_id: 10 })
      expect(canvas.analytics.getCourseActivity).toHaveBeenCalledWith(10)
    })
  })

  describe('get_student_analytics', () => {
    it('has read-only annotations', () => {
      const tool = analyticsTools(buildMockCanvas()).find(
        (t) => t.name === 'get_student_analytics',
      )!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.analytics.getStudentActivity', async () => {
      const canvas = buildMockCanvas()
      const tool = analyticsTools(canvas).find((t) => t.name === 'get_student_analytics')!
      await tool.handler({ course_id: 10, student_id: 42 })
      expect(canvas.analytics.getStudentActivity).toHaveBeenCalledWith(10, 42)
    })
  })

  describe('get_course_activity_stream', () => {
    it('has read-only annotations', () => {
      const tool = analyticsTools(buildMockCanvas()).find(
        (t) => t.name === 'get_course_activity_stream',
      )!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.analytics.getCourseActivityStream', async () => {
      const canvas = buildMockCanvas()
      const tool = analyticsTools(canvas).find((t) => t.name === 'get_course_activity_stream')!
      await tool.handler({ course_id: 10 })
      expect(canvas.analytics.getCourseActivityStream).toHaveBeenCalledWith(10)
    })
  })
})
