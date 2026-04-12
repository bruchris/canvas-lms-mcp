import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import type { CanvasClient } from '../../src/canvas'
import type { ToolDefinition } from '../../src/tools/types'

// We'll import healthTools once it exists
// For now, this will fail at import time
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

  it('returns error status when Canvas API fails', async () => {
    const canvas = buildMockCanvas({
      courses: {
        list: vi.fn().mockRejectedValue(new Error('fetch failed')),
        get: vi.fn(),
        getSyllabus: vi.fn(),
      } as unknown as CanvasClient['courses'],
    })
    const tools = healthTools(canvas)
    const result = await tools[0].handler({})
    expect(result).toEqual({
      status: 'error',
      message: 'fetch failed',
    })
  })

  it('has a description', () => {
    const canvas = buildMockCanvas()
    const tools = healthTools(canvas)
    expect(tools[0].description).toBeTruthy()
  })
})
