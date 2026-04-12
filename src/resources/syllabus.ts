import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../canvas'
import { formatError } from '../tools'

export function registerSyllabusResource(server: McpServer, canvas: CanvasClient): void {
  const template = new ResourceTemplate('canvas://course/{courseId}/syllabus', {
    list: undefined,
  })

  server.resource(
    'course-syllabus',
    template,
    { mimeType: 'text/html' },
    async (_uri, variables) => {
      const courseId = Number(variables.courseId)
      if (Number.isNaN(courseId)) {
        return {
          contents: [
            {
              uri: `canvas://course/${variables.courseId}/syllabus`,
              mimeType: 'text/plain',
              text: 'Invalid course ID',
            },
          ],
        }
      }
      try {
        const body = await canvas.courses.getSyllabus(courseId)
        return {
          contents: [
            {
              uri: `canvas://course/${courseId}/syllabus`,
              mimeType: 'text/html',
              text: body ?? '',
            },
          ],
        }
      } catch (error) {
        return {
          contents: [
            {
              uri: `canvas://course/${courseId}/syllabus`,
              mimeType: 'text/plain',
              text: formatError(error),
            },
          ],
        }
      }
    },
  )
}
