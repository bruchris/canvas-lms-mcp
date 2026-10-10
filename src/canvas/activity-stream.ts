import type { CanvasHttpClient } from './client'
import type { CanvasActivityStreamEntry, CanvasActivityStreamSummaryEntry } from './types'

export interface ActivityStreamQuery {
  onlyActiveCourses?: boolean
  /**
   * Stop following `Link: rel="next"` once this many items have accumulated.
   * Bounds the WORK, not just the result: `paginate()` otherwise follows every
   * page to exhaustion (up to `maxPaginationPages`, default 1000) before
   * returning, so slicing afterwards would still have fetched up to 100,000
   * items.
   */
  maxItems?: number
}

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

  /**
   * `GET /users/self/activity_stream` — the cross-course stream itself.
   *
   * Uses `paginate()`, which is not interchangeable with `request()` here:
   * Canvas renders this endpoint through `Api.paginate(scope, self, …,
   * default_per_page: 21)`, so a `request()` call would silently return 21
   * items with no error and no `Link` header followed. `paginate()` sets
   * `per_page=100` (Canvas's `MAX_PER_PAGE`) and follows the links.
   */
  async getStream(query: ActivityStreamQuery = {}): Promise<CanvasActivityStreamEntry[]> {
    return this.client.paginate<CanvasActivityStreamEntry>(
      '/api/v1/users/self/activity_stream',
      { only_active_courses: query.onlyActiveCourses },
      query.maxItems === undefined ? undefined : { maxItems: query.maxItems },
    )
  }
}
