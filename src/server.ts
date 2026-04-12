import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CanvasClient } from './canvas'
import { registerAllTools } from './tools'

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

  registerAllTools(server, canvas)

  return { server, canvas }
}
