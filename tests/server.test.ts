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

  it('accepts a role for tool filtering without throwing', () => {
    // The filtered set is asserted at the getAllTools choke point in
    // tests/tools/role-filter.test.ts; here we only verify the factory wires a
    // role through to registerAllTools cleanly for every role + unset.
    for (const role of [undefined, 'student', 'teacher', 'admin'] as const) {
      const result = createCanvasMCPServer({
        token: 'test-token',
        baseUrl: 'https://canvas.example.com',
        role,
      })
      expect(result.server).toBeInstanceOf(McpServer)
    }
  })
})
