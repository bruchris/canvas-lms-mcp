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
const USER_SORT = ['username', 'email', 'sis_id', 'integration_id', 'last_login'] as const
const SEARCH_USER_INCLUDE = ['email', 'last_login', 'avatar_url', 'time_zone', 'uuid'] as const

export function userTools(canvas: CanvasClient, pseudonymizer?: Pseudonymizer): ToolDefinition[] {
  return [
    {
      name: 'list_students',
      description: 'List all students enrolled in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const users = await canvas.users.listStudents(course_id)
        if (!pseudonymizer?.isEnabled()) return users
        return pseudonymizer.anonymizeUsers(course_id, users)
      },
    },
    {
      name: 'get_user',
      description: 'Get details for a single user by ID.',
      inputSchema: {
        user_id: z.number().describe('The Canvas user ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const user = await canvas.users.get(params.user_id as number)
        if (!pseudonymizer?.isEnabled()) return user
        // No course context — unknown role defaults to pseudonymize (conservative).
        // '_global' is the map key so pseudonyms are stable across calls.
        return pseudonymizer.anonymizeUser('_global', user)
      },
    },
    {
      name: 'get_profile',
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
      description:
        'Search for users in a Canvas account by name, login, or email. Use `include` to request email, last_login, avatar_url, time_zone, or uuid in the response.',
      inputSchema: {
        account_id: z.number().describe('The Canvas account ID'),
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
        const account_id = params.account_id as number
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
      description:
        'List users in a course with optional Canvas filters. Use `include` to request email, enrollments, avatar_url, bio, and other fields otherwise omitted from the default response. Use `enrollment_type` / `enrollment_state` to narrow by role or status, `search_term` to filter by name/login, `user_ids` to fetch a specific subset, and `sort`/`order` to control ordering.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
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
        user_ids: z
          .array(z.union([z.number(), z.string()]))
          .optional()
          .describe('Restrict the result to the given user IDs'),
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
        const course_id = params.course_id as number
        const opts: ListCourseUsersOptions = {}
        if (params.enrollment_type !== undefined)
          opts.enrollment_type = params.enrollment_type as ReadonlyArray<CourseUserEnrollmentType>
        if (params.enrollment_state !== undefined)
          opts.enrollment_state =
            params.enrollment_state as ReadonlyArray<CourseUserEnrollmentState>
        if (params.include !== undefined)
          opts.include = params.include as ReadonlyArray<CourseUserInclude>
        if (params.user_ids !== undefined)
          opts.user_ids = params.user_ids as ReadonlyArray<number | string>
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
