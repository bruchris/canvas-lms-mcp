import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import { CanvasApiError } from '../canvas/client'
import type { CanvasDiscussionTopic } from '../canvas/types'
import type { ToolDefinition } from './types'
import { type CanvasId, canvasIdInput } from '../canvas/id'

/**
 * Canvas deliberately hides anonymous discussion topics from its topic-scoped REST
 * actions. `DiscussionTopicsApiController#is_not_anonymous` renders
 * `{ errors: [{ message: 'The specified resource does not exist.' }] }` with HTTP 404
 * whenever `DiscussionTopic#anonymous?`, and that predicate is `!anonymous_state.nil?`
 * — so it fires for `partial_anonymity` as well as `full_anonymity`. The guard runs on
 * `show`, `view`, `entries`, `replies` and `entry_list`; of those, only `show` is
 * reachable from this server (`get_discussion`). `add_entry` is deliberately not
 * guarded, so `post_discussion_entry` keeps working on an anonymous topic.
 *
 * The index action does list these topics and serializes `anonymous_state`
 * (`ALLOWED_TOPIC_FIELDS` in `lib/api/v1/discussion_topics.rb`), which is what makes a
 * single fallback list request a reliable discriminator between "anonymous, so Canvas
 * will never serve the detail endpoint" and "genuinely absent".
 */
const ANONYMITY_DESCRIPTIONS: Record<string, string> = {
  full_anonymity: 'fully anonymous',
  partial_anonymity: 'partially anonymous',
}

/**
 * `anonymous_state` is not part of the published `CanvasDiscussionTopic` type — it is
 * read defensively here so the discriminator needs no change to a shared public type.
 */
function anonymityDescription(topic: CanvasDiscussionTopic): string | undefined {
  const state = (topic as { anonymous_state?: unknown }).anonymous_state
  if (typeof state !== 'string' || state.length === 0) return undefined
  // Canvas normalizes an unrecognized `anonymous_state` to NULL on create (see
  // `ANONYMOUS_STATES` in `discussion_topics_controller.rb`), so an unknown value here
  // should be unreachable. Describe it generically rather than echoing Canvas-authored
  // text into a model-visible error message.
  return ANONYMITY_DESCRIPTIONS[state] ?? 'anonymous'
}

function anonymousTopicMessage(courseId: CanvasId, topicId: CanvasId, description: string): string {
  return (
    `Discussion topic ${topicId} exists in course ${courseId} — list_discussions returns it — but ` +
    'Canvas blocks the topic-scoped detail REST endpoint for anonymous discussion topics and ' +
    `answers it with HTTP 404. This topic is ${description}. The topic ID is correct; no other ID ` +
    "will work. Read the topic's listed attributes from list_discussions, or open the topic in the " +
    'Canvas web UI. Replying with post_discussion_entry is unaffected.'
  )
}

/**
 * Resolve how an already-404ing topic is anonymous, or `undefined` when the 404 should
 * keep its ordinary not-found meaning. A failure of the fallback request itself also
 * yields `undefined`: the detail failure is the one the caller asked about, and
 * replacing it with a list error would be less accurate, not more.
 */
async function describeAnonymityFromList(
  canvas: CanvasClient,
  courseId: CanvasId,
  topicId: CanvasId,
): Promise<string | undefined> {
  let topics: CanvasDiscussionTopic[]
  try {
    topics = await canvas.discussions.list(courseId)
  } catch {
    return undefined
  }
  // Compared as canonical strings, not by coercing `topicId` back to a number:
  // `topic.id` is a response value (still `number` until PR 2a) and `topicId` is
  // a migrated input, so this is one of §4.1's ID-to-ID comparisons.
  const listed = topics.find((topic) => topic.id === topicId)
  return listed ? anonymityDescription(listed) : undefined
}

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
        course_id: canvasIdInput().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        return canvas.discussions.list(course_id)
      },
    },
    {
      name: 'get_discussion',
      title: 'Get Discussion',
      // The anonymous-topic case is reported by the handler's error below rather than
      // advertised here: `docs/generated/tool-manifest.json` embeds this string, so any
      // edit also requires `pnpm generate:manifests`.
      description: 'Get details for a single discussion topic by ID.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        topic_id: canvasIdInput().describe('The Canvas discussion topic ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const topic_id = params.topic_id as CanvasId
        try {
          return await canvas.discussions.get(course_id, topic_id)
        } catch (error) {
          // Only a 404 is ambiguous, and only one extra request is ever made — never on
          // a successful read, and never for any other status.
          if (!(error instanceof CanvasApiError) || error.status !== 404) throw error
          const description = await describeAnonymityFromList(canvas, course_id, topic_id)
          if (description === undefined) throw error
          throw new Error(anonymousTopicMessage(course_id, topic_id, description), {
            cause: error,
          })
        }
      },
    },
    {
      name: 'list_announcements',
      title: 'List Announcements',
      description: 'List all announcements in a course.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        return canvas.discussions.listAnnouncements(course_id)
      },
    },
    {
      name: 'post_discussion_entry',
      title: 'Post Discussion Entry',
      description: 'Post a new entry (reply) to a discussion topic.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        topic_id: canvasIdInput().describe('The Canvas discussion topic ID'),
        message: z.string().describe('The message body (supports HTML)'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const topic_id = params.topic_id as CanvasId
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
        course_id: canvasIdInput().describe('The Canvas course ID'),
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
        const course_id = params.course_id as CanvasId
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
        course_id: canvasIdInput().describe('The Canvas course ID'),
        topic_id: canvasIdInput().describe('The Canvas discussion topic ID'),
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
        const course_id = params.course_id as CanvasId
        const topic_id = params.topic_id as CanvasId
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
        course_id: canvasIdInput().describe('The Canvas course ID'),
        topic_id: canvasIdInput().describe('The Canvas discussion topic ID to delete'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const topic_id = params.topic_id as CanvasId
        await canvas.discussions.delete(course_id, topic_id)
        return { deleted: true, topic_id }
      },
    },
  ]
}
