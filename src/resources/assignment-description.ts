import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../canvas'
import { CanvasApiError } from '../canvas/client'
import { RESOURCE_LABELS } from '../provenance/fields'
import { fenceBlock, isProvenanceFencingEnabled } from '../provenance/markers'
import { formatError } from '../tools'

function fenceDescription(description: string): string {
  if (description.length === 0 || !isProvenanceFencingEnabled()) return description
  return fenceBlock(description, RESOURCE_LABELS.assignmentDescription)
}

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
              // Fenced here because resources bypass buildHandler (BRU-2104 §8.2).
              text: fenceDescription(assignment.description ?? ''),
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
