import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { AccountUserSort } from '../canvas/accounts'
import type { SearchUserInclude } from '../canvas/users'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'
import { type CanvasId, canvasIdInput } from '../canvas/id'
import { SEARCH_USER_INCLUDE, USER_SORT } from './users'

const ACCOUNT_USER_SORT = [...USER_SORT, 'id'] as const

export function accountTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
  return [
    {
      name: 'get_account',
      title: 'Get Account',
      description:
        'Get a single Canvas account by ID, including its name, parent and root account IDs, UUID, default storage quotas, and workflow state. Find the account_id via `list_accounts`, or `list_sub_accounts` on a parent account to find one of its children. Requires an admin role on the account.',
      inputSchema: {
        account_id: canvasIdInput().describe('The Canvas account ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        return canvas.accounts.get(params.account_id as CanvasId)
      },
    },
    {
      name: 'list_accounts',
      title: 'List Accounts',
      description: 'List all accounts accessible to the authenticated user.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        return canvas.accounts.list()
      },
    },
    {
      name: 'list_sub_accounts',
      title: 'List Sub-Accounts',
      description:
        "List the direct child accounts nested under a given Canvas account — one level deep, not grandchildren or deeper descendants. Fetches every page (100 per request) and fails with a 'Results are incomplete' error instead of silently truncating. Use `get_account` to fetch one sub-account's full details by ID, or call this tool again with a child's ID as `account_id` to walk further down the tree. Requires an admin role on the account.",
      inputSchema: {
        account_id: canvasIdInput().describe('The parent Canvas account ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        return canvas.accounts.listSubAccounts(params.account_id as CanvasId)
      },
    },
    {
      name: 'list_account_courses',
      title: 'List Account Courses',
      description:
        "List every course in a Canvas account, optionally filtered by `search_term` matching course name or course code. Fetches every page (100 per request) and fails with a 'Results are incomplete' error instead of silently truncating. Use `list_sub_accounts` first if you want one sub-account's courses rather than this account's own, and `list_courses` instead for the courses the authenticated user is enrolled in or can access, rather than a full account inventory. Requires an admin role on the account.",
      inputSchema: {
        account_id: canvasIdInput().describe('The Canvas account ID'),
        search_term: z.string().optional().describe('Search courses by name or course code'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        return canvas.accounts.listCourses(params.account_id as CanvasId, {
          search_term: params.search_term as string | undefined,
        })
      },
    },
    {
      name: 'list_account_users',
      title: 'List Account Users',
      description:
        "List every user in a Canvas account — every role the account contains, not only students — optionally filtered by `search_term` matching name, email, or login. Fetches every page (100 per request) and fails with a 'Results are incomplete' error instead of silently truncating. Use `include` to add email, last_login, avatar_url, time_zone, or uuid to each returned user, `sort`/`order` to control result ordering (`sort: \"id\"` is Canvas's recommended choice when paging through many results), and `list_course_users` to scope the roster to one course rather than the whole account. When CANVAS_PSEUDONYMIZE_STUDENTS is enabled, every returned user's name and contact info is replaced with a stable pseudonym — this tool has no enrollment data to tell students from staff, so every row is masked the same way; use `resolve_pseudonym` to map one back to a real user_id. Requires an admin role on the account.",
      inputSchema: {
        account_id: canvasIdInput().describe('The Canvas account ID'),
        search_term: z.string().optional().describe('Search users by name, email, or login'),
        sort: z
          .enum(ACCOUNT_USER_SORT)
          .optional()
          .describe('Sort field. Use "id" for efficient pagination through many pages of results.'),
        order: z.enum(['asc', 'desc']).optional().describe('Sort order'),
        include: z
          .array(z.enum(SEARCH_USER_INCLUDE))
          .optional()
          .describe('Extra fields to include on each user (Canvas include[] param)'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const account_id = params.account_id as CanvasId
        const users = await canvas.accounts.listUsers(account_id, {
          search_term: params.search_term as string | undefined,
          sort: params.sort as AccountUserSort | undefined,
          order: params.order as 'asc' | 'desc' | undefined,
          include: params.include as ReadonlyArray<SearchUserInclude> | undefined,
        })
        if (!pseudonymizer?.isEnabled()) return users
        // Account-scoped; no course context. Use account_id as map key.
        return pseudonymizer.anonymizeUsers(String(account_id), users)
      },
    },
    {
      name: 'get_account_reports',
      title: 'Get Account Reports',
      description:
        'List the report types a Canvas account supports — csv/grade exports, SIS imports, and institution-specific types — each with its report key, title, expected parameters, and the most recent `last_run` status if one was ever generated. This only lists what can be run; it does not start, re-run, or download a report, and there is no report-running tool registered on this server. Use `get_account` to confirm the account first. Requires an admin role on the account.',
      inputSchema: {
        account_id: canvasIdInput().describe('The Canvas account ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        return canvas.accounts.getReports(params.account_id as CanvasId)
      },
    },
    {
      name: 'list_account_notifications',
      title: 'List Account Notifications',
      audience: 'shared',
      description:
        'List active global institution-wide announcements for the current user (maintenance windows, term deadlines, policy notices).',
      inputSchema: {
        account_id: z
          .string()
          .optional()
          .describe('Canvas account ID, or "self" for the root account (default: "self")'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const accountId = (params.account_id as string) || 'self'
        return canvas.accounts.listNotifications(accountId)
      },
    },
    {
      // Payload is institution-authored announcement metadata only — no student PII,
      // so no pseudonymizer wrap is required. If a future revision adds per-user
      // fields, this tool MUST be added to PSEUDONYMIZER_WRAPPED_TOOLS and wrapped.
      name: 'view_account_notifications',
      title: 'View Account Notifications',
      audience: 'shared',
      description:
        'Interactive panel of active institution-wide announcements. Returns the same payload as `list_account_notifications` and additionally links to an MCP Apps UI resource that renders scannable announcement cards with type filters and search. Hosts that do not support MCP Apps fall back to the JSON payload (same as `list_account_notifications`).',
      inputSchema: {
        account_id: z
          .string()
          .optional()
          .describe('Canvas account ID, or "self" for the root account (default: "self")'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      ui: {
        resourceUri: 'ui://canvas-lms-mcp/account-notifications.html',
        csp: {
          connectDomains: [],
          resourceDomains: [],
          frameDomains: [],
        },
      },
      handler: async (params) => {
        const accountId = (params.account_id as string) || 'self'
        return canvas.accounts.listNotifications(accountId)
      },
    },
  ]
}
