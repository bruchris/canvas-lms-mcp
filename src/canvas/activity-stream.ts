import type { CanvasHttpClient } from './client'
import type { CanvasActivityStreamSummaryEntry } from './types'

export class ActivityStreamModule {
  constructor(private client: CanvasHttpClient) {}

  /**
   * `GET /users/self/activity_stream/summary` is the one stream endpoint Canvas
   * does not paginate (`api_render_stream_summary` has no `Api.paginate` call),
   * so this uses `request()` rather than `paginate()` — the inverse of every
   * other activity-stream endpoint.
   */
  async getSummary(onlyActiveCourses?: boolean): Promise<CanvasActivityStreamSummaryEntry[]> {
    return this.client.request<CanvasActivityStreamSummaryEntry[]>(
      '/api/v1/users/self/activity_stream/summary',
      { query: { only_active_courses: onlyActiveCourses } },
    )
  }
}
