import { describe, expect, it, beforeAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { createCanvasMCPServer } from '../../src/server'
import { getAllTools } from '../../src/tools'
import { CanvasClient } from '../../src/canvas'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'

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
  })
})
