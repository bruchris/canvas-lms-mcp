import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../canvas'
import { CanvasApiError } from '../canvas/client'
import { type CanvasId, normalizeCanvasIdInput } from '../canvas/id'
import { RESOURCE_LABELS } from '../provenance/fields'
import { fenceBlock, isProvenanceFencingEnabled } from '../provenance/markers'
import { formatError } from '../tools'

function fenceSyllabus(body: string): string {
  if (body.length === 0 || !isProvenanceFencingEnabled()) return body
  return fenceBlock(body, RESOURCE_LABELS.syllabus)
}

export function registerSyllabusResource(server: McpServer, canvas: CanvasClient): void {
  const template = new ResourceTemplate('canvas://course/{courseId}/syllabus', {
    list: undefined,
  })

  server.resource(
    'course-syllabus',
    template,
    { mimeType: 'text/html' },
    async (_uri, variables) => {
      // See the note in src/resources/assignment-description.ts: a URI-template
      // variable is a string, and `Number()` on it was BRU-2730 §4.4's forbidden
      // coercion.
      const rawCourseId = String(variables.courseId)
      let courseId: CanvasId
      try {
        courseId = normalizeCanvasIdInput(rawCourseId)
      } catch {
        return {
          contents: [
            {
              uri: `canvas://course/${rawCourseId}/syllabus`,
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
              // Resources bypass buildHandler, so the fence is applied here
              // (BRU-2104 §8.2). Block form: the payload is text/html, with no
              // JSON string value to sit inside. An empty syllabus is returned
              // bare — a marker around nothing is noise, not provenance.
              text: fenceSyllabus(body ?? ''),
            },
          ],
        }
      } catch (error) {
        if (!(error instanceof CanvasApiError)) {
          console.error('Unexpected error in syllabus resource:', error)
        }
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
