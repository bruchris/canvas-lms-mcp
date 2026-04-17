import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AccountsModule } from '../../src/canvas/accounts'
import { CanvasHttpClient } from '../../src/canvas/client'

describe('AccountsModule', () => {
  let client: CanvasHttpClient
  let accounts: AccountsModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    accounts = new AccountsModule(client)
  })

  it('gets a single account', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ id: 1, name: 'Default' })
    const result = await accounts.get(1)
    expect(result).toMatchObject({ id: 1, name: 'Default' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/accounts/1')
  })

  it('lists all accessible accounts', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 1, name: 'Default' }])
    const result = await accounts.list()
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/accounts')
  })

  it('lists sub-accounts', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 2, name: 'Sub' }])
    const result = await accounts.listSubAccounts(1)
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/accounts/1/sub_accounts')
  })

  it('lists courses under an account without filter', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 10, name: 'Course A' }])
    const result = await accounts.listCourses(1)
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/accounts/1/courses', undefined)
  })

  it('lists courses with a search term', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
    await accounts.listCourses(1, { search_term: 'math' })
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/accounts/1/courses', { search_term: 'math' })
  })

  it('lists users under an account without filter', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 5, name: 'Alice' }])
    const result = await accounts.listUsers(1)
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/accounts/1/users', undefined)
  })

  it('gets available report types for an account', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce([{ report: 'grade_export_csv', title: 'Grade Export' }])
    const result = await accounts.getReports(1)
    expect(result).toHaveLength(1)
    expect(client.request).toHaveBeenCalledWith('/api/v1/accounts/1/reports')
  })
})
