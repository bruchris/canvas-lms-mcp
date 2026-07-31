import { describe, it, expect } from 'vitest'
import { mapWithConcurrency } from '../../src/canvas/concurrency'

describe('mapWithConcurrency', () => {
  it('preserves input order even when calls settle out of order', async () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    const result = await mapWithConcurrency(items, 3, async (n) => {
      // Later items resolve first: the delay shrinks as n grows, so within each
      // batch the calls settle in reverse order. Output must still be in order.
      await new Promise((resolve) => setTimeout(resolve, (10 - n) * 2))
      return n * 10
    })
    expect(result).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90])
  })

  it('never runs more than `limit` calls concurrently', async () => {
    const items = Array.from({ length: 25 }, (_, i) => i)
    let inFlight = 0
    let peak = 0
    const result = await mapWithConcurrency(items, 10, async (n) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight--
      return n
    })
    expect(result).toHaveLength(25)
    expect(peak).toBeLessThanOrEqual(10)
    // Sanity: the work actually overlapped, so peak==1 would mean we proved nothing.
    expect(peak).toBeGreaterThan(1)
  })

  it('processes every item when the count does not divide evenly by the limit', async () => {
    const items = [1, 2, 3, 4, 5, 6, 7]
    const seen: number[] = []
    const result = await mapWithConcurrency(items, 3, async (n) => {
      seen.push(n)
      return n * 2
    })
    expect(result).toEqual([2, 4, 6, 8, 10, 12, 14])
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('passes the item index to fn', async () => {
    const result = await mapWithConcurrency(
      ['a', 'b', 'c'],
      2,
      async (item, index) => `${index}:${item}`,
    )
    expect(result).toEqual(['0:a', '1:b', '2:c'])
  })

  it('propagates the first rejection from fn', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom')
        return n
      }),
    ).rejects.toThrow('boom')
  })

  it('returns an empty array without calling fn for no items', async () => {
    let calls = 0
    const result = await mapWithConcurrency([], 5, async (n) => {
      calls++
      return n
    })
    expect(result).toEqual([])
    expect(calls).toBe(0)
  })

  it('rejects with a RangeError when limit is less than 1', async () => {
    await expect(mapWithConcurrency([1], 0, async (n) => n)).rejects.toThrow(RangeError)
  })
})
