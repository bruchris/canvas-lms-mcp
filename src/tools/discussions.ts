import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function discussionTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_discussions',
      description: 'List all discussion topics in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.discussions.list(course_id)
      },
    },
    {
      name: 'get_discussion',
      description: 'Get details for a single discussion topic by ID.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        topic_id: z.number().describe('The Canvas discussion topic ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const topic_id = params.topic_id as number
        return canvas.discussions.get(course_id, topic_id)
      },
    },
    {
      name: 'list_announcements',
      description: 'List all announcements in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.discussions.listAnnouncements(course_id)
      },
    },
    {
      name: 'post_discussion_entry',
      description: 'Post a new entry (reply) to a discussion topic.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        topic_id: z.number().describe('The Canvas discussion topic ID'),
        message: z.string().describe('The message body (supports HTML)'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const topic_id = params.topic_id as number
        const message = params.message as string
        return canvas.discussions.postEntry(course_id, topic_id, message)
      },
    },
  ]
}
