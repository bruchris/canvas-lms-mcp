/**
 * Marked-name fixtures for `list_appointment_groups`, `get_appointment_group`,
 * `list_appointment_group_users` and `list_appointment_group_groups`
 * (`src/tools/appointment-groups.ts`).
 *
 * **Serializer read** (`instructure/canvas-lms@master`):
 * `lib/api/v1/calendar_event.rb#appointment_group_json` and
 * `#calendar_event_json`.
 *
 * The group object itself carries no person: `only: %w[id created_at
 * description end_at max_appointments_per_participant
 * min_appointments_per_participant participants_per_appointment start_at title
 * updated_at workflow_state participant_visibility]`, plus `location_*`,
 * `context_codes`, `requiring_action` and the `participant_count` /
 * `reserved_times` includes. Its `title` is the slot series name, not a
 * person — a decoy, and unmarked.
 *
 * The identities arrive under `include[]=appointments,child_events`, in the
 * reservation events. `calendar_event_json` renders each child event with
 * `include: ["participants"]`, and that branch picks ONE of two shapes by the
 * reservation's context type:
 *
 * ```ruby
 * when "User"  then hash["user"]  = user_json(event.context, user, session)
 * when "Group" then hash["group"] = group_json(event.context, user, session,
 *                                              include: ["users"])
 * ```
 *
 * Both arms are exercised below, one per fixture:
 * `list_appointment_groups` reserves as individuals (the `user` arm) and
 * `get_appointment_group` reserves as a group (the `group` arm, which is the
 * richer one — that `group_json` asks for `users` itself, so it carries the
 * group's `leader` AND its whole roster).
 *
 * `new_appointments` is deliberately absent from both: it is an
 * `attr_accessor` populated while creating or updating an appointment group,
 * so a read never returns it.
 *
 * `list_appointment_group_users` is `GET
 * /appointment_groups/:id/users` → plain `user_json` rows, and
 * `list_appointment_group_groups` is the same endpoint's `groups` variant →
 * `group_json` rows, i.e. the `leader` arm of `groups.ts` reached by a second
 * read path. Both go through the same pseudonym pools as their siblings
 * (`_apptgrp_<id>` for users, `groupScopeKey` for groups), which is what keeps
 * one person on one label across all four tools.
 */
import type { CanvasClient } from '../../../src/canvas'
import { buildSweepPseudonymizer, type MarkedNameFixture } from './sweep'

function reservationUser(id: string, marks: [string, string, string]) {
  return {
    id,
    name: marks[0],
    created_at: '2026-01-05T08:00:00Z',
    sortable_name: marks[1],
    short_name: marks[2],
    pronouns: 'she/her',
  }
}

function appointmentSlot(childEvents: unknown[]) {
  return {
    id: '2001',
    title: 'Thesis check-in',
    start_at: '2026-11-03T09:00:00Z',
    end_at: '2026-11-03T09:20:00Z',
    workflow_state: 'active',
    context_code: 'appointment_group_900',
    type: 'event',
    child_events_count: childEvents.length,
    child_events: childEvents,
  }
}

function appointmentGroup(appointments: unknown[], participantType: 'User' | 'Group') {
  return {
    id: '900',
    title: 'Thesis check-ins (week 45)',
    description: 'Twenty-minute slots.',
    context_codes: ['course_7'],
    sub_context_codes: participantType === 'Group' ? ['group_category_12'] : [],
    workflow_state: 'active',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    start_at: '2026-11-03T09:00:00Z',
    end_at: '2026-11-03T12:00:00Z',
    location_name: 'Room 2.14',
    location_address: null,
    participant_type: participantType,
    participant_visibility: 'protected',
    participant_count: 1,
    requiring_action: false,
    appointments,
  }
}

export const appointmentGroupFixtures: Record<string, MarkedNameFixture> = {
  // GET /api/v1/appointment_groups?include[]=appointments&include[]=child_events
  // — the `user` arm: individual sign-up.
  list_appointment_groups: {
    args: { scope: 'manageable', include: ['appointments', 'child_events'] },
    buildCanvas: () =>
      ({
        appointmentGroups: {
          list: async () => [
            appointmentGroup(
              [
                appointmentSlot([
                  {
                    id: '2101',
                    title: 'Thesis check-in',
                    start_at: '2026-11-03T09:00:00Z',
                    end_at: '2026-11-03T09:20:00Z',
                    type: 'event',
                    context_code: 'user_101',
                    appointment_group_id: '900',
                    participant_type: 'User',
                    user: reservationUser('101', ['REAL_NAME_1', 'REAL_NAME_2', 'REAL_NAME_3']),
                  },
                ]),
              ],
              'User',
            ),
          ],
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },

  // GET /api/v1/appointment_groups/:id?include[]=appointments&include[]=child_events
  // — the `group` arm: group sign-up, where `group_json(..., include:
  // ["users"])` brings both the leader and the roster.
  get_appointment_group: {
    args: { appointment_group_id: '900', include: ['appointments', 'child_events'] },
    buildCanvas: () =>
      ({
        appointmentGroups: {
          get: async () =>
            appointmentGroup(
              [
                appointmentSlot([
                  {
                    id: '2102',
                    title: 'Thesis check-in',
                    start_at: '2026-11-03T09:00:00Z',
                    end_at: '2026-11-03T09:20:00Z',
                    type: 'event',
                    context_code: 'group_41',
                    appointment_group_id: '900',
                    participant_type: 'Group',
                    group: {
                      id: '41',
                      // The group's own name: a decoy, and unmarked.
                      name: 'Fjord Study Group',
                      group_category_id: '12',
                      members_count: 2,
                      created_at: '2026-02-01T10:00:00Z',
                      context_type: 'Course',
                      course_id: '7',
                      context_name: 'Introduction to Fjords',
                      leader: {
                        id: '101',
                        anonymous_id: '2t',
                        display_name: 'REAL_NAME_1',
                        avatar_image_url: 'https://school.example/images/users/101',
                        html_url: 'https://school.example/groups/41/users/101',
                        pronouns: 'she/her',
                      },
                      users: [
                        reservationUser('101', ['REAL_NAME_2', 'REAL_NAME_3', 'REAL_NAME_4']),
                        reservationUser('102', ['REAL_NAME_5', 'REAL_NAME_6', 'REAL_NAME_7']),
                      ],
                    },
                  },
                ]),
              ],
              'Group',
            ),
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },

  // GET /api/v1/appointment_groups/:id/users
  list_appointment_group_users: {
    args: { appointment_group_id: '900' },
    buildCanvas: () =>
      ({
        appointmentGroups: {
          listUsers: async () => [
            reservationUser('101', ['REAL_NAME_1', 'REAL_NAME_2', 'REAL_NAME_3']),
            reservationUser('102', ['REAL_NAME_4', 'REAL_NAME_5', 'REAL_NAME_6']),
          ],
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },

  // GET /api/v1/appointment_groups/:id/groups — the second read path onto a
  // group's `leader`, which is why #441 had to fix two tools from one payload.
  list_appointment_group_groups: {
    args: { appointment_group_id: '900' },
    buildCanvas: () =>
      ({
        appointmentGroups: {
          listGroups: async () => [
            {
              id: '41',
              name: 'Fjord Study Group',
              group_category_id: '12',
              members_count: 2,
              created_at: '2026-02-01T10:00:00Z',
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
          ],
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },
}
