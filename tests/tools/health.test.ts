import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { CanvasApiError } from '../../src/canvas/client'
import { healthTools } from '../../src/tools/health'

describe('healthTools', () => {
  function buildMockCanvas(overrides: Partial<CanvasClient> = {}): CanvasClient {
    return {
      users: {
        getProfile: vi.fn(),
        get: vi.fn(),
        listStudents: vi.fn(),
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
      users: {
        getProfile: vi.fn().mockResolvedValue({ id: 1, name: 'Test User' }),
        get: vi.fn(),
        listStudents: vi.fn(),
      } as unknown as CanvasClient['users'],
    })
    const tools = healthTools(canvas)
    const result = await tools[0].handler({})
    expect(result).toEqual({
      status: 'ok',
      message: 'Canvas API is reachable',
    })
  })

  it('propagates CanvasApiError to outer handler for formatError()', async () => {
    const canvas = buildMockCanvas({
      users: {
        getProfile: vi
          .fn()
          .mockRejectedValue(new CanvasApiError('Unauthorized', 401, '/api/v1/users/self/profile')),
        get: vi.fn(),
        listStudents: vi.fn(),
      } as unknown as CanvasClient['users'],
    })
    const tools = healthTools(canvas)
    await expect(tools[0].handler({})).rejects.toThrow(CanvasApiError)
  })

  it('propagates non-CanvasApiError errors', async () => {
    const canvas = buildMockCanvas({
      users: {
        getProfile: vi.fn().mockRejectedValue(new TypeError('unexpected')),
        get: vi.fn(),
        listStudents: vi.fn(),
      } as unknown as CanvasClient['users'],
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
