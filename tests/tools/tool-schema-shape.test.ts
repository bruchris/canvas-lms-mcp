import { describe, expect, it, beforeAll } from 'vitest'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import {
  normalizeObjectSchema,
  objectFromShape,
  type ZodRawShapeCompat,
} from '@modelcontextprotocol/sdk/server/zod-compat.js'
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js'
import { createCanvasMCPServer } from '../../src/server'
import { getAllTools } from '../../src/tools'
import { CanvasClient } from '../../src/canvas'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import { JSON_SCHEMA_DIALECT_2020_12 } from '../../src/schema-dialect'

/**
 * Regression coverage for PR #308: `z.tuple([...])` compiles to draft-07
 * tuple-style `"items": [...]` (or 2020-12 `prefixItems`) in the emitted JSON
 * Schema. Anthropic accepts that form, but OpenAI-compatible backends (e.g.
 * Z.AI/GLM) reject the *entire request* when any registered tool carries it —
 * see https://github.com/bruchris/canvas-lms-mcp/pull/308. This test walks the
 * real `tools/list` wire output (not the Zod objects) so any future tool that
 * reintroduces `z.tuple()` fails CI instead of shipping silently.
 *
 * Two server configs are walked: the default (163 tools) and
 * `enableAssignmentSubmission: true` (165 tools). The opt-in gate is the only
 * server config that adds tools beyond the default set — role filtering only
 * ever subsets it — so walking these two covers every tool the server can
 * ever return. See BRU-2359.
 *
 * The walk covers `outputSchema` as well as `inputSchema` (BRU-2418 §7.1): a
 * tuple in an output schema breaks the same backends, and output schemas carry
 * a hazard input schemas never had. `tools/list` builds every tool's schema
 * inside one map, so a single unrepresentable type — `z.date()` is the easy
 * mistake — throws and returns *zero* tools. That makes one tool's contract a
 * whole-server outage, which is why the count assertions below are the load
 * bearing part of this file rather than boilerplate: a throwing `tools/list`
 * fails `beforeAll`, and a silently empty one fails the count. See §0.3, §7.4.
 */

type JsonSchemaNode = Record<string, unknown>

const TEST_TOKEN = 'test-token'
const TEST_BASE_URL = 'https://canvas.example.com'

function isJsonSchemaNode(value: unknown): value is JsonSchemaNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function walkSchema(node: unknown, path: string, violations: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => walkSchema(item, `${path}[${i}]`, violations))
    return
  }
  if (!isJsonSchemaNode(node)) return

  if (Array.isArray(node.items)) {
    violations.push(`${path}.items is tuple-style (draft-07 positional array)`)
  }
  if ('prefixItems' in node) {
    violations.push(`${path}.prefixItems is present (2020-12 tuple form)`)
  }

  for (const [key, value] of Object.entries(node)) {
    walkSchema(value, `${path}.${key}`, violations)
  }
}

/** The two `ToolDefinition` sets the two walked server configs register. */
function registryConfigs(): [string, ReturnType<typeof getAllTools>][] {
  const canvas = new CanvasClient({ token: TEST_TOKEN, baseUrl: TEST_BASE_URL })
  const pseudonymizer = new Pseudonymizer({ baseUrl: TEST_BASE_URL })
  return [
    ['default', getAllTools(canvas, pseudonymizer)],
    [
      'opt-in',
      getAllTools(canvas, pseudonymizer, undefined, {
        assignmentSubmission: true,
      }),
    ],
  ]
}

/** `[label, $schema value]` for every schema the given tool list advertises. */
function advertisedDialects(tools: Tool[], config: string): [string, unknown][] {
  const dialects: [string, unknown][] = []
  for (const tool of tools) {
    dialects.push([
      `${config} ${tool.name}.inputSchema`,
      (tool.inputSchema as JsonSchemaNode).$schema,
    ])
    if (tool.outputSchema) {
      dialects.push([
        `${config} ${tool.name}.outputSchema`,
        (tool.outputSchema as JsonSchemaNode).$schema,
      ])
    }
  }
  return dialects
}

function nestedDialectKeys(node: unknown, path: string, depth: number, found: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => nestedDialectKeys(item, `${path}[${i}]`, depth + 1, found))
    return
  }
  if (!isJsonSchemaNode(node)) return
  for (const [key, value] of Object.entries(node)) {
    if (key === '$schema' && depth > 0) found.push(`${path}.$schema`)
    nestedDialectKeys(value, `${path}.${key}`, depth + 1, found)
  }
}

/**
 * The bodies the SDK's own converter emits for one Zod schema under each of
 * the two dialects, with the `$schema` declaration removed from both.
 */
function bodiesUnderBothDialects(
  schema: Parameters<typeof normalizeObjectSchema>[0],
  io: 'input' | 'output',
): [string, string] {
  // `registerTool` stores `objectFromShape(...)` for a raw shape, so a
  // zero-key input shape — `get_todo_items` and two others — still reaches
  // `tools/list` as a Zod object even though `normalizeObjectSchema` declines
  // to normalize the bare `{}`. Mirroring both steps keeps this comparison on
  // exactly the schemas the server converts.
  const normalized = normalizeObjectSchema(schema) ?? objectFromShape(schema as ZodRawShapeCompat)
  return (['draft-7', 'draft-2020-12'] as const).map((target) => {
    const body = toJsonSchemaCompat(normalized, {
      strictUnions: true,
      pipeStrategy: io,
      target,
    })
    delete body.$schema
    return JSON.stringify(body)
  }) as [string, string]
}

async function listClientFacingTools(enableAssignmentSubmission?: boolean): Promise<Tool[]> {
  const { server } = createCanvasMCPServer({
    token: TEST_TOKEN,
    baseUrl: TEST_BASE_URL,
    enableAssignmentSubmission,
  })
  const client = new Client({ name: 'schema-shape-test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  const result = await client.listTools()
  return result.tools
}

describe('tool JSON Schema shape (client-facing wire output)', () => {
  let tools: Tool[]
  let optInTools: Tool[]

  beforeAll(async () => {
    ;[tools, optInTools] = await Promise.all([listClientFacingTools(), listClientFacingTools(true)])
  })

  it('registers the same tool count as the registry (a walk over an empty list would pass vacuously)', () => {
    const canvas = new CanvasClient({ token: TEST_TOKEN, baseUrl: TEST_BASE_URL })
    const pseudonymizer = new Pseudonymizer({ baseUrl: TEST_BASE_URL })
    const registered = getAllTools(canvas, pseudonymizer)
    expect(tools.length).toBe(registered.length)
    expect(tools.length).toBeGreaterThan(0)
  })

  it('contains no tuple-style array schema anywhere in the client-facing inputSchema', () => {
    const violations: string[] = []
    for (const tool of tools) {
      walkSchema(tool.inputSchema, `${tool.name}.inputSchema`, violations)
    }
    expect(violations).toEqual([])
  })

  it('contains no tuple-style array schema anywhere in the client-facing outputSchema', () => {
    const violations: string[] = []
    for (const tool of tools) {
      if (tool.outputSchema) {
        walkSchema(tool.outputSchema, `${tool.name}.outputSchema`, violations)
      }
    }
    expect(violations).toEqual([])
  })

  it('advertises an outputSchema for exactly the tools that declare an output contract', () => {
    // Guards the walk above against going vacuous: if registration ever stopped
    // passing `outputSchema` through, the walk would sweep nothing and pass.
    const canvas = new CanvasClient({ token: TEST_TOKEN, baseUrl: TEST_BASE_URL })
    const pseudonymizer = new Pseudonymizer({ baseUrl: TEST_BASE_URL })
    const declared = getAllTools(canvas, pseudonymizer)
      .filter((tool) => tool.output !== undefined)
      .map((tool) => tool.name)
      .sort()

    const advertised = tools
      .filter((tool) => tool.outputSchema !== undefined)
      .map((tool) => tool.name)
      .sort()

    expect(advertised).toEqual(declared)
    expect(advertised.length).toBeGreaterThan(0)
  })

  it('pins the #308 fix: new_appointments stays a fixed-length array schema, not a tuple', () => {
    for (const toolName of ['create_appointment_group', 'update_appointment_group']) {
      const tool = tools.find((t) => t.name === toolName)
      expect(tool, `${toolName} not found in tools/list`).toBeDefined()

      const properties = (tool!.inputSchema as JsonSchemaNode).properties as JsonSchemaNode
      const newAppointments = properties.new_appointments as JsonSchemaNode
      expect(newAppointments.type).toBe('array')

      const pairSchema = newAppointments.items as JsonSchemaNode
      expect(Array.isArray(pairSchema)).toBe(false)
      expect(pairSchema.type).toBe('array')
      expect(pairSchema.minItems).toBe(2)
      expect(pairSchema.maxItems).toBe(2)
    }
  })

  describe('opt-in tools (enableAssignmentSubmission)', () => {
    it('registers the same tool count as the registry, including the gated domain (a walk over just the default 163 would never see these)', () => {
      const canvas = new CanvasClient({ token: TEST_TOKEN, baseUrl: TEST_BASE_URL })
      const pseudonymizer = new Pseudonymizer({ baseUrl: TEST_BASE_URL })
      const registered = getAllTools(canvas, pseudonymizer, undefined, {
        assignmentSubmission: true,
      })
      expect(optInTools.length).toBe(registered.length)
      expect(optInTools.length).toBeGreaterThan(tools.length)
    })

    it('adds exactly submit_assignment and upload_submission_file over the default tool set', () => {
      const defaultNames = new Set(tools.map((t) => t.name))
      const delta = optInTools
        .map((t) => t.name)
        .filter((name) => !defaultNames.has(name))
        .sort()
      expect(delta).toEqual(['submit_assignment', 'upload_submission_file'])
    })

    it('contains no tuple-style array schema anywhere in the client-facing inputSchema', () => {
      const violations: string[] = []
      for (const tool of optInTools) {
        walkSchema(tool.inputSchema, `${tool.name}.inputSchema`, violations)
      }
      expect(violations).toEqual([])
    })

    it('contains no tuple-style array schema anywhere in the client-facing outputSchema', () => {
      const violations: string[] = []
      for (const tool of optInTools) {
        if (tool.outputSchema) {
          walkSchema(tool.outputSchema, `${tool.name}.outputSchema`, violations)
        }
      }
      expect(violations).toEqual([])
    })
  })
})

/**
 * Issue #341: `@modelcontextprotocol/sdk@1.30.0` converts every Zod schema
 * with an unconditional `target: 'draft-7'` and exposes no override through
 * `registerTool`, so every tool shipped `"$schema":
 * "http://json-schema.org/draft-07/schema#"`. Claude Desktop's validator
 * supports 2020-12 only and rejected the five `pages` tools — the only ones
 * advertising an `outputSchema` — before any Canvas request was made.
 *
 * The walk above deliberately traversed `$schema` without ever asserting on
 * it, which is why a guard that reads the right artifact still missed this.
 * These tests pin the dialect itself across every tool and both configs.
 *
 * `dialect swap is semantically identical` is the safety argument for
 * rewriting the declaration rather than withdrawing the output contracts: the
 * SDK's own converter is asked for both dialects and the bodies must match
 * byte for byte, so what we advertise is exactly what the SDK would have
 * emitted had it accepted a `target` option. The test after it is that
 * check's control — a tuple schema is a case where the two targets genuinely
 * differ (`items` + `additionalItems` vs `prefixItems` + `items`), so a
 * comparison that could never fail is ruled out.
 */
describe('tool JSON Schema dialect (issue #341)', () => {
  let tools: Tool[]
  let optInTools: Tool[]

  beforeAll(async () => {
    ;[tools, optInTools] = await Promise.all([listClientFacingTools(), listClientFacingTools(true)])
  })

  it('declares JSON Schema 2020-12 on every client-facing schema', () => {
    const dialects = advertisedDialects(tools, 'default')
    const violations = dialects
      .filter(([, dialect]) => dialect !== JSON_SCHEMA_DIALECT_2020_12)
      .map(([label, dialect]) => `${label} declares ${String(dialect)}`)

    expect(violations).toEqual([])
    // Anti-vacuity: an empty `tools/list` would satisfy the filter above.
    expect(dialects.length).toBeGreaterThan(tools.length)
  })

  it('declares JSON Schema 2020-12 on every client-facing schema, including the gated domain', () => {
    const dialects = advertisedDialects(optInTools, 'opt-in')
    const violations = dialects
      .filter(([, dialect]) => dialect !== JSON_SCHEMA_DIALECT_2020_12)
      .map(([label, dialect]) => `${label} declares ${String(dialect)}`)

    expect(violations).toEqual([])
    expect(optInTools.length).toBeGreaterThan(tools.length)
  })

  it('declares the dialect at the schema root only', () => {
    // The rewrite sets one key per schema. A nested `$schema` would be a
    // second, unrewritten declaration hiding below it.
    const found: string[] = []
    for (const tool of [...tools, ...optInTools]) {
      nestedDialectKeys(tool.inputSchema, `${tool.name}.inputSchema`, 0, found)
      if (tool.outputSchema) {
        nestedDialectKeys(tool.outputSchema, `${tool.name}.outputSchema`, 0, found)
      }
    }
    expect(found).toEqual([])
  })

  it('emits an identical schema body under both dialects, so the swap is a dialect change and nothing else', () => {
    const divergent: string[] = []
    let compared = 0

    for (const [config, definitions] of registryConfigs()) {
      for (const definition of definitions) {
        const pairs: [string, Parameters<typeof normalizeObjectSchema>[0], 'input' | 'output'][] = [
          [`${config} ${definition.name}.inputSchema`, definition.inputSchema, 'input'],
        ]
        if (definition.output) {
          pairs.push([
            `${config} ${definition.name}.outputSchema`,
            definition.output.schema,
            'output',
          ])
        }
        for (const [label, schema, io] of pairs) {
          const [draft07, draft202012] = bodiesUnderBothDialects(schema, io)
          compared++
          if (draft07 !== draft202012) divergent.push(label)
        }
      }
    }

    expect(divergent).toEqual([])
    expect(compared).toBeGreaterThan(300)
  })

  it('the dialect-equivalence check is not vacuous: a tuple schema diverges between the two targets', () => {
    const [draft07, draft202012] = bodiesUnderBothDialects(
      { pair: z.tuple([z.string(), z.string()]) },
      'input',
    )

    expect(draft07).not.toBe(draft202012)
    expect(draft07).toContain('additionalItems')
    expect(draft202012).toContain('prefixItems')
  })
})
