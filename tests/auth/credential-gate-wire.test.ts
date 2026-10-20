import { describe, expect, it, afterEach, vi } from 'vitest'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ReadBuffer } from '@modelcontextprotocol/sdk/shared/stdio.js'
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { createCanvasMCPServer } from '../../src/server'
import {
  CALL_TOOL_METHOD,
  MISSING_CREDENTIALS_TOOL_CALL_ERROR,
  canvasCredentialGate,
} from '../../src/auth/credential-gate'

/**
 * BRU-3053 — the **wire** half of the credentialless gate.
 *
 * `tests/tools/credential-gate.test.ts` proves the handler half: every
 * registered tool, invoked directly, refuses. That is not sufficient for the
 * acceptance criterion, because a `tools/call` request is validated twice
 * inside the SDK before any registered handler runs:
 *
 * 1. `Protocol.setRequestHandler` parses the request with the schema it was
 *    registered under and rethrows the `ZodError` (JSON-RPC `-32603`).
 * 2. `Server.setRequestHandler` overrides that method and wraps *any*
 *    `tools/call` handler in an unconditional
 *    `safeParse(CallToolRequestSchema, request)` (`-32602`).
 *
 * So a request with no `params`, a non-string `name` or a non-object
 * `arguments` used to be answered with a protocol error instead of the stable
 * credential refusal — measured, before the fix, as 5 of the 13 shapes below.
 *
 * Every request here is sent as **raw JSON-RPC over a linked
 * `InMemoryTransport`**, with no SDK `Client` in the path. That matters: a
 * client normalises its own requests, so it cannot send most of these shapes
 * at all, and a test written through one would pass with the fix absent.
 */

const CONFIGURED = { token: 'test-token', baseUrl: 'https://canvas.example.com' }

interface RawResponse {
  id?: number
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

/** A raw JSON-RPC peer: sends exactly the bytes given, parses nothing away. */
class WireProbe {
  private readonly seen = new Map<number, RawResponse>()
  private readonly transport: InMemoryTransport
  private id = 0
  readonly fetchCalls: string[] = []

  private constructor(transport: InMemoryTransport) {
    this.transport = transport
  }

  static async connect(gated: boolean): Promise<WireProbe> {
    const { server } = createCanvasMCPServer({
      token: gated ? '' : CONFIGURED.token,
      baseUrl: gated ? '' : CONFIGURED.baseUrl,
      sharedAcrossCallers: false,
      ...(gated ? { toolCallGate: canvasCredentialGate() } : {}),
    })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const probe = new WireProbe(clientTransport)
    clientTransport.onmessage = (message: unknown) => {
      const response = message as RawResponse
      if (typeof response.id === 'number') probe.seen.set(response.id, response)
    }
    await clientTransport.start()
    await server.connect(serverTransport)

    vi.stubGlobal('fetch', (input: unknown) => {
      probe.fetchCalls.push(String(input))
      return Promise.reject(new Error('a gated request reached the network'))
    })

    await probe.send('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'bru3053-wire', version: '0.0.0' },
    })
    await clientTransport.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as never)
    return probe
  }

  /** Resolves to `undefined` when the server sends nothing back. */
  async send(method: string, params?: unknown): Promise<RawResponse | undefined> {
    const id = ++this.id
    const raw: Record<string, unknown> = { jsonrpc: '2.0', id, method }
    if (params !== undefined) raw.params = params
    await this.transport.send(raw as never)
    for (let tick = 0; tick < 100 && !this.seen.has(id); tick++) {
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    return this.seen.get(id)
  }
}

/** The shapes the SDK rejects before a handler, plus the ones it accepts. */
const MALFORMED_CALLS: [label: string, params: unknown][] = [
  ['params omitted entirely', undefined],
  ['params is an empty object', {}],
  ['name is a number', { name: 123 }],
  ['name is an empty string', { name: '', arguments: {} }],
  ['arguments is a string', { name: 'list_pages', arguments: 'nope' }],
  ['arguments is an array', { name: 'list_pages', arguments: [] }],
  ['arguments is null', { name: 'list_pages', arguments: null }],
  ['arguments is missing but required', { name: 'list_pages' }],
  ['an argument has the wrong type', { name: 'list_pages', arguments: { course_id: null } }],
  ['the tool does not exist', { name: 'no_such_tool_xyz', arguments: {} }],
  ['an unknown key sits beside name', { name: 'list_pages', arguments: {}, bogus: 1 }],
  ['well-formed (baseline)', { name: 'list_pages', arguments: { course_id: '1' } }],
]

function refusalText(response: RawResponse | undefined): string | undefined {
  const content = response?.result?.content as { type?: string; text?: string }[] | undefined
  return content?.[0]?.text
}

describe('credentialless gate: wire-level tools/call', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(MALFORMED_CALLS)(
    'returns the credential refusal when %s',
    async (_label, params) => {
      const probe = await WireProbe.connect(true)
      const response = await probe.send(CALL_TOOL_METHOD, params)

      expect(response?.error).toBeUndefined()
      expect(refusalText(response)).toBe(MISSING_CREDENTIALS_TOOL_CALL_ERROR)
      expect(response?.result?.isError).toBe(true)
      // An error result must carry nothing that could satisfy a success schema.
      expect(response?.result?.structuredContent).toBeUndefined()
      expect(probe.fetchCalls).toEqual([])
    },
    30_000,
  )

  it('is not vacuous: a configured server answers none of them that way', async () => {
    // Without this, every assertion above would also pass on a server that
    // refuses everything for an unrelated reason. Here the gate is the only
    // variable, and the same 12 requests produce 12 non-refusals.
    const probe = await WireProbe.connect(false)
    const texts: string[] = []
    for (const [, params] of MALFORMED_CALLS) {
      const response = await probe.send(CALL_TOOL_METHOD, params)
      texts.push(response?.error?.message ?? refusalText(response) ?? '(no response)')
    }

    expect(texts).toHaveLength(MALFORMED_CALLS.length)
    expect(texts.filter((text) => text === MISSING_CREDENTIALS_TOOL_CALL_ERROR)).toEqual([])
    expect(texts.filter((text) => text === '(no response)')).toEqual([])
  }, 60_000)

  it('survives the whole malformed batch and still answers discovery', async () => {
    const probe = await WireProbe.connect(true)
    const before = await probe.send('tools/list', {})
    for (const [, params] of MALFORMED_CALLS) await probe.send(CALL_TOOL_METHOD, params)

    const after = await probe.send('tools/list', {})
    const names = (response: RawResponse | undefined) =>
      ((response?.result?.tools ?? []) as { name: string }[]).map((tool) => tool.name)

    expect(names(after)).toEqual(names(before))
    expect(names(after).length).toBeGreaterThan(150)
    for (const method of ['prompts/list', 'resources/list', 'ping']) {
      expect((await probe.send(method, {}))?.error).toBeUndefined()
    }
    expect(probe.fetchCalls).toEqual([])
  }, 60_000)

  describe('nothing else changes', () => {
    // Replacing the `tools/call` entry with a fallback handler displaces
    // `Protocol._onrequest`'s own "Method not found" branch for *every* other
    // unhandled method, so the gated and configured answers must match
    // byte-for-byte. `McpError` would not: it rewrites the message to
    // `MCP error -32601: Method not found`.
    it('answers an unknown method exactly as a configured server does', async () => {
      const gated = await WireProbe.connect(true)
      const gatedResponse = await gated.send('no/such/method', {})
      vi.unstubAllGlobals()
      const configured = await WireProbe.connect(false)
      const configuredResponse = await configured.send('no/such/method', {})

      expect(gatedResponse?.error).toEqual({
        code: ErrorCode.MethodNotFound,
        message: 'Method not found',
      })
      expect(gatedResponse?.error).toEqual(configuredResponse?.error)
    }, 60_000)

    it('leaves a configured server with the SDK validation it always had', async () => {
      const probe = await WireProbe.connect(false)
      const response = await probe.send(CALL_TOOL_METHOD, { name: 123 })

      // The SDK's pre-dispatch rejection, unchanged: a protocol error, not a
      // tool result. This is what the gated server must *not* do, so it is
      // also the control proving the two modes really differ.
      expect(response?.error?.code).toBeDefined()
      expect(response?.result).toBeUndefined()
      expect(probe.fetchCalls).toEqual([])
    }, 30_000)
  })

  describe('documented residues', () => {
    /**
     * Two shapes are out of reach of any server-level seam. Pinned as
     * characterization so a future SDK bump that changes either one is visible
     * rather than silent — neither is a path to a tool handler or to Canvas.
     */
    it('a non-object params is not a JSON-RPC request, and stdio rejects it first', () => {
      // `Protocol.connect`'s dispatcher classifies with `isJSONRPCRequest`,
      // which requires `params` to be an object, so such a message is never
      // routed to a method at all. On the stdio transport it never even gets
      // that far: the `ReadBuffer` parses every line with
      // `JSONRPCMessageSchema` and throws, which the transport reports through
      // `onerror` while the read loop continues.
      for (const params of [null, 'string', 42]) {
        const buffer = new ReadBuffer()
        buffer.append(
          Buffer.from(
            `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: CALL_TOOL_METHOD, params })}\n`,
          ),
        )
        expect(() => buffer.readMessage()).toThrow()
      }
      // Control: the same line with an object `params` parses, so the
      // assertion above is about `params` and not about the harness.
      const control = new ReadBuffer()
      control.append(
        Buffer.from(
          `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: CALL_TOOL_METHOD, params: { name: 'x' } })}\n`,
        ),
      )
      expect(control.readMessage()).toMatchObject({ method: CALL_TOOL_METHOD })
    })

    it('a task-augmented call is refused by the SDK before handler dispatch', async () => {
      // `Protocol._onrequest` calls `assertTaskHandlerCapability` when
      // `params.task` is present, before it resolves any handler. This server
      // declares no task capability, so the request cannot reach a tool —
      // identical in configured mode.
      const probe = await WireProbe.connect(true)
      const response = await probe.send(CALL_TOOL_METHOD, {
        name: 'list_pages',
        arguments: { course_id: '1' },
        task: { ttl: 1000 },
      })

      expect(response?.error?.message).toContain('does not support task creation')
      expect(probe.fetchCalls).toEqual([])
    }, 30_000)
  })
})
