import { describe, it, expect, vi } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../../src/canvas'
import { CanvasApiError } from '../../src/canvas/client'
import { registerSyllabusResource } from '../../src/resources/syllabus'

describe('registerSyllabusResource', () => {
  function buildMockCanvas(overrides: Record<string, unknown> = {}): CanvasClient {
    return {
      courses: {
        getSyllabus: vi.fn().mockResolvedValue('<p>Welcome to the course</p>'),
        ...overrides,
      },
    } as unknown as CanvasClient
  }

  function captureHandler(canvas: CanvasClient) {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    const resourceSpy = vi.spyOn(server, 'resource')
    registerSyllabusResource(server, canvas)
    // The handler is the last argument to server.resource()
    const call = resourceSpy.mock.calls[0]
    return call[call.length - 1] as (uri: unknown, variables: Record<string, string>) => Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }>
  }

  it('registers without throwing', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    expect(() => registerSyllabusResource(server, buildMockCanvas())).not.toThrow()
  })

  it('returns syllabus HTML when Canvas API succeeds', async () => {
    const canvas = buildMockCanvas()
    const handler = captureHandler(canvas)
    const result = await handler(new URL('canvas://course/1/syllabus'), { courseId: '1' })
    expect(canvas.courses.getSyllabus).toHaveBeenCalledWith(1)
    expect(result.contents[0].text).toBe('<p>Welcome to the course</p>')
    expect(result.contents[0].mimeType).toBe('text/html')
  })

  it('returns empty string when syllabus is null', async () => {
    const canvas = buildMockCanvas({ getSyllabus: vi.fn().mockResolvedValue(null) })
    const handler = captureHandler(canvas)
    const result = await handler(new URL('canvas://course/1/syllabus'), { courseId: '1' })
    expect(result.contents[0].text).toBe('')
  })

  it('returns error message when Canvas API fails', async () => {
    const canvas = buildMockCanvas({
      getSyllabus: vi.fn().mockRejectedValue(new CanvasApiError('Not Found', 404, '/api/v1/courses/999')),
    })
    const handler = captureHandler(canvas)
    const result = await handler(new URL('canvas://course/999/syllabus'), { courseId: '999' })
    expect(result.contents[0].text).toContain('not found')
  })

  it('returns error for invalid course ID', async () => {
    const canvas = buildMockCanvas()
    const handler = captureHandler(canvas)
    const result = await handler(new URL('canvas://course/abc/syllabus'), { courseId: 'abc' })
    expect(result.contents[0].text).toBe('Invalid course ID')
  })
})
