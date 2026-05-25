import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../canvas'
import { CanvasApiError } from '../canvas/client'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'
import { toolDomainCatalog } from './catalog'
import { formatError } from './errors'
import { pseudonymTools } from './pseudonym'

const PSEUDONYM_META_NOTE =
  'Student names and contact info in this response have been replaced with stable pseudonyms (CANVAS_PSEUDONYMIZE_STUDENTS=true). Real names are not available to this tool.'

export function getAllTools(canvas: CanvasClient, pseudonymizer?: Pseudonymizer): ToolDefinition[] {
  const domainTools = toolDomainCatalog.flatMap((registration) => registration.getTools(canvas))
  const conditional = pseudonymizer ? pseudonymTools(pseudonymizer) : []
  return [...domainTools, ...conditional]
}

export function registerAllTools(
  server: McpServer,
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): void {
  const tools = getAllTools(canvas, pseudonymizer)
  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.inputSchema, tool.annotations, async (params) => {
      try {
        const result = await tool.handler(params as Record<string, unknown>)
        const text =
          result === undefined
            ? 'Operation completed successfully.'
            : JSON.stringify(result, null, 2)
        const response: {
          content: { type: 'text'; text: string }[]
          _meta?: Record<string, unknown>
        } = {
          content: [{ type: 'text' as const, text }],
        }
        if (pseudonymizer?.isEnabled()) {
          response._meta = { pseudonymized: true, note: PSEUDONYM_META_NOTE }
        }
        return response
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
