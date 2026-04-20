import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../canvas'
import { CanvasApiError } from '../canvas/client'
import type { ToolDefinition } from './types'
import { toolDomainCatalog } from './catalog'
import { formatError } from './errors'

export function getAllTools(canvas: CanvasClient): ToolDefinition[] {
  return toolDomainCatalog.flatMap((registration) => registration.getTools(canvas))
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
