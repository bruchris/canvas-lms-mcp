import { describe, it, expect, vi } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../../src/canvas'
import { registerSyllabusResource } from '../../src/resources/syllabus'

describe('registerSyllabusResource', () => {
  function buildMockCanvas(): CanvasClient {
    return {
      courses: {
        getSyllabus: vi.fn().mockResolvedValue('<p>Welcome to the course</p>'),
      },
    } as unknown as CanvasClient
  }

  it('registers without throwing', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    const canvas = buildMockCanvas()
    expect(() => registerSyllabusResource(server, canvas)).not.toThrow()
  })
})
