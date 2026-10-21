import type { CanvasGroup } from '../../../src/canvas/types'

/**
 * A faithful Canvas `group_json` row (`lib/api/v1/group.rb`), shared by every
 * tool that renders a group: `list_groups`
 * (`GET /api/v1/courses/:course_id/groups`) and `list_appointment_group_groups`
 * (`GET /api/v1/appointment_groups/:id/groups`) both hand their rows to the
 * same serializer.
 *
 * The field that matters is `leader`. Canvas sets
 * `hash["leader"] = group.leader ? user_display_json(group.leader, group) : nil`
 * **unconditionally** — it is not behind an `include[]`, unlike `users` — so
 * every rendered group carries its leader's real `display_name`, avatar and
 * pronouns (#441). `description`/`avatar_url`/`role` are here because the real
 * payload has them; they are not what the tests assert on.
 */
export const REAL_GROUP_LEADER_NAME = 'Jordan Rivera'

/** Names that must not survive pseudonymized mode. Keep in step with the fixtures below. */
export const GROUP_JSON_REAL_NAMES = [REAL_GROUP_LEADER_NAME, 'Priya Raman'] as const

export const REAL_GROUP_MEMBER_NAME = GROUP_JSON_REAL_NAMES[1]

export function groupJsonWithLeader(overrides: Partial<CanvasGroup> = {}): CanvasGroup {
  return {
    id: 42,
    name: 'Project Team 3',
    description: null,
    is_public: false,
    join_level: 'invitation_only',
    group_category_id: 10,
    max_membership: null,
    created_at: '2026-02-01T00:00:00Z',
    members_count: 4,
    storage_quota_mb: 50,
    context_type: 'Course',
    course_id: 1,
    context_name: 'Biology 101',
    avatar_url: null,
    role: null,
    leader: {
      id: 5,
      anonymous_id: 'aXy9Q',
      display_name: REAL_GROUP_LEADER_NAME,
      avatar_image_url: 'https://school.instructure.com/images/thumbnails/9/jordan.png',
      html_url: 'https://school.instructure.com/courses/1/users/5',
      pronouns: 'she/her',
    },
    ...overrides,
  }
}

/**
 * GUARD fixture: the shape Canvas renders only when the caller asks for
 * `include[]=users`. Neither client call site sends that include, so this
 * cannot arrive today — the arm exists so that adding the include later cannot
 * reintroduce the leak by construction.
 */
export function groupJsonWithUsers(): CanvasGroup {
  return groupJsonWithLeader({
    users: [
      {
        id: 7,
        name: REAL_GROUP_MEMBER_NAME,
        sortable_name: 'Raman, Priya',
        short_name: REAL_GROUP_MEMBER_NAME,
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
  })
}
