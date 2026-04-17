import type { CanvasClientConfig, CanvasErrorResponse } from './types'

export class CanvasApiError extends Error {
  status: number
  endpoint: string

  constructor(message: string, status: number, endpoint: string) {
    super(message)
    this.name = 'CanvasApiError'
    this.status = status
    this.endpoint = endpoint
  }
}

const DEFAULT_MAX_PAGINATION_PAGES = 1000
const USER_AGENT = 'canvas-lms-mcp/1.0'

export class CanvasHttpClient {
  private token: string
  private _baseUrl: string
  private maxPaginationPages: number

  constructor(config: CanvasClientConfig) {
    this.token = config.token
    this._baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.maxPaginationPages = config.maxPaginationPages ?? DEFAULT_MAX_PAGINATION_PAGES
  }

  get baseUrl(): string {
    return this._baseUrl
  }

  /**
   * Makes a single authenticated request to the Canvas API.
   * Returns `undefined` (typed as `T`) when Canvas responds with 204 No Content,
   * which is the expected response for DELETE operations.
   */
  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${this._baseUrl}${endpoint}`

    const method = (options.method ?? 'GET').toUpperCase()
    if (options.body != null && (method === 'GET' || method === 'HEAD')) {
      throw new Error(
        `GET requests must not include a body (Canvas CloudFront CDN rejects them with 403): ${endpoint}`,
      )
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'User-Agent': USER_AGENT,
    }
    if (options.body) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    })

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as CanvasErrorResponse
      const message =
        body.errors?.[0]?.message ?? body.message ?? `Canvas API error: ${response.status}`
      throw new CanvasApiError(message, response.status, endpoint)
    }

    if (response.status === 204) {
      return undefined as T
    }

    return response.json() as Promise<T>
  }

  async paginate<T>(endpoint: string, params?: Record<string, string>): Promise<T[]> {
    const url = new URL(`${this._baseUrl}${endpoint}`)
    url.searchParams.set('per_page', '100')
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value)
      }
    }

    const results: T[] = []
    let nextUrl: string | null = url.toString()
    let pages = 0

    while (nextUrl && pages < this.maxPaginationPages) {
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'User-Agent': USER_AGENT,
        },
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as CanvasErrorResponse
        const message =
          body.errors?.[0]?.message ?? body.message ?? `Canvas API error: ${response.status}`
        throw new CanvasApiError(message, response.status, endpoint)
      }

      const data = (await response.json()) as T[]
      results.push(...data)
      pages++

      nextUrl = this.parseNextLink(response.headers.get('Link'))
    }

    return results
  }

  async paginateEnvelope<T>(
    endpoint: string,
    envelopeKey: string,
    params?: Record<string, string>,
  ): Promise<T[]> {
    const url = new URL(`${this._baseUrl}${endpoint}`)
    url.searchParams.set('per_page', '100')
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value)
      }
    }

    const results: T[] = []
    let nextUrl: string | null = url.toString()
    let pages = 0

    while (nextUrl && pages < this.maxPaginationPages) {
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'User-Agent': USER_AGENT,
        },
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as CanvasErrorResponse
        const message =
          body.errors?.[0]?.message ?? body.message ?? `Canvas API error: ${response.status}`
        throw new CanvasApiError(message, response.status, endpoint)
      }

      const body = (await response.json()) as Record<string, T[]>
      const data = body[envelopeKey] ?? []
      results.push(...data)
      pages++

      nextUrl = this.parseNextLink(response.headers.get('Link'))
    }

    return results
  }

  private parseNextLink(linkHeader: string | null): string | null {
    if (!linkHeader) return null
    const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
    return match?.[1] ?? null
  }
}
