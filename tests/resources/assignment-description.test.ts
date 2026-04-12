import { describe, it, expect, vi } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../../src/canvas'
import { registerAssignmentDescriptionResource } from '../../src/resources/assignment-description'

describe('registerAssignmentDescriptionResource', () => {
  function buildMockCanvas(): CanvasClient {
    return {
      assignments: {
        get: vi.fn().mockResolvedValue({ description: '<p>Do the homework</p>' }),
      },
    } as unknown as CanvasClient
  }

  it('registers without throwing', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    const canvas = buildMockCanvas()
    expect(() => registerAssignmentDescriptionResource(server, canvas)).not.toThrow()
  })
})
