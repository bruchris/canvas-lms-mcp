import type { CanvasHttpClient } from './client'
import type { CanvasPlannerItem } from './types'

export interface PlannerItemsQuery {
  startDate?: string
  endDate?: string
  contextCodes?: string[]
  filter?: 'new_activity' | 'incomplete_items' | 'complete_items'
  /**
   * Stop following `Link: rel="next"` once this many items have accumulated.
   * Same rationale as `ActivityStreamQuery.maxItems`: bounds the WORK, not
   * just the result.
   */
  maxItems?: number
}

export class PlannerModule {
  constructor(private client: CanvasHttpClient) {}

  /**
   * `GET /planner/items` — unions nine Canvas collections (assignments,
   * ungraded quizzes, planner notes, wiki pages, ungraded discussions,
   * calendar events, peer reviews, sub-assignments, peer-review
   * sub-assignments) into one cross-course/cross-group feed.
   *
   * Uses `paginate()`: `Api.paginate(items, self, …)` sets no
   * `default_per_page`, so Canvas falls back to `Api::PER_PAGE = 10` absent an
   * explicit `per_page` (BRU-2797 §3.2) — the same `request()`-vs-`paginate()`
   * hazard as the activity stream.
   */
  async listItems(query: PlannerItemsQuery = {}): Promise<CanvasPlannerItem[]> {
    return this.client.paginate<CanvasPlannerItem>(
      '/api/v1/planner/items',
      {
        start_date: query.startDate,
        end_date: query.endDate,
        context_codes: query.contextCodes,
        filter: query.filter,
      },
      query.maxItems === undefined ? undefined : { maxItems: query.maxItems },
    )
  }
}
