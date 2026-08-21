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
 */

type JsonSchemaNode = Record<string, unknown>

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

describe('tool JSON Schema shape (client-facing wire output)', () => {
  let tools: Tool[]

  beforeAll(async () => {
    const { server } = createCanvasMCPServer({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    const client = new Client({ name: 'schema-shape-test', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    const result = await client.listTools()
    tools = result.tools
  })

  it('registers the same tool count as the registry (a walk over an empty list would pass vacuously)', () => {
    const canvas = new CanvasClient({ token: 'test-token', baseUrl: 'https://canvas.example.com' })
    const pseudonymizer = new Pseudonymizer({ baseUrl: 'https://canvas.example.com' })
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
})
