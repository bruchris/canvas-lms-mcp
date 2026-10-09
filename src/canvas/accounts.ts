import type { CanvasHttpClient } from './client'
import type {
  CanvasAccount,
  CanvasAccountNotification,
  CanvasAccountReport,
  CanvasCourse,
  CanvasUser,
} from './types'
import type { CanvasId } from './id'

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

  async listUsers(accountId: CanvasId, params?: { search_term?: string }): Promise<CanvasUser[]> {
    const query: Record<string, string> = {}
    if (params?.search_term) query.search_term = params.search_term
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
