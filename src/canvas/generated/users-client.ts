/**
 * Generated-client users module (prototype for GitHub issue #78).
 *
 * Demonstrates swapping the hand-written `UsersModule` with a thin layer
 * on top of `openapi-fetch` + generated types. The public shape matches
 * `UsersModule` exactly so that `CanvasClient` can select either
 * implementation behind a feature flag without downstream tools knowing.
 *
 * Two things that cannot live in the OpenAPI spec (per issue #78) are
 * handled here:
 *
 *  1. Bearer auth injection -- a one-line openapi-fetch middleware.
 *  2. Link-header pagination -- a small manual loop. openapi-fetch drives
 *     the first request with full type-checking; subsequent pages are
 *     fetched directly since Canvas returns absolute URLs in the Link
 *     header that don't fit openapi-fetch's path-templated API surface.
 */
import createClient, { type Middleware } from 'openapi-fetch'
import { version } from '../../../package.json'
import { CanvasApiError } from '../client'
import type {
  CanvasClientConfig,
  CanvasErrorResponse,
  CanvasUpcomingEvent,
  CanvasUser,
  CanvasUserProfile,
} from '../types'
import type {
  CourseUserEnrollmentType,
  CourseUserEnrollmentState,
  CourseUserInclude,
  ListCourseUsersOptions,
  SearchUserInclude,
  SearchUsersOptions,
  UserSort,
  UsersModuleApi,
} from '../users'
import type { paths } from './types'

const DEFAULT_MAX_PAGINATION_PAGES = 1000
const USER_AGENT = `canvas-lms-mcp/${version}`
const DEFAULT_PER_PAGE = 100

type OpenApiClient = ReturnType<typeof createClient<paths>>

export class GeneratedUsersModule implements UsersModuleApi {
  private client: OpenApiClient
  private token: string
  private baseUrl: string
  private maxPaginationPages: number

  constructor(config: CanvasClientConfig) {
    this.token = config.token
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.maxPaginationPages = config.maxPaginationPages ?? DEFAULT_MAX_PAGINATION_PAGES

    const token = this.token
    const authMiddleware: Middleware = {
      onRequest({ request }) {
        request.headers.set('Authorization', `Bearer ${token}`)
        request.headers.set('User-Agent', USER_AGENT)
        return request
      },
    }

    this.client = createClient<paths>({ baseUrl: this.baseUrl })
    this.client.use(authMiddleware)
  }

  async listStudents(courseId: number): Promise<CanvasUser[]> {
    return this.paginate<CanvasUser>(`/api/v1/courses/${courseId}/users`, {
      'enrollment_type[]': ['student'],
    })
  }

  async get(userId: number): Promise<CanvasUser> {
    const endpoint = `/api/v1/users/${userId}`
    const { data, error, response } = await this.client.GET('/api/v1/users/{id}', {
      params: { path: { id: userId } },
    })
    if (error || !response.ok) {
      throw await toCanvasError(response, endpoint, error)
    }
    return data as CanvasUser
  }

  async getProfile(): Promise<CanvasUserProfile> {
    const endpoint = '/api/v1/users/self/profile'
    const { data, error, response } = await this.client.GET('/api/v1/users/self/profile')
    if (error || !response.ok) {
      throw await toCanvasError(response, endpoint, error)
    }
    return data as CanvasUserProfile
  }

  async searchUsers(
    accountId: number,
    searchTerm: string,
    opts: SearchUsersOptions = {},
  ): Promise<CanvasUser[]> {
    const query: Record<string, unknown> = { search_term: searchTerm }
    if (opts.sort) query.sort = opts.sort
    if (opts.order) query.order = opts.order
    if (opts.include && opts.include.length > 0) query['include[]'] = opts.include
    return this.paginate<CanvasUser>(`/api/v1/accounts/${accountId}/users`, query)
  }

  async listCourseUsers(
    courseId: number,
    opts: ListCourseUsersOptions = {},
  ): Promise<CanvasUser[]> {
    const query: Record<string, unknown> = {}
    if (opts.enrollment_type !== undefined) {
      query['enrollment_type[]'] = Array.isArray(opts.enrollment_type)
        ? opts.enrollment_type
        : [opts.enrollment_type]
    }
    if (opts.enrollment_state && opts.enrollment_state.length > 0) {
      query['enrollment_state[]'] = opts.enrollment_state
    }
    if (opts.include && opts.include.length > 0) query['include[]'] = opts.include
    if (opts.user_ids && opts.user_ids.length > 0) query['user_ids[]'] = opts.user_ids
    if (opts.enrollment_role_id !== undefined) query.enrollment_role_id = opts.enrollment_role_id
    if (opts.user_id !== undefined) query.user_id = opts.user_id
    if (opts.search_term) query.search_term = opts.search_term
    if (opts.sort) query.sort = opts.sort
    if (opts.order) query.order = opts.order
    return this.paginate<CanvasUser>(`/api/v1/courses/${courseId}/users`, query)
  }

  async getUpcomingAssignments(): Promise<CanvasUpcomingEvent[]> {
    const endpoint = '/api/v1/users/self/upcoming_events'
    const { data, error, response } = await this.client.GET('/api/v1/users/self/upcoming_events', {
      params: { query: { type: 'Assignment' } },
    })
    if (error || !response.ok) {
      throw await toCanvasError(response, endpoint, error)
    }
    return (data as CanvasUpcomingEvent[]) ?? []
  }

  /**
   * Paginated GET with manual Link-header handling. The first page uses
   * openapi-fetch's typed surface; subsequent pages use raw fetch since
   * Canvas returns absolute URLs in the Link header that don't map onto
   * path templates.
   */
  private async paginate<T>(endpoint: string, query: Record<string, unknown>): Promise<T[]> {
    const firstUrl = buildUrl(this.baseUrl, endpoint, query)
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'User-Agent': USER_AGENT,
    }

    const results: T[] = []
    let nextUrl: string | null = firstUrl
    let pages = 0

    while (nextUrl && pages < this.maxPaginationPages) {
      const response = await fetch(nextUrl, { headers })
      if (!response.ok) {
        throw await toCanvasError(response, endpoint, undefined)
      }
      const page = (await response.json()) as T[]
      results.push(...page)
      pages++
      nextUrl = parseNextLink(response.headers.get('Link'))
    }
    return results
  }
}

function buildUrl(baseUrl: string, endpoint: string, query: Record<string, unknown>): string {
  const url = new URL(`${baseUrl}${endpoint}`)
  if (!url.searchParams.has('per_page')) {
    url.searchParams.set('per_page', String(DEFAULT_PER_PAGE))
  }
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue
        url.searchParams.append(key, String(item))
      }
    } else {
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  return match?.[1] ?? null
}

async function toCanvasError(
  response: Response,
  endpoint: string,
  openapiError: unknown,
): Promise<CanvasApiError> {
  let body: CanvasErrorResponse = {}
  if (openapiError && typeof openapiError === 'object') {
    body = openapiError as CanvasErrorResponse
  } else if (!response.bodyUsed) {
    try {
      body = (await response.clone().json()) as CanvasErrorResponse
    } catch {
      body = {}
    }
  }
  const message =
    body.errors?.[0]?.message ?? body.message ?? `Canvas API error: ${response.status}`
  return new CanvasApiError(message, response.status, endpoint)
}

// Re-export the types already defined in src/canvas/users.ts so that
// consumers of the generated module get an identical surface.
export type {
  CourseUserEnrollmentType,
  CourseUserEnrollmentState,
  CourseUserInclude,
  ListCourseUsersOptions,
  SearchUserInclude,
  SearchUsersOptions,
  UserSort,
}
