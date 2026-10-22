import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'
import { type CanvasId, canvasIdInput } from '../canvas/id'

export function conversationTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
  return [
    {
      name: 'list_conversations',
      title: 'List Conversations',
      description:
        "List the authenticated user's inbox: every non-archived conversation, both read and " +
        "unread, newest first, returning each one's id, subject, last_message, " +
        'last_message_at, message_count, and participants (id, name) — no message bodies; use ' +
        'get_conversation for the full thread. There is no scope filter here, so starred-only, ' +
        "archived, sent-only, or unread-only views aren't available. Fetches every page (100 per " +
        "request) and fails with a 'Results are incomplete' error instead of silently " +
        'truncating. Use get_conversation_unread_count for just the unread total instead of the ' +
        'whole inbox.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        const conversations = await canvas.conversations.list()
        if (!pseudonymizer?.isEnabled()) return conversations
        return Promise.all(conversations.map((c) => pseudonymizer.anonymizeConversation(c)))
      },
    },
    {
      name: 'get_conversation',
      title: 'Get Conversation',
      description:
        "Get one conversation's full message thread by id, returning its subject, participants, " +
        'and every message (id, body, author_id, created_at) — not just the last_message ' +
        'summary list_conversations returns. Canvas marks any unread messages in this thread as ' +
        'read as a side effect of calling this, so re-reading a thread changes its unread state. ' +
        'Find the conversation_id with list_conversations. Use get_conversation_unread_count to ' +
        'check the inbox-wide unread total without marking anything read.',
      inputSchema: {
        conversation_id: canvasIdInput().describe('The conversation ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const conversation = await canvas.conversations.get(params.conversation_id as CanvasId)
        if (!pseudonymizer?.isEnabled()) return conversation
        return pseudonymizer.anonymizeConversation(conversation)
      },
    },
    {
      name: 'get_conversation_unread_count',
      title: 'Get Conversation Unread Count',
      description:
        'Get the number of unread conversations for the authenticated user as a single integer ' +
        '— not the conversations themselves, and not a count of unread messages within them. ' +
        'Use list_conversations to see which conversations are unread, or get_conversation to ' +
        'open one and mark its messages read.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        return canvas.conversations.getUnreadCount()
      },
    },
    {
      name: 'send_conversation',
      title: 'Send Conversation',
      description:
        'Send a new message and return the created conversation object(s) (id, subject, ' +
        'participants) — one per recipient. With more than one entry in recipients, this ' +
        'creates a separate private conversation with each recipient rather than one shared ' +
        'group thread: each recipient sees only their own copy, and nobody sees who else ' +
        'received it. Every call sends again — there is no dedup against an already-sent ' +
        'message with the same subject and body. recipients must be real Canvas user ids as ' +
        'strings; list_course_users or search_users can look those up first. Requires the ' +
        'authenticated user to have permission to message every recipient (course messaging ' +
        'rules and any inbox restrictions Canvas enforces). Use list_conversations and ' +
        'get_conversation to review what was sent.',
      inputSchema: {
        recipients: z.array(z.string()).describe('Array of recipient user IDs (as strings)'),
        subject: z.string().describe('The conversation subject line'),
        body: z.string().describe('The message body'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const recipients = params.recipients as string[]
        const subject = params.subject as string
        const body = params.body as string
        const conversations = await canvas.conversations.send(recipients, subject, body)
        if (!pseudonymizer?.isEnabled()) return conversations
        return Promise.all(conversations.map((c) => pseudonymizer.anonymizeConversation(c)))
      },
    },
  ]
}
