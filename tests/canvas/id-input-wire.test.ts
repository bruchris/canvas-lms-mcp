import { describe, it, expect, beforeAll } from 'vitest'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js'
import {
  normalizeObjectSchema,
  objectFromShape,
  type ZodRawShapeCompat,
} from '@modelcontextprotocol/sdk/server/zod-compat.js'
import { installSchemaDialectCompat, JSON_SCHEMA_DIALECT_2020_12 } from '../../src/schema-dialect'
import { canvasIdInput } from '../../src/canvas/id'

/**
 * Phase 1, PR 1a (BRU-2816): the three assertions §4.2.1 requires at the
 * wire, each of which exists because revision 1's rules failed it. None of
 * them can be made from a `safeParse` verdict:
 *
 * - **N1** — a `safeParse` assertion inside a `try` block passes on the
 *   broken form, because the broken form *throws* rather than rejecting.
 *   Only the JSON-RPC error code distinguishes them.
 * - **N2** — `z.toJSONSchema(schema)` throws outright with a transform
 *   attached and succeeds only under `{ io: 'input' }`. Calling it ourselves
 *   would test our call; the thing that must hold is the SDK's call.
 * - **N3** — the message a caller hitting the precision bug actually sees.
 *
 * The probe tool is registered on a bare `McpServer` rather than through
 * `registerAllTools`, because PR 1a deliberately adopts the type at **no**
 * call site (that is PR 1b). `installSchemaDialectCompat` is installed here
 * so the published schema this reads back is the one production would ship.
 */

const PROBE_TOOL = 'probe_canvas_id'

interface ProbeHarness {
  client: Client
  received: Array<Record<string, unknown>>
}

async function connectProbe(schema: z.ZodType<string, unknown>): Promise<ProbeHarness> {
  const server = new McpServer({ name: 'canvas-id-probe', version: '0.0.0' })
  installSchemaDialectCompat(server)
  const received: Array<Record<string, unknown>> = []
  server.registerTool(
    PROBE_TOOL,
    {
      description: 'Probe tool carrying a canonical Canvas identifier input.',
      inputSchema: { course_id: schema },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => {
      received.push(args as Record<string, unknown>)
      return { content: [{ type: 'text' as const, text: 'ok' }] }
    },
  )

  const client = new Client({ name: 'canvas-id-wire-test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  // Arm the client's validator cache before any call, per §8's compatibility
  // test rules. Also the only way to read the published schema back.
  await client.listTools()
  return { client, received }
}

type ProbeOutcome =
  | { kind: 'ok'; text: string }
  | { kind: 'error-result'; text: string }
  | { kind: 'rejected'; text: string }

/**
 * Normalizes the three shapes a tool call can come back as.
 *
 * **Measured, and not what either the design or this test first assumed:** an
 * input-validation failure on `@modelcontextprotocol/sdk` 1.32.0 arrives as a
 * resolved tool result with `isError: true`, whose *text* carries
 * `MCP error -32602: Input validation error: …`. It is **not** a
 * protocol-level rejection, so `expect(...).rejects` is the wrong shape and
 * `error.code` is never populated. The §4.2.1 N1 distinction therefore lives
 * entirely in the text: the recommended form yields the `-32602` text above,
 * and the form revision 1 prescribed yields a bare
 * `Cannot convert 7.0 to a BigInt` in the same `isError` envelope. A test
 * that only asserted `isError === true` would pass on both.
 */
async function callProbe(client: Client, args: Record<string, unknown>): Promise<ProbeOutcome> {
  try {
    const result = (await client.callTool({ name: PROBE_TOOL, arguments: args })) as {
      isError?: boolean
      content?: Array<{ text?: string }>
    }
    const text = result.content?.map((part) => part.text ?? '').join('') ?? ''
    return result.isError ? { kind: 'error-result', text } : { kind: 'ok', text }
  } catch (error) {
    return { kind: 'rejected', text: (error as Error).message }
  }
}

/** The prefix the SDK puts on an input-validation rejection. */
const INVALID_PARAMS_TEXT = 'MCP error -32602: Input validation error:'

/**
 * The inputs that make `BigInt()` throw. §4.2.1 N1 names seven; the eighth,
 * `"self"`, is the same failure mode and is reported in the PR body as a
 * correction — the spec's list was drawn from a hostile-13 fixture that did
 * not include it, yet it is the most likely of the eight to be sent by
 * accident (a caller trying Canvas's sentinel on a tool that does not
 * declare it). Every rejected string that `BigInt()` *can* parse — `"0"`,
 * `"-7"`, `"007"`, `" 7"`, `"7 "`, `"+7"`, `""`,
 * `"12345678901234567890"` — is unaffected, which is why the injection
 * named in the PR body fails exactly these eight and nothing else.
 */
const N1_THROWING_INPUTS: Array<[label: string, value: string]> = [
  ['"7.0"', '7.0'],
  ['"1e3"', '1e3'],
  ['"1_000"', '1_000'],
  ['"Infinity"', 'Infinity'],
  ['"NaN"', 'NaN'],
  ['"٧٧" (Arabic-Indic digits)', '٧٧'],
  ['"７" (fullwidth digit)', '７'],
  ['"self" (undeclared sentinel)', 'self'],
]

describe('§4.2.1 N1 — the inputs that make BigInt() throw reject as -32602, not as leaked internals', () => {
  let harness: ProbeHarness

  beforeAll(async () => {
    harness = await connectProbe(canvasIdInput())
  })

  it.each(N1_THROWING_INPUTS)('rejects %s as a -32602 error result', async (_label, value) => {
    const outcome = await callProbe(harness.client, { course_id: value })

    expect(outcome.kind).toBe('error-result')
    expect(outcome.text).toContain(INVALID_PARAMS_TEXT)
    // Both halves matter. Without the `-32602` prefix this is some other
    // error; with a `BigInt` mention it is the internal text leaking, which
    // is the defect itself rather than a validation failure.
    expect(outcome.text).not.toMatch(/BigInt/)
  })

  it('the handler is never reached for any of them', () => {
    expect(harness.received).toEqual([])
  })

  it('control: a valid ID above 2**53 reaches the handler as the canonical string', async () => {
    const { client, received } = await connectProbe(canvasIdInput())
    const outcome = await callProbe(client, { course_id: '9010000000000001' })

    expect(outcome.kind).toBe('ok')
    expect(received).toEqual([{ course_id: '9010000000000001' }])
  })

  it('control: a valid small number reaches the handler normalized to a string', async () => {
    const { client, received } = await connectProbe(canvasIdInput())
    const outcome = await callProbe(client, { course_id: 12345 })

    expect(outcome.kind).toBe('ok')
    expect(received).toEqual([{ course_id: '12345' }])
  })

  it('control: the unsafe integer that defeats JSON.parse is rejected at the wire', async () => {
    const { client, received } = await connectProbe(canvasIdInput())
    const args = JSON.parse('{"course_id":9007199254740993}') as Record<string, unknown>
    const outcome = await callProbe(client, args)

    expect(outcome.kind).toBe('error-result')
    expect(outcome.text).toContain(INVALID_PARAMS_TEXT)
    expect(received).toEqual([])
  })
})

describe('§4.2.1 N2 — the schema the SDK actually publishes for a canvasIdInput() field', () => {
  const EXPECTED_ANY_OF = [
    { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
    { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
  ]

  it('publishes exactly the §9 anyOf body, read back from listTools()', async () => {
    const server = new McpServer({ name: 'canvas-id-probe', version: '0.0.0' })
    installSchemaDialectCompat(server)
    server.registerTool(
      PROBE_TOOL,
      {
        description: 'Probe.',
        inputSchema: { course_id: canvasIdInput() },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    )
    const client = new Client({ name: 'canvas-id-wire-test', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    const { tools } = await client.listTools()
    const probe = tools.find((tool) => tool.name === PROBE_TOOL)
    expect(probe).toBeDefined()

    const schema = probe?.inputSchema as {
      $schema?: string
      required?: string[]
      properties?: Record<string, unknown>
    }
    // The transform is what makes this assertion load-bearing: with it
    // attached, the SDK's conversion succeeds only because it passes
    // `io: 'input'`. Under the default mode it throws outright, which would
    // be a total `tools/list` outage rather than a wrong schema.
    expect(schema.properties?.course_id).toEqual({ anyOf: EXPECTED_ANY_OF })
    expect(schema.required).toEqual(['course_id'])
    expect(schema.$schema).toBe(JSON_SCHEMA_DIALECT_2020_12)
  })

  it('the published body is identical under draft-7 and draft-2020-12 (§9), so the dialect shim stays a no-op', () => {
    const bodies = bodiesUnderBothDialects({ course_id: canvasIdInput() })
    expect(bodies[0]).toBe(bodies[1])
    expect(JSON.parse(bodies[0])).toMatchObject({
      properties: { course_id: { anyOf: EXPECTED_ANY_OF } },
    })
  })

  it('the dialect comparison is not vacuous: a tuple schema does diverge between the two targets', () => {
    const [draft07, draft202012] = bodiesUnderBothDialects({
      pair: z.tuple([z.string(), z.string()]),
    })
    expect(draft07).not.toBe(draft202012)
  })
})

/**
 * Mirrors the two normalization steps `registerTool` applies before handing
 * a shape to the converter, so the comparison is on exactly the schema the
 * server converts. The same helper exists in
 * `tests/tools/tool-schema-shape.test.ts`, which runs this comparison over
 * every *registered* schema — PR 1a registers the ID type nowhere, so this
 * local copy is the bridge until PR 1b adopts it at call sites.
 */
function bodiesUnderBothDialects(shape: Record<string, z.ZodType>): [string, string] {
  const normalized = normalizeObjectSchema(shape) ?? objectFromShape(shape as ZodRawShapeCompat)
  return (['draft-7', 'draft-2020-12'] as const).map((target) => {
    const body = toJsonSchemaCompat(normalized, {
      strictUnions: true,
      pipeStrategy: 'input',
      target,
    })
    delete body.$schema
    return JSON.stringify(body)
  }) as [string, string]
}

describe('§4.2.1 N3 — the rejection message names the value and the remedy', () => {
  let client: Client

  beforeAll(async () => {
    ;({ client } = await connectProbe(canvasIdInput()))
  })

  it('an unsafe integer gets a message naming the received value and the string remedy', async () => {
    const outcome = await callProbe(client, { course_id: 9007199254740992 })

    expect(outcome.kind).toBe('error-result')
    expect(outcome.text).toContain('course_id must be a Canvas ID')
    expect(outcome.text).toContain('received 9007199254740992')
    expect(outcome.text).toContain('9007199254740991')
    expect(outcome.text).toMatch(/pass large IDs as strings/i)
    expect(outcome.text).toContain('"9010000000000001"')
    // Not the bare Zod text the design names as the defect: without a
    // message on the number member this reads `Too big: expected int to be
    // <=9007199254740991`, which names neither the value nor the remedy.
    expect(outcome.text).not.toMatch(/Too big/)
  })

  it('a string above MAX_ID gets a message naming the received value and Canvas’s ceiling', async () => {
    const outcome = await callProbe(client, { course_id: '9223372036854775808' })

    expect(outcome.kind).toBe('error-result')
    expect(outcome.text).toContain('course_id must be a Canvas ID at or below 9223372036854775807')
    expect(outcome.text).toContain('received "9223372036854775808"')
    // Without a message on the `.refine` this reads a bare `Invalid input`.
    expect(outcome.text).not.toMatch(/Invalid input:? /)
  })

  it('a non-positive integer gets the same contract message, not a bare too_small', async () => {
    const outcome = await callProbe(client, { course_id: 0 })

    expect(outcome.kind).toBe('error-result')
    expect(outcome.text).toContain('received 0')
    expect(outcome.text).not.toMatch(/Too small/)
  })

  it('a non-canonical string gets the contract message from the union, not a bare invalid_union', async () => {
    const outcome = await callProbe(client, { course_id: '007' })

    expect(outcome.kind).toBe('error-result')
    expect(outcome.text).toContain('received "007"')
    expect(outcome.text).toContain('course_id must be a Canvas ID')
  })
})
