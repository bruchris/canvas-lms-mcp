import { describe, it, expect, vi } from 'vitest'
import { registerAllTools, getAllTools } from '../../src/tools'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../../src/canvas'

describe('getAllTools', () => {
  it('returns an array of tool definitions', () => {
    const mockCanvas = {} as CanvasClient
    const tools = getAllTools(mockCanvas)

    expect(Array.isArray(tools)).toBe(true)
  })

  it('returns empty array when no tool modules registered', () => {
    const mockCanvas = {} as CanvasClient
    const tools = getAllTools(mockCanvas)

    expect(tools).toEqual([])
  })
})

describe('registerAllTools', () => {
  it('is a function exported from tools module', () => {
    expect(typeof registerAllTools).toBe('function')
  })

  it('registers tools on the MCP server', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    const mockCanvas = {} as CanvasClient

    // Should not throw with empty tool list
    expect(() => registerAllTools(server, mockCanvas)).not.toThrow()
  })
})
