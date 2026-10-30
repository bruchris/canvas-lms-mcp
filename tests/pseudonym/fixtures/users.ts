/**
 * Marked-name fixtures for the tools that return bare Canvas `user_json`
 * objects: `list_students`, `get_user`, `search_users`, `list_course_users`
 * (`src/tools/users.ts`) and `list_account_users` (`src/tools/accounts.ts`).
 *
 * **Serializer read** (`instructure/canvas-lms@master`):
 * `lib/api/v1/user.rb#user_json`. `API_USER_JSON_OPTS` emits `id`, `name`,
 * `created_at` plus the `sortable_name` and `short_name` methods on every call;
 * `json[:sis_user_id]` / `json[:integration_id]` ride along for a caller with
 * `read_sis`, `json[:login_id] = pseudonym.unique_id` for an admin with
 * `view_user_logins`, `json[:pronouns]` whenever the user has set them (no
 * `include[]` needed), and `json[:email] = user.email` /
 * `json[:first_name]` / `json[:last_name]` under the matching `include[]`.
 *
 * **Which `include[]` each endpoint actually gets is a controller fact, not a
 * client one** — and it is where the three shapes below diverge:
 *
 * - `GET /courses/:id/users` — `courses_controller#users` does
 *   `includes = Array(params[:include]).push("sis_user_id", "email")`, so
 *   `email` and `sis_user_id` arrive whether or not we ask. Shape:
 *   {@link courseRosterStudent}.
 * - `GET /accounts/:id/users` — `users_controller#api_index` intersects:
 *   `(params[:include] || []) & %w[avatar_url email last_login time_zone uuid
 *   ui_invoked]`, so `email` appears only when the caller asks. Shape:
 *   {@link accountSearchStudent}.
 * - `GET /users/:id` — `users_controller#api_show_includes` returns
 *   `%w[first_name last_name locale avatar_url permissions email
 *   effective_locale]` *unconditionally*. Shape: {@link apiShowUser}, and the
 *   reason this file carries marks on `first_name` / `last_name` that no other
 *   fixture does.
 *
 * **Three name strings, not one.** `name`, `sortable_name` (`Last, First`) and
 * `short_name` are three genuinely different strings for the same person, so
 * each carries its own mark — which is also what keeps mark indices unique
 * (§5.4).
 *
 * **`email` and `login_id` are marked too.** Neither is literally a name
 * field, but Canvas derives both from the institution's pseudonym, where the
 * person's name is normally the local part — and `applyPseudonymToUser`
 * rewrites both, so marking them asserts a rewrite the implementation already
 * promises rather than inventing a new requirement. The marked substring sits
 * inside a larger string (`<mark>@school.example`), which also exercises
 * the sweep's substring detection.
 *
 * **`pronouns` is deliberately present and deliberately UNMARKED** — it is
 * identity, not a name. It is the decoy that would catch a scrub which
 * rewrites every string next to a masked name: the oracle must not require it
 * to change, and `applyPseudonymToUser` nulls it anyway.
 *
 * **Still absent, and that is also a reading of the serializer.**
 * `json[:pronunciation]` (a phonetic rendering of the person's name) needs
 * `include[]=pronunciation` plus the `name_pronunciation` account feature, and
 * `json[:sections]` needs `include[]=sections`; no tool or client method in
 * this repo requests either, so a faithful fixture omits both.
 */
import type { CanvasClient } from '../../../src/canvas'
import { buildSweepPseudonymizer, type MarkedNameFixture } from './sweep'

/**
 * `GET /courses/:id/users` — `email` and `sis_user_id` are pushed by the
 * controller, so they are present without an `include[]`. `enrollments` is
 * attached only under `include[]=enrollments`, which the `list_course_users`
 * fixture asks for.
 */
function courseRosterStudent(enrollments?: unknown[]) {
  return {
    id: '101',
    name: 'REAL_NAME_1',
    created_at: '2026-01-05T08:00:00Z',
    sortable_name: 'REAL_NAME_2',
    short_name: 'REAL_NAME_3',
    sis_user_id: 'SIS-4411',
    integration_id: 'INT-4411',
    login_id: 'REAL_NAME_4',
    email: 'REAL_NAME_5@school.example',
    pronouns: 'she/her',
    ...(enrollments ? { enrollments } : {}),
  }
}

/**
 * A staff row, to keep the fixtures honest about what the sweep does and does
 * not claim. `classifyRole` reads the nested `enrollments`, so this teacher's
 * name survives pseudonymization *by design* and must NOT be marked — a
 * fixture that marked it would fail a correct implementation.
 */
function unmarkedTeacher() {
  return {
    id: '9',
    name: 'Dr. Ingrid Holt',
    created_at: '2025-08-20T08:00:00Z',
    sortable_name: 'Holt, Ingrid',
    short_name: 'Ingrid Holt',
    sis_user_id: 'SIS-0009',
    email: 'ingrid.holt@school.example',
    enrollments: [
      {
        id: '880',
        course_id: '7',
        user_id: '9',
        type: 'TeacherEnrollment',
        role: 'TeacherEnrollment',
        enrollment_state: 'active',
      },
    ],
  }
}

/** `GET /accounts/:id/users?include[]=email` — no `first_name`/`last_name` here. */
function accountSearchStudent() {
  return {
    id: '101',
    name: 'REAL_NAME_1',
    created_at: '2026-01-05T08:00:00Z',
    sortable_name: 'REAL_NAME_2',
    short_name: 'REAL_NAME_3',
    sis_user_id: 'SIS-4411',
    integration_id: 'INT-4411',
    login_id: 'REAL_NAME_4',
    email: 'REAL_NAME_5@school.example',
    pronouns: 'she/her',
    last_login: '2026-10-20T11:00:00Z',
  }
}

/**
 * `GET /users/:id` — `api_show_includes` is unconditional, so `first_name`,
 * `last_name`, `email`, `avatar_url`, `locale`, `effective_locale` and
 * `permissions` are all on every response. `first_name` and `last_name` are
 * the keys this repo had never written down (zero occurrences in `src/`
 * before this PR), which is the §1.5 shape precisely.
 */
function apiShowUser() {
  return {
    id: '101',
    name: 'REAL_NAME_1',
    created_at: '2026-01-05T08:00:00Z',
    sortable_name: 'REAL_NAME_2',
    short_name: 'REAL_NAME_3',
    first_name: 'REAL_NAME_6',
    last_name: 'REAL_NAME_7',
    sis_user_id: 'SIS-4411',
    integration_id: 'INT-4411',
    login_id: 'REAL_NAME_4',
    email: 'REAL_NAME_5@school.example',
    avatar_url: 'https://school.example/images/users/101',
    pronouns: 'she/her',
    locale: null,
    effective_locale: 'en',
    permissions: {
      can_update_name: true,
      can_update_avatar: false,
      limit_parent_app_web_access: false,
    },
  }
}

export const userFixtures: Record<string, MarkedNameFixture> = {
  // GET /api/v1/courses/:course_id/users?enrollment_type[]=student
  list_students: {
    args: { course_id: '7' },
    buildCanvas: () =>
      ({ users: { listStudents: async () => [courseRosterStudent()] } }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },

  // GET /api/v1/users/:id — no course context, so the handler keys the map on
  // `_global` and the role is unknown, i.e. pseudonymized (conservative).
  get_user: {
    args: { user_id: '101' },
    buildCanvas: () => ({ users: { get: async () => apiShowUser() } }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },

  // GET /api/v1/accounts/:account_id/users?search_term=...&include[]=email
  search_users: {
    args: { account_id: '1', search_term: 'REAL', include: ['email'] },
    buildCanvas: () =>
      ({
        users: { searchUsers: async () => [accountSearchStudent()] },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },

  // GET /api/v1/courses/:course_id/users?include[]=enrollments — the one
  // fixture carrying both arms: a marked student and an unmarked teacher whose
  // `enrollments` classify them as staff.
  list_course_users: {
    args: { course_id: '7', include: ['enrollments'] },
    buildCanvas: () =>
      ({
        users: {
          listCourseUsers: async () => [
            courseRosterStudent([
              {
                id: '881',
                course_id: '7',
                user_id: '101',
                type: 'StudentEnrollment',
                role: 'StudentEnrollment',
                enrollment_state: 'active',
              },
            ]),
            unmarkedTeacher(),
          ],
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },

  // GET /api/v1/accounts/:account_id/users?include[]=email — account scope, no
  // enrollment data, so every row is masked the same way.
  list_account_users: {
    args: { account_id: '1', include: ['email'] },
    buildCanvas: () =>
      ({
        accounts: { listUsers: async () => [accountSearchStudent()] },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },
}
