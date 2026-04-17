import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { analyticsTools } from '../../src/tools/analytics'

describe('analyticsTools', () => {
  function buildMockCanvas(): CanvasClient {
    return {
      analytics: {
        searchCourseContent: vi.fn().mockResolvedValue([
          { id: 1, title: 'Intro Page', type: 'page', course_id: 10 },
        ]),
        getCourseActivity: vi.fn().mockResolvedValue([
          { date: '2024-01-01', views: 30, participations: 5 },
        ]),
        getStudentActivity: vi.fn().mockResolvedValue({ page_views: 80, participations: 12 }),
        getCourseActivityStream: vi.fn().mockResolvedValue([
          { type: 'Submission', count: 7 },
        ]),
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
      const tool = analyticsTools(buildMockCanvas()).find((t) => t.name === 'search_course_content')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.analytics.searchCourseContent', async () => {
      const canvas = buildMockCanvas()
      const tool = analyticsTools(canvas).find((t) => t.name === 'search_course_content')!
      await tool.handler({ course_id: 10, search_term: 'quiz' })
      expect(canvas.analytics.searchCourseContent).toHaveBeenCalledWith(10, 'quiz', undefined)
    })

    it('passes content_types when provided', async () => {
      const canvas = buildMockCanvas()
      const tool = analyticsTools(canvas).find((t) => t.name === 'search_course_content')!
      await tool.handler({ course_id: 10, search_term: 'quiz', content_types: ['assignments'] })
      expect(canvas.analytics.searchCourseContent).toHaveBeenCalledWith(10, 'quiz', ['assignments'])
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
      const tool = analyticsTools(buildMockCanvas()).find((t) => t.name === 'get_student_analytics')!
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
