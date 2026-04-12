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
