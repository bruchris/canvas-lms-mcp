import type { CanvasHttpClient } from './client'
import type { CanvasConversation } from './types'

export class ConversationsModule {
  constructor(private client: CanvasHttpClient) {}

  async list(): Promise<CanvasConversation[]> {
    return this.client.paginate<CanvasConversation>('/api/v1/conversations')
  }

  async get(id: number): Promise<CanvasConversation> {
    return this.client.request<CanvasConversation>(`/api/v1/conversations/${id}`)
  }

  async getUnreadCount(): Promise<{ unread_count: number }> {
    return this.client.request<{ unread_count: number }>('/api/v1/conversations/unread_count')
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
