import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createCanvasMCPServer } from '../../src/server'
import { CanvasHttpClient } from '../../src/canvas/client'
import { getAllTools } from '../../src/tools'
import type { CanvasClient } from '../../src/canvas'

/**
 * The 64-bit identifier migration
 * (`docs/superpowers/specs/2026-10-05-bru-2730-canvas-64bit-identifiers.md`,
 * BRU-2730).
 *
 * ~~Phase 0 (BRU-2815) … These are **characterization tests** — they record
 * the ID precision defect as it exists on `main` today, not a regression this
 * PR fixes.~~ **Superseded by PR 1b (BRU-2827), 2026-10-09.** Phase 1 fixed
 * the defect, so the three §2.2 assertions that recorded it now assert the
 * opposite. Each one's Phase-0 value is kept inline, because the before/after
 * pair *is* the evidence that the migration reached the wire:
 *
 * | Input to `get_course.course_id` | Phase 0 (recorded) | After PR 1b |
 * | --- | --- | --- |
 * | `12345` | accepted | accepted, unchanged (control) |
 * | `"12345"` | **rejected** | accepted → `/courses/12345` |
 * | `9007199254740993` (via JSON) | **accepted, silently `…992`** | **rejected**, message names the value |
 * | `"9007199254740993"` | **rejected** | accepted → `/courses/9007199254740993` |
 *
 * The §3.4 block below is unchanged and still passing: the 52 `.int()` ID
 * sites are deliberately NOT part of PR 1b's 222, so they still reject a
 * large ID in either form. See the PR body — that is a known, measured gap in
 * the spec's own phase plan, not a side effect of this change.
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

describe('§2.2 — the input defect on the wire, fixed by PR 1b (BRU-2730/BRU-2827)', () => {
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

  it('the same small ID as a string is now accepted and reaches the same endpoint (Phase 0: rejected)', async () => {
    const result = await client.callTool({ name: 'get_course', arguments: { course_id: '12345' } })

    expect(result.isError).toBeFalsy()
    // Byte-identical to the numeric form above: `canvasIdInput()` normalizes
    // both representations to the one canonical decimal string, which is the
    // §4.1 property the whole design rests on.
    expect(requestSpy).toHaveBeenCalledWith('/api/v1/courses/12345', expect.anything())
  })

  it('an unsafe integer that crossed a JSON boundary is now rejected, naming the value (Phase 0: silently rounded and succeeded)', async () => {
    // `JSON.parse` — what every MCP transport does to wire bytes — has
    // already rounded the value before this line runs. The object literal
    // `{ course_id: 9007199254740993 }` would round identically at parse
    // time; going through `JSON.parse` explicitly makes that boundary
    // visible rather than hiding it in a source-literal.
    const args = JSON.parse(`{"course_id":${UNSAFE_INT_DECIMAL}}`) as { course_id: number }
    expect(args.course_id).toBe(SAFE_LARGE_INT) // already a different number than UNSAFE_INT_DECIMAL

    const result = await client.callTool({ name: 'get_course', arguments: args })

    // Phase 0 recorded `isError: false` and a request to the WRONG course,
    // `/api/v1/courses/9007199254740992`. No request is made now.
    expect(result.isError).toBe(true)
    expect(requestSpy).not.toHaveBeenCalled()
    // §4.2.1 N3: the message a caller hitting the precision bug actually sees
    // has to name the received value and the remedy, not just `too_big`.
    const text = JSON.stringify(result.content)
    expect(text).toContain(String(SAFE_LARGE_INT))
    expect(text).toContain('Pass large IDs as strings')
  })

  it('the string form of the same unsafe ID now reaches Canvas byte-exact (Phase 0: rejected, unaddressable)', async () => {
    const result = await client.callTool({
      name: 'get_course',
      arguments: { course_id: UNSAFE_INT_DECIMAL },
    })

    expect(result.isError).toBeFalsy()
    // The whole point of the design: 19 digits in, the same 19 digits on the
    // wire, with no double in the path to round them.
    expect(requestSpy).toHaveBeenCalledWith(
      `/api/v1/courses/${UNSAFE_INT_DECIMAL}`,
      expect.anything(),
    )
  })
})

/**
 * ~~§3.4 / §9 — every ID-named `z.number().int()` input site already rejects
 * `2**53` today, split into the 46 `.int().positive()` sites and the 6 bare
 * `.int()` sites the spec names.~~ **Superseded by PR 1b (BRU-2827),
 * 2026-10-09.**
 *
 * Phase 0 recorded **52** such sites: 46 `.int().positive()` and 6 bare
 * `.int()` (4 × `grading_period_id`, 2 × `enrollment_term_id`). §8 PR 1b
 * names only "the 222 un-`.int()` ID sites", which would have left those 52
 * rejecting a shard >= 901 ID in *either* representation — among them
 * `update_course.course_id`, `explain_grade.course_id`,
 * `project_grade.course_id` and `audit_course_links.course_id`.
 *
 * They were migrated anyway, because leaving them is not merely incomplete,
 * it is broken. PR 1b retypes every ID-named `as number` cast in
 * `src/tools/**` to `as CanvasId`, so an unmigrated site's handler asserts
 * `CanvasId` over a runtime `number`, and every ID join in that tool then
 * compares a string against a number. Measured before migrating them: with
 * `assignment_group_id` arriving as a number — exactly what its integer-only
 * schema produced — `explain_grade` matched **0** assignment groups instead
 * of 1. The deviation from §8's "222" is called out in the PR body.
 *
 * This block now asserts the post-migration property and **keeps the Phase-0
 * detector**, so a regression back to the integer-only shape is named rather
 * than merely changing a count.
 */

const ID_NAME = /(^|_)ids?$/i
/** The shard-901 case from §2.1: the reason this migration exists. */
const SHARD_901_ID = '9010000000000001'

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

/** The Phase-0 shape: `z.number().int()`, with or without `.positive()`. */
function isSafeIntNumber(schema: z.ZodType): boolean {
  const def = (schema as unknown as ZodIntrospectable)._zod.def
  if (def.type !== 'number') return false
  const checks = (def.checks as ZodIntrospectable[]) ?? []
  return checks.some((check) => check._zod.def.format === 'safeint')
}

/**
 * Classified by **behaviour**, not by introspection: `canvasIdInput()` is a
 * union behind a transform, so its `_zod.def` shape is an implementation
 * detail, while "accepts a safe integer AND accepts a canonical 16-digit
 * string" is the contract §4.2 actually specifies. It also separates the
 * canonical sites from the handful of ID fields that are declared
 * `z.string()` and were left alone by §4.4 (they are already strings, so
 * they carry no precision risk).
 */
function isCanonicalIdSchema(schema: z.ZodType): boolean {
  return schema.safeParse(42).success && schema.safeParse(SHARD_901_ID).success
}

interface IdSite {
  tool: string
  field: string
  kind: 'scalar' | 'array-item'
  schema: z.ZodType
}

function findIdSites(tools: ReturnType<typeof getAllTools>): IdSite[] {
  const sites: IdSite[] = []
  for (const tool of tools) {
    for (const [field, rawSchema] of Object.entries(tool.inputSchema)) {
      if (!ID_NAME.test(field)) continue
      const base = unwrapModifiers(rawSchema)
      const baseDef = (base as unknown as ZodIntrospectable)._zod.def
      if (baseDef.type === 'array') {
        const element = unwrapModifiers(baseDef.element as z.ZodType)
        sites.push({ tool: tool.name, field, kind: 'array-item', schema: element })
      } else {
        sites.push({ tool: tool.name, field, kind: 'scalar', schema: base })
      }
    }
  }
  return sites
}

describe('§3.4 — every ID-named input site now takes a 64-bit ID (BRU-2730/BRU-2827)', () => {
  let sites: IdSite[]
  let canonical: IdSite[]

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
    sites = findIdSites(tools)
    canonical = sites.filter((site) => isCanonicalIdSchema(site.schema))
  })

  it('finds every ID-named input site in the registry, so the sweeps below are not vacuous', () => {
    // §3.4 counts 274 ID-named `z.number()` occurrences plus a handful of
    // `z.string()` ID fields. The floor is deliberately well under that so an
    // ordinary tool addition never has to touch it.
    expect(sites.length).toBeGreaterThanOrEqual(250)
    expect(canonical.length).toBeGreaterThanOrEqual(250)
  })

  it('no site publishes a safe-integer-only schema any more — Phase 0 recorded exactly 52', () => {
    const integerOnly = sites
      .filter((site) => isSafeIntNumber(site.schema))
      .map((site) => `${site.tool}.${site.field}`)

    expect(integerOnly).toEqual([])
  })

  it(`accepts the shard-901 string "${SHARD_901_ID}" at every canonical site — the case Phase 0 recorded as unaddressable`, () => {
    const failures = canonical
      .filter((site) => !site.schema.safeParse(SHARD_901_ID).success)
      .map((site) => `${site.tool}.${site.field}`)

    expect(failures).toEqual([])
  })

  it('still rejects 2**53 as a number at every site, so the Phase 0 guarantee is not traded away', () => {
    const failures = canonical
      .filter((site) => site.schema.safeParse(SAFE_LARGE_INT).success)
      .map((site) => `${site.tool}.${site.field}`)

    expect(failures).toEqual([])
  })

  it('accepts an ordinary safe integer at every site, so the rejection is about 2**53 specifically', () => {
    const failures = canonical
      .filter((site) => !site.schema.safeParse(42).success)
      .map((site) => `${site.tool}.${site.field}`)

    expect(failures).toEqual([])
  })

  it('rejects a non-canonical decimal string at every site, so one object has exactly one ID', () => {
    // §4.2 rule 2: Canvas tolerates `"007"`; we do not, or `Map` keys fork and
    // §4.1's whole argument is defeated.
    const failures = canonical
      .filter((site) => site.schema.safeParse('007').success)
      .map((site) => `${site.tool}.${site.field}`)

    expect(failures).toEqual([])
  })

  it('publishes the §9 `anyOf` body at every site rather than the old integer keywords', () => {
    for (const site of canonical) {
      // `{ io: 'input' }` is required, not optional: the `.transform()` makes
      // the default mode throw (§4.2.1 N2). The SDK passes `io: 'input'` for
      // tool input schemas, which is the only reason `tools/list` works.
      const json = z.toJSONSchema(site.schema, { io: 'input' }) as {
        anyOf?: Array<Record<string, unknown>>
      }
      const label = `${site.tool}.${site.field}`
      expect(json.anyOf, label).toBeDefined()
      const members = json.anyOf!
      expect(
        members.some((m) => m.type === 'integer' && m.maximum === 9007199254740991),
        label,
      ).toBe(true)
      expect(
        members.some((m) => m.type === 'string' && m.pattern === '^[1-9][0-9]{0,18}$'),
        label,
      ).toBe(true)
    }
  })
})
