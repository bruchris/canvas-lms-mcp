import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CanvasClient } from './canvas'
import { getAllTools, formatError } from './tools'

export interface CanvasMCPServerConfig {
  token: string
  baseUrl: string
}

export interface CanvasMCPServer {
  server: McpServer
  canvas: CanvasClient
}

export function createCanvasMCPServer(config: CanvasMCPServerConfig): CanvasMCPServer {
  const canvas = new CanvasClient({
    token: config.token,
    baseUrl: config.baseUrl,
  })

  const server = new McpServer({
    name: 'canvas-lms-mcp',
    version: '1.0.0',
  })

  // Register all tools
  const tools = getAllTools(canvas)
  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.annotations, async (params) => {
      try {
        const result = await tool.handler(params as Record<string, unknown>)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        }
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatError(error) }],
          isError: true,
        }
      }
    })
  }

  return { server, canvas }
}
