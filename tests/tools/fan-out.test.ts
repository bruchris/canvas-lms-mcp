import { describe, it, expect, vi } from 'vitest'
import { CanvasApiError } from '../../src/canvas/client'
import { fanOut } from '../../src/tools/fan-out'

interface Item {
  id: number
  name: string
}

const ITEMS: Item[] = [
  { id: 1, name: 'one' },
  { id: 2, name: 'two' },
  { id: 3, name: 'three' },
]

describe('fanOut', () => {
  it('routes each item into applied / skipped / failed by its outcome', async () => {
    const result = await fanOut<Item, Record<string, unknown>>({
      items: ITEMS,
      errorContext: (item) => `processing item ${item.id}`,
      onError: (item, message) => ({ id: item.id, error: message }),
      perform: async (item) => {
        if (item.id === 1) return { status: 'applied', result: { id: 1 } }
        if (item.id === 2) return { status: 'skipped', result: { id: 2, skip_reason: 'because' } }
        throw new CanvasApiError('Forbidden', 403, '/x')
      },
    })

    expect(result.applied).toEqual([{ id: 1 }])
    expect(result.skipped).toEqual([{ id: 2, skip_reason: 'because' }])
    expect(result.failed).toEqual([{ id: 3, error: 'Forbidden' }])
    expect(result.summary).toEqual({ total: 3, applied: 1, skipped: 1, failed: 1 })
  })

  it('passes CanvasApiError messages through raw without logging them', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await fanOut<Item, Record<string, unknown>>({
      items: [ITEMS[0]],
      errorContext: (item) => `processing item ${item.id}`,
      onError: (item, message) => ({ id: item.id, error: message }),
      perform: async () => {
        throw new CanvasApiError('Unprocessable Entity', 422, '/x')
      },
    })

    expect(result.failed).toEqual([{ id: 1, error: 'Unprocessable Entity' }])
    // A routine Canvas error (e.g. an expected 422) is recorded quietly.
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('console.error-logs a non-CanvasApiError before reducing it to a per-item message', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await fanOut<Item, Record<string, unknown>>({
      items: [ITEMS[0]],
      errorContext: (item) => `processing item ${item.id}`,
      onError: (item, message) => ({ id: item.id, error: message }),
      perform: async () => {
        throw new TypeError('boom')
      },
    })

    expect(result.failed).toEqual([{ id: 1, error: 'boom' }])
    expect(errorSpy).toHaveBeenCalledTimes(1)
    // The log line is interpolated from errorContext so the offending item is identifiable.
    expect(errorSpy.mock.calls[0][0]).toBe('Unexpected error processing item 1:')
    errorSpy.mockRestore()
  })

  it('reduces a non-Error throw to the "Unknown error" string', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await fanOut<Item, Record<string, unknown>>({
      items: [ITEMS[0]],
      errorContext: (item) => `processing item ${item.id}`,
      onError: (item, message) => ({ id: item.id, error: message }),
      perform: async () => {
        throw 'just a string'
      },
    })

    expect(result.failed).toEqual([{ id: 1, error: 'Unknown error' }])
    // A non-Error throw is still a non-CanvasApiError, so it is logged.
    expect(errorSpy).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })

  it('includes not_found (and summary.not_found) only when notFound is supplied', async () => {
    const withNotFound = await fanOut<Item, Record<string, unknown>>({
      items: [ITEMS[0]],
      notFound: [999],
      errorContext: (item) => `processing item ${item.id}`,
      onError: (item, message) => ({ id: item.id, error: message }),
      perform: async (item) => ({ status: 'applied', result: { id: item.id } }),
    })
    expect(withNotFound.not_found).toEqual([999])
    expect(withNotFound.summary.not_found).toBe(1)

    const withoutNotFound = await fanOut<Item, Record<string, unknown>>({
      items: [ITEMS[0]],
      errorContext: (item) => `processing item ${item.id}`,
      onError: (item, message) => ({ id: item.id, error: message }),
      perform: async (item) => ({ status: 'applied', result: { id: item.id } }),
    })
    expect('not_found' in withoutNotFound).toBe(false)
    expect('not_found' in withoutNotFound.summary).toBe(false)
  })

  it('returns empty buckets and a zeroed summary for no items', async () => {
    const result = await fanOut<Item, Record<string, unknown>>({
      items: [],
      errorContext: (item) => `processing item ${item.id}`,
      onError: (item, message) => ({ id: item.id, error: message }),
      perform: async (item) => ({ status: 'applied', result: { id: item.id } }),
    })
    expect(result.applied).toEqual([])
    expect(result.skipped).toEqual([])
    expect(result.failed).toEqual([])
    expect(result.summary).toEqual({ total: 0, applied: 0, skipped: 0, failed: 0 })
  })
})
