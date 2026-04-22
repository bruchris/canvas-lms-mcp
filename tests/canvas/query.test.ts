import { describe, it, expect } from 'vitest'
import { appendCanvasQuery, toCanvasQuery } from '../../src/canvas/query'

describe('toCanvasQuery', () => {
  it('returns an empty URLSearchParams when given no input', () => {
    expect(toCanvasQuery().toString()).toBe('')
    expect(toCanvasQuery({}).toString()).toBe('')
  })

  it('encodes scalar values via set (last write wins)', () => {
    const params = toCanvasQuery({ per_page: 50, search_term: 'alice', published: true })
    expect(params.get('per_page')).toBe('50')
    expect(params.get('search_term')).toBe('alice')
    expect(params.get('published')).toBe('true')
  })

  it('encodes arrays as repeated key[] entries matching Canvas convention', () => {
    const params = toCanvasQuery({ include: ['email', 'enrollments'] })
    expect(params.getAll('include[]')).toEqual(['email', 'enrollments'])
    expect(params.toString()).toBe('include%5B%5D=email&include%5B%5D=enrollments')
  })

  it('does not double-suffix keys that already end in []', () => {
    const params = toCanvasQuery({ 'student_ids[]': ['self', '1'] })
    expect(params.getAll('student_ids[]')).toEqual(['self', '1'])
    expect(params.getAll('student_ids[][]')).toEqual([])
  })

  it('skips undefined and null values', () => {
    const params = toCanvasQuery({ search: undefined, extra: null, include: ['term'] })
    expect(params.has('search')).toBe(false)
    expect(params.has('extra')).toBe(false)
    expect(params.getAll('include[]')).toEqual(['term'])
  })

  it('skips empty arrays', () => {
    const params = toCanvasQuery({ include: [], student_ids: [] })
    expect(params.toString()).toBe('')
  })

  it('stringifies number and boolean array entries', () => {
    const params = toCanvasQuery({ assignment_ids: [1, 2, 3], flags: [true, false] })
    expect(params.getAll('assignment_ids[]')).toEqual(['1', '2', '3'])
    expect(params.getAll('flags[]')).toEqual(['true', 'false'])
  })

  it('appendCanvasQuery preserves existing entries on the target', () => {
    const target = new URLSearchParams('per_page=100')
    appendCanvasQuery(target, { include: ['term'] })
    expect(target.get('per_page')).toBe('100')
    expect(target.getAll('include[]')).toEqual(['term'])
  })
})
