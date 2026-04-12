import { describe, it, expect, vi } from 'vitest'
import { registerAllTools, getAllTools } from '../../src/tools'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../../src/canvas'

describe('getAllTools', () => {
  it('returns an array of tool definitions', () => {
    const mockCanvas = {
      courses: { list: async () => [], get: async () => ({}), getSyllabus: async () => null },
    } as unknown as CanvasClient
    const tools = getAllTools(mockCanvas)

    expect(Array.isArray(tools)).toBe(true)
  })

  it('returns health and course tools', () => {
    const mockCanvas = {
      courses: { list: async () => [], get: async () => ({}), getSyllabus: async () => null },
    } as unknown as CanvasClient
    const tools = getAllTools(mockCanvas)
    const names = tools.map((t) => t.name)

    expect(names).toContain('health_check')
    expect(names).toContain('list_courses')
    expect(names).toContain('get_course')
    expect(names).toContain('get_syllabus')
    expect(tools).toHaveLength(4)
  })
})

describe('registerAllTools', () => {
  it('is a function exported from tools module', () => {
    expect(typeof registerAllTools).toBe('function')
  })

  it('registers tools on the MCP server', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    const mockCanvas = {
      courses: { list: async () => [], get: async () => ({}), getSyllabus: async () => null },
    } as unknown as CanvasClient

    expect(() => registerAllTools(server, mockCanvas)).not.toThrow()
  })
})
