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
    {
      name: 'create_discussion',
      description: 'Create a new discussion topic in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        title: z.string().min(1).describe('Title of the discussion topic'),
        message: z.string().optional().describe('Body text of the discussion (supports HTML)'),
        discussion_type: z
          .enum(['side_comment', 'threaded'])
          .optional()
          .describe('Discussion type: side_comment (flat) or threaded'),
        published: z.boolean().optional().describe('Whether the topic is published'),
        require_initial_post: z
          .boolean()
          .optional()
          .describe('Require students to post before seeing replies'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.discussions.create(course_id, {
          title: params.title as string,
          message: params.message as string | undefined,
          discussion_type: params.discussion_type as 'side_comment' | 'threaded' | undefined,
          published: params.published as boolean | undefined,
          require_initial_post: params.require_initial_post as boolean | undefined,
        })
      },
    },
    {
      name: 'update_discussion',
      description: 'Update an existing discussion topic.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        topic_id: z.number().describe('The Canvas discussion topic ID'),
        title: z.string().optional().describe('New title for the discussion topic'),
        message: z.string().optional().describe('New body text (supports HTML)'),
        published: z.boolean().optional().describe('Publish or unpublish the topic'),
        require_initial_post: z
          .boolean()
          .optional()
          .describe('Require students to post before seeing replies'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const topic_id = params.topic_id as number
        const updateParams = {
          title: params.title as string | undefined,
          message: params.message as string | undefined,
          published: params.published as boolean | undefined,
          require_initial_post: params.require_initial_post as boolean | undefined,
        }
        if (Object.values(updateParams).every((v) => v === undefined)) {
          throw new Error('At least one field must be provided to update a discussion topic')
        }
        return canvas.discussions.update(course_id, topic_id, updateParams)
      },
    },
    {
      name: 'delete_discussion',
      description: 'Delete a discussion topic from a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        topic_id: z.number().describe('The Canvas discussion topic ID to delete'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const topic_id = params.topic_id as number
        await canvas.discussions.delete(course_id, topic_id)
        return { deleted: true, topic_id }
      },
    },
  ]
}
