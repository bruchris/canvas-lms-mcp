import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../canvas'
import { registerSyllabusResource } from './syllabus'
import { registerAssignmentDescriptionResource } from './assignment-description'

export function registerAllResources(server: McpServer, canvas: CanvasClient): void {
  registerSyllabusResource(server, canvas)
  registerAssignmentDescriptionResource(server, canvas)
}
