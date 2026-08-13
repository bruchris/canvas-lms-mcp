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
        create: vi.fn().mockResolvedValue(mockTopic),
        update: vi.fn().mockResolvedValue(mockTopic),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 7 tool definitions', () => {
    expect(discussionTools(buildMockCanvas())).toHaveLength(7)
  })

  it('exports tools with correct names', () => {
    const names = discussionTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'list_discussions',
      'get_discussion',
      'list_announcements',
      'post_discussion_entry',
      'create_discussion',
      'update_discussion',
      'delete_discussion',
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

  describe('create_discussion', () => {
    it('has destructive and openWorld annotations', () => {
      const tool = discussionTools(buildMockCanvas()).find((t) => t.name === 'create_discussion')!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.discussions.create with required params', async () => {
      const canvas = buildMockCanvas()
      const tool = discussionTools(canvas).find((t) => t.name === 'create_discussion')!
      await tool.handler({ course_id: 1, title: 'New Topic' })
      expect(canvas.discussions.create).toHaveBeenCalledWith(1, {
        title: 'New Topic',
        message: undefined,
        discussion_type: undefined,
        published: undefined,
        require_initial_post: undefined,
        is_announcement: undefined,
        delayed_post_at: undefined,
      })
    })

    it('passes optional params to canvas.discussions.create', async () => {
      const canvas = buildMockCanvas()
      const tool = discussionTools(canvas).find((t) => t.name === 'create_discussion')!
      await tool.handler({
        course_id: 1,
        title: 'New Topic',
        message: '<p>Hello</p>',
        discussion_type: 'threaded',
        published: true,
        require_initial_post: true,
      })
      expect(canvas.discussions.create).toHaveBeenCalledWith(1, {
        title: 'New Topic',
        message: '<p>Hello</p>',
        discussion_type: 'threaded',
        published: true,
        require_initial_post: true,
        is_announcement: undefined,
        delayed_post_at: undefined,
      })
    })

    it('forwards is_announcement and delayed_post_at to canvas.discussions.create', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.discussions.create).mockResolvedValueOnce({
        ...mockTopic,
        is_announcement: true,
      })
      const tool = discussionTools(canvas).find((t) => t.name === 'create_discussion')!
      await tool.handler({
        course_id: 1,
        title: 'Course Update',
        is_announcement: true,
        delayed_post_at: '2026-09-01T08:00:00.000Z',
      })
      expect(canvas.discussions.create).toHaveBeenCalledWith(1, {
        title: 'Course Update',
        message: undefined,
        discussion_type: undefined,
        published: undefined,
        require_initial_post: undefined,
        is_announcement: true,
        delayed_post_at: '2026-09-01T08:00:00.000Z',
      })
    })

    it('returns the topic when Canvas honors is_announcement: true', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.discussions.create).mockResolvedValueOnce({
        ...mockTopic,
        id: 42,
        is_announcement: true,
      })
      const tool = discussionTools(canvas).find((t) => t.name === 'create_discussion')!
      const result = await tool.handler({
        course_id: 1,
        title: 'Course Update',
        is_announcement: true,
      })
      expect(result).toMatchObject({ id: 42, is_announcement: true })
    })

    it('throws when Canvas silently downgrades the announcement to a regular topic', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.discussions.create).mockResolvedValueOnce({
        ...mockTopic,
        id: 99,
        is_announcement: false,
      })
      const tool = discussionTools(canvas).find((t) => t.name === 'create_discussion')!
      await expect(
        tool.handler({ course_id: 1, title: 'Course Update', is_announcement: true }),
      ).rejects.toThrow(/99/)
      await expect(
        tool.handler({ course_id: 1, title: 'Course Update', is_announcement: true }),
      ).rejects.toThrow(/announcement/i)
    })

    it('does not check the announcement postcondition for ordinary discussions', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.discussions.create).mockResolvedValueOnce({
        ...mockTopic,
        is_announcement: false,
      })
      const tool = discussionTools(canvas).find((t) => t.name === 'create_discussion')!
      await expect(tool.handler({ course_id: 1, title: 'New Topic' })).resolves.toMatchObject({
        is_announcement: false,
      })
    })
  })

  describe('update_discussion', () => {
    it('has destructive and openWorld annotations', () => {
      const tool = discussionTools(buildMockCanvas()).find((t) => t.name === 'update_discussion')!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.discussions.update', async () => {
      const canvas = buildMockCanvas()
      const tool = discussionTools(canvas).find((t) => t.name === 'update_discussion')!
      await tool.handler({ course_id: 1, topic_id: 1, title: 'Updated', published: false })
      expect(canvas.discussions.update).toHaveBeenCalledWith(1, 1, {
        title: 'Updated',
        message: undefined,
        published: false,
        require_initial_post: undefined,
        is_announcement: undefined,
        delayed_post_at: undefined,
      })
    })

    it('forwards is_announcement and delayed_post_at to canvas.discussions.update', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.discussions.update).mockResolvedValueOnce({
        ...mockTopic,
        is_announcement: true,
      })
      const tool = discussionTools(canvas).find((t) => t.name === 'update_discussion')!
      await tool.handler({
        course_id: 1,
        topic_id: 2,
        is_announcement: true,
        delayed_post_at: '2026-10-15T09:00:00.000Z',
      })
      expect(canvas.discussions.update).toHaveBeenCalledWith(1, 2, {
        title: undefined,
        message: undefined,
        published: undefined,
        require_initial_post: undefined,
        is_announcement: true,
        delayed_post_at: '2026-10-15T09:00:00.000Z',
      })
    })

    it('returns the topic when Canvas honors is_announcement: true', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.discussions.update).mockResolvedValueOnce({
        ...mockTopic,
        id: 7,
        is_announcement: true,
      })
      const tool = discussionTools(canvas).find((t) => t.name === 'update_discussion')!
      const result = await tool.handler({ course_id: 1, topic_id: 7, is_announcement: true })
      expect(result).toMatchObject({ id: 7, is_announcement: true })
    })

    it('throws when Canvas silently downgrades the announcement update to a regular topic', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.discussions.update).mockResolvedValueOnce({
        ...mockTopic,
        id: 13,
        is_announcement: false,
      })
      const tool = discussionTools(canvas).find((t) => t.name === 'update_discussion')!
      await expect(
        tool.handler({ course_id: 1, topic_id: 13, is_announcement: true }),
      ).rejects.toThrow(/13/)
      await expect(
        tool.handler({ course_id: 1, topic_id: 13, is_announcement: true }),
      ).rejects.toThrow(/announcement/i)
    })

    it('does not check the announcement postcondition for ordinary updates', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.discussions.update).mockResolvedValueOnce({
        ...mockTopic,
        is_announcement: false,
      })
      const tool = discussionTools(canvas).find((t) => t.name === 'update_discussion')!
      await expect(
        tool.handler({ course_id: 1, topic_id: 1, title: 'Updated' }),
      ).resolves.toMatchObject({ is_announcement: false })
    })
  })

  describe('delete_discussion', () => {
    it('has destructive and openWorld annotations', () => {
      const tool = discussionTools(buildMockCanvas()).find((t) => t.name === 'delete_discussion')!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.discussions.delete and returns confirmation', async () => {
      const canvas = buildMockCanvas()
      const tool = discussionTools(canvas).find((t) => t.name === 'delete_discussion')!
      const result = await tool.handler({ course_id: 1, topic_id: 5 })
      expect(canvas.discussions.delete).toHaveBeenCalledWith(1, 5)
      expect(result).toEqual({ deleted: true, topic_id: 5 })
    })
  })
})
