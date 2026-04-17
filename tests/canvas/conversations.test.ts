import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConversationsModule } from '../../src/canvas/conversations'
import { CanvasHttpClient } from '../../src/canvas/client'

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
        workflow_state: 'unread',
        last_message: 'Hi',
        last_message_at: '2026-04-10T00:00:00Z',
        message_count: 2,
        audience: [1],
        participants: [{ id: 1, name: 'Alice' }],
      },
    ])
    const result = await conversations.list()
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/conversations')
  })

  it('gets a single conversation by ID', async () => {
    const mockConversation = {
      id: 5,
      subject: 'Grades',
      workflow_state: 'read' as const,
      last_message: 'Sounds good',
      last_message_at: '2026-04-11T00:00:00Z',
      message_count: 3,
      audience: [5, 10],
      participants: [
        { id: 5, name: 'Alice' },
        { id: 10, name: 'Bob' },
      ],
      messages: [
        {
          id: 101,
          created_at: '2026-04-11T00:00:00Z',
          body: 'Sounds good',
          author_id: 10,
          generated: false,
        },
      ],
    }
    vi.spyOn(client, 'request').mockResolvedValueOnce(mockConversation)
    const result = await conversations.get(5)
    expect(result.id).toBe(5)
    expect(result.messages).toHaveLength(1)
    expect(client.request).toHaveBeenCalledWith('/api/v1/conversations/5')
  })

  it('gets unread conversation count', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ unread_count: 7 })
    const result = await conversations.getUnreadCount()
    expect(result.unread_count).toBe(7)
    expect(client.request).toHaveBeenCalledWith('/api/v1/conversations/unread_count')
  })

  it('sends a conversation', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce([
      {
        id: 2,
        subject: 'Hello',
        workflow_state: 'read',
        last_message: 'Hi there',
        last_message_at: '2026-04-10T00:00:00Z',
        message_count: 1,
        audience: [],
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
