import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function accountTools(canvas: CanvasClient): ToolDefinition[] {
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
        return canvas.accounts.listUsers(params.account_id as number, {
          search_term: params.search_term as string | undefined,
        })
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
  ]
}
