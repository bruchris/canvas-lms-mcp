import { describe, expect, it, beforeAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import Ajv2020Import from 'ajv/dist/2020.js'
import { createCanvasMCPServer } from '../../src/server'
import { JSON_SCHEMA_DIALECT_2020_12 } from '../../src/schema-dialect'
import { OUTPUT_FIXTURES, buildPagesCanvas, callArmed } from './fixtures/output-fixtures'

/**
 * Reproduction and regression coverage for GitHub issue #341.
 *
 * Claude Desktop validates every advertised `outputSchema` with a validator
 * that supports JSON Schema 2020-12 *only*, and rejects the tool before the
 * request reaches Canvas when the schema declares another dialect. Prior to
 * this fix all five `pages` tools advertised
 * `"$schema": "http://json-schema.org/draft-07/schema#"`, because
 * `@modelcontextprotocol/sdk@1.30.0` converts Zod with an unconditional
 * `target: 'draft-7'` and exposes no override through `registerTool`.
 *
 * The assertions below run the *actual* class Claude Desktop's validator is
 * built on — Ajv's 2020-12 entry point — over the real `tools/list` wire
 * artifact, so this file fails for the same reason the user's client did
 * rather than on a string comparison that merely stands in for it. The
 * dialect string itself is pinned separately in `tool-schema-shape.test.ts`.
 *
 * `dialect-is-rejected` below is the anti-vacuity control: it feeds the same
 * validator the draft-07 form these tools used to advertise and asserts it
 * throws. Without it, a validator that silently accepted everything would make
 * every other assertion here pass for free.
 */

// ajv ships CJS; the 2020-12 entry is the constructor on both interop paths.
const Ajv2020 = ((Ajv2020Import as unknown as { default?: typeof Ajv2020Import }).default ??
  Ajv2020Import) as typeof Ajv2020Import

const TEST_TOKEN = 'test-token'
const TEST_BASE_URL = 'https://canvas.example.com'

/** The five tools issue #341 reported, all of which declare an output contract. */
const PAGES_TOOLS = ['list_pages', 'get_page', 'create_page', 'update_page', 'delete_page']

function newValidator(): InstanceType<typeof Ajv2020> {
  // `strict: true` is deliberate: it also rejects a schema that declares the
  // 2020-12 dialect while carrying draft-07-only keywords (tuple `items` plus
  // `additionalItems`, say), which a dialect-string check alone would miss.
  // The two opt-outs are Ajv opinions rather than dialect rules, and both
  // constructs mean the same thing in draft-07 and 2020-12, so leaving them on
  // would make this file fail on 22 schemas that no client has a problem with:
  //  - `strictTypes` rejects a union `type: ['string', 'number']` (six tools);
  //  - `validateFormats` rejects `format: 'date-time'` as unknown unless
  //    `ajv-formats` is registered, and `format` is an annotation by default.
  return new Ajv2020({ strict: true, strictTypes: false, validateFormats: false })
}

async function listClientFacingTools(enableAssignmentSubmission?: boolean): Promise<Tool[]> {
  const { server } = createCanvasMCPServer({
    token: TEST_TOKEN,
    baseUrl: TEST_BASE_URL,
    enableAssignmentSubmission,
  })
  const client = new Client({ name: 'schema-dialect-test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  const result = await client.listTools()
  return result.tools
}

/** Every schema the two server configurations can put on the wire, labelled. */
function everySchema(tools: Tool[], config: string): [string, unknown][] {
  const pairs: [string, unknown][] = []
  for (const tool of tools) {
    pairs.push([`${config} ${tool.name}.inputSchema`, tool.inputSchema])
    if (tool.outputSchema) pairs.push([`${config} ${tool.name}.outputSchema`, tool.outputSchema])
  }
  return pairs
}

function compileFailures(pairs: [string, unknown][]): string[] {
  // One instance for the whole sweep: constructing an Ajv2020 re-parses the
  // 2020-12 meta-schema, which dominates the runtime over 300-odd schemas.
  // None of ours carry an `$id`, so nothing collides in its cache.
  const validator = newValidator()
  const failures: string[] = []
  for (const [label, schema] of pairs) {
    try {
      validator.compile(schema as object)
    } catch (error) {
      failures.push(`${label}: ${(error as Error).message}`)
    }
  }
  return failures
}

describe('JSON Schema dialect compatibility (issue #341)', () => {
  let tools: Tool[]
  let optInTools: Tool[]

  beforeAll(async () => {
    ;[tools, optInTools] = await Promise.all([listClientFacingTools(), listClientFacingTools(true)])
  })

  it('compiles every advertised schema under a 2020-12-only validator', () => {
    const pairs = [...everySchema(tools, 'default'), ...everySchema(optInTools, 'opt-in')]
    expect(compileFailures(pairs)).toEqual([])
    // Anti-vacuity: a `tools/list` that returned nothing would sweep no schemas.
    expect(pairs.length).toBeGreaterThan(300)
  })

  it('rejects the draft-07 dialect these tools used to advertise (the validator is real)', () => {
    const getPage = tools.find((tool) => tool.name === 'get_page')
    expect(getPage?.outputSchema).toBeDefined()

    const asDraft07 = {
      ...(getPage!.outputSchema as Record<string, unknown>),
      $schema: 'http://json-schema.org/draft-07/schema#',
    }

    expect(() => newValidator().compile(asDraft07)).toThrow(
      /no schema with key or ref "http:\/\/json-schema\.org\/draft-07\/schema#"/,
    )
  })

  it('rejects draft-07-only keywords carried under a 2020-12 declaration', () => {
    // The other half of the control: rewriting the dialect string would be
    // unsafe if the body could still be draft-07 shaped, so prove the
    // validator is strict enough to notice when it is.
    const tupleUnderNewDialect = {
      $schema: JSON_SCHEMA_DIALECT_2020_12,
      type: 'object',
      properties: {
        pair: { type: 'array', items: [{ type: 'string' }], additionalItems: false },
      },
    }

    expect(() => newValidator().compile(tupleUnderNewDialect)).toThrow(/items must be object/)
  })

  describe('the five tools reported in #341', () => {
    it('advertises an outputSchema a 2020-12-only client can compile', () => {
      const failures: string[] = []
      for (const name of PAGES_TOOLS) {
        const tool = tools.find((candidate) => candidate.name === name)
        if (!tool) {
          failures.push(`${name}: not registered`)
          continue
        }
        if (!tool.outputSchema) {
          failures.push(`${name}: advertises no outputSchema`)
          continue
        }
        const dialect = (tool.outputSchema as Record<string, unknown>).$schema
        if (dialect !== JSON_SCHEMA_DIALECT_2020_12) {
          failures.push(`${name}: $schema is ${String(dialect)}`)
        }
        try {
          newValidator().compile(tool.outputSchema)
        } catch (error) {
          failures.push(`${name}: ${(error as Error).message}`)
        }
      }
      expect(failures).toEqual([])
    })

    it('produces structuredContent the compiled validator accepts', async () => {
      // The dialect fix is only worth anything if a real payload still passes
      // the schema once a 2020-12 client can finally compile it. `callArmed`
      // lists tools first, so the SDK client's own validator is armed too.
      const rejections: string[] = []
      for (const name of PAGES_TOOLS) {
        const fixture = OUTPUT_FIXTURES[name]
        expect(fixture, `${name} has no output fixture`).toBeDefined()

        const tool = tools.find((candidate) => candidate.name === name)
        const validate = newValidator().compile(tool!.outputSchema as object)
        const result = await callArmed(buildPagesCanvas(), name, fixture!.args)

        expect(result.isError, `${name} returned an error result`).toBeFalsy()
        if (!validate(result.structuredContent)) {
          rejections.push(`${name}: ${newValidator().errorsText(validate.errors)}`)
        }
      }
      expect(rejections).toEqual([])
    })
  })
})
