import { describe, it, expect, vi, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createCanvasMCPServer } from '../../src/server'
import { CanvasHttpClient } from '../../src/canvas/client'
import { CanvasClient } from '../../src/canvas'

/**
 * BRU-2730 §8 "Compatibility tests required in every phase", for PR 1b.
 *
 * The canonical fixture is the shard-901 case, `9010000000000001`, so the test
 * name explains *why* the value is large: `switchman`'s
 * `global_id = local_id + shard_id * IDS_PER_SHARD` with
 * `IDS_PER_SHARD = 10_000_000_000_000` puts every object on shard >= 901 above
 * `Number.MAX_SAFE_INTEGER`.
 *
 * Two structural rules, both from §8 and both load-bearing:
 *
 * - **`listTools()` is called before any `callTool`**, matching how a real
 *   client is used. It does not gate anything these tests assert: Canvas
 *   input validation runs unconditionally server-side, and removing the call
 *   leaves all 7 outcomes below unchanged. `listTools()` only populates the
 *   SDK's *output*-validator cache, which this file does not exercise.
 * - **Every "no request was made" assertion is paired with a control** that
 *   makes the same call in a configuration where the request *is* attempted.
 *   Otherwise the safety assertion passes on a server broken for an unrelated
 *   reason.
 *
 * Test 5 of §8's list — the response round-trip — is **not** here, and not
 * because it passes: there is no response normalization until PR 2a, which is
 * where §8 puts `normalizeCanvasIds()`. What PR 1b can assert about the
 * response side is the narrower property at the bottom of this file.
 */

const TEST_TOKEN = 'test-token'
const TEST_BASE_URL = 'https://canvas.example.com'
/** Shard 901, local id 1: the smallest Canvas ID a JS number cannot carry. */
const SHARD_901_ID = '9010000000000001'
/** `2**53`, the first integer indistinguishable from its neighbour as a double. */
const UNSAFE_NUMBER = 9007199254740992

async function armedClient(): Promise<Client> {
  const { server } = createCanvasMCPServer({ token: TEST_TOKEN, baseUrl: TEST_BASE_URL })
  const client = new Client({ name: 'id-compat-test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  // Matches real client usage; the assertions below hold identically without
  // this call too — server-side input validation is unconditional, not
  // gated by it.
  await client.listTools()
  return client
}

describe('§8 compatibility — a shard-901 Canvas ID survives the whole input path (BRU-2730)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('test 1: the ID reaches the Canvas endpoint byte-exact through a real Client', async () => {
    const client = await armedClient()
    const requestSpy = vi
      .spyOn(CanvasHttpClient.prototype, 'request')
      .mockResolvedValue({ id: SHARD_901_ID, name: 'Shard 901 Course' })

    const result = await client.callTool({
      name: 'get_course',
      arguments: { course_id: SHARD_901_ID },
    })

    expect(result.isError).toBeFalsy()
    expect(requestSpy).toHaveBeenCalledWith(`/api/v1/courses/${SHARD_901_ID}`, expect.anything())
    // Not `toContain`: the whole point is that no digit changed, and a
    // substring check would pass on a rounded value that shares a prefix.
    const [endpoint] = requestSpy.mock.calls[0]!
    expect(endpoint).toBe(`/api/v1/courses/${SHARD_901_ID}`)
  })

  it('test 2: `2**53` as a number is rejected, and the message names the value and the remedy', async () => {
    const client = await armedClient()
    const requestSpy = vi.spyOn(CanvasHttpClient.prototype, 'request').mockResolvedValue({})

    const result = await client.callTool({
      name: 'get_course',
      arguments: { course_id: UNSAFE_NUMBER },
    })

    expect(result.isError).toBe(true)
    expect(requestSpy).not.toHaveBeenCalled()
    const text = JSON.stringify(result.content)
    expect(text).toContain(String(UNSAFE_NUMBER))
    expect(text).toContain('Pass large IDs as strings')
  })

  it('test 6: control for test 2 — the same call with a valid ID DOES attempt the request', async () => {
    // Without this, test 2 passes on a server that makes no requests at all.
    const client = await armedClient()
    const requestSpy = vi.spyOn(CanvasHttpClient.prototype, 'request').mockResolvedValue({})

    await client.callTool({ name: 'get_course', arguments: { course_id: SHARD_901_ID } })

    expect(requestSpy).toHaveBeenCalledTimes(1)
  })

  it('test 3: the exact ID survives a followed `Link` rel="next" URL', async () => {
    const canvas = new CanvasClient({ token: TEST_TOKEN, baseUrl: TEST_BASE_URL })
    const nextUrl = `${TEST_BASE_URL}/api/v1/courses/${SHARD_901_ID}/assignments?page=2&per_page=100`
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 1, name: 'A1' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json', Link: `<${nextUrl}>; rel="next"` },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 2, name: 'A2' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

    const assignments = await canvas.assignments.list(SHARD_901_ID)

    expect(assignments).toHaveLength(2)
    const urls = fetchSpy.mock.calls.map((call) => String(call[0]))
    expect(urls).toHaveLength(2)
    // Page 1 is built by us; page 2 is Canvas's own URL, followed verbatim.
    // Both must carry all 16 digits.
    for (const url of urls) {
      expect(url).toContain(`/courses/${SHARD_901_ID}/assignments`)
      expect(url).not.toContain('9010000000000000')
    }
  })

  it('test 4: an ID in a JSON request body is emitted as a JSON string, not a number', async () => {
    // §2.4: a numeric `user_id` in a request body reaches Canvas's
    // `Api::ID_REGEX.match?(42)` and raises an unrescued `TypeError` there, so
    // the string form is the correct one and not merely the safe one.
    const canvas = new CanvasClient({ token: TEST_TOKEN, baseUrl: TEST_BASE_URL })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ quiz_extensions: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await canvas.quizzes.setExtension('1', '2', SHARD_901_ID, 30, undefined)

    const init = fetchSpy.mock.calls[0]![1] as RequestInit
    const body = JSON.parse(String(init.body)) as {
      quiz_extensions: Array<Record<string, unknown>>
    }
    expect(body.quiz_extensions[0]!.user_id).toBe(SHARD_901_ID)
    expect(typeof body.quiz_extensions[0]!.user_id).toBe('string')
    // The quantities in the same body stay numbers — the §8 `Record<string,
    // number>` fix was about separating them, not about stringifying the lot.
    expect(body.quiz_extensions[0]!.extra_time).toBe(30)
    // Byte-level, so a JSON serializer that quoted the number would fail here
    // and a rounded value could not hide behind `==`.
    expect(String(init.body)).toContain(`"user_id":"${SHARD_901_ID}"`)
  })

  it('both representations of the same ID produce one canonical request, so a Map key cannot fork', async () => {
    // §4.1's property, asserted on the wire rather than argued: the number and
    // the string form of the SAME small ID must reach the identical endpoint.
    const client = await armedClient()
    const requestSpy = vi.spyOn(CanvasHttpClient.prototype, 'request').mockResolvedValue({})

    await client.callTool({ name: 'get_course', arguments: { course_id: 12345 } })
    await client.callTool({ name: 'get_course', arguments: { course_id: '12345' } })

    const endpoints = requestSpy.mock.calls.map((call) => call[0])
    expect(endpoints).toEqual(['/api/v1/courses/12345', '/api/v1/courses/12345'])
  })

  it('what PR 1b can say about the response side: an ID echoed back to the caller is canonical', async () => {
    // NOT §8's test 5. There is no response normalization until PR 2a, so a
    // Canvas-sourced ID is still whatever `JSON.parse` produced. What *is*
    // true now is that any ID the tool echoes from its own input is the
    // canonical string, in both representations — which is the first visible
    // slice of the Phase 2 output change and is called out in the PR body.
    const client = await armedClient()
    vi.spyOn(CanvasHttpClient.prototype, 'request').mockResolvedValue('<p>Syllabus</p>')

    const fromString = await client.callTool({
      name: 'get_syllabus',
      arguments: { course_id: SHARD_901_ID },
    })
    const fromNumber = await client.callTool({
      name: 'get_syllabus',
      arguments: { course_id: 12345 },
    })

    expect(JSON.stringify(fromString.content)).toContain(SHARD_901_ID)
    // The tool's text payload is pretty-printed JSON, so the quotes around
    // `12345` are what prove the echoed ID is the canonical STRING.
    expect(JSON.parse(String((fromNumber.content as Array<{ text: string }>)[0]!.text))).toEqual({
      course_id: '12345',
      syllabus_body: null,
    })
  })
})
