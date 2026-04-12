import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function conversationTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_conversations',
      description: 'List conversations (inbox messages) for the authenticated user.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        return canvas.conversations.list()
      },
    },
    {
      name: 'send_conversation',
      description: 'Send a new conversation message to one or more recipients.',
      inputSchema: {
        recipients: z
          .array(z.string())
          .describe('Array of recipient user IDs (as strings)'),
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
        return canvas.conversations.send(recipients, subject, body)
      },
    },
  ]
}
