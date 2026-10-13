import { describe, it, expect, beforeAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { createCanvasMCPServer, type CanvasMCPServerConfig } from '../../src/server'
import { MAX_SAFE_CANVAS_NUMBER_ID } from '../../src/canvas/id'

/**
 * BRU-2730 §8 PR 1b, the coverage test: "fails if any ID-named param in any
 * tool is declared `z.number()` without going through `canvasIdInput()`."
 *
 * Enumerated from the **real registry** via `tools/list` over a real `Client`,
 * not from `getAllTools` and not from the default config alone. Both of those
 * shortcuts have already produced a blind guard in this repo: issue #341
 * shipped past a walk that built its subject from the default config and was
 * therefore blind to 2 of 165 tools. So every configuration that changes which
 * tools register gets its own enumeration **and its own floor**, in its own
 * `it`, so re-narrowing the guard fails attributably rather than lowering one
 * shared total.
 *
 * The classification is of the PUBLISHED JSON Schema, which is the only thing
 * a client sees. That is also what makes the guard derivable rather than
 * hand-maintained: `z.number()` publishes a bare `{"type":"number"}` with no
 * bounds, `.int()` publishes `{"type":"integer", …}`, and `canvasIdInput()`
 * publishes the §9 `anyOf`. No list of migrated call sites is kept anywhere.
 */

const TEST_TOKEN = 'test-token'
const TEST_BASE_URL = 'https://canvas.example.com'

/** §3.4's name rule, verbatim. */
const ID_NAME = /(^|_)ids?$/i
/** §4.2 rule 2's canonical-decimal pattern, as published. */
const CANONICAL_PATTERN = '^[1-9][0-9]{0,18}$'

type JsonSchemaNode = Record<string, unknown>

interface IdParam {
  tool: string
  field: string
  /** Set when the param is an array of IDs rather than a scalar. */
  item: boolean
  kind: 'canonical' | 'int-only' | 'bare-number' | 'plain-string' | 'other'
  node: JsonSchemaNode
}

function isIntegerMember(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false
  const n = node as JsonSchemaNode
  return n.type === 'integer' && n.maximum === MAX_SAFE_CANVAS_NUMBER_ID
}

function isCanonicalStringMember(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false
  const n = node as JsonSchemaNode
  return n.type === 'string' && n.pattern === CANONICAL_PATTERN
}

/**
 * The published shape of `canvasIdInput()`: an `anyOf` carrying the safe-integer
 * arm AND the canonical decimal-string arm. Extra members are expected — a
 * declared sentinel publishes `{type:'string', const:'self'}` (or an `enum` for
 * more than one) and a declared SIS prefix publishes its own `pattern` — so the
 * test asserts the two required members are present rather than an exact body.
 * `tests/tools/tool-schema-shape.test.ts` owns the exact-body assertions.
 */
/**
 * The `anyOf` members that describe the ID itself, with `.nullable()`'s `null`
 * member dropped. `.nullable()` nests rather than flattens — it publishes
 * `anyOf: [ <the canvasIdInput union>, {type:'null'} ]` — so a lone surviving
 * member that is itself an `anyOf` is unwrapped one more level.
 */
function nonNullMembers(node: JsonSchemaNode): JsonSchemaNode[] {
  const anyOf = node.anyOf
  if (!Array.isArray(anyOf)) return [node]
  const members = anyOf.filter(
    (m) => !(typeof m === 'object' && m !== null && (m as JsonSchemaNode).type === 'null'),
  ) as JsonSchemaNode[]
  if (members.length === 1 && Array.isArray(members[0]!.anyOf)) return nonNullMembers(members[0]!)
  return members
}

function classify(node: JsonSchemaNode): IdParam['kind'] {
  const anyOf = node.anyOf
  if (Array.isArray(anyOf)) {
    // `.nullable()` adds a `{"type":"null"}` member, and one site uses it
    // (`apply_grading_standard_to_course.grading_standard_id`, where null
    // removes the standard). Dropping it first keeps the classification about
    // the ID shape rather than about the modifier.
    const members = nonNullMembers(node)
    if (members.length === 1 && !Array.isArray(members[0]!.anyOf)) return classify(members[0]!)
    return members.some(isIntegerMember) && members.some(isCanonicalStringMember)
      ? 'canonical'
      : 'other'
  }
  if (node.type === 'integer') return 'int-only'
  if (node.type === 'number') return 'bare-number'
  if (node.type === 'string') return 'plain-string'
  return 'other'
}

function collectIdParams(tools: Tool[]): IdParam[] {
  const params: IdParam[] = []
  for (const tool of tools) {
    const properties = (tool.inputSchema as JsonSchemaNode | undefined)?.properties
    if (typeof properties !== 'object' || properties === null) continue
    for (const [field, raw] of Object.entries(properties as Record<string, JsonSchemaNode>)) {
      if (!ID_NAME.test(field)) continue
      // An array ID param is attributed to the array's own property name and
      // classified on its item schema, exactly as §3.4's rule does.
      const isArray = raw.type === 'array'
      const node = (isArray ? (raw.items as JsonSchemaNode | undefined) : raw) ?? {}
      params.push({ tool: tool.name, field, item: isArray, kind: classify(node), node })
    }
  }
  return params
}

async function listTools(config: Partial<CanvasMCPServerConfig>): Promise<Tool[]> {
  const { server } = createCanvasMCPServer({
    token: TEST_TOKEN,
    baseUrl: TEST_BASE_URL,
    ...config,
  })
  const client = new Client({ name: 'id-coverage-test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  const { tools } = await client.listTools()
  return tools
}

/**
 * Every configuration that changes which tools register. `minCanonical` is a
 * floor, not the measured value: it exists so that a guard which silently stops
 * finding tools fails here instead of passing on an empty sweep. Each is well
 * below today's count so ordinary tool additions never need to touch it, and
 * each is per-config so re-pointing the walk at one config cannot be hidden by
 * the others.
 */
const CONFIGS: Array<{
  label: string
  config: Partial<CanvasMCPServerConfig>
  minTools: number
  minCanonical: number
}> = [
  { label: 'default', config: {}, minTools: 150, minCanonical: 180 },
  {
    label: 'assignment-submission opt-in',
    config: { enableAssignmentSubmission: true },
    minTools: 150,
    minCanonical: 180,
  },
  {
    label: 'destructive tools blocked',
    config: { destructiveTools: 'block' },
    minTools: 140,
    minCanonical: 170,
  },
  {
    label: 'write tools blocked',
    config: { writeTools: 'block' },
    minTools: 90,
    minCanonical: 110,
  },
  { label: 'role=student', config: { role: 'student' }, minTools: 20, minCanonical: 20 },
  { label: 'role=teacher', config: { role: 'teacher' }, minTools: 90, minCanonical: 110 },
  { label: 'role=admin', config: { role: 'admin' }, minTools: 90, minCanonical: 110 },
]

describe('§8 PR 1b — every ID-named tool input goes through canvasIdInput() (BRU-2730)', () => {
  const byConfig = new Map<string, { tools: Tool[]; params: IdParam[] }>()

  beforeAll(async () => {
    for (const { label, config } of CONFIGS) {
      const tools = await listTools(config)
      byConfig.set(label, { tools, params: collectIdParams(tools) })
    }
  })

  for (const { label, minTools, minCanonical } of CONFIGS) {
    it(`[${label}] publishes no bare \`{"type":"number"}\` on any ID-named input`, () => {
      const entry = byConfig.get(label)!
      const offenders = entry.params
        .filter((p) => p.kind === 'bare-number')
        .map((p) => `${p.tool}.${p.field}${p.item ? '[]' : ''}`)

      expect(offenders).toEqual([])
    })

    it(`[${label}] anti-vacuity floor: the walk finds ${minTools}+ tools and ${minCanonical}+ canonical ID params`, () => {
      const entry = byConfig.get(label)!
      // Without this, the assertion above passes on an empty sweep — which is
      // precisely how a guard in this repo went blind before.
      expect(entry.tools.length).toBeGreaterThanOrEqual(minTools)
      expect(entry.params.filter((p) => p.kind === 'canonical').length).toBeGreaterThanOrEqual(
        minCanonical,
      )
    })
  }

  it('publishes nothing in the `other` bucket — every ID input is one of the four known shapes', () => {
    const entry = byConfig.get('default')!
    const unexpected = entry.params
      .filter((p) => p.kind === 'other')
      .map((p) => `${p.tool}.${p.field}: ${JSON.stringify(p.node)}`)

    expect(unexpected).toEqual([])
  })

  /**
   * §8 PR 1b names only "the 222 un-`.int()` ID sites", which would have left
   * the 52 ID-named `.int()` sites Phase 0 recorded publishing an integer-only
   * schema — i.e. **rejecting** `"9010000000000001"` in either representation,
   * so those parameters could not address a shard >= 901 object at all. The
   * list included `update_course.course_id` and `explain_grade.course_id`.
   *
   * They were migrated, and this guard is why the decision is checkable rather
   * than a claim: it names any ID param that regresses to the integer-only
   * shape. `tests/canvas/id-precision.test.ts` carries the measurement that
   * made the migration mandatory rather than merely tidy.
   */
  it('no ID param publishes an integer-only schema — Phase 0 recorded 52 of them', () => {
    const entry = byConfig.get('assignment-submission opt-in')!
    const intOnly = entry.params
      .filter((p) => p.kind === 'int-only')
      .map((p) => `${p.tool}.${p.field}`)
      .sort()

    expect(intOnly).toEqual([])
  })

  it('records the ID params published as a plain string, which are already precision-safe', () => {
    const entry = byConfig.get('assignment-submission opt-in')!
    const plain = entry.params
      .filter((p) => p.kind === 'plain-string')
      .map((p) => `${p.tool}.${p.field}`)
      .sort()

    // §3.4 / §4.4: the standalone `z.string()` ID fields are left alone on
    // purpose — they are already strings, so they carry no precision risk.
    expect(plain.length).toBeGreaterThan(0)
    expect(plain.every((name) => /(^|_|\.)ids?$/i.test(name))).toBe(true)
  })

  it('the canonical shape accepts the shard-901 case and rejects 2**53 at every site that publishes it', () => {
    // A property of the published schema rather than of one tool: the integer
    // arm's ceiling is `MAX_SAFE_INTEGER`, and the string arm's pattern admits
    // up to 19 digits. Asserted here so the floor above cannot be satisfied by
    // an `anyOf` that merely looks right.
    const entry = byConfig.get('default')!
    const canonical = entry.params.filter((p) => p.kind === 'canonical')
    for (const param of canonical) {
      const members = nonNullMembers(param.node)
      const integerArm = members.find(isIntegerMember)!
      const stringArm = members.find(isCanonicalStringMember)!
      expect(integerArm.maximum, `${param.tool}.${param.field}`).toBe(9007199254740991)
      expect(integerArm.exclusiveMinimum, `${param.tool}.${param.field}`).toBe(0)
      expect(new RegExp(stringArm.pattern as string).test('9010000000000001')).toBe(true)
      expect(new RegExp(stringArm.pattern as string).test('0')).toBe(false)
    }
  })
})
