import type { CanvasHttpClient } from './client'
import type { CanvasModule, CanvasModuleItem, CanvasCourseStructure } from './types'
import type { CanvasId } from './id'

/**
 * Per-call cap on `listItems` recovery round-trips triggered by the 100-item inline
 * cliff documented on {@link ModulesModule.listWithItems}. Bounds the fan-out when a
 * course has many oversized modules in one request.
 */
export const MAX_OVERSIZED_MODULE_RECOVERIES = 10

/**
 * True when `mod.items` is Canvas's complete inlined item list for `include[]=items`.
 * `[]` is truthy in JS, so this must compare lengths against `items_count` rather
 * than testing presence: a module with `items: []` and `items_count: 0` is
 * genuinely empty and IS complete, while a module whose `items` key is absent
 * (Canvas's 100-item cliff), or whose inlined array disagrees with `items_count`,
 * is not and needs a fallback read via {@link ModulesModule.listItems}. Shared by
 * `getCourseStructure` here, `check_course_setup` and `get_student_requirement_graph`
 * so the three do not independently drift again — see BRU-3145.
 *
 * The `typeof mod.items_count === 'number'` guard is defense-in-depth only: Canvas's
 * `module_json` always serializes `items_count` as a number (it is not a conditional
 * field), so no real Canvas response reaches the branch it guards against. Kept for
 * parity with a malformed/partial response rather than to pass a reachable fixture.
 */
export function hasCompleteInlinedItems(mod: {
  items?: CanvasModuleItem[]
  items_count?: number
}): boolean {
  return (
    mod.items !== undefined &&
    typeof mod.items_count === 'number' &&
    mod.items.length === mod.items_count
  )
}

export interface CreateModuleItemParams {
  title: string
  type: string
  content_id?: CanvasId
  /** Page slug — Page items are addressed by URL slug, not by `content_id`. */
  page_url?: string
  external_url?: string
  position?: number
  indent?: number
  new_tab?: boolean
}

export interface UpdateModuleItemParams {
  title?: string
  external_url?: string
  position?: number
  indent?: number
  new_tab?: boolean
  published?: boolean
  /** Move the item to a different module. */
  module_id?: CanvasId
}

export class ModulesModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: CanvasId): Promise<CanvasModule[]> {
    return this.client.paginate<CanvasModule>(`/api/v1/courses/${courseId}/modules`)
  }

  /**
   * List a course's modules with each module's items inlined via `include[]=items`.
   * Unlike `getCourseStructure`, this returns the raw Canvas shapes (including the
   * `published` state on every module and item, and each item's
   * `completion_requirement`, all of which `getCourseStructure` projects away), which
   * the course-setup health check needs to detect unpublished content.
   *
   * **`items` can be absent, and absent is not empty.** `module_json` inlines items
   * only when `includes.include?("items") && count <= Api::MAX_PER_PAGE`, with
   * `Api::MAX_PER_PAGE = 100` (`lib/api.rb`). A module with 101 or more items comes back
   * with **no `items` key at all** — not a truncated array, not an error. Compare
   * `items.length` against `items_count` and fall back to `listItems` for that module;
   * `items ?? []` silently reports a large module as empty.
   *
   * `per_page` needs no argument here: `CanvasHttpClient.paginate` sets `per_page=100`
   * whenever the caller did not, so this never falls back to Canvas's
   * `Api::PER_PAGE = 10` default.
   *
   * @param opts.contentDetails adds `include[]=content_details`, which is the only way
   *   to see `locked_for_user` and the caller's override-applied effective `due_at` per
   *   item. Off by default so existing callers keep their current response size.
   * @param opts.maxItems stops after this many MODULES. Pass `limit + 1` to probe for
   *   truncation: `paginate()` reports what it accumulated, never whether more was
   *   waiting, so asking for exactly `limit` makes "there are exactly `limit`" and
   *   "there are more" indistinguishable. Off by default.
   */
  async listWithItems(
    courseId: CanvasId,
    opts: { contentDetails?: boolean; maxItems?: number } = {},
  ): Promise<(CanvasModule & { items?: CanvasModuleItem[] })[]> {
    const include = opts.contentDetails ? ['items', 'content_details'] : ['items']
    const endpoint = `/api/v1/courses/${courseId}/modules`
    // Branch rather than pass `undefined`: a caller that supplies no `maxItems`
    // must reach `paginate` with the same arity it always has.
    return opts.maxItems === undefined
      ? this.client.paginate<CanvasModule & { items?: CanvasModuleItem[] }>(endpoint, { include })
      : this.client.paginate<CanvasModule & { items?: CanvasModuleItem[] }>(
          endpoint,
          { include },
          { maxItems: opts.maxItems },
        )
  }

  async get(courseId: CanvasId, moduleId: CanvasId): Promise<CanvasModule> {
    return this.client.request<CanvasModule>(`/api/v1/courses/${courseId}/modules/${moduleId}`)
  }

  /**
   * List one module's items. This is the paginating endpoint, so it is also the recovery
   * path for the `include[]=items` cliff documented on {@link listWithItems}: a module
   * with more than 100 items has to be read here.
   *
   * @param opts.contentDetails adds `include[]=content_details`, so a module recovered
   *   through this path carries the same `locked_for_user` and effective-date evidence
   *   as one inlined by `listWithItems({ contentDetails: true })`. Off by default.
   */
  async listItems(
    courseId: CanvasId,
    moduleId: CanvasId,
    opts: { contentDetails?: boolean } = {},
  ): Promise<CanvasModuleItem[]> {
    const endpoint = `/api/v1/courses/${courseId}/modules/${moduleId}/items`
    // Branch rather than pass `undefined`: the query argument is omitted entirely in
    // the default case, so the request this has always made is byte-identical.
    return opts.contentDetails
      ? this.client.paginate<CanvasModuleItem>(endpoint, { include: ['content_details'] })
      : this.client.paginate<CanvasModuleItem>(endpoint)
  }

  async create(
    courseId: CanvasId,
    params: {
      name: string
      position?: number
      unlock_at?: string
      prerequisite_module_ids?: CanvasId[]
    },
  ): Promise<CanvasModule> {
    return this.client.request<CanvasModule>(`/api/v1/courses/${courseId}/modules`, {
      method: 'POST',
      body: JSON.stringify({ module: params }),
    })
  }

  async update(
    courseId: CanvasId,
    moduleId: CanvasId,
    params: { name?: string; position?: number; published?: boolean },
  ): Promise<CanvasModule> {
    return this.client.request<CanvasModule>(`/api/v1/courses/${courseId}/modules/${moduleId}`, {
      method: 'PUT',
      body: JSON.stringify({ module: params }),
    })
  }

  /**
   * Canvas answers a module DELETE with the deleted module's body (the
   * controller renders `module_json` with no root key). The module's items go
   * with it; the content they link to is stored separately in the course.
   */
  async delete(courseId: CanvasId, moduleId: CanvasId): Promise<CanvasModule> {
    return this.client.request<CanvasModule>(`/api/v1/courses/${courseId}/modules/${moduleId}`, {
      method: 'DELETE',
    })
  }

  async createItem(
    courseId: CanvasId,
    moduleId: CanvasId,
    params: CreateModuleItemParams,
  ): Promise<CanvasModuleItem> {
    return this.client.request<CanvasModuleItem>(
      `/api/v1/courses/${courseId}/modules/${moduleId}/items`,
      {
        method: 'POST',
        body: JSON.stringify({ module_item: params }),
      },
    )
  }

  async updateItem(
    courseId: CanvasId,
    moduleId: CanvasId,
    itemId: CanvasId,
    params: UpdateModuleItemParams,
  ): Promise<CanvasModuleItem> {
    return this.client.request<CanvasModuleItem>(
      `/api/v1/courses/${courseId}/modules/${moduleId}/items/${itemId}`,
      {
        method: 'PUT',
        body: JSON.stringify({ module_item: params }),
      },
    )
  }

  /** Canvas answers a module-item DELETE with the deleted item's body. */
  async deleteItem(
    courseId: CanvasId,
    moduleId: CanvasId,
    itemId: CanvasId,
  ): Promise<CanvasModuleItem> {
    return this.client.request<CanvasModuleItem>(
      `/api/v1/courses/${courseId}/modules/${moduleId}/items/${itemId}`,
      { method: 'DELETE' },
    )
  }

  async getCourseStructure(
    courseId: CanvasId,
    opts: { includePublishedOnly?: boolean; includeContentDetails?: boolean } = {},
  ): Promise<CanvasCourseStructure> {
    const include: string[] = ['items']
    if (opts.includeContentDetails) include.push('content_details')

    const modules = await this.client.paginate<CanvasModule & { items?: CanvasModuleItem[] }>(
      `/api/v1/courses/${courseId}/modules`,
      { include },
    )

    const itemsByType: Record<string, number> = {}
    let totalItems = 0
    let anyTruncated = false
    let recoveries = 0

    const filteredModules: CanvasCourseStructure['modules'] = []
    for (const mod of modules) {
      let items: CanvasModuleItem[] | null
      let truncated = false

      if (hasCompleteInlinedItems(mod)) {
        items = mod.items as CanvasModuleItem[]
      } else if (recoveries < MAX_OVERSIZED_MODULE_RECOVERIES) {
        recoveries += 1
        items = await this.listItems(courseId, mod.id, {
          contentDetails: opts.includeContentDetails,
        })
      } else {
        // Recovery cap already spent — report this module's items as unknown,
        // never as an empty array that would lie about it having no content.
        items = null
        truncated = true
        anyTruncated = true
      }

      const visibleItems = opts.includePublishedOnly
        ? (items ?? []).filter((item) => item.published)
        : (items ?? [])
      for (const item of visibleItems) {
        itemsByType[item.type] = (itemsByType[item.type] ?? 0) + 1
        totalItems++
      }

      filteredModules.push({
        id: mod.id,
        name: mod.name,
        position: mod.position,
        state: mod.state ?? (mod.published ? 'active' : 'unpublished'),
        unlock_at: mod.unlock_at,
        items: truncated
          ? null
          : visibleItems.map((item) => ({
              id: item.id,
              title: item.title,
              type: item.type,
              position: item.position,
              published: item.published,
              html_url: item.html_url,
              page_url: item.page_url,
              content_id: item.content_id,
              content_details: item.content_details,
            })),
        items_truncated: truncated,
      })
    }

    return {
      modules: filteredModules,
      summary: {
        total_modules: filteredModules.length,
        total_items: totalItems,
        items_by_type: itemsByType,
        items_truncated: anyTruncated,
      },
    }
  }
}
