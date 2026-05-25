import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pingUsersSelf } from '../../src/init/validate'

const ORIGINAL_FETCH = globalThis.fetch

describe('pingUsersSelf', () => {
  beforeEach(() => {
    // Each test installs its own fetch stub via mockFetch().
  })

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
    vi.restoreAllMocks()
  })

  const mockFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
    globalThis.fetch = vi.fn(impl) as unknown as typeof fetch
  }

  it('returns ok with displayName when Canvas responds 200', async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ id: 1, name: 'Jane Smith' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )

    const result = await pingUsersSelf('valid-token', 'https://school.instructure.com/api/v1')

    expect(result.ok).toBe(true)
    expect(result.displayName).toBe('Jane Smith')
  })

  it('strips trailing slashes from baseUrl before requesting', async () => {
    let calledUrl = ''
    mockFetch(async (url) => {
      calledUrl = url
      return new Response(JSON.stringify({ name: 'X' }), { status: 200 })
    })

    await pingUsersSelf('t', 'https://school.instructure.com/api/v1/')

    expect(calledUrl).toBe('https://school.instructure.com/api/v1/users/self')
  })

  it('sends the token as a Bearer authorization header', async () => {
    let authHeader: string | null = null
    mockFetch(async (_url, init) => {
      const headers = new Headers(init?.headers)
      authHeader = headers.get('Authorization')
      return new Response(JSON.stringify({ name: 'X' }), { status: 200 })
    })

    await pingUsersSelf('s3cret', 'https://school.instructure.com/api/v1')

    expect(authHeader).toBe('Bearer s3cret')
  })

  it('returns ok=false with 401 and an "invalid or expired" hint on 401', async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ errors: [{ message: 'Invalid access token' }] }), {
          status: 401,
        }),
    )

    const result = await pingUsersSelf('bad', 'https://school.instructure.com/api/v1')

    expect(result.ok).toBe(false)
    expect(result.status).toBe(401)
    expect(result.hint).toMatch(/invalid or expired/i)
  })

  it('treats 5xx as a soft failure with a "continue anyway?" hint', async () => {
    mockFetch(async () => new Response('{}', { status: 503 }))

    const result = await pingUsersSelf('t', 'https://school.instructure.com/api/v1')

    expect(result.ok).toBe(false)
    expect(result.status).toBe(503)
    expect(result.hint).toMatch(/canvas unreachable.*continue anyway/i)
  })

  it('treats network/fetch failures as a soft failure with "continue anyway?"', async () => {
    mockFetch(async () => {
      throw new TypeError('fetch failed')
    })

    const result = await pingUsersSelf('t', 'https://school.instructure.com/api/v1')

    expect(result.ok).toBe(false)
    expect(result.status).toBeUndefined()
    expect(result.hint).toMatch(/canvas unreachable.*continue anyway/i)
  })

  it('returns ok=false with status and "Unexpected error" for other non-2xx codes', async () => {
    mockFetch(async () => new Response('{}', { status: 403 }))

    const result = await pingUsersSelf('t', 'https://school.instructure.com/api/v1')

    expect(result.ok).toBe(false)
    expect(result.status).toBe(403)
    expect(result.hint).toMatch(/unexpected/i)
  })

  it('returns ok=true even when Canvas omits a name field', async () => {
    mockFetch(async () => new Response(JSON.stringify({ id: 1 }), { status: 200 }))

    const result = await pingUsersSelf('t', 'https://school.instructure.com/api/v1')

    expect(result.ok).toBe(true)
    expect(result.displayName).toBeUndefined()
  })
})
