import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../canvas'
import { CanvasApiError } from '../canvas/client'
import type { ToolDefinition } from './types'
import { healthTools } from './health'
import { courseTools } from './courses'
import { assignmentTools } from './assignments'
import { submissionTools } from './submissions'
import { rubricTools } from './rubrics'
import { quizTools } from './quizzes'
import { fileTools } from './files'
import { userTools } from './users'
import { groupTools } from './groups'
import { enrollmentTools } from './enrollments'
import { discussionTools } from './discussions'
import { moduleTools } from './modules'
import { pageTools } from './pages'
import { calendarTools } from './calendar'
import { conversationTools } from './conversations'
import { peerReviewTools } from './peer-reviews'
import { accountTools } from './accounts'
import { analyticsTools } from './analytics'
import { studentTools } from './student'

export function getAllTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    ...healthTools(canvas),
    ...courseTools(canvas),
    ...assignmentTools(canvas),
    ...submissionTools(canvas),
    ...rubricTools(canvas),
    ...quizTools(canvas),
    ...fileTools(canvas),
    ...userTools(canvas),
    ...groupTools(canvas),
    ...enrollmentTools(canvas),
    ...discussionTools(canvas),
    ...moduleTools(canvas),
    ...pageTools(canvas),
    ...calendarTools(canvas),
    ...conversationTools(canvas),
    ...peerReviewTools(canvas),
    ...accountTools(canvas),
    ...analyticsTools(canvas),
    ...studentTools(canvas),
  ]
}

export function registerAllTools(server: McpServer, canvas: CanvasClient): void {
  const tools = getAllTools(canvas)
  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.inputSchema, tool.annotations, async (params) => {
      try {
        const result = await tool.handler(params as Record<string, unknown>)
        const text =
          result === undefined
            ? 'Operation completed successfully.'
            : JSON.stringify(result, null, 2)
        return {
          content: [{ type: 'text' as const, text }],
        }
      } catch (error) {
        if (error instanceof CanvasApiError) {
          // CanvasApiError — expected, no need to log
        } else {
          console.error(`Unexpected error in tool "${tool.name}":`, error)
        }
        return {
          content: [{ type: 'text' as const, text: formatError(error) }],
          isError: true,
        }
      }
    })
  }
}

export function formatError(error: unknown): string {
  if (error instanceof CanvasApiError) {
    const status = error.status
    const message = error.message
    switch (status) {
      case 401:
        return 'Canvas token is invalid or expired'
      case 403:
        return "You don't have permission to perform this action in this course"
      case 404:
        return 'Course/assignment/submission not found — check the ID'
      case 422:
        return `Invalid data sent to Canvas: ${message}`
      case 429:
        return 'Canvas API rate limit exceeded — wait a moment and retry'
      case 500:
      case 502:
      case 503:
        return `Canvas server error (${status}) — try again later`
      default:
        return `Canvas API error (${status}): ${message}`
    }
  }
  if (error instanceof Error) {
    if (isNetworkError(error)) {
      return 'Failed to connect to Canvas — check your base URL'
    }
    return error.message
  }
  return 'An unexpected error occurred'
}

function isNetworkError(error: Error): boolean {
  const msg = error.message.toLowerCase()
  return (
    msg.includes('fetch') ||
    msg.includes('enotfound') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('network') ||
    msg.includes('dns') ||
    msg.includes('socket') ||
    error.name === 'TypeError'
  )
}
