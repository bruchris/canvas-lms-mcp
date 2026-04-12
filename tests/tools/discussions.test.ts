import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import type {
  CanvasDiscussionTopic,
  CanvasDiscussionEntry,
  CanvasAnnouncement,
} from '../../src/canvas/types'
import { discussionTools } from '../../src/tools/discussions'

describe('discussionTools', () => {
  const mockTopic: CanvasDiscussionTopic = {
    id: 1,
    title: 'Week 1 Discussion',
    message: '<p>Discuss the readings</p>',
    posted_at: '2026-04-01T00:00:00Z',
    discussion_type: 'threaded',
    published: true,
    user_name: 'Instructor',
  }

  const mockEntry: CanvasDiscussionEntry = {
    id: 1,
    user_id: 5,
    message: '<p>My response</p>',
    created_at: '2026-04-02T00:00:00Z',
  }

  const mockAnnouncement: CanvasAnnouncement = {
    id: 2,
    title: 'Welcome!',
    message: '<p>Welcome to class</p>',
    posted_at: '2026-04-01T00:00:00Z',
    is_announcement: true,
    user_name: 'Instructor',
  }

  function buildMockCanvas(): CanvasClient {
    return {
      discussions: {
        list: vi.fn().mockResolvedValue([mockTopic]),
        get: vi.fn().mockResolvedValue(mockTopic),
        listAnnouncements: vi.fn().mockResolvedValue([mockAnnouncement]),
        postEntry: vi.fn().mockResolvedValue(mockEntry),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 4 tool definitions', () => {
    expect(discussionTools(buildMockCanvas())).toHaveLength(4)
  })

  it('exports tools with correct names', () => {
    const names = discussionTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'list_discussions',
      'get_discussion',
      'list_announcements',
      'post_discussion_entry',
    ])
  })

  describe('list_discussions', () => {
    it('has read-only annotations', () => {
      const tool = discussionTools(buildMockCanvas()).find((t) => t.name === 'list_discussions')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.discussions.list', async () => {
      const canvas = buildMockCanvas()
      const tool = discussionTools(canvas).find((t) => t.name === 'list_discussions')!
      await tool.handler({ course_id: 1 })
      expect(canvas.discussions.list).toHaveBeenCalledWith(1)
    })
  })

  describe('get_discussion', () => {
    it('has read-only annotations', () => {
      const tool = discussionTools(buildMockCanvas()).find((t) => t.name === 'get_discussion')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.discussions.get', async () => {
      const canvas = buildMockCanvas()
      const tool = discussionTools(canvas).find((t) => t.name === 'get_discussion')!
      await tool.handler({ course_id: 1, topic_id: 1 })
      expect(canvas.discussions.get).toHaveBeenCalledWith(1, 1)
    })
  })

  describe('list_announcements', () => {
    it('has read-only annotations', () => {
      const tool = discussionTools(buildMockCanvas()).find((t) => t.name === 'list_announcements')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.discussions.listAnnouncements', async () => {
      const canvas = buildMockCanvas()
      const tool = discussionTools(canvas).find((t) => t.name === 'list_announcements')!
      await tool.handler({ course_id: 1 })
      expect(canvas.discussions.listAnnouncements).toHaveBeenCalledWith(1)
    })
  })

  describe('post_discussion_entry', () => {
    it('has destructive and openWorld annotations', () => {
      const tool = discussionTools(buildMockCanvas()).find(
        (t) => t.name === 'post_discussion_entry',
      )!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.discussions.postEntry', async () => {
      const canvas = buildMockCanvas()
      const tool = discussionTools(canvas).find((t) => t.name === 'post_discussion_entry')!
      await tool.handler({ course_id: 1, topic_id: 1, message: 'Hello!' })
      expect(canvas.discussions.postEntry).toHaveBeenCalledWith(1, 1, 'Hello!')
    })
  })
})
