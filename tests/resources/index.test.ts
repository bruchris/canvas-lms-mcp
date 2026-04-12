import { describe, it, expect, vi } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../../src/canvas'
import { registerAllResources } from '../../src/resources'

describe('registerAllResources', () => {
  function buildMockCanvas(): CanvasClient {
    return {
      courses: {
        getSyllabus: vi.fn().mockResolvedValue(null),
      },
      assignments: {
        get: vi.fn().mockResolvedValue({ description: null }),
      },
    } as unknown as CanvasClient
  }

  it('registers all resources without throwing', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    const canvas = buildMockCanvas()
    expect(() => registerAllResources(server, canvas)).not.toThrow()
  })
})
