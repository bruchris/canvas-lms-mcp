import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server'
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
  const domainTools = toolDomainCatalog.flatMap((registration) =>
    registration.getTools(canvas, pseudonymizer),
  )
  const conditional = pseudonymizer ? pseudonymTools(pseudonymizer) : []
  return [...domainTools, ...conditional]
}

type ToolResponse = {
  content: { type: 'text'; text: string }[]
  isError?: boolean
  _meta?: Record<string, unknown>
}

function buildHandler(
  tool: ToolDefinition,
  pseudonymizer: Pseudonymizer | undefined,
): (params: Record<string, unknown>, extra?: unknown) => Promise<ToolResponse> {
  return async (params) => {
    try {
      const result = await tool.handler(params)
      const text =
        result === undefined ? 'Operation completed successfully.' : JSON.stringify(result, null, 2)
      const response: ToolResponse = {
        content: [{ type: 'text' as const, text }],
      }
      if (pseudonymizer?.isEnabled()) {
        response._meta = { pseudonymized: true, note: PSEUDONYM_META_NOTE }
      }
      return response
    } catch (error) {
      if (!(error instanceof CanvasApiError)) {
        console.error(`Unexpected error in tool "${tool.name}":`, error)
      }
      return {
        content: [{ type: 'text' as const, text: formatError(error) }],
        isError: true,
      }
    }
  }
}

export function registerAllTools(
  server: McpServer,
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): void {
  const tools = getAllTools(canvas, pseudonymizer)
  for (const tool of tools) {
    const handler = buildHandler(tool, pseudonymizer)
    if (tool.ui) {
      registerAppTool(
        server,
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          _meta: { ui: { resourceUri: tool.ui.resourceUri } },
        },
        handler,
      )
    } else {
      server.tool(tool.name, tool.description, tool.inputSchema, tool.annotations, handler)
    }
  }
}
export { formatError } from './errors'
