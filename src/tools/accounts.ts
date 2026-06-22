import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'

export function accountTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
  return [
    {
      name: 'get_account',
      description: 'Get details for a Canvas account by ID.',
      inputSchema: {
        account_id: z.number().describe('The Canvas account ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        return canvas.accounts.get(params.account_id as number)
      },
    },
    {
      name: 'list_accounts',
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
      description: 'List sub-accounts under a given Canvas account.',
      inputSchema: {
        account_id: z.number().describe('The parent Canvas account ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        return canvas.accounts.listSubAccounts(params.account_id as number)
      },
    },
    {
      name: 'list_account_courses',
      description: 'List courses under a given Canvas account.',
      inputSchema: {
        account_id: z.number().describe('The Canvas account ID'),
        search_term: z.string().optional().describe('Search courses by name or course code'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        return canvas.accounts.listCourses(params.account_id as number, {
          search_term: params.search_term as string | undefined,
        })
      },
    },
    {
      name: 'list_account_users',
      description: 'List users in a Canvas account.',
      inputSchema: {
        account_id: z.number().describe('The Canvas account ID'),
        search_term: z.string().optional().describe('Search users by name, email, or login'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const account_id = params.account_id as number
        const users = await canvas.accounts.listUsers(account_id, {
          search_term: params.search_term as string | undefined,
        })
        if (!pseudonymizer?.isEnabled()) return users
        // Account-scoped; no course context. Use account_id as map key.
        return pseudonymizer.anonymizeUsers(String(account_id), users)
      },
    },
    {
      name: 'get_account_reports',
      description: 'List available report types for a Canvas account.',
      inputSchema: {
        account_id: z.number().describe('The Canvas account ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        return canvas.accounts.getReports(params.account_id as number)
      },
    },
    {
      name: 'list_account_notifications',
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
