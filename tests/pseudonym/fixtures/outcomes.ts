/**
 * Marked-name fixtures for `get_outcome_results` and `get_outcome_rollups`
 * (`src/tools/outcomes.ts`).
 *
 * **Serializer read** (`instructure/canvas-lms@master`):
 * `lib/api/v1/outcome_results.rb#outcome_results_linked_users_json`. This one
 * is not an ordinary `user_json`, and the difference is the whole point of
 * these two fixtures:
 *
 * ```ruby
 * users = users_json(users, @current_user, session, %w[sis_user_id avatar_url],
 *                    context, nil, %w[personal_info])
 * allowed_fields = %w[id name display_name sortable_name sis_id
 *                     integration_id login_id avatar_url]
 * users.map do |u|
 *   u[:id] = u[:id].to_s if u[:id]
 *   u[:display_name] = u[:short_name] if u[:short_name]
 *   u[:sis_id] = u[:sis_user_id] if u[:sis_user_id]
 *   u.select! { |field| allowed_fields.include?(field) }
 * end
 * ```
 *
 * `short_name` is copied to **`display_name`** and then dropped by `select!`,
 * and `sis_user_id` is copied to **`sis_id`** and likewise dropped. So a
 * linked user is `{ id, name, display_name, sortable_name, sis_id,
 * integration_id, login_id, avatar_url }` — a shape with a real name at a key
 * `applyPseudonymToUser` had never seen, because every other wrapped tool
 * calls the name `short_name`. `display_name` is marked here; `sis_id` is an
 * identifier rather than a name, so it carries no mark (see the BRU-3257 task
 * notes, where its survival is raised separately).
 *
 * **The decoys are the other members of `linked`.**
 * `outcome_results_linked_courses_json` is `{ id, name: course.name }` and the
 * rollups response also links `sections` as `{ id, name }`. Both are
 * `name`-keyed strings that are NOT people, and both must come back
 * unchanged.
 *
 * Neither `outcome_results[]` nor `rollups[]` carries a name of its own: an
 * outcome result is scores plus a `links` map of ids, and a rollup is
 * `{ scores, links: { user, section, status } }`.
 */
import type { CanvasClient } from '../../../src/canvas'
import { buildSweepPseudonymizer, type MarkedNameFixture } from './sweep'

function linkedUser(marks: [string, string, string]) {
  return {
    id: '101',
    name: marks[0],
    display_name: marks[1],
    sortable_name: marks[2],
    sis_id: 'SIS-4411',
    integration_id: 'INT-4411',
    login_id: 'r.name',
    avatar_url: 'https://school.example/images/users/101',
  }
}

export const outcomeFixtures: Record<string, MarkedNameFixture> = {
  // GET /api/v1/courses/:course_id/outcome_results
  get_outcome_results: {
    args: { course_id: '7' },
    buildCanvas: () =>
      ({
        outcomes: {
          getOutcomeResults: async () => ({
            outcome_results: [
              {
                id: '3001',
                score: 3,
                mastery: true,
                possible: 4,
                percent: 0.75,
                submitted_or_assessed_at: '2026-10-27T09:00:00Z',
                links: {
                  user: '101',
                  learning_outcome: '600',
                  alignment: 'assignment_88',
                },
              },
            ],
            linked: {
              users: [linkedUser(['REAL_NAME_1', 'REAL_NAME_2', 'REAL_NAME_3'])],
              outcomes: [{ id: '600', title: 'Interprets fjord formation', display_name: null }],
            },
          }),
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },

  // GET /api/v1/courses/:course_id/outcome_rollups
  get_outcome_rollups: {
    args: { course_id: '7' },
    buildCanvas: () =>
      ({
        outcomes: {
          getOutcomeRollups: async () => ({
            rollups: [
              {
                scores: [{ score: 3, count: 2, links: { outcome: '600' } }],
                links: { user: '101', section: '70', status: 'active' },
              },
            ],
            linked: {
              users: [linkedUser(['REAL_NAME_1', 'REAL_NAME_2', 'REAL_NAME_3'])],
              outcomes: [{ id: '600', title: 'Interprets fjord formation' }],
              // Decoys: a section and a course are `name`-keyed and are not
              // people. Both must survive pseudonymization untouched.
              sections: [{ id: '70', name: 'Section A (morning)' }],
              courses: [{ id: '7', name: 'Introduction to Fjords' }],
            },
          }),
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },
}
