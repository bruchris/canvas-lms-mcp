import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createCanvasMCPServer } from '../../src/server'
import { CanvasHttpClient } from '../../src/canvas/client'
import { getAllTools } from '../../src/tools'
import type { CanvasClient } from '../../src/canvas'

/**
 * Phase 0 (BRU-2815) of the 64-bit identifier migration design
 * (`docs/superpowers/specs/2026-10-05-bru-2730-canvas-64bit-identifiers.md`,
 * BRU-2730). Per spec §8: "Nothing to build." These are **characterization
 * tests** — they record the ID precision defect as it exists on `main`
 * today, not a regression this PR fixes. Red-first is impossible by
 * construction (the defect is the thing being recorded), so none of these
 * tests were ever red; `+N tests` here is not `+N red`. The fix is Phase 1
 * (BRU-2730 §8, PR 1a/1b) and is explicitly out of scope — no schema, type
 * or handler changes ship in this PR.
 */

const TEST_TOKEN = 'test-token'
const TEST_BASE_URL = 'https://canvas.example.com'
// A decimal literal, not a number: `9007199254740993` would itself lose
// precision at parse time (and trips `no-loss-of-precision`). Keeping it as
// a string until it is embedded in JSON text is what makes the subsequent
// `JSON.parse` the thing that rounds it, rather than the source file.
const UNSAFE_INT_DECIMAL = '9007199254740993'
const SAFE_LARGE_INT = 2 ** 53 // the first value a JS number cannot distinguish from its neighbour; what UNSAFE_INT_DECIMAL rounds to

async function connectArmedClient() {
  const { server } = createCanvasMCPServer({ token: TEST_TOKEN, baseUrl: TEST_BASE_URL })
  const client = new Client({ name: 'id-precision-test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

describe('§2.2 — the input defect on the wire, as it exists on main today (BRU-2730)', () => {
  let client: Client
  let requestSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    client = await connectArmedClient()
    requestSpy = vi.spyOn(CanvasHttpClient.prototype, 'request').mockResolvedValue({
      id: 1,
      name: 'Stub Course',
      course_code: 'STUB',
      workflow_state: 'available',
    })
  })

  afterEach(() => {
    requestSpy.mockRestore()
  })

  it('control: a small number is accepted and reaches the Canvas endpoint unchanged', async () => {
    const result = await client.callTool({ name: 'get_course', arguments: { course_id: 12345 } })

    expect(result.isError).toBeFalsy()
    expect(requestSpy).toHaveBeenCalledWith('/api/v1/courses/12345', expect.anything())
  })

  it('control: the same small ID as a string is rejected, so the rejection is about declared type, not magnitude', async () => {
    const result = await client.callTool({ name: 'get_course', arguments: { course_id: '12345' } })

    expect(result.isError).toBe(true)
    expect(requestSpy).not.toHaveBeenCalled()
  })

  it('characterizes the defect: an unsafe integer that crossed a JSON boundary is silently rounded and still succeeds', async () => {
    // `JSON.parse` — what every MCP transport does to wire bytes — has
    // already rounded the value before this line runs. The object literal
    // `{ course_id: 9007199254740993 }` would round identically at parse
    // time; going through `JSON.parse` explicitly makes that boundary
    // visible rather than hiding it in a source-literal.
    const args = JSON.parse(`{"course_id":${UNSAFE_INT_DECIMAL}}`) as { course_id: number }
    expect(args.course_id).toBe(SAFE_LARGE_INT) // already a different number than UNSAFE_INT_DECIMAL

    const result = await client.callTool({ name: 'get_course', arguments: args })

    expect(result.isError).toBeFalsy()
    // A different course than the one requested — no error, no warning.
    expect(requestSpy).toHaveBeenCalledWith(`/api/v1/courses/${SAFE_LARGE_INT}`, expect.anything())
  })

  it('the string form of the same unsafe ID is rejected — today there is no way to address that object', async () => {
    const result = await client.callTool({
      name: 'get_course',
      arguments: { course_id: UNSAFE_INT_DECIMAL },
    })

    expect(result.isError).toBe(true)
    expect(requestSpy).not.toHaveBeenCalled()
  })
})

/**
 * §3.4 / §9 — every ID-named `z.number().int()` input site already rejects
 * `2**53` today, split into the 46 `.int().positive()` sites and the 6 bare
 * `.int()` sites the spec names (BRU-2730 §3.4). Enumerated from the live
 * registry via the same AST-adjacent rule the spec states (ID-named =
 * `/(^|_)ids?$/i`, attributing an array item to its enclosing property),
 * run against `getAllTools` with every opt-in domain and policy enabled so
 * no gated-off tool hides a site from the count.
 */

const ID_NAME = /(^|_)ids?$/i

interface ZodIntrospectable {
  _zod: { def: Record<string, unknown> }
}

function unwrapModifiers(schema: z.ZodType): z.ZodType {
  let current = schema as unknown as ZodIntrospectable
  for (;;) {
    const { type, innerType } = current._zod.def
    if ((type === 'optional' || type === 'default' || type === 'nullable') && innerType) {
      current = innerType as unknown as ZodIntrospectable
      continue
    }
    return current as unknown as z.ZodType
  }
}

function isSafeIntNumber(schema: z.ZodType): boolean {
  const def = (schema as unknown as ZodIntrospectable)._zod.def
  if (def.type !== 'number') return false
  const checks = (def.checks as ZodIntrospectable[]) ?? []
  return checks.some((check) => check._zod.def.format === 'safeint')
}

function hasPositiveCheck(schema: z.ZodType): boolean {
  const def = (schema as unknown as ZodIntrospectable)._zod.def
  const checks = (def.checks as ZodIntrospectable[]) ?? []
  return checks.some(
    (check) => check._zod.def.check === 'greater_than' && check._zod.def.value === 0,
  )
}

interface IntIdSite {
  tool: string
  field: string
  kind: 'scalar' | 'array-item'
  schema: z.ZodType
  bare: boolean
}

function findIntIdSites(tools: ReturnType<typeof getAllTools>): IntIdSite[] {
  const sites: IntIdSite[] = []
  for (const tool of tools) {
    for (const [field, rawSchema] of Object.entries(tool.inputSchema)) {
      if (!ID_NAME.test(field)) continue
      const base = unwrapModifiers(rawSchema)
      const baseDef = (base as unknown as ZodIntrospectable)._zod.def
      if (isSafeIntNumber(base)) {
        sites.push({
          tool: tool.name,
          field,
          kind: 'scalar',
          schema: base,
          bare: !hasPositiveCheck(base),
        })
      } else if (baseDef.type === 'array') {
        const element = unwrapModifiers(baseDef.element as z.ZodType)
        if (isSafeIntNumber(element)) {
          sites.push({
            tool: tool.name,
            field,
            kind: 'array-item',
            schema: element,
            bare: !hasPositiveCheck(element),
          })
        }
      }
    }
  }
  return sites
}

describe('§3.4 — the 52 ID-named .int() sites that already reject 2**53 today (BRU-2730)', () => {
  let sites: IntIdSite[]

  beforeAll(() => {
    const canvas = {} as CanvasClient
    // Every opt-in domain/policy enabled so a gated-off tool cannot hide a site.
    const tools = getAllTools(canvas, undefined, undefined, {
      destructiveTools: 'allow',
      writeTools: 'allow',
      assignmentSubmission: true,
    })
    // Anti-vacuity: a registry that failed to build would have far fewer tools.
    expect(tools.length).toBeGreaterThan(100)
    sites = findIntIdSites(tools)
  })

  it('finds exactly the 52 sites the spec records: 46 already `.positive()`, 6 still bare', () => {
    expect(sites.length).toBe(52)
    expect(sites.filter((s) => !s.bare).length).toBe(46)
    expect(sites.filter((s) => s.bare).length).toBe(6)

    // The 6 bare sites the spec names by file:line (§3.4): 4 `grading_period_id`,
    // 2 `enrollment_term_id`, all reachable here by tool + field instead.
    const bareFields = sites.filter((s) => s.bare).map((s) => s.field)
    expect(bareFields.filter((f) => f === 'grading_period_id').length).toBe(4)
    expect(bareFields.filter((f) => f === 'enrollment_term_id').length).toBe(2)
  })

  it('rejects 2**53 at every one of the 52 sites, with no exceptions', () => {
    const failures = sites
      .filter((site) => site.schema.safeParse(SAFE_LARGE_INT).success)
      .map((site) => `${site.tool}.${site.field}`)

    expect(failures).toEqual([])
  })

  it('accepts an ordinary safe integer at every site, so the rejection is about 2**53 specifically', () => {
    const failures = sites
      .filter((site) => !site.schema.safeParse(42).success)
      .map((site) => `${site.tool}.${site.field}`)

    expect(failures).toEqual([])
  })

  it('publishes the §9 keyword split as it stands today: bare sites have no floor, positive sites exclude 0', () => {
    for (const site of sites) {
      const json = z.toJSONSchema(site.schema) as {
        type: string
        minimum?: number
        exclusiveMinimum?: number
        maximum?: number
      }
      expect(json.type, `${site.tool}.${site.field}`).toBe('integer')
      expect(json.maximum, `${site.tool}.${site.field}`).toBe(9007199254740991)
      if (site.bare) {
        expect(json.minimum, `${site.tool}.${site.field}`).toBe(-9007199254740991)
        expect(json.exclusiveMinimum, `${site.tool}.${site.field}`).toBeUndefined()
      } else {
        expect(json.exclusiveMinimum, `${site.tool}.${site.field}`).toBe(0)
        expect(json.minimum, `${site.tool}.${site.field}`).toBeUndefined()
      }
    }
  })
})
