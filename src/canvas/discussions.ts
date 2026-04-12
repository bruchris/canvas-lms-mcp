import type { CanvasHttpClient } from './client'
import type { CanvasDiscussionTopic, CanvasDiscussionEntry, CanvasAnnouncement } from './types'

export class DiscussionsModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: number): Promise<CanvasDiscussionTopic[]> {
    return this.client.paginate<CanvasDiscussionTopic>(
      `/api/v1/courses/${courseId}/discussion_topics`,
    )
  }

  async get(courseId: number, topicId: number): Promise<CanvasDiscussionTopic> {
    return this.client.request<CanvasDiscussionTopic>(
      `/api/v1/courses/${courseId}/discussion_topics/${topicId}?include[]=all_dates`,
    )
  }

  async listAnnouncements(courseId: number): Promise<CanvasAnnouncement[]> {
    return this.client.paginate<CanvasAnnouncement>(
      `/api/v1/courses/${courseId}/discussion_topics`,
      { only_announcements: 'true' },
    )
  }

  async postEntry(
    courseId: number,
    topicId: number,
    message: string,
  ): Promise<CanvasDiscussionEntry> {
    return this.client.request<CanvasDiscussionEntry>(
      `/api/v1/courses/${courseId}/discussion_topics/${topicId}/entries`,
      {
        method: 'POST',
        body: JSON.stringify({ message }),
      },
    )
  }
}
