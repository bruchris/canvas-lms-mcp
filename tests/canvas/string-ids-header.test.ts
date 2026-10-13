import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CanvasHttpClient } from '../../src/canvas/client'
import { FilesModule } from '../../src/canvas/files'
import { CANVAS_STRING_IDS_ACCEPT, CANVAS_STRING_IDS_ENV_VAR } from '../../src/canvas/string-ids'

/**
 * BRU-2730 §5 / §8 Phase 2b — the opt-in Canvas string-ID Accept header
 * (BRU-2851, after PR 2a / #399).
 *
 * ## What is red-first here and what is not
 *
 * The **presence** assertions are red-first: before `src/canvas/string-ids.ts`
 * existed no path sent the header, so each one failed.
 *
 * The **absence** assertions (New Quizzes, non-exact flag values) pass
 * vacuously on an empty implementation — "no header" is the state of the world
 * before this PR. They are not evidence on their own, and they are not padding
 * either: each is load-bearing against a *plausible wrong implementation*, and
 * the PR body's injection matrix is what proves it. The two injections that
 * matter are (a) using the repo's `isEnvTruthy()` instead of `=== 'true'` and
 * (b) dropping the `/api/quiz/v1` prefix check.
 *
 * Every absence assertion therefore carries a **negative control** proving a
 * request was actually attempted — otherwise a client broken for any unrelated
 * reason passes the safety test (§8 required assertion 6).
 */

/** The shard-901 compatibility value: above `2**53`, so a JSON number is lossy. */
const SHARD_901_ID = '9010000000000001'
/** What `JSON.parse` leaves of it when Canvas answers with a bare number. */
const SHARD_901_ROUNDED = '9010000000000000'
/** A second shard-901-shaped ID whose rounding error goes the other way. */
const SHARD_901_ID_PAGE2 = '9010000000000003'
const SHARD_901_PAGE2_ROUNDED = '9010000000000004'

interface Captured {
  url: string
  headers: Record<string, string>
  init: RequestInit | undefined
}

/**
 * Replaces `globalThis.fetch` with a queue of canned responses and records
 * every call. Real capture, not an assertion on our own belief: the recorded
 * `headers` is the object the client handed to `fetch`.
 */
function captureFetch(responses: Response[]): Captured[] {
  const calls: Captured[] = []
  let i = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(((url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      init,
    })
    const response = responses[i++]
    if (!response) throw new Error(`captureFetch: no canned response for call ${i}`)
    return Promise.resolve(response)
  }) as unknown as typeof fetch)
  return calls
}

function json(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** A body whose IDs Canvas has already stringified, i.e. what the header buys. */
function raw(text: string, headers: Record<string, string> = {}): Response {
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function nextLink(url: string): Record<string, string> {
  return { Link: `<${url}>; rel="next"` }
}

let client: CanvasHttpClient
let originalFlag: string | undefined

function setFlag(value: string | undefined): void {
  if (value === undefined) delete process.env[CANVAS_STRING_IDS_ENV_VAR]
  else process.env[CANVAS_STRING_IDS_ENV_VAR] = value
}

beforeEach(() => {
  originalFlag = process.env[CANVAS_STRING_IDS_ENV_VAR]
  setFlag(undefined)
  client = new CanvasHttpClient({ token: 'test-token', baseUrl: 'https://canvas.example.com' })
})

afterEach(() => {
  setFlag(originalFlag)
  vi.restoreAllMocks()
})

describe('§8 Phase 2b — the string-ID Accept header is sent on all three client paths', () => {
  beforeEach(() => {
    setFlag('true')
  })

  it('request() sends the Canvas string-ID media type', async () => {
    const calls = captureFetch([json({ id: 1 })])

    await client.request('/api/v1/courses/1')

    expect(calls).toHaveLength(1)
    expect(calls[0].headers.Accept).toBe(CANVAS_STRING_IDS_ACCEPT)
  })

  it('paginate() sends it on the first page', async () => {
    const calls = captureFetch([json([{ id: 1 }])])

    await client.paginate('/api/v1/courses')

    expect(calls).toHaveLength(1)
    expect(calls[0].headers.Accept).toBe(CANVAS_STRING_IDS_ACCEPT)
  })

  it('paginateEnvelope() sends it on the first page', async () => {
    const calls = captureFetch([json({ items: [{ id: 1 }] })])

    await client.paginateEnvelope('/api/v1/items', 'items')

    expect(calls).toHaveLength(1)
    expect(calls[0].headers.Accept).toBe(CANVAS_STRING_IDS_ACCEPT)
  })

  it('paginate() sends it on a followed `Link` rel="next" URL, not just the first page', async () => {
    const page2 = 'https://canvas.example.com/api/v1/courses?page=2'
    const calls = captureFetch([json([{ id: 1 }], nextLink(page2)), json([{ id: 2 }])])

    await client.paginate('/api/v1/courses')

    expect(calls.map((c) => c.url)).toEqual([expect.stringContaining('per_page=100'), page2])
    expect(calls.map((c) => c.headers.Accept)).toEqual([
      CANVAS_STRING_IDS_ACCEPT,
      CANVAS_STRING_IDS_ACCEPT,
    ])
  })

  it('paginateEnvelope() sends it on a followed `Link` rel="next" URL', async () => {
    const page2 = 'https://canvas.example.com/api/v1/items?page=2'
    const calls = captureFetch([
      json({ items: [{ id: 1 }] }, nextLink(page2)),
      json({ items: [{ id: 2 }] }),
    ])

    await client.paginateEnvelope('/api/v1/items', 'items')

    expect(calls.map((c) => c.url)).toEqual([expect.stringContaining('per_page=100'), page2])
    expect(calls.map((c) => c.headers.Accept)).toEqual([
      CANVAS_STRING_IDS_ACCEPT,
      CANVAS_STRING_IDS_ACCEPT,
    ])
  })

  it('keeps a plain `application/json` fallback in the same header', () => {
    // Canvas gates on `Accept&.include?("application/json+canvas-string-ids")`
    // — a substring test — so the fallback costs nothing and keeps the request
    // acceptable to any proxy or endpoint that does not know the vendor type
    // (§5, `application_controller.rb:2978`).
    expect(CANVAS_STRING_IDS_ACCEPT).toBe('application/json+canvas-string-ids, application/json')
    expect(CANVAS_STRING_IDS_ACCEPT).toContain('application/json+canvas-string-ids')
    expect(CANVAS_STRING_IDS_ACCEPT.split(', ')).toContain('application/json')
  })

  it('leaves the existing auth and user-agent headers intact on all three paths', async () => {
    const calls = captureFetch([json({ id: 1 }), json([{ id: 1 }]), json({ items: [] })])

    await client.request('/api/v1/courses/1')
    await client.paginate('/api/v1/courses')
    await client.paginateEnvelope('/api/v1/items', 'items')

    expect(calls).toHaveLength(3)
    for (const call of calls) {
      expect(call.headers.Authorization).toBe('Bearer test-token')
      expect(call.headers['User-Agent']).toMatch(/^canvas-lms-mcp\//)
    }
  })

  it('still sets Content-Type alongside Accept on a request with a body', async () => {
    const calls = captureFetch([json({ id: 1 })])

    await client.request('/api/v1/courses', { method: 'POST', body: JSON.stringify({ a: 1 }) })

    expect(calls[0].headers['Content-Type']).toBe('application/json')
    expect(calls[0].headers.Accept).toBe(CANVAS_STRING_IDS_ACCEPT)
  })

  it('lets an explicit caller-supplied Accept win, so the opt-in is never a lock-in', async () => {
    const calls = captureFetch([json({ id: 1 })])

    await client.request('/api/v1/courses/1', { headers: { Accept: 'application/xml' } })

    expect(calls[0].headers.Accept).toBe('application/xml')
  })
})

describe('§5 Phase 2b — New Quizzes (`/api/quiz/v1`) never acquires the header', () => {
  // `json_cast` is an `ApplicationController` concern and `/api/quiz/v1` is
  // served by the separate New Quizzes service, which does not implement the
  // vendor media type. Our own types already record that it answers
  // differently: `CanvasNewQuizItem.id` is a string while `CanvasNewQuiz.id`
  // is a number (§5). Sending the header there negotiates nothing, so the
  // exclusion keeps the request byte-identical to the pre-flag one.
  beforeEach(() => {
    setFlag('true')
  })

  it('request() to /api/quiz/v1 sends no Accept header — and the request IS attempted', async () => {
    const calls = captureFetch([json({ id: 1 })])

    await client.request('/api/quiz/v1/courses/1/quizzes/2')

    // Negative control first: absence is only meaningful if a call happened.
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://canvas.example.com/api/quiz/v1/courses/1/quizzes/2')
    expect(calls[0].headers.Accept).toBeUndefined()
  })

  it('paginate() over /api/quiz/v1 sends no Accept header — and the request IS attempted', async () => {
    const calls = captureFetch([json([{ id: 1 }])])

    await client.paginate('/api/quiz/v1/courses/1/quizzes/2/items')

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/quiz/v1/')
    expect(calls[0].headers.Accept).toBeUndefined()
  })

  it('paginateEnvelope() over /api/quiz/v1 sends no Accept header — and the request IS attempted', async () => {
    const calls = captureFetch([json({ items: [{ id: 1 }] })])

    await client.paginateEnvelope('/api/quiz/v1/courses/1/quizzes/2/items', 'items')

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/quiz/v1/')
    expect(calls[0].headers.Accept).toBeUndefined()
  })

  it('decides per followed URL, so a `Link` into /api/quiz/v1 is also excluded', async () => {
    const quizPage2 = 'https://canvas.example.com/api/quiz/v1/courses/1/quizzes?page=2'
    const calls = captureFetch([json([{ id: 1 }], nextLink(quizPage2)), json([{ id: 2 }])])

    await client.paginate('/api/v1/courses')

    expect(calls).toHaveLength(2)
    // Control on the same run: the non-quiz first page DID get the header, so
    // the second call's absence cannot be the flag simply being off.
    expect(calls[0].headers.Accept).toBe(CANVAS_STRING_IDS_ACCEPT)
    expect(calls[1].headers.Accept).toBeUndefined()
  })

  it('excludes only the prefix: `/api/v1/quiz...` and `/api/quiz/v2` still negotiate', async () => {
    const calls = captureFetch([json({ id: 1 }), json({ id: 1 }), json({ id: 1 })])

    await client.request('/api/v1/courses/1/quizzes/2')
    await client.request('/api/quiz/v2/courses/1/quizzes/2')
    await client.request('/api/quiz/v1x/courses/1')

    expect(calls.map((c) => c.headers.Accept)).toEqual([
      CANVAS_STRING_IDS_ACCEPT,
      CANVAS_STRING_IDS_ACCEPT,
      // `/api/quiz/v1x` starts with the prefix string, so it is excluded too.
      // Canvas has no such route; recording the behaviour rather than
      // pretending the check is segment-aware.
      undefined,
    ])
  })
})

describe('§8 Phase 2b — the flag is byte-exact: only `true` enables negotiation', () => {
  // Deliberately NOT `isEnvTruthy()` from `src/env.ts`. This flag changes the
  // wire type of every identifier in every response, so every trim, lowercase
  // or truthiness step widens the set of strings that *accidentally* turn it
  // on: `TRUE` out of a YAML file, `1` out of a template, a trailing space out
  // of a paste (§8 PR 2b).
  const nonEnablingValues: Array<[string, string | undefined]> = [
    ['unset', undefined],
    ['empty string', ''],
    ['uppercase TRUE', 'TRUE'],
    ['title-case True', 'True'],
    ['leading space', ' true'],
    ['trailing space', 'true '],
    ['tab-padded', '\ttrue'],
    ['numeric 1', '1'],
    ['yes', 'yes'],
    ['on', 'on'],
    ['false', 'false'],
    ['truthy-looking JSON', '"true"'],
  ]

  it.each(nonEnablingValues)(
    'does not negotiate for %s — and the request IS still attempted',
    async (_label, value) => {
      setFlag(value)
      const calls = captureFetch([json({ id: 1 })])

      await client.request('/api/v1/courses/1')

      expect(calls).toHaveLength(1)
      expect(calls[0].headers.Accept).toBeUndefined()
      // Positive control: the same client under the exact value DOES negotiate,
      // so the absence above is attributable to the value and nothing else.
      expect(process.env[CANVAS_STRING_IDS_ENV_VAR]).not.toBe('true')
    },
  )

  it('positive control for the whole table: the exact string `true` DOES negotiate', async () => {
    setFlag('true')
    const calls = captureFetch([json({ id: 1 })])

    await client.request('/api/v1/courses/1')

    expect(calls[0].headers.Accept).toBe(CANVAS_STRING_IDS_ACCEPT)
  })

  it('reads the flag per request, so turning it off mid-process takes effect', async () => {
    setFlag('true')
    const calls = captureFetch([json({ id: 1 }), json({ id: 1 })])

    await client.request('/api/v1/courses/1')
    setFlag('false')
    await client.request('/api/v1/courses/1')

    expect(calls.map((c) => c.headers.Accept)).toEqual([CANVAS_STRING_IDS_ACCEPT, undefined])
  })
})

describe('§8 assertions 3 and 5 — a shard-901 ID survives once Canvas answers in strings', () => {
  it('preserves `9010000000000001` byte-exact across a followed `Link` page', async () => {
    setFlag('true')
    const page2 = 'https://canvas.example.com/api/v1/courses?page=2'
    const calls = captureFetch([
      raw(`[{"id":"${SHARD_901_ID}"}]`, nextLink(page2)),
      raw(`[{"id":"${SHARD_901_ID_PAGE2}"}]`),
    ])

    const result = await client.paginate<{ id: string }>('/api/v1/courses')

    expect(result.map((r) => r.id)).toEqual([SHARD_901_ID, SHARD_901_ID_PAGE2])
    expect(calls.map((c) => c.headers.Accept)).toEqual([
      CANVAS_STRING_IDS_ACCEPT,
      CANVAS_STRING_IDS_ACCEPT,
    ])
  })

  it('preserves it through request() and paginateEnvelope() too', async () => {
    setFlag('true')
    captureFetch([raw(`{"id":"${SHARD_901_ID}"}`), raw(`{"items":[{"id":"${SHARD_901_ID}"}]}`)])

    const one = await client.request<{ id: string }>('/api/v1/courses/1')
    const many = await client.paginateEnvelope<{ id: string }>('/api/v1/items', 'items')

    expect(one.id).toBe(SHARD_901_ID)
    expect(many[0].id).toBe(SHARD_901_ID)
  })

  // CHARACTERIZATION — true before this PR and after it. This is the measurement
  // that says *why* the header is the only fix: `response.json()` is
  // `JSON.parse`, so a bare JSON number is already rounded before any code of
  // ours runs. §4.3 normalization cannot recover a digit that never arrived,
  // which is the §19 correction to §8 assertion 5.
  it('characterization: a NUMERIC shard-901 payload is already lossy at `JSON.parse`', async () => {
    setFlag('true')
    captureFetch([raw(`[{"id":${SHARD_901_ID}},{"id":${SHARD_901_ID_PAGE2}}]`)])

    const result = await client.paginate<{ id: string }>('/api/v1/courses')

    expect(result.map((r) => r.id)).toEqual([SHARD_901_ROUNDED, SHARD_901_PAGE2_ROUNDED])
    expect(result.map((r) => r.id)).not.toContain(SHARD_901_ID)
  })
})

describe('§4.3 Phase 2b — PR 2a normalization is preserved in BOTH flag modes', () => {
  // The order in §8 is not negotiable: normalization is unconditional and the
  // header is a pure precision improvement on top of it. These are
  // CHARACTERIZATION tests of #399's property, re-pinned here so a future
  // change that makes normalization conditional on the flag fails loudly.
  it('normalizes numeric IDs to canonical strings with the flag OFF', async () => {
    setFlag(undefined)
    captureFetch([json({ id: 7, course_id: 8, points_possible: 10 })])

    const result = await client.request<Record<string, unknown>>('/api/v1/assignments/7')

    expect(result).toEqual({ id: '7', course_id: '8', points_possible: 10 })
  })

  it('normalizes numeric IDs to canonical strings with the flag ON', async () => {
    // §5's caveat made executable: `ApplicationController#render` applies
    // `json_cast` only `unless json.is_a?(String)`, so an endpoint that renders
    // pre-serialized JSON answers with numbers even when the header was sent.
    // The header is best-effort; normalization is not.
    setFlag('true')
    captureFetch([json({ id: 7, course_id: 8, points_possible: 10 })])

    const result = await client.request<Record<string, unknown>>('/api/v1/assignments/7')

    expect(result).toEqual({ id: '7', course_id: '8', points_possible: 10 })
  })

  it('leaves an already-stringified payload untouched in both modes', async () => {
    for (const flag of ['true', undefined] as const) {
      setFlag(flag)
      vi.restoreAllMocks()
      captureFetch([json({ id: '7', course_id: '8', points_possible: 10 })])

      const result = await client.request<Record<string, unknown>>('/api/v1/assignments/7')

      expect(result).toEqual({ id: '7', course_id: '8', points_possible: 10 })
    }
  })

  it('normalizes a New Quizzes response too, even though it never gets the header', async () => {
    setFlag('true')
    captureFetch([json({ id: 7, quiz_id: 8 })])

    const result = await client.request<Record<string, unknown>>('/api/quiz/v1/courses/1/quizzes/7')

    expect(result).toEqual({ id: '7', quiz_id: '8' })
  })
})

describe('§5 Phase 2b — the file-upload S3 leg cannot acquire the header', () => {
  // §5 requires verifying in Phase 2 that `src/canvas/files.ts`'s upload steps
  // do not pick the header up. The structural answer is that step 2 POSTs to a
  // storage URL with a module-level bare `fetch()`, never through
  // `CanvasHttpClient`, so it cannot — while steps 1 and 3 are genuine Canvas
  // API calls through `request()` and legitimately do negotiate. This exercises
  // the real three-leg flow rather than mocking `client.request` away.
  it('sends the header on the Canvas notify and confirm legs, and nothing on the S3 leg', async () => {
    setFlag('true')
    const files = new FilesModule(client)
    const calls = captureFetch([
      json({ upload_url: 'https://s3.example.com/upload', upload_params: { key: 'k' } }),
      new Response(null, {
        status: 303,
        headers: { location: 'https://canvas.example.com/api/v1/files/42/confirm' },
      }),
      json({ id: 42, display_name: 'notes.txt' }),
    ])

    await files.upload(100, 'notes.txt', btoa('hello world'), 'text/plain')

    expect(calls.map((c) => c.url)).toEqual([
      'https://canvas.example.com/api/v1/courses/100/files',
      'https://s3.example.com/upload',
      'https://canvas.example.com/api/v1/files/42/confirm',
    ])
    expect(calls.map((c) => c.headers.Accept)).toEqual([
      CANVAS_STRING_IDS_ACCEPT,
      undefined,
      CANVAS_STRING_IDS_ACCEPT,
    ])
    // The S3 leg carries no Authorization either — the existing invariant this
    // must not disturb.
    expect(calls[1].headers.Authorization).toBeUndefined()
  })
})
