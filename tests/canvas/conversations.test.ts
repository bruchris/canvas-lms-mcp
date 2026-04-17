import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConversationsModule } from '../../src/canvas/conversations'
import { CanvasHttpClient } from '../../src/canvas/client'
import type { CanvasConversationDetail } from '../../src/canvas/types'

describe('ConversationsModule', () => {
  let client: CanvasHttpClient
  let conversations: ConversationsModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    conversations = new ConversationsModule(client)
  })

  it('lists conversations', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      {
        id: 1,
        subject: 'Question',
        last_message: 'Hi',
        last_message_at: '2026-04-10T00:00:00Z',
        message_count: 2,
        participants: [{ id: 1, name: 'Alice' }],
      },
    ])
    const result = await conversations.list()
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/conversations')
  })

  it('gets a conversation with full message thread', async () => {
    const mockDetail: CanvasConversationDetail = {
      id: 1,
      subject: 'Question',
      last_message: 'Sure!',
      last_message_at: '2026-04-10T01:00:00Z',
      message_count: 2,
      participants: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
      messages: [
        {
          id: 101,
          created_at: '2026-04-10T00:00:00Z',
          body: 'Can you help?',
          author_id: 1,
          generated: false,
        },
        {
          id: 102,
          created_at: '2026-04-10T01:00:00Z',
          body: 'Sure!',
          author_id: 2,
          generated: false,
        },
      ],
    }
    vi.spyOn(client, 'request').mockResolvedValueOnce(mockDetail)

    const result = await conversations.get('1')
    expect(result.id).toBe(1)
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]!.body).toBe('Can you help?')
    expect(client.request).toHaveBeenCalledWith('/api/v1/conversations/1')
  })

  it('gets unread conversation count', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ unread_count: '3' })

    const result = await conversations.getUnreadCount()
    expect(result.unread_count).toBe(3)
    expect(client.request).toHaveBeenCalledWith('/api/v1/conversations/unread_count')
  })

  it('returns zero unread count when inbox is empty', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ unread_count: '0' })
    const result = await conversations.getUnreadCount()
    expect(result.unread_count).toBe(0)
  })

  it('sends a conversation', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce([
      {
        id: 2,
        subject: 'Hello',
        last_message: 'Hi there',
        last_message_at: '2026-04-10T00:00:00Z',
        message_count: 1,
        participants: [],
      },
    ])
    const result = await conversations.send(['10', '20'], 'Hello', 'Hi there')
    expect(result).toHaveLength(1)
    expect(client.request).toHaveBeenCalledWith('/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        recipients: ['10', '20'],
        subject: 'Hello',
        body: 'Hi there',
      }),
    })
  })
})
