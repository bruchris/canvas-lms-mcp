import { describe, expect, it, afterEach, vi } from 'vitest'
import { CanvasHttpClient } from '../../src/canvas/client'
import { MISSING_CREDENTIALS_TOOL_CALL_ERROR } from '../../src/auth/credential-gate'

/**
 * BRU-3043 / GH #442 — defence in depth for the credentialless state.
 *
 * The tool-layer gate is the user-facing behaviour and covers every registered
 * tool. This is the property underneath it: a client holding no token cannot
 * reach the network at all, whatever calls it. The guard sits in
 * `canvasHeaders()`, which `request`, `paginate` and `paginateEnvelope` all
 * call to build the `Authorization` header *before* invoking `fetch` — so it is
 * the one place an authenticated Canvas request cannot route around, and the
 * "no Canvas network request is made" acceptance criterion holds for callers
 * the tool wrapper does not cover (a resource read, an embedder using
 * `canvas-lms-mcp/canvas` as a library).
 *
 * "No caller does X" is a convention. "The transport throws on X" is a
 * property. Both are asserted; this file owns the second.
 */

const BASE_URL = 'https://canvas.example.com'

describe('CanvasHttpClient with no token', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function credentialless() {
    return new CanvasHttpClient({ token: '', baseUrl: BASE_URL })
  }

  it('refuses request() before any fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(credentialless().request('/api/v1/courses/1')).rejects.toThrow(
      MISSING_CREDENTIALS_TOOL_CALL_ERROR,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses paginate() before any fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(credentialless().paginate('/api/v1/courses')).rejects.toThrow(
      MISSING_CREDENTIALS_TOOL_CALL_ERROR,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses paginateEnvelope() before any fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(
      credentialless().paginateEnvelope('/api/v1/courses/1/gradebook_history/feed', 'items'),
    ).rejects.toThrow(MISSING_CREDENTIALS_TOOL_CALL_ERROR)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('control: the same three calls do reach fetch once a token is present', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })))
    vi.stubGlobal('fetch', fetchSpy)
    const client = new CanvasHttpClient({ token: 'test-token', baseUrl: BASE_URL })

    await client.request('/api/v1/courses/1')
    await client.paginate('/api/v1/courses')
    await client.paginateEnvelope('/api/v1/courses/1/gradebook_history/feed', 'items')

    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(3)
  })
})
