import { CanvasApiError } from '../canvas/client'

export function formatError(error: unknown): string {
  if (error instanceof CanvasApiError) {
    const status = error.status
    const message = error.message
    switch (status) {
      case 401:
        return 'Canvas token is invalid or expired'
      case 403:
        return "You don't have permission to perform this action in this course"
      case 404:
        return 'Course/assignment/submission not found — check the ID'
      case 422:
        return `Invalid data sent to Canvas: ${message}`
      case 429:
        return 'Canvas API rate limit exceeded — wait a moment and retry'
      case 500:
      case 502:
      case 503:
        return `Canvas server error (${status}) — try again later`
      default:
        return `Canvas API error (${status}): ${message}`
    }
  }
  if (error instanceof Error) {
    if (isNetworkError(error)) {
      return 'Failed to connect to Canvas — check your base URL'
    }
    return error.message
  }
  return 'An unexpected error occurred'
}

function isNetworkError(error: Error): boolean {
  const msg = error.message.toLowerCase()
  return (
    msg.includes('fetch') ||
    msg.includes('enotfound') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('network') ||
    msg.includes('dns') ||
    msg.includes('socket') ||
    error.name === 'TypeError'
  )
}
