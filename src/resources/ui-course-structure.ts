import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { COURSE_STRUCTURE_HTML } from '../ui/course-structure.html'

const RESOURCE_URI = 'ui://canvas-lms-mcp/course-structure.html'

export function registerCourseStructureUI(server: McpServer): void {
  registerAppResource(
    server,
    'Course Structure',
    RESOURCE_URI,
    { description: 'Interactive course structure tree' },
    async () => ({
      contents: [
        {
          uri: RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: COURSE_STRUCTURE_HTML,
        },
      ],
    }),
  )
}
