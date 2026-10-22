import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CanvasClient } from '../../src/canvas'
import type {
  CanvasAccount,
  CanvasAccountNotification,
  CanvasAccountReport,
  CanvasCourse,
  CanvasUser,
} from '../../src/canvas/types'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import { accountTools } from '../../src/tools/accounts'
import { getAllTools } from '../../src/tools'

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
    parameters: null,
    last_run: null,
  }

  const mockNotification: CanvasAccountNotification = {
    id: 10,
    subject: 'System Maintenance',
    message: 'Canvas will be offline Sunday 2–4 AM.',
    start_at: '2026-06-14T02:00:00Z',
    end_at: '2026-06-14T04:00:00Z',
    icon: 'warning',
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
        listNotifications: vi.fn().mockResolvedValue([mockNotification]),
      },
    } as unknown as CanvasClient
  }

  it('returns 8 tool definitions', () => {
    expect(accountTools(buildMockCanvas())).toHaveLength(8)
  })

  describe('description quality (BRU-3108)', () => {
    // Guards against the five Glama-flagged tools regressing to a one-line
    // restatement; semantic checks only, no brittle full-prose snapshots.
    // The mechanical floor is also enforced by the description-quality.test.ts
    // CI ratchet now that these five are no longer in the baseline.
    const REWRITTEN_LIST_TOOLS = ['list_sub_accounts', 'list_account_courses', 'list_account_users']

    // These descriptions route to tools outside accounts.ts (search_users,
    // list_course_users, resolve_pseudonym), so the sibling check needs the
    // full server-wide registry, not just this domain's 8 tools.
    function registeredToolNames(): Set<string> {
      const deep: unknown = new Proxy(function () {}, {
        get: () => deep,
        apply: () => deep,
      })
      return new Set(getAllTools(deep as CanvasClient).map((t) => t.name))
    }

    it.each(['get_account', ...REWRITTEN_LIST_TOOLS, 'get_account_reports'])(
      '%s names a registered sibling tool and clears the length floor',
      (name) => {
        const tools = accountTools(buildMockCanvas())
        const names = registeredToolNames()
        const tool = tools.find((t) => t.name === name)!
        expect(tool.description.length).toBeGreaterThanOrEqual(150)
        const mentionsSibling = [...names].some(
          (sibling) => sibling !== name && tool.description.includes(sibling),
        )
        expect(mentionsSibling).toBe(true)
      },
    )

    it('list tools state pagination behavior', () => {
      const tools = accountTools(buildMockCanvas())
      for (const name of REWRITTEN_LIST_TOOLS) {
        const tool = tools.find((t) => t.name === name)!
        expect(tool.description).toMatch(/every page|pagin|truncat/i)
      }
    })

    it('get_account_reports does not imply it starts or downloads a report', () => {
      const tool = accountTools(buildMockCanvas()).find((t) => t.name === 'get_account_reports')!
      expect(tool.description).toMatch(/does not start|not start, re-run/i)
    })

    it("list_account_users' description states pseudonymization semantics", () => {
      const tool = accountTools(buildMockCanvas()).find((t) => t.name === 'list_account_users')!
      expect(tool.description).toMatch(/CANVAS_PSEUDONYMIZE_STUDENTS/)
      expect(tool.description).toMatch(/pseudonym/i)
      expect(tool.description).toContain('resolve_pseudonym')
    })
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
      'list_account_notifications',
      'view_account_notifications',
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
      await tool.handler({ account_id: '1' })
      expect(canvas.accounts.get).toHaveBeenCalledWith('1')
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
      await tool.handler({ account_id: '1' })
      expect(canvas.accounts.listSubAccounts).toHaveBeenCalledWith('1')
    })
  })

  describe('list_account_courses', () => {
    it('delegates to canvas.accounts.listCourses without search_term', async () => {
      const canvas = buildMockCanvas()
      const tool = accountTools(canvas).find((t) => t.name === 'list_account_courses')!
      await tool.handler({ account_id: '1' })
      expect(canvas.accounts.listCourses).toHaveBeenCalledWith('1', { search_term: undefined })
    })

    it('delegates to canvas.accounts.listCourses with search_term', async () => {
      const canvas = buildMockCanvas()
      const tool = accountTools(canvas).find((t) => t.name === 'list_account_courses')!
      await tool.handler({ account_id: '1', search_term: 'math' })
      expect(canvas.accounts.listCourses).toHaveBeenCalledWith('1', { search_term: 'math' })
    })
  })

  describe('list_account_users', () => {
    it('delegates to canvas.accounts.listUsers', async () => {
      const canvas = buildMockCanvas()
      const tool = accountTools(canvas).find((t) => t.name === 'list_account_users')!
      await tool.handler({ account_id: '1' })
      expect(canvas.accounts.listUsers).toHaveBeenCalledWith('1', { search_term: undefined })
    })
  })

  describe('get_account_reports', () => {
    it('delegates to canvas.accounts.getReports', async () => {
      const canvas = buildMockCanvas()
      const tool = accountTools(canvas).find((t) => t.name === 'get_account_reports')!
      await tool.handler({ account_id: '1' })
      expect(canvas.accounts.getReports).toHaveBeenCalledWith('1')
    })
  })

  describe('list_account_notifications', () => {
    it('has read-only annotations', () => {
      const tool = accountTools(buildMockCanvas()).find(
        (t) => t.name === 'list_account_notifications',
      )!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('defaults account_id to "self" when not provided', async () => {
      const canvas = buildMockCanvas()
      const tool = accountTools(canvas).find((t) => t.name === 'list_account_notifications')!
      await tool.handler({})
      expect(canvas.accounts.listNotifications).toHaveBeenCalledWith('self')
    })

    it('defaults account_id to "self" when an empty string is passed', async () => {
      const canvas = buildMockCanvas()
      const tool = accountTools(canvas).find((t) => t.name === 'list_account_notifications')!
      await tool.handler({ account_id: '' })
      expect(canvas.accounts.listNotifications).toHaveBeenCalledWith('self')
    })

    it('passes account_id to canvas.accounts.listNotifications when provided', async () => {
      const canvas = buildMockCanvas()
      const tool = accountTools(canvas).find((t) => t.name === 'list_account_notifications')!
      await tool.handler({ account_id: '42' })
      expect(canvas.accounts.listNotifications).toHaveBeenCalledWith('42')
    })

    it('returns the notification array from Canvas', async () => {
      const canvas = buildMockCanvas()
      const tool = accountTools(canvas).find((t) => t.name === 'list_account_notifications')!
      const result = (await tool.handler({})) as CanvasAccountNotification[]
      expect(result).toHaveLength(1)
      expect(result[0].subject).toBe('System Maintenance')
    })

    it('propagates a 404 error from Canvas', async () => {
      const { CanvasApiError } = await import('../../src/canvas/client')
      const canvas = buildMockCanvas()
      vi.mocked(canvas.accounts.listNotifications).mockRejectedValueOnce(
        new CanvasApiError('Not Found', 404, '/api/v1/accounts/self/account_notifications'),
      )
      const tool = accountTools(canvas).find((t) => t.name === 'list_account_notifications')!
      await expect(tool.handler({})).rejects.toBeInstanceOf(CanvasApiError)
    })
  })

  describe('view_account_notifications', () => {
    it('has read-only annotations', () => {
      const tool = accountTools(buildMockCanvas()).find(
        (t) => t.name === 'view_account_notifications',
      )!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('declares the UI resource URI', () => {
      const tool = accountTools(buildMockCanvas()).find(
        (t) => t.name === 'view_account_notifications',
      )!
      expect(tool.ui?.resourceUri).toBe('ui://canvas-lms-mcp/account-notifications.html')
    })

    it('keeps CSP empty (widget is self-contained)', () => {
      const tool = accountTools(buildMockCanvas()).find(
        (t) => t.name === 'view_account_notifications',
      )!
      expect(tool.ui?.csp).toEqual({
        connectDomains: [],
        resourceDomains: [],
        frameDomains: [],
      })
    })

    it('defaults account_id to "self" when not provided', async () => {
      const canvas = buildMockCanvas()
      const tool = accountTools(canvas).find((t) => t.name === 'view_account_notifications')!
      await tool.handler({})
      expect(canvas.accounts.listNotifications).toHaveBeenCalledWith('self')
    })

    it('defaults account_id to "self" when an empty string is passed', async () => {
      const canvas = buildMockCanvas()
      const tool = accountTools(canvas).find((t) => t.name === 'view_account_notifications')!
      await tool.handler({ account_id: '' })
      expect(canvas.accounts.listNotifications).toHaveBeenCalledWith('self')
    })

    it('passes account_id to canvas.accounts.listNotifications when provided', async () => {
      const canvas = buildMockCanvas()
      const tool = accountTools(canvas).find((t) => t.name === 'view_account_notifications')!
      await tool.handler({ account_id: '42' })
      expect(canvas.accounts.listNotifications).toHaveBeenCalledWith('42')
    })

    it('returns the same payload as list_account_notifications', async () => {
      const canvas = buildMockCanvas()
      const tools = accountTools(canvas)
      const list = tools.find((t) => t.name === 'list_account_notifications')!
      const view = tools.find((t) => t.name === 'view_account_notifications')!
      const listResult = await list.handler({})
      const viewResult = await view.handler({})
      expect(viewResult).toEqual(listResult)
    })

    it('propagates a 404 error from Canvas (same as the JSON tool)', async () => {
      const { CanvasApiError } = await import('../../src/canvas/client')
      const canvas = buildMockCanvas()
      vi.mocked(canvas.accounts.listNotifications).mockRejectedValueOnce(
        new CanvasApiError('Not Found', 404, '/api/v1/accounts/self/account_notifications'),
      )
      const tool = accountTools(canvas).find((t) => t.name === 'view_account_notifications')!
      await expect(tool.handler({})).rejects.toBeInstanceOf(CanvasApiError)
    })
  })

  describe('pseudonymization', () => {
    let tmpDir: string
    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'account-tool-'))
    })
    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true })
    })

    function makePseudonymizer(enabled = true) {
      return new Pseudonymizer({
        baseUrl: 'https://school.instructure.com/api/v1',
        rootDir: tmpDir,
        env: enabled ? { CANVAS_PSEUDONYMIZE_STUDENTS: 'true' } : {},
      })
    }

    describe('list_account_users', () => {
      it('pseudonymizes user names when enabled', async () => {
        const canvas = buildMockCanvas()
        const tool = accountTools(canvas, makePseudonymizer()).find(
          (t) => t.name === 'list_account_users',
        )!
        const result = (await tool.handler({ account_id: '1' })) as CanvasUser[]
        expect(result[0].name).toMatch(/^Student \d+$/)
      })

      it('passes through real names when disabled', async () => {
        const canvas = buildMockCanvas()
        const tool = accountTools(canvas, makePseudonymizer(false)).find(
          (t) => t.name === 'list_account_users',
        )!
        const result = (await tool.handler({ account_id: '1' })) as CanvasUser[]
        expect(result[0].name).toBe('Alice')
      })
    })
  })
})
