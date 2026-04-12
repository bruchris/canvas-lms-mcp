import type { CanvasHttpClient } from './client'
import type { CanvasConversation } from './types'

export class ConversationsModule {
  constructor(private client: CanvasHttpClient) {}

  async list(): Promise<CanvasConversation[]> {
    return this.client.paginate<CanvasConversation>('/api/v1/conversations')
  }

  async send(
    recipients: string[],
    subject: string,
    body: string,
  ): Promise<CanvasConversation[]> {
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
