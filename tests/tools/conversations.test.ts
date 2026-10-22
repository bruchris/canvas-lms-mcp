import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import type { CanvasClient } from '../../src/canvas'
import type {
  CanvasConversation,
  CanvasConversationDetail,
  CanvasConversationUnreadCount,
} from '../../src/canvas/types'
import { conversationTools } from '../../src/tools/conversations'

describe('conversationTools', () => {
  // Participant shape per Canvas's `conversation_user_json`
  // (lib/api/v1/conversation.rb): `name` is `user.short_name`, `full_name` is
  // `user.name`, and `pronouns` / `avatar_url` / `common_courses` /
  // `common_groups` ride along. Index and show send avatars and contexts by
  // default, so these fixtures carry them.
  const mockConversation: CanvasConversation = {
    id: 1,
    subject: 'Question about HW',
    last_message: 'Thanks!',
    last_message_at: '2026-04-10T12:00:00Z',
    message_count: 3,
    avatar_url: 'https://school.instructure.com/images/thumbnails/5/alice.png',
    participants: [
      {
        id: 5,
        name: 'Alice',
        full_name: 'Alice Andersen',
        pronouns: 'she/her',
        avatar_url: 'https://school.instructure.com/images/thumbnails/5/alice.png',
        common_courses: { '101': ['StudentEnrollment'] },
        common_groups: {},
      },
      {
        id: 10,
        name: 'Bob',
        full_name: 'Bob Bergersen',
        pronouns: 'he/him',
        avatar_url: 'https://school.instructure.com/images/thumbnails/10/bob.png',
        common_courses: { '101': ['TeacherEnrollment'] },
        common_groups: {},
      },
    ],
  }

  const mockDetail: CanvasConversationDetail = {
    ...mockConversation,
    messages: [
      {
        id: 201,
        created_at: '2026-04-10T12:00:00Z',
        body: 'Thanks!',
        author_id: 5,
        generated: false,
      },
    ],
  }

  const mockUnreadCount: CanvasConversationUnreadCount = { unread_count: 4 }

  // `POST /api/v1/conversations` with more than one recipient and no
  // `group_conversation` flag takes Canvas's `batch_private_messages` branch
  // (conversations_controller.rb#create): one conversation per recipient,
  // rendered with `include_participant_avatars: false` and
  // `include_participant_contexts: false`.
  const sentPrivateMessages: CanvasConversation[] = [
    {
      id: 77,
      subject: 'Reminder',
      last_message: 'No class tomorrow',
      last_message_at: '2026-04-11T09:00:00Z',
      message_count: 1,
      participants: [
        { id: 1, name: 'Casey', full_name: 'Casey Carlsen', pronouns: null },
        { id: 5, name: 'Alice', full_name: 'Alice Andersen', pronouns: 'she/her' },
      ],
    },
    {
      id: 78,
      subject: 'Reminder',
      last_message: 'No class tomorrow',
      last_message_at: '2026-04-11T09:00:00Z',
      message_count: 1,
      participants: [
        { id: 1, name: 'Casey', full_name: 'Casey Carlsen', pronouns: null },
        { id: 10, name: 'Bob', full_name: 'Bob Bergersen', pronouns: 'he/him' },
      ],
    },
  ]

  // The single-recipient branch of the same action renders
  // `[conversation_json(..., include_indirect_participants: true, messages: [message])]`
  // — one entry, with the default avatars/contexts and the sent message.
  const sentSingleConversation: CanvasConversationDetail = {
    id: 79,
    subject: 'Reminder',
    last_message: 'No class tomorrow',
    last_message_at: '2026-04-11T09:00:00Z',
    message_count: 1,
    avatar_url: 'https://school.instructure.com/images/thumbnails/10/bob.png',
    participants: [
      {
        id: 1,
        name: 'Casey',
        full_name: 'Casey Carlsen',
        pronouns: null,
        avatar_url: 'https://school.instructure.com/images/thumbnails/1/casey.png',
        common_courses: {},
        common_groups: {},
      },
      {
        id: 10,
        name: 'Bob',
        full_name: 'Bob Bergersen',
        pronouns: 'he/him',
        avatar_url: 'https://school.instructure.com/images/thumbnails/10/bob.png',
        common_courses: { '101': ['TeacherEnrollment'] },
        common_groups: {},
      },
    ],
    messages: [
      {
        id: 301,
        created_at: '2026-04-11T09:00:00Z',
        body: 'No class tomorrow',
        author_id: 1,
        generated: false,
      },
    ],
  }

  /**
   * Every real, identity-bearing string the fixtures carry, derived from the
   * fixtures themselves rather than hand-listed: each participant's string
   * values except its `id`, plus the conversation-level `avatar_url` (which is
   * the other participant's face on a two-person thread). Deriving it this way
   * means a PII field added to a fixture later is swept automatically.
   */
  function realParticipantPii(conversations: readonly CanvasConversation[]): string[] {
    const values = new Set<string>()
    for (const conversation of conversations) {
      if (typeof conversation.avatar_url === 'string') values.add(conversation.avatar_url)
      for (const participant of conversation.participants) {
        for (const [key, value] of Object.entries(participant)) {
          if (key === 'id') continue
          if (typeof value === 'string' && value.length > 0) values.add(value)
        }
      }
    }
    return [...values]
  }

  function buildMockCanvas(): CanvasClient {
    return {
      conversations: {
        list: vi.fn().mockResolvedValue([mockConversation]),
        get: vi.fn().mockResolvedValue(mockDetail),
        getUnreadCount: vi.fn().mockResolvedValue(mockUnreadCount),
        // Mirrors Canvas's own branch on recipient count.
        send: vi.fn(async (recipients: string[]) =>
          recipients.length > 1 ? sentPrivateMessages : [sentSingleConversation],
        ),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 4 tool definitions', () => {
    expect(conversationTools(buildMockCanvas())).toHaveLength(4)
  })

  it('exports tools with correct names', () => {
    const names = conversationTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'list_conversations',
      'get_conversation',
      'get_conversation_unread_count',
      'send_conversation',
    ])
  })

  describe('list_conversations', () => {
    it('has read-only annotations', () => {
      const tool = conversationTools(buildMockCanvas()).find(
        (t) => t.name === 'list_conversations',
      )!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.conversations.list', async () => {
      const canvas = buildMockCanvas()
      const tool = conversationTools(canvas).find((t) => t.name === 'list_conversations')!
      const result = await tool.handler({})
      expect(canvas.conversations.list).toHaveBeenCalled()
      expect(result).toEqual([mockConversation])
    })
  })

  describe('get_conversation', () => {
    it('has read-only annotations', () => {
      const tool = conversationTools(buildMockCanvas()).find((t) => t.name === 'get_conversation')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.conversations.get with conversation_id', async () => {
      const canvas = buildMockCanvas()
      const tool = conversationTools(canvas).find((t) => t.name === 'get_conversation')!
      const result = await tool.handler({ conversation_id: '1' })
      expect(canvas.conversations.get).toHaveBeenCalledWith('1')
      expect(result).toEqual(mockDetail)
      expect((result as CanvasConversationDetail).messages).toHaveLength(1)
    })
  })

  describe('get_conversation_unread_count', () => {
    it('has read-only annotations', () => {
      const tool = conversationTools(buildMockCanvas()).find(
        (t) => t.name === 'get_conversation_unread_count',
      )!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.conversations.getUnreadCount', async () => {
      const canvas = buildMockCanvas()
      const tool = conversationTools(canvas).find(
        (t) => t.name === 'get_conversation_unread_count',
      )!
      const result = await tool.handler({})
      expect(canvas.conversations.getUnreadCount).toHaveBeenCalled()
      expect((result as CanvasConversationUnreadCount).unread_count).toBe(4)
    })
  })

  describe('send_conversation', () => {
    it('has destructive and openWorld annotations', () => {
      const tool = conversationTools(buildMockCanvas()).find((t) => t.name === 'send_conversation')!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.conversations.send', async () => {
      const canvas = buildMockCanvas()
      const tool = conversationTools(canvas).find((t) => t.name === 'send_conversation')!
      await tool.handler({
        recipients: ['5'],
        subject: 'Hello',
        body: 'Hi there!',
      })
      expect(canvas.conversations.send).toHaveBeenCalledWith(['5'], 'Hello', 'Hi there!')
    })
  })

  describe('pseudonymization', () => {
    let tmpDir: string
    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'conv-tool-'))
    })
    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true })
    })

    function makePseudonymizer(enabled = true) {
      return new Pseudonymizer({
        baseUrl: 'https://school.instructure.com/api/v1',
        rootDir: tmpDir,
        env: enabled ? { CANVAS_PSEUDONYMIZE_STUDENTS: 'true' } : {},
      })
    }

    describe('list_conversations', () => {
      it('pseudonymizes participant names when enabled', async () => {
        const canvas = buildMockCanvas()
        const tool = conversationTools(canvas, makePseudonymizer()).find(
          (t) => t.name === 'list_conversations',
        )!
        const result = (await tool.handler({})) as CanvasConversation[]
        for (const p of result[0].participants) {
          expect(p.name).toMatch(/^Person \d+$/)
        }
      })

      it('leaves no real participant PII in the response when enabled', async () => {
        const canvas = buildMockCanvas()
        const tool = conversationTools(canvas, makePseudonymizer()).find(
          (t) => t.name === 'list_conversations',
        )!
        const result = (await tool.handler({})) as CanvasConversation[]
        const serialized = JSON.stringify(result)
        const pii = realParticipantPii([mockConversation])
        expect(pii.length).toBeGreaterThanOrEqual(6)
        for (const value of pii) {
          expect(serialized).not.toContain(value)
        }
      })

      it('passes through real names when disabled', async () => {
        const canvas = buildMockCanvas()
        const tool = conversationTools(canvas, makePseudonymizer(false)).find(
          (t) => t.name === 'list_conversations',
        )!
        const result = (await tool.handler({})) as CanvasConversation[]
        expect(result[0].participants.map((p) => p.name)).toEqual(['Alice', 'Bob'])
      })
    })

    describe('get_conversation', () => {
      it('pseudonymizes participant names when enabled', async () => {
        const canvas = buildMockCanvas()
        const tool = conversationTools(canvas, makePseudonymizer()).find(
          (t) => t.name === 'get_conversation',
        )!
        const result = (await tool.handler({ conversation_id: '1' })) as CanvasConversationDetail
        for (const p of result.participants) {
          expect(p.name).toMatch(/^Person \d+$/)
        }
      })

      it('passes through real names when disabled', async () => {
        const canvas = buildMockCanvas()
        const tool = conversationTools(canvas, makePseudonymizer(false)).find(
          (t) => t.name === 'get_conversation',
        )!
        const result = (await tool.handler({ conversation_id: '1' })) as CanvasConversationDetail
        expect(result.participants.map((p) => p.name)).toEqual(['Alice', 'Bob'])
      })
    })

    describe('send_conversation', () => {
      function sendTool(pseudonymizer?: Pseudonymizer) {
        const canvas = buildMockCanvas()
        const tool = conversationTools(canvas, pseudonymizer).find(
          (t) => t.name === 'send_conversation',
        )!
        return { canvas, tool }
      }

      it('pseudonymizes every participant name in every created conversation', async () => {
        const { tool } = sendTool(makePseudonymizer())
        const result = (await tool.handler({
          recipients: ['5', '10'],
          subject: 'Reminder',
          body: 'No class tomorrow',
        })) as CanvasConversation[]

        expect(result).toHaveLength(2)
        for (const conversation of result) {
          for (const participant of conversation.participants) {
            expect(participant.name).toMatch(/^Person \d+$/)
            expect(participant.full_name).toMatch(/^Person \d+$/)
          }
        }
      })

      it('leaves no real participant PII anywhere in the response when enabled', async () => {
        const { tool } = sendTool(makePseudonymizer())
        const result = (await tool.handler({
          recipients: ['5', '10'],
          subject: 'Reminder',
          body: 'No class tomorrow',
        })) as CanvasConversation[]

        const serialized = JSON.stringify(result)
        const pii = realParticipantPii(sentPrivateMessages)
        expect(pii.length).toBeGreaterThanOrEqual(6)
        for (const value of pii) {
          expect(serialized).not.toContain(value)
        }
      })

      it('control: every one of those values is present when pseudonymization is disabled', async () => {
        const { tool } = sendTool(makePseudonymizer(false))
        const result = (await tool.handler({
          recipients: ['5', '10'],
          subject: 'Reminder',
          body: 'No class tomorrow',
        })) as CanvasConversation[]

        const serialized = JSON.stringify(result)
        const pii = realParticipantPii(sentPrivateMessages)
        expect(pii.length).toBeGreaterThanOrEqual(6)
        for (const value of pii) {
          expect(serialized).toContain(value)
        }
        expect(result).toEqual(sentPrivateMessages)
      })

      it('control: passes the raw response through when no pseudonymizer is supplied', async () => {
        const { tool } = sendTool()
        const result = await tool.handler({
          recipients: ['5', '10'],
          subject: 'Reminder',
          body: 'No class tomorrow',
        })
        expect(result).toEqual(sentPrivateMessages)
      })

      it('nulls the identity siblings beside a masked name on the single-recipient shape', async () => {
        const { tool } = sendTool(makePseudonymizer())
        const result = (await tool.handler({
          recipients: ['10'],
          subject: 'Reminder',
          body: 'No class tomorrow',
        })) as CanvasConversationDetail[]

        expect(result).toHaveLength(1)
        expect(result[0].avatar_url).toBeNull()
        for (const participant of result[0].participants) {
          expect(participant.pronouns).toBeNull()
          expect(participant.avatar_url).toBeNull()
        }
        // Ids are identifiers and are never rewritten.
        expect(result[0].participants.map((p) => p.id)).toEqual([1, 10])
        // Message bodies and author ids are untouched.
        expect(result[0].messages[0]?.body).toBe('No class tomorrow')
        expect(result[0].messages[0]?.author_id).toBe(1)
      })

      it('reuses the pseudonym an earlier conversations tool assigned to the same user id', async () => {
        const pseudonymizer = makePseudonymizer()
        const canvas = buildMockCanvas()
        const tools = conversationTools(canvas, pseudonymizer)

        // Warm the shared conversation pool first, so the user we then check is
        // NOT the first id the counter hands a pseudonym to. Without the warm,
        // every fresh scope answers "Person 1" and the assertion below would
        // hold whatever scope the implementation picked.
        const listed = (await tools
          .find((t) => t.name === 'list_conversations')!
          .handler({})) as CanvasConversation[]
        expect(listed[0].participants.map((p) => p.name)).toEqual(['Person 1', 'Person 2'])
        const bobPseudonym = listed[0].participants.find((p) => p.id === 10)!.name

        const sent = (await tools
          .find((t) => t.name === 'send_conversation')!
          .handler({
            recipients: ['10'],
            subject: 'Reminder',
            body: 'No class tomorrow',
          })) as CanvasConversation[]

        const bob = sent[0].participants.find((p) => p.id === 10)!
        expect(bob.name).toBe(bobPseudonym)
        expect(bob.name).not.toBe('Person 1')
      })
    })
  })
})
