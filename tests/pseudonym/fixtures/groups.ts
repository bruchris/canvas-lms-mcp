/**
 * Marked-name fixtures for `list_groups` and `list_group_members`
 * (`src/tools/groups.ts`).
 *
 * **Serializer read** (`instructure/canvas-lms@master`):
 * `lib/api/v1/group.rb#group_json`. `API_GROUP_JSON_OPTS` emits the group's
 * own `id`, `name`, `description`, `is_public`, `join_level`,
 * `group_category_id`, `max_membership`, `created_at` plus `members_count` and
 * `storage_quota_mb`; the method then merges `context_data(group)`, sets
 * `context_name = group.context.name`, `avatar_url`, `role`, and —
 * unconditionally, with no `include[]` asked for —
 * `hash["leader"] = group.leader ? user_display_json(group.leader, group) : nil`.
 * That one line is the #438/#441 leak.
 *
 * `user_display_json` (`lib/api/v1/user.rb`) is
 * `{ id, anonymous_id, display_name: user.short_name, avatar_image_url,
 * html_url, pronouns }` — note `avatar_image_url`, not `avatar_url`, and note
 * that `display_name` is the only name string in it.
 *
 * **The group's own `name` is marked-adjacent on purpose and stays UNMARKED,**
 * as does `context_name` (the course's name). A deep scrub that rewrote every
 * `name`-shaped key — §1.4's measured 156-tool alternative — could not tell
 * `'Fjord Study Group'` from the leader's name, and would have to fail this
 * fixture rather than pass it.
 *
 * **`users` is absent, and that is faithful.** `group_json` attaches it only
 * under `include[]=users`, and `src/canvas/groups.ts#list` requests
 * `/courses/:id/groups` with no params. `anonymizeGroup` covers the arm anyway
 * so that adding the include later cannot reintroduce the leak; the fixture
 * follows the wire, so that arm is Phase 2's to exercise.
 *
 * **The second group has `leader: null`,** which is the branch
 * `group.leader ? ... : nil` actually emits most of the time.
 *
 * `list_group_members` is `GET /groups/:id/users` →
 * `groups_controller#users`, whose `includes = Array(params[:include])` is
 * empty for us, so each member is a plain `user_json`: no email, no
 * `first_name` / `last_name`.
 */
import type { CanvasClient } from '../../../src/canvas'
import { buildSweepPseudonymizer, type MarkedNameFixture } from './sweep'

export const groupFixtures: Record<string, MarkedNameFixture> = {
  // GET /api/v1/courses/:course_id/groups
  list_groups: {
    args: { course_id: '7' },
    buildCanvas: () =>
      ({
        groups: {
          list: async () => [
            {
              id: '41',
              name: 'Fjord Study Group',
              description: 'Week 4 project team',
              is_public: false,
              join_level: 'invitation_only',
              group_category_id: '12',
              max_membership: 4,
              created_at: '2026-02-01T10:00:00Z',
              members_count: 3,
              storage_quota_mb: 50,
              context_type: 'Course',
              course_id: '7',
              context_name: 'Introduction to Fjords',
              avatar_url: null,
              role: null,
              leader: {
                id: '101',
                anonymous_id: '2t',
                display_name: 'REAL_NAME_1',
                avatar_image_url: 'https://school.example/images/users/101',
                html_url: 'https://school.example/groups/41/users/101',
                pronouns: 'she/her',
              },
            },
            {
              id: '42',
              name: 'Glacier Reading Circle',
              group_category_id: '12',
              members_count: 2,
              created_at: '2026-02-01T10:00:00Z',
              context_type: 'Course',
              course_id: '7',
              context_name: 'Introduction to Fjords',
              leader: null,
            },
          ],
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },

  // GET /api/v1/groups/:group_id/users
  list_group_members: {
    args: { group_id: '41' },
    buildCanvas: () =>
      ({
        groups: {
          listMembers: async () => [
            {
              id: '101',
              name: 'REAL_NAME_1',
              created_at: '2026-01-05T08:00:00Z',
              sortable_name: 'REAL_NAME_2',
              short_name: 'REAL_NAME_3',
              sis_user_id: 'SIS-4411',
              login_id: 'REAL_NAME_4',
              pronouns: 'she/her',
            },
            {
              id: '102',
              name: 'REAL_NAME_5',
              created_at: '2026-01-06T08:00:00Z',
              sortable_name: 'REAL_NAME_6',
              short_name: 'REAL_NAME_7',
              sis_user_id: 'SIS-4412',
              login_id: 'REAL_NAME_8',
            },
          ],
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },
}
