import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import type {
  CanvasConversation,
  CanvasConversationDetail,
  CanvasConversationUnreadCount,
} from '../../src/canvas/types'
import { conversationTools } from '../../src/tools/conversations'

describe('conversationTools', () => {
  const mockConversation: CanvasConversation = {
    id: 1,
    subject: 'Question about HW',
    last_message: 'Thanks!',
    last_message_at: '2026-04-10T12:00:00Z',
    message_count: 3,
    participants: [
      { id: 5, name: 'Alice' },
      { id: 10, name: 'Bob' },
    ],
  }

  const mockDetail: CanvasConversationDetail = {
    ...mockConversation,
    messages: [
      {
        id: 201,
        created_at: '2026-04-10T12:00:00Z',
        body: 'Thanks!',
        author_id: 5,
        generated: false,
      },
    ],
  }

  const mockUnreadCount: CanvasConversationUnreadCount = { unread_count: 4 }

  function buildMockCanvas(): CanvasClient {
    return {
      conversations: {
        list: vi.fn().mockResolvedValue([mockConversation]),
        get: vi.fn().mockResolvedValue(mockDetail),
        getUnreadCount: vi.fn().mockResolvedValue(mockUnreadCount),
        send: vi.fn().mockResolvedValue([mockConversation]),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 4 tool definitions', () => {
    expect(conversationTools(buildMockCanvas())).toHaveLength(4)
  })

  it('exports tools with correct names', () => {
    const names = conversationTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'list_conversations',
      'get_conversation',
      'get_conversation_unread_count',
      'send_conversation',
    ])
  })

  describe('list_conversations', () => {
    it('has read-only annotations', () => {
      const tool = conversationTools(buildMockCanvas()).find(
        (t) => t.name === 'list_conversations',
      )!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.conversations.list', async () => {
      const canvas = buildMockCanvas()
      const tool = conversationTools(canvas).find((t) => t.name === 'list_conversations')!
      const result = await tool.handler({})
      expect(canvas.conversations.list).toHaveBeenCalled()
      expect(result).toEqual([mockConversation])
    })
  })

  describe('get_conversation', () => {
    it('has read-only annotations', () => {
      const tool = conversationTools(buildMockCanvas()).find((t) => t.name === 'get_conversation')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.conversations.get with conversation_id', async () => {
      const canvas = buildMockCanvas()
      const tool = conversationTools(canvas).find((t) => t.name === 'get_conversation')!
      const result = await tool.handler({ conversation_id: '1' })
      expect(canvas.conversations.get).toHaveBeenCalledWith('1')
      expect(result).toEqual(mockDetail)
      expect((result as CanvasConversationDetail).messages).toHaveLength(1)
    })
  })

  describe('get_conversation_unread_count', () => {
    it('has read-only annotations', () => {
      const tool = conversationTools(buildMockCanvas()).find(
        (t) => t.name === 'get_conversation_unread_count',
      )!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.conversations.getUnreadCount', async () => {
      const canvas = buildMockCanvas()
      const tool = conversationTools(canvas).find(
        (t) => t.name === 'get_conversation_unread_count',
      )!
      const result = await tool.handler({})
      expect(canvas.conversations.getUnreadCount).toHaveBeenCalled()
      expect((result as CanvasConversationUnreadCount).unread_count).toBe(4)
    })
  })

  describe('send_conversation', () => {
    it('has destructive and openWorld annotations', () => {
      const tool = conversationTools(buildMockCanvas()).find((t) => t.name === 'send_conversation')!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.conversations.send', async () => {
      const canvas = buildMockCanvas()
      const tool = conversationTools(canvas).find((t) => t.name === 'send_conversation')!
      await tool.handler({
        recipients: ['5'],
        subject: 'Hello',
        body: 'Hi there!',
      })
      expect(canvas.conversations.send).toHaveBeenCalledWith(['5'], 'Hello', 'Hi there!')
    })
  })
})
