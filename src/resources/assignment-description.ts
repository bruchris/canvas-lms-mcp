import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../canvas'
import { CanvasApiError } from '../canvas/client'
import { formatError } from '../tools'

export function registerAssignmentDescriptionResource(
  server: McpServer,
  canvas: CanvasClient,
): void {
  const template = new ResourceTemplate(
    'canvas://course/{courseId}/assignment/{assignmentId}/description',
    { list: undefined },
  )

  server.resource(
    'assignment-description',
    template,
    { mimeType: 'text/html' },
    async (_uri, variables) => {
      const courseId = Number(variables.courseId)
      const assignmentId = Number(variables.assignmentId)
      const uri = `canvas://course/${courseId}/assignment/${assignmentId}/description`
      if (Number.isNaN(courseId) || Number.isNaN(assignmentId)) {
        return {
          contents: [{ uri, mimeType: 'text/plain', text: 'Invalid course or assignment ID' }],
        }
      }
      try {
        const assignment = await canvas.assignments.get(courseId, assignmentId)
        return {
          contents: [
            {
              uri,
              mimeType: 'text/html',
              text: assignment.description ?? '',
            },
          ],
        }
      } catch (error) {
        if (!(error instanceof CanvasApiError)) {
          console.error('Unexpected error in assignment-description resource:', error)
        }
        return {
          contents: [{ uri, mimeType: 'text/plain', text: formatError(error) }],
        }
      }
    },
  )
}
