import type { CanvasHttpClient } from './client'
import type {
  CanvasConversation,
  CanvasConversationDetail,
  CanvasConversationUnreadCount,
} from './types'

export class ConversationsModule {
  constructor(private client: CanvasHttpClient) {}

  async list(): Promise<CanvasConversation[]> {
    return this.client.paginate<CanvasConversation>('/api/v1/conversations')
  }

  async get(conversationId: string): Promise<CanvasConversationDetail> {
    return this.client.request<CanvasConversationDetail>(`/api/v1/conversations/${conversationId}`)
  }

  async getUnreadCount(): Promise<CanvasConversationUnreadCount> {
    const raw = await this.client.request<{ unread_count: string }>(
      '/api/v1/conversations/unread_count',
    )
    return { unread_count: parseInt(raw.unread_count, 10) }
  }

  async send(recipients: string[], subject: string, body: string): Promise<CanvasConversation[]> {
    return this.client.request<CanvasConversation[]>('/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        recipients,
        subject,
        body,
      }),
    })
  }
}
