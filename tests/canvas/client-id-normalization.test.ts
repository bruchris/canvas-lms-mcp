/**
 * The wiring half of PR 2a: `normalizeCanvasIds()` runs on **all three**
 * `CanvasHttpClient` request paths, unconditionally
 * (`docs/superpowers/specs/2026-10-05-bru-2730-canvas-64bit-identifiers.md`
 * §4.3, BRU-2828).
 *
 * `tests/canvas/normalize-ids.test.ts` proves what the walk does. This file
 * proves it is *reached*, which is a separate claim: the three paths each have
 * their own `fetch` call and their own `response.json()`, and the paginators'
 * `Link`-following loops re-enter theirs once per page. A normalizer wired into
 * one path and not the others would leave every list tool unnormalized while
 * every single-entity tool looked correct.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CanvasHttpClient } from '../../src/canvas/client'

function jsonResponse(body: unknown, link?: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...(link ? { Link: link } : {}),
    },
  })
}

/**
 * One payload, carrying one of each case: an identifier Canvas's own regexes
 * convert, an identifier they miss (`rules.never_drop` — the §2.3 grade
 * divergence), and two quantities in the same object as that miss.
 */
const PAYLOAD = {
  id: 7,
  course_id: 7,
  position: 3,
  points_possible: 10,
  rules: { drop_lowest: 1, never_drop: [101, 102] },
}

const NORMALIZED = {
  id: '7',
  course_id: '7',
  position: 3,
  points_possible: 10,
  rules: { drop_lowest: 1, never_drop: ['101', '102'] },
}

describe('CanvasHttpClient normalizes identifiers on every path', () => {
  let client: CanvasHttpClient

  beforeEach(() => {
    client = new CanvasHttpClient({ token: 't', baseUrl: 'https://canvas.example.com' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('request()', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(PAYLOAD))

    expect(await client.request('/api/v1/courses/7/assignment_groups/1')).toEqual(NORMALIZED)
  })

  it('paginate()', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse([PAYLOAD]))

    expect(await client.paginate('/api/v1/courses/7/assignment_groups')).toEqual([NORMALIZED])
  })

  it('paginate() on every followed Link page, not just the first', async () => {
    // The header and the walk both live inside the loop. A normalizer applied
    // to the accumulated result instead would pass the single-page test and
    // still leave page 2 numeric.
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse([PAYLOAD], '<https://canvas.example.com/next>; rel="next"'),
      )
      .mockResolvedValueOnce(jsonResponse([{ ...PAYLOAD, id: 8 }]))

    expect(await client.paginate('/api/v1/courses/7/assignment_groups')).toEqual([
      NORMALIZED,
      { ...NORMALIZED, id: '8' },
    ])
  })

  it('paginateEnvelope()', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ groups: [PAYLOAD] }))

    expect(await client.paginateEnvelope('/api/v1/x', 'groups')).toEqual([NORMALIZED])
  })

  it('paginateEnvelope() on every followed Link page', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ groups: [PAYLOAD] }, '<https://canvas.example.com/next>; rel="next"'),
      )
      .mockResolvedValueOnce(jsonResponse({ groups: [{ ...PAYLOAD, id: 8 }] }))

    expect(await client.paginateEnvelope('/api/v1/x', 'groups')).toEqual([
      NORMALIZED,
      { ...NORMALIZED, id: '8' },
    ])
  })

  it('normalizes the envelope body before it is opened, so an envelope-scoped exception is reached', async () => {
    // `answer` is scoped to the `quiz_submission_questions` envelope key
    // (§4.3), which only holds if the walk sees the whole body rather than the
    // extracted array.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ quiz_submission_questions: [{ id: 1, answer: 4321 }] }),
    )

    expect(
      await client.paginateEnvelope(
        '/api/v1/quiz_submissions/1/questions',
        'quiz_submission_questions',
      ),
    ).toEqual([{ id: '1', answer: '4321' }])
  })

  it('control: an un-normalized client would return the numbers, so the assertions above are not vacuous', () => {
    // The same payload read straight out of `JSON.parse`. If the walk were a
    // no-op, every expectation in this file would still be comparing against
    // this shape — so the control is what makes them evidence.
    expect(JSON.parse(JSON.stringify(PAYLOAD))).toEqual(PAYLOAD)
    expect(PAYLOAD).not.toEqual(NORMALIZED)
  })

  it('returns undefined on 204 without attempting to normalize a body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }))

    expect(await client.request('/api/v1/courses/7', { method: 'DELETE' })).toBeUndefined()
  })
})
