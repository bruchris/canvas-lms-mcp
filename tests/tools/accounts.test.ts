import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasAccount, CanvasAccountReport, CanvasCourse, CanvasUser } from '../../src/canvas/types'
import { accountTools } from '../../src/tools/accounts'

describe('accountTools', () => {
  const mockAccount: CanvasAccount = {
    id: 1,
    name: 'Default Account',
    parent_account_id: null,
    root_account_id: null,
    uuid: 'abc-123',
    default_storage_quota_mb: 500,
    default_user_storage_quota_mb: 50,
    default_group_storage_quota_mb: 50,
    workflow_state: 'active',
  }

  const mockCourse: CanvasCourse = {
    id: 10,
    name: 'Intro to Math',
    course_code: 'MATH101',
    workflow_state: 'available',
  }

  const mockUser: CanvasUser = {
    id: 5,
    name: 'Alice',
    sortable_name: 'Alice',
    short_name: 'Alice',
    login_id: 'alice@example.com',
    email: 'alice@example.com',
    created_at: '2026-01-01T00:00:00Z',
  }

  const mockReport: CanvasAccountReport = {
    report: 'grade_export_csv',
    title: 'Grade Export',
    parameters_schema: null,
    last_run: null,
  }

  function buildMockCanvas(): CanvasClient {
    return {
      accounts: {
        get: vi.fn().mockResolvedValue(mockAccount),
        list: vi.fn().mockResolvedValue([mockAccount]),
        listSubAccounts: vi.fn().mockResolvedValue([mockAccount]),
        listCourses: vi.fn().mockResolvedValue([mockCourse]),
        listUsers: vi.fn().mockResolvedValue([mockUser]),
        getReports: vi.fn().mockResolvedValue([mockReport]),
      },
    } as unknown as CanvasClient
  }

  it('returns 6 tool definitions', () => {
    expect(accountTools(buildMockCanvas())).toHaveLength(6)
  })

  it('exports tools with correct names', () => {
    const names = accountTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'get_account',
      'list_accounts',
      'list_sub_accounts',
      'list_account_courses',
      'list_account_users',
      'get_account_reports',
    ])
  })

  describe('get_account', () => {
    it('has read-only annotations', () => {
      const tool = accountTools(buildMockCanvas()).find((t) => t.name === 'get_account')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.accounts.get', async () => {
      const canvas = buildMockCanvas()
      const tool = accountTools(canvas).find((t) => t.name === 'get_account')!
      await tool.handler({ account_id: 1 })
      expect(canvas.accounts.get).toHaveBeenCalledWith(1)
    })
  })

  describe('list_accounts', () => {
    it('has read-only annotations', () => {
      const tool = accountTools(buildMockCanvas()).find((t) => t.name === 'list_accounts')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.accounts.list', async () => {
      const canvas = buildMockCanvas()
      const tool = accountTools(canvas).find((t) => t.name === 'list_accounts')!
      await tool.handler({})
      expect(canvas.accounts.list).toHaveBeenCalled()
    })
  })

  describe('list_sub_accounts', () => {
    it('delegates to canvas.accounts.listSubAccounts', async () => {
      const canvas = buildMockCanvas()
      const tool = accountTools(canvas).find((t) => t.name === 'list_sub_accounts')!
      await tool.handler({ account_id: 1 })
      expect(canvas.accounts.listSubAccounts).toHaveBeenCalledWith(1)
    })
  })

  describe('list_account_courses', () => {
    it('delegates to canvas.accounts.listCourses without search_term', async () => {
      const canvas = buildMockCanvas()
      const tool = accountTools(canvas).find((t) => t.name === 'list_account_courses')!
      await tool.handler({ account_id: 1 })
      expect(canvas.accounts.listCourses).toHaveBeenCalledWith(1, { search_term: undefined })
    })

    it('delegates to canvas.accounts.listCourses with search_term', async () => {
      const canvas = buildMockCanvas()
      const tool = accountTools(canvas).find((t) => t.name === 'list_account_courses')!
      await tool.handler({ account_id: 1, search_term: 'math' })
      expect(canvas.accounts.listCourses).toHaveBeenCalledWith(1, { search_term: 'math' })
    })
  })

  describe('list_account_users', () => {
    it('delegates to canvas.accounts.listUsers', async () => {
      const canvas = buildMockCanvas()
      const tool = accountTools(canvas).find((t) => t.name === 'list_account_users')!
      await tool.handler({ account_id: 1 })
      expect(canvas.accounts.listUsers).toHaveBeenCalledWith(1, { search_term: undefined })
    })
  })

  describe('get_account_reports', () => {
    it('delegates to canvas.accounts.getReports', async () => {
      const canvas = buildMockCanvas()
      const tool = accountTools(canvas).find((t) => t.name === 'get_account_reports')!
      await tool.handler({ account_id: 1 })
      expect(canvas.accounts.getReports).toHaveBeenCalledWith(1)
    })
  })
})
