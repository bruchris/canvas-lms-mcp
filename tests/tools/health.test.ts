import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { CanvasApiError } from '../../src/canvas/client'
import { healthTools } from '../../src/tools/health'

describe('healthTools', () => {
  function buildMockCanvas(overrides: Partial<CanvasClient> = {}): CanvasClient {
    return {
      courses: {
        list: vi.fn(),
        get: vi.fn(),
        getSyllabus: vi.fn(),
      },
      ...overrides,
    } as unknown as CanvasClient
  }

  it('returns an array with one tool definition', () => {
    const canvas = buildMockCanvas()
    const tools = healthTools(canvas)
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('health_check')
  })

  it('has empty input schema', () => {
    const canvas = buildMockCanvas()
    const tools = healthTools(canvas)
    const healthCheck = tools[0]
    expect(healthCheck.inputSchema).toEqual({})
  })

  it('has correct annotations', () => {
    const canvas = buildMockCanvas()
    const tools = healthTools(canvas)
    const healthCheck = tools[0]
    expect(healthCheck.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: true,
    })
  })

  it('returns ok status when Canvas API is reachable', async () => {
    const canvas = buildMockCanvas({
      courses: {
        list: vi.fn().mockResolvedValue([{ id: 1, name: 'Test Course' }]),
        get: vi.fn(),
        getSyllabus: vi.fn(),
      } as unknown as CanvasClient['courses'],
    })
    const tools = healthTools(canvas)
    const result = await tools[0].handler({})
    expect(result).toEqual({
      status: 'ok',
      message: 'Canvas API is reachable',
    })
  })

  it('returns error status when Canvas API returns CanvasApiError', async () => {
    const canvas = buildMockCanvas({
      courses: {
        list: vi.fn().mockRejectedValue(new CanvasApiError('Unauthorized', 401, '/api/v1/courses')),
        get: vi.fn(),
        getSyllabus: vi.fn(),
      } as unknown as CanvasClient['courses'],
    })
    const tools = healthTools(canvas)
    const result = await tools[0].handler({})
    expect(result).toEqual({
      status: 'error',
      message: 'Unauthorized',
    })
  })

  it('rethrows non-CanvasApiError errors', async () => {
    const canvas = buildMockCanvas({
      courses: {
        list: vi.fn().mockRejectedValue(new TypeError('unexpected')),
        get: vi.fn(),
        getSyllabus: vi.fn(),
      } as unknown as CanvasClient['courses'],
    })
    const tools = healthTools(canvas)
    await expect(tools[0].handler({})).rejects.toThrow('unexpected')
  })

  it('has a description', () => {
    const canvas = buildMockCanvas()
    const tools = healthTools(canvas)
    expect(tools[0].description).toBeTruthy()
  })
})
