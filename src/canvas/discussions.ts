import type { CanvasHttpClient } from './client'
import type {
  CanvasDiscussionTopic,
  CanvasDiscussionEntry,
  CanvasAnnouncement,
  CreateDiscussionParams,
  UpdateDiscussionParams,
} from './types'

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

  async create(courseId: number, params: CreateDiscussionParams): Promise<CanvasDiscussionTopic> {
    return this.client.request<CanvasDiscussionTopic>(
      `/api/v1/courses/${courseId}/discussion_topics`,
      {
        method: 'POST',
        body: JSON.stringify(params),
      },
    )
  }

  async update(
    courseId: number,
    topicId: number,
    params: UpdateDiscussionParams,
  ): Promise<CanvasDiscussionTopic> {
    return this.client.request<CanvasDiscussionTopic>(
      `/api/v1/courses/${courseId}/discussion_topics/${topicId}`,
      {
        method: 'PUT',
        body: JSON.stringify(params),
      },
    )
  }

  async delete(courseId: number, topicId: number): Promise<void> {
    await this.client.request<void>(`/api/v1/courses/${courseId}/discussion_topics/${topicId}`, {
      method: 'DELETE',
    })
  }
}
