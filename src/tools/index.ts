import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function getAllTools(_canvas: CanvasClient): ToolDefinition[] {
  return [
    // Tool domain modules will be registered here as implemented.
    // See implementation plan Tasks 7, 9, 11.
    // Pattern: ...courseTools(canvas), ...assignmentTools(canvas), etc.
  ]
}

export function formatError(error: unknown): string {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status
    const message = 'message' in error ? String((error as { message: string }).message) : ''
    switch (status) {
      case 401:
        return 'Canvas token is invalid or expired'
      case 403:
        return "You don't have permission to perform this action in this course"
      case 404:
        return 'Course/assignment/submission not found \u2014 check the ID'
      default:
        return `Canvas API error (${status}): ${message}`
    }
  }
  if (error instanceof Error) {
    if (error.message.includes('fetch')) {
      return 'Failed to connect to Canvas \u2014 check your base URL'
    }
    return error.message
  }
  return 'An unexpected error occurred'
}
