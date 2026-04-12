import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'
import { healthTools } from './health'
import { courseTools } from './courses'

export function getAllTools(canvas: CanvasClient): ToolDefinition[] {
  return [...healthTools(canvas), ...courseTools(canvas)]
}

export function registerAllTools(server: McpServer, canvas: CanvasClient): void {
  const tools = getAllTools(canvas)
  for (const tool of tools) {
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema,
      tool.annotations,
      async (params) => {
        try {
          const result = await tool.handler(params as Record<string, unknown>)
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          }
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: formatError(error) }],
            isError: true,
          }
        }
      },
    )
  }
}

export function formatError(error: unknown): string {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status
    const message = 'message' in error ? String((error as { message: string }).message) : ''
    switch (status) {
      case 401:
        return 'Canvas token is invalid or expired'
      case 403:
        return "You don't have permission to perform this action in this course"
      case 404:
        return 'Course/assignment/submission not found \u2014 check the ID'
      default:
        return `Canvas API error (${status}): ${message}`
    }
  }
  if (error instanceof Error) {
    if (error.message.includes('fetch')) {
      return 'Failed to connect to Canvas \u2014 check your base URL'
    }
    return error.message
  }
  return 'An unexpected error occurred'
}
