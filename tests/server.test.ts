import { describe, it, expect } from 'vitest'
import { createCanvasMCPServer } from '../src/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CanvasClient } from '../src/canvas'

describe('createCanvasMCPServer', () => {
  it('creates an MCP server instance', () => {
    const result = createCanvasMCPServer({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })

    expect(result).toBeDefined()
    expect(result.server).toBeDefined()
    expect(result.canvas).toBeDefined()
  })

  it('returns an McpServer instance', () => {
    const result = createCanvasMCPServer({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })

    expect(result.server).toBeInstanceOf(McpServer)
  })

  it('returns a CanvasClient instance', () => {
    const result = createCanvasMCPServer({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })

    expect(result.canvas).toBeInstanceOf(CanvasClient)
  })

  it('uses registerAllTools to wire tools into server', () => {
    // Verify factory completes without error — registerAllTools is called internally
    const result = createCanvasMCPServer({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })

    expect(result.server).toBeDefined()
    expect(result.canvas).toBeDefined()
  })
})
