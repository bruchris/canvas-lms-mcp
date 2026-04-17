import type { CanvasHttpClient } from './client'
import type { CanvasAccount, CanvasAccountReport, CanvasCourse, CanvasUser } from './types'

export class AccountsModule {
  constructor(private client: CanvasHttpClient) {}

  async get(accountId: number): Promise<CanvasAccount> {
    return this.client.request<CanvasAccount>(`/api/v1/accounts/${accountId}`)
  }

  async list(): Promise<CanvasAccount[]> {
    return this.client.paginate<CanvasAccount>('/api/v1/accounts')
  }

  async listSubAccounts(accountId: number): Promise<CanvasAccount[]> {
    return this.client.paginate<CanvasAccount>(`/api/v1/accounts/${accountId}/sub_accounts`)
  }

  async listCourses(accountId: number, params?: { search_term?: string }): Promise<CanvasCourse[]> {
    const query: Record<string, string> = {}
    if (params?.search_term) query.search_term = params.search_term
    return this.client.paginate<CanvasCourse>(`/api/v1/accounts/${accountId}/courses`, Object.keys(query).length ? query : undefined)
  }

  async listUsers(accountId: number, params?: { search_term?: string }): Promise<CanvasUser[]> {
    const query: Record<string, string> = {}
    if (params?.search_term) query.search_term = params.search_term
    return this.client.paginate<CanvasUser>(`/api/v1/accounts/${accountId}/users`, Object.keys(query).length ? query : undefined)
  }

  async getReports(accountId: number): Promise<CanvasAccountReport[]> {
    return this.client.request<CanvasAccountReport[]>(`/api/v1/accounts/${accountId}/reports`)
  }
}
