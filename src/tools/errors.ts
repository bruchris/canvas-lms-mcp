import { CanvasApiError } from '../canvas/client'

export function formatError(error: unknown): string {
  if (error instanceof CanvasApiError) {
    const status = error.status
    const message = error.message

    // LTI not enabled: Canvas returns "Tool not configured" for /api/quiz/v1/ when New Quizzes
    // LTI isn't enabled on the instance. A real 404 on a valid endpoint won't include this phrase.
    const ltiMarkers = ['Tool not configured', 'tool is not configured']
    const looksLikeLtiNotEnabled =
      error.endpoint.startsWith('/api/quiz/v1/') &&
      (status === 404 || status === 401) &&
      ltiMarkers.some((m) => message.toLowerCase().includes(m.toLowerCase()))
    if (looksLikeLtiNotEnabled) {
      return 'New Quizzes is not enabled on this Canvas instance. Ask a Canvas admin to enable the "New Quizzes" LTI tool, or use the Classic quiz tools (list_quizzes / get_quiz) instead.'
    }

    // Rate-limit on New Quizzes: 403 + body containing "Rate Limit Exceeded"
    if (status === 403 && message.toLowerCase().includes('rate limit exceeded')) {
      return 'Canvas rate-limit hit. Wait a few seconds and retry, or chunk your bulk operation.'
    }

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
