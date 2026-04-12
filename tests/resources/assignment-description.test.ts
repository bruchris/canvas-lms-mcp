import { describe, it, expect, vi } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../../src/canvas'
import { CanvasApiError } from '../../src/canvas/client'
import { registerAssignmentDescriptionResource } from '../../src/resources/assignment-description'

describe('registerAssignmentDescriptionResource', () => {
  function buildMockCanvas(overrides: Record<string, unknown> = {}): CanvasClient {
    return {
      assignments: {
        get: vi.fn().mockResolvedValue({ description: '<p>Do the homework</p>' }),
        ...overrides,
      },
    } as unknown as CanvasClient
  }

  function captureHandler(canvas: CanvasClient) {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    const resourceSpy = vi.spyOn(server, 'resource')
    registerAssignmentDescriptionResource(server, canvas)
    const call = resourceSpy.mock.calls[0]
    return call[call.length - 1] as (
      uri: unknown,
      variables: Record<string, string>,
    ) => Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }>
  }

  it('registers without throwing', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    expect(() => registerAssignmentDescriptionResource(server, buildMockCanvas())).not.toThrow()
  })

  it('returns assignment description when Canvas API succeeds', async () => {
    const canvas = buildMockCanvas()
    const handler = captureHandler(canvas)
    const result = await handler(new URL('canvas://course/1/assignment/2/description'), {
      courseId: '1',
      assignmentId: '2',
    })
    expect(canvas.assignments.get).toHaveBeenCalledWith(1, 2)
    expect(result.contents[0].text).toBe('<p>Do the homework</p>')
    expect(result.contents[0].mimeType).toBe('text/html')
  })

  it('returns empty string when description is null', async () => {
    const canvas = buildMockCanvas({ get: vi.fn().mockResolvedValue({ description: null }) })
    const handler = captureHandler(canvas)
    const result = await handler(new URL('canvas://course/1/assignment/2/description'), {
      courseId: '1',
      assignmentId: '2',
    })
    expect(result.contents[0].text).toBe('')
  })

  it('returns error message when Canvas API fails', async () => {
    const canvas = buildMockCanvas({
      get: vi
        .fn()
        .mockRejectedValue(
          new CanvasApiError('Not Found', 404, '/api/v1/courses/1/assignments/999'),
        ),
    })
    const handler = captureHandler(canvas)
    const result = await handler(new URL('canvas://course/1/assignment/999/description'), {
      courseId: '1',
      assignmentId: '999',
    })
    expect(result.contents[0].text).toContain('not found')
  })

  it('returns error for invalid IDs', async () => {
    const canvas = buildMockCanvas()
    const handler = captureHandler(canvas)
    const result = await handler(new URL('canvas://course/abc/assignment/def/description'), {
      courseId: 'abc',
      assignmentId: 'def',
    })
    expect(result.contents[0].text).toBe('Invalid course or assignment ID')
  })
})
