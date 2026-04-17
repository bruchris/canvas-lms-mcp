import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../canvas'
import { CanvasApiError } from '../canvas/client'
import type { ToolDefinition } from './types'
import { formatError } from './errors'
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
import { dashboardTools } from './dashboard'

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
    ...dashboardTools(canvas),
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
export { formatError } from './errors'
