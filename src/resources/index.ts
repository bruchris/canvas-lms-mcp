import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../canvas'
import { registerSyllabusResource } from './syllabus'
import { registerAssignmentDescriptionResource } from './assignment-description'
import { registerCourseStructureUI } from './ui-course-structure'
import { registerAccountNotificationsUI } from './ui-account-notifications'

export function registerAllResources(server: McpServer, canvas: CanvasClient): void {
  registerSyllabusResource(server, canvas)
  registerAssignmentDescriptionResource(server, canvas)
  registerCourseStructureUI(server)
  registerAccountNotificationsUI(server)
}
