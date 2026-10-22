import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type {
  CourseUserEnrollmentState,
  CourseUserEnrollmentType,
  CourseUserInclude,
  ListCourseUsersOptions,
  SearchUserInclude,
  SearchUsersOptions,
  UserSort,
} from '../canvas/users'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'
import { type CanvasId, canvasIdInput, canvasIdList } from '../canvas/id'

const COURSE_USER_ENROLLMENT_TYPE = ['student', 'teacher', 'ta', 'observer', 'designer'] as const
const COURSE_USER_ENROLLMENT_STATE = [
  'active',
  'invited',
  'rejected',
  'completed',
  'inactive',
] as const
const COURSE_USER_INCLUDE = [
  'email',
  'enrollments',
  'locked',
  'avatar_url',
  'test_student',
  'bio',
  'custom_links',
  'current_grading_period_scores',
  'uuid',
] as const
export const USER_SORT = ['username', 'email', 'sis_id', 'integration_id', 'last_login'] as const
export const SEARCH_USER_INCLUDE = [
  'email',
  'last_login',
  'avatar_url',
  'time_zone',
  'uuid',
] as const

export function userTools(canvas: CanvasClient, pseudonymizer?: Pseudonymizer): ToolDefinition[] {
  return [
    {
      name: 'list_students',
      title: 'List Students',
      description:
        "List every student enrolled in a course (enrollment_type=student only), returning Canvas user objects (id, name, email, login_id) without grades or enrollment details. Fetches every page (100 per request) and fails with a 'Results are incomplete' error instead of silently truncating. Use list_course_users for every role in the course (teachers, TAs, observers) or to filter users by enrollment_state, and list_course_enrollments when you need the enrollment/grade objects themselves (score, grade, enrollment workflow_state) rather than user profile fields. In pseudonymized mode every returned user's name and email are anonymized, since this endpoint carries no enrollment data for role classification to tell staff apart.",
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const users = await canvas.users.listStudents(course_id)
        if (!pseudonymizer?.isEnabled()) return users
        return pseudonymizer.anonymizeUsers(course_id, users)
      },
    },
    {
      name: 'get_user',
      title: 'Get User',
      description:
        'Get a single Canvas user by numeric ID, returning the full Canvas user object (name, email, login_id, time_zone, bio, pronouns) when the caller is permitted to see it. Use get_profile instead when the target is the caller\'s own account, search_users to find a user when you only know their name, login, or email in an account, or list_course_users to see every user enrolled in a specific course. Because a bare ID lookup carries no enrollment data, pseudonymized mode cannot tell staff from students here and conservatively anonymizes the name and email on every call; list_course_users only keeps a real name when it is also called with `include: ["enrollments"]` and Canvas reports a teacher, TA, or designer enrollment for that user.',
      inputSchema: {
        user_id: canvasIdInput().describe('The Canvas user ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const user = await canvas.users.get(params.user_id as CanvasId)
        if (!pseudonymizer?.isEnabled()) return user
        // No course context — unknown role defaults to pseudonymize (conservative).
        // '_global' is the map key so pseudonyms are stable across calls.
        return pseudonymizer.anonymizeUser('_global', user)
      },
    },
    {
      name: 'get_profile',
      title: 'Get Profile',
      audience: 'shared',
      description: 'Get the profile of the currently authenticated user.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        // get_profile is the token owner — never pseudonymize self.
        return canvas.users.getProfile()
      },
    },
    {
      name: 'search_users',
      title: 'Search Users',
      description:
        "Search for users in a single Canvas account by name, login, or email, returning matching Canvas user objects. Use `include` to add email, last_login, avatar_url, time_zone, or uuid to each result, and `sort`/`order` to control the ordering. This is one account-scoped search — to check whether one student is enrolled anywhere across an educator's own active and concluded courses, use find_student_across_courses instead; to list every user in one course without a search term, use list_course_users; to list an entire account's users unfiltered, use list_account_users. Because results carry no enrollment data, pseudonymized mode cannot tell staff from students and anonymizes every returned user's name and email.",
      inputSchema: {
        account_id: canvasIdInput().describe('The Canvas account ID'),
        search_term: z.string().describe('The search term (name, login, or email)'),
        sort: z.enum(USER_SORT).optional().describe('Sort field'),
        order: z.enum(['asc', 'desc']).optional().describe('Sort order'),
        include: z
          .array(z.enum(SEARCH_USER_INCLUDE))
          .optional()
          .describe('Extra fields to include on each user (Canvas include[] param)'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const account_id = params.account_id as CanvasId
        const opts: SearchUsersOptions = {}
        if (params.sort !== undefined) opts.sort = params.sort as UserSort
        if (params.order !== undefined) opts.order = params.order as 'asc' | 'desc'
        if (params.include !== undefined)
          opts.include = params.include as ReadonlyArray<SearchUserInclude>
        const users = await canvas.users.searchUsers(account_id, params.search_term as string, opts)
        if (!pseudonymizer?.isEnabled()) return users
        // Account-scoped; no course context. Use account_id as map key.
        return pseudonymizer.anonymizeUsers(String(account_id), users)
      },
    },
    {
      name: 'list_course_users',
      title: 'List Course Users',
      description:
        'List users in a course with optional Canvas filters. Use `include` to request email, enrollments, avatar_url, bio, and other fields otherwise omitted from the default response. Use `enrollment_type` / `enrollment_state` to narrow by role or status, `search_term` to filter by name/login, `user_ids` to fetch a specific subset, and `sort`/`order` to control ordering.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        enrollment_type: z
          .array(z.enum(COURSE_USER_ENROLLMENT_TYPE))
          .optional()
          .describe('Filter by one or more enrollment types'),
        enrollment_state: z
          .array(z.enum(COURSE_USER_ENROLLMENT_STATE))
          .optional()
          .describe('Filter by enrollment state (e.g. active, invited)'),
        include: z
          .array(z.enum(COURSE_USER_INCLUDE))
          .optional()
          .describe('Extra fields to include on each user (Canvas include[] param)'),
        // The pre-1b schema here was `z.union([z.number(), z.string()])`, i.e. any
        // string at all, with no documented meaning for the string arm. §4.2 rule 2
        // forbids an ID field that accepts arbitrary strings, so this narrows to the
        // canonical ID forms plus the one SIS prefix the rest of this repo documents
        // (`sis_user_id:`, as in outcomes.ts). Called out in the PR as a narrowing.
        user_ids: canvasIdList({ prefixes: ['sis_user_id'] })
          .optional()
          .describe(
            'Restrict the result to the given user IDs (pass large IDs as strings). ' +
              'SIS user IDs may be given as "sis_user_id:<sis id>".',
          ),
        search_term: z
          .string()
          .optional()
          .describe('Partial name or full login/SIS ID to filter users by'),
        sort: z.enum(USER_SORT).optional().describe('Sort field'),
        order: z.enum(['asc', 'desc']).optional().describe('Sort order'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const opts: ListCourseUsersOptions = {}
        if (params.enrollment_type !== undefined)
          opts.enrollment_type = params.enrollment_type as ReadonlyArray<CourseUserEnrollmentType>
        if (params.enrollment_state !== undefined)
          opts.enrollment_state =
            params.enrollment_state as ReadonlyArray<CourseUserEnrollmentState>
        if (params.include !== undefined)
          opts.include = params.include as ReadonlyArray<CourseUserInclude>
        if (params.user_ids !== undefined)
          opts.user_ids = params.user_ids as ReadonlyArray<CanvasId>
        if (params.search_term !== undefined) opts.search_term = params.search_term as string
        if (params.sort !== undefined) opts.sort = params.sort as UserSort
        if (params.order !== undefined) opts.order = params.order as 'asc' | 'desc'
        const users = await canvas.users.listCourseUsers(course_id, opts)
        if (!pseudonymizer?.isEnabled()) return users
        return pseudonymizer.anonymizeUsers(course_id, users)
      },
    },
  ]
}
