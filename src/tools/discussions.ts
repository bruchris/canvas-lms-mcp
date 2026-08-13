import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { CanvasDiscussionTopic } from '../canvas/types'
import type { ToolDefinition } from './types'

/**
 * Canvas returns 200 with a plain discussion topic (no error) when the caller
 * requests is_announcement: true but lacks announcement-create permission. Throwing
 * here — rather than returning the downgraded topic as success — is what turns that
 * into a structured tool failure instead of a false success.
 */
function assertAnnouncementHonored(
  topic: CanvasDiscussionTopic,
  action: 'created' | 'updated',
): void {
  if (topic.is_announcement) return
  throw new Error(
    `Canvas ${action} topic ${topic.id} as a regular discussion, not an announcement — the caller lacks ` +
      'announcement-create permission in this course. The announcement was NOT honored; use topic ID ' +
      `${topic.id} to find or clean up the discussion, or ask a course admin/teacher to grant announcement ` +
      'permission and retry.',
  )
}

export function discussionTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_discussions',
      title: 'List Discussions',
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
      title: 'Get Discussion',
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
      title: 'List Announcements',
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
      title: 'Post Discussion Entry',
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
      title: 'Create Discussion',
      audience: 'educator',
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
        is_announcement: z
          .boolean()
          .optional()
          .describe(
            'When true, requests an announcement instead of a discussion topic. Canvas silently ' +
              'downgrades this to a plain discussion topic (no error) if the caller lacks ' +
              "announcement permission in the course — check the response's own " +
              '`is_announcement` field rather than assuming the request was honored.',
          ),
        delayed_post_at: z
          .string()
          .datetime()
          .optional()
          .describe('ISO 8601 datetime to schedule the topic for future posting'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const is_announcement = params.is_announcement as boolean | undefined
        const topic = await canvas.discussions.create(course_id, {
          title: params.title as string,
          message: params.message as string | undefined,
          discussion_type: params.discussion_type as 'side_comment' | 'threaded' | undefined,
          published: params.published as boolean | undefined,
          require_initial_post: params.require_initial_post as boolean | undefined,
          is_announcement,
          delayed_post_at: params.delayed_post_at as string | undefined,
        })
        if (is_announcement) assertAnnouncementHonored(topic, 'created')
        return topic
      },
    },
    {
      name: 'update_discussion',
      title: 'Update Discussion',
      audience: 'educator',
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
        is_announcement: z
          .boolean()
          .optional()
          .describe(
            'When true, requests marking the topic as an announcement. Canvas silently ' +
              'downgrades this to a plain discussion topic (no error) if the caller lacks ' +
              "announcement permission in the course — check the response's own " +
              '`is_announcement` field rather than assuming the request was honored.',
          ),
        delayed_post_at: z
          .string()
          .datetime()
          .optional()
          .describe('ISO 8601 datetime to schedule the topic for future posting'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const topic_id = params.topic_id as number
        const is_announcement = params.is_announcement as boolean | undefined
        const updateParams = {
          title: params.title as string | undefined,
          message: params.message as string | undefined,
          published: params.published as boolean | undefined,
          require_initial_post: params.require_initial_post as boolean | undefined,
          is_announcement,
          delayed_post_at: params.delayed_post_at as string | undefined,
        }
        if (Object.values(updateParams).every((v) => v === undefined)) {
          throw new Error('At least one field must be provided to update a discussion topic')
        }
        const topic = await canvas.discussions.update(course_id, topic_id, updateParams)
        if (is_announcement) assertAnnouncementHonored(topic, 'updated')
        return topic
      },
    },
    {
      name: 'delete_discussion',
      title: 'Delete Discussion',
      audience: 'educator',
      description: 'Delete a discussion topic from a course. This action is permanent.',
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
