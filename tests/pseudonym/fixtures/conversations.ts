/**
 * Marked-name fixtures for `list_conversations`, `get_conversation` and
 * `send_conversation` (`src/tools/conversations.ts`).
 *
 * **Serializer read** (`instructure/canvas-lms@master`):
 * `lib/api/v1/conversation.rb#conversation_json` and
 * `#conversation_user_json`. The participant shape is
 * `{ id, name: user.short_name, full_name: user.name, pronouns }`, plus
 * `common_courses` / `common_groups` under `include_participant_contexts`
 * (which `conversation_json` defaults to TRUE) and `avatar_url` under
 * `include_participant_avatars`. **Two** real-name strings per participant,
 * which is the half of the #473 leak a pre-fix type could not have asserted
 * on: `full_name` was not in `src/canvas/types.ts` at all.
 *
 * `conversation_json` also sets `avatar_url` on the conversation itself
 * (`avatar_url_for(conversation, explicit_participants)`) — on a two-person
 * thread that is the *other* person's face, so it re-identifies a masked name
 * and `anonymizeConversation` nulls it. It is a URL, not a name, so it carries
 * no mark.
 *
 * **`context_name` is a decoy and stays unmarked.** It is
 * `conversation.context_name`, i.e. the course's name. So is `subject`. A
 * scrub that could not tell a course from a person would have to fail these
 * fixtures rather than pass them.
 *
 * **Message bodies carry no mark either.** `conversation_message_json` emits
 * `{ id, created_at, body, author_id, generated, participating_user_ids, ... }`
 * — identifiers and free text, no name field. Canvas's own *generated* event
 * messages do put a person's name in `body`, which this server
 * provenance-fences rather than pseudonymizes; marking it would assert a
 * rewrite nobody has promised, so the fixture keeps bodies name-free.
 */
import type { CanvasClient } from '../../../src/canvas'
import { buildSweepPseudonymizer, type MarkedNameFixture } from './sweep'

function markedParticipant(id: string, nameMark: string, fullNameMark: string) {
  return {
    id,
    name: nameMark,
    full_name: fullNameMark,
    pronouns: 'they/them',
    common_courses: { '7': ['StudentEnrollment'] },
    common_groups: {},
    avatar_url: 'https://school.example/images/users/' + id,
  }
}

function conversationRow() {
  return {
    id: '301',
    subject: 'Week 4 feedback',
    workflow_state: 'unread',
    last_message: 'Thanks, I will revise the intro section tonight.',
    last_message_at: '2026-10-28T20:14:00Z',
    last_authored_message_at: '2026-10-28T19:40:00Z',
    message_count: 4,
    starred: false,
    visible: true,
    context_name: 'Introduction to Fjords',
    context_code: 'course_7',
    audience: ['101'],
    avatar_url: 'https://school.example/images/users/101',
    participants: [
      markedParticipant('101', 'REAL_NAME_1', 'REAL_NAME_2'),
      markedParticipant('102', 'REAL_NAME_3', 'REAL_NAME_4'),
    ],
  }
}

export const conversationFixtures: Record<string, MarkedNameFixture> = {
  // GET /api/v1/conversations
  list_conversations: {
    args: {},
    buildCanvas: () =>
      ({
        conversations: { list: async () => [conversationRow()] },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },

  // GET /api/v1/conversations/:id — same envelope plus `messages`.
  get_conversation: {
    args: { conversation_id: '301' },
    buildCanvas: () =>
      ({
        conversations: {
          get: async () => ({
            ...conversationRow(),
            messages: [
              {
                id: '9001',
                created_at: '2026-10-28T20:14:00Z',
                body: 'Thanks, I will revise the intro section tonight.',
                author_id: '101',
                generated: false,
                participating_user_ids: ['101', '102'],
              },
            ],
          }),
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },

  // POST /api/v1/conversations — Canvas answers with one conversation per
  // recipient, each already carrying both participants.
  send_conversation: {
    args: { recipients: ['101'], subject: 'Week 4 feedback', body: 'See my comments.' },
    buildCanvas: () =>
      ({
        conversations: { send: async () => [conversationRow()] },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },
}
