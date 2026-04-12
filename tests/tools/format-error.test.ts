import { describe, it, expect } from 'vitest'
import { formatError } from '../../src/tools'
import { CanvasApiError } from '../../src/canvas'

describe('formatError', () => {
  it('maps 401 to token invalid message', () => {
    const error = new CanvasApiError('Unauthorized', 401, '/api/v1/courses')
    expect(formatError(error)).toBe('Canvas token is invalid or expired')
  })

  it('maps 403 to permission denied message', () => {
    const error = new CanvasApiError('Forbidden', 403, '/api/v1/courses/1')
    expect(formatError(error)).toBe(
      "You don't have permission to perform this action in this course",
    )
  })

  it('maps 404 to not found message', () => {
    const error = new CanvasApiError('Not Found', 404, '/api/v1/courses/999')
    expect(formatError(error)).toBe('Course/assignment/submission not found \u2014 check the ID')
  })

  it('maps other status codes to generic Canvas API error', () => {
    const error = new CanvasApiError('Rate limited', 429, '/api/v1/courses')
    expect(formatError(error)).toBe('Canvas API error (429): Rate limited')
  })

  it('maps fetch errors to connection message', () => {
    const error = new TypeError('fetch failed')
    expect(formatError(error)).toBe('Failed to connect to Canvas \u2014 check your base URL')
  })

  it('maps generic errors to their message', () => {
    const error = new Error('Something broke')
    expect(formatError(error)).toBe('Something broke')
  })

  it('maps non-error values to unexpected error message', () => {
    expect(formatError('string error')).toBe('An unexpected error occurred')
    expect(formatError(null)).toBe('An unexpected error occurred')
    expect(formatError(undefined)).toBe('An unexpected error occurred')
  })
})
