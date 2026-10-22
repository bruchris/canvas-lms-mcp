import type { CanvasHttpClient } from './client'
import type { CanvasQueryParams } from './query'
import type {
  CanvasAccount,
  CanvasAccountNotification,
  CanvasAccountReport,
  CanvasCourse,
  CanvasUser,
} from './types'
import type { CanvasId } from './id'
import type { SearchUserInclude, UserSort } from './users'

// Canvas's `UsersController#api_index` ("List users in account", GET
// /api/v1/accounts/:account_id/users) documents `sort` as accepting `id` in addition
// to the UserSort values shared with the course-scoped `UserSearch` callers — `id` is
// the account-index-specific value Canvas recommends for paging through many results
// efficiently, so it is added on here rather than widening the shared `UserSort` type.
export type AccountUserSort = UserSort | 'id'

export interface ListAccountUsersOptions {
  search_term?: string
  sort?: AccountUserSort
  order?: 'asc' | 'desc'
  include?: ReadonlyArray<SearchUserInclude>
}

export class AccountsModule {
  constructor(private client: CanvasHttpClient) {}

  async get(accountId: CanvasId): Promise<CanvasAccount> {
    return this.client.request<CanvasAccount>(`/api/v1/accounts/${accountId}`)
  }

  async list(): Promise<CanvasAccount[]> {
    return this.client.paginate<CanvasAccount>('/api/v1/accounts')
  }

  async listSubAccounts(accountId: CanvasId): Promise<CanvasAccount[]> {
    return this.client.paginate<CanvasAccount>(`/api/v1/accounts/${accountId}/sub_accounts`)
  }

  async listCourses(
    accountId: CanvasId,
    params?: { search_term?: string },
  ): Promise<CanvasCourse[]> {
    const query: Record<string, string> = {}
    if (params?.search_term) query.search_term = params.search_term
    return this.client.paginate<CanvasCourse>(
      `/api/v1/accounts/${accountId}/courses`,
      Object.keys(query).length ? query : undefined,
    )
  }

  async listUsers(accountId: CanvasId, params?: ListAccountUsersOptions): Promise<CanvasUser[]> {
    const query: CanvasQueryParams = {}
    if (params?.search_term) query.search_term = params.search_term
    if (params?.sort) query.sort = params.sort
    if (params?.order) query.order = params.order
    if (params?.include && params.include.length > 0) query.include = params.include
    return this.client.paginate<CanvasUser>(
      `/api/v1/accounts/${accountId}/users`,
      Object.keys(query).length ? query : undefined,
    )
  }

  async getReports(accountId: CanvasId): Promise<CanvasAccountReport[]> {
    return this.client.request<CanvasAccountReport[]>(`/api/v1/accounts/${accountId}/reports`)
  }

  async listNotifications(accountId: string): Promise<CanvasAccountNotification[]> {
    return this.client.paginate<CanvasAccountNotification>(
      `/api/v1/accounts/${accountId}/account_notifications`,
    )
  }
}
