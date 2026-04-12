import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../canvas'

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
      const assignment = await canvas.assignments.get(courseId, assignmentId)
      return {
        contents: [
          {
            uri: `canvas://course/${courseId}/assignment/${assignmentId}/description`,
            mimeType: 'text/html',
            text: assignment.description ?? '',
          },
        ],
      }
    },
  )
}
