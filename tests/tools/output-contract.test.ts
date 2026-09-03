import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { CanvasClient } from '../../src/canvas'
import { PSEUDONYMIZER_WRAPPED_TOOLS } from '../../src/pseudonym/coverage'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import { getAllTools } from '../../src/tools'
import {
  ACK_MESSAGE,
  ackOutput,
  buildEnvelope,
  listOutput,
  objectOutput,
  outputContractError,
  validateEnvelope,
} from '../../src/tools/output/contract'
import { canvasPageSchema, pageDeletionSchema } from '../../src/tools/output/entities'
import {
  OUTPUT_FIXTURES,
  callArmed,
  callArmedWithPseudonymizer,
  type OutputFixture,
} from './fixtures/output-fixtures'

/**
 * The gap set between two tool-name registries and the pseudonymization-mode
 * coverage each fixture declares. Pure so the anti-vacuity test can exercise
 * it against synthetic registries without executing any handler (BRU-2426).
 */
function pseudonymizationCoverageGaps(
  migrated: readonly string[],
  wrapped: readonly string[],
  fixtures: Readonly<Record<string, Pick<OutputFixture, 'pseudonymization'>>>,
): string[] {
  return migrated
    .filter((name) => wrapped.includes(name))
    .filter((name) => fixtures[name]?.pseudonymization == null)
}

/**
 * The shared gates for structured output (BRU-2418 §7).
 *
 * `pages-output.test.ts` covers the pilot's behaviour; this file covers the
 * properties that must hold for *every* tool that ever declares an `output`
 * contract, so the first person to migrate a second domain inherits them.
 */

const TEST_TOKEN = 'test-token'
const TEST_BASE_URL = 'https://canvas.example.com'

function migratedToolNames(features?: { assignmentSubmission: boolean }): string[] {
  const canvas = new CanvasClient({ token: TEST_TOKEN, baseUrl: TEST_BASE_URL })
  const pseudonymizer = new Pseudonymizer({ baseUrl: TEST_BASE_URL })
  return getAllTools(canvas, pseudonymizer, undefined, features)
    .filter((tool) => tool.output !== undefined)
    .map((tool) => tool.name)
    .sort()
}

describe('structured output — shared gates', () => {
  describe('§7.5 contract completeness', () => {
    it('every tool declaring an output contract has a fixture', () => {
      // Enumerated across *both* server configurations, not just the default.
      // The opt-in gate is the only config that adds tools, and a check built
      // from the default config alone is blind to whatever it adds — the exact
      // hole BRU-2359 found in the schema-shape guard.
      const declared = new Set([
        ...migratedToolNames(),
        ...migratedToolNames({ assignmentSubmission: true }),
      ])

      expect([...declared].sort()).toEqual(Object.keys(OUTPUT_FIXTURES).sort())
    })

    it('the fixture registry is not empty (an empty registry would satisfy the gate above vacuously)', () => {
      expect(Object.keys(OUTPUT_FIXTURES).length).toBeGreaterThan(0)
    })

    it('names no tool that does not exist', () => {
      const canvas = new CanvasClient({ token: TEST_TOKEN, baseUrl: TEST_BASE_URL })
      const everyToolName = new Set(getAllTools(canvas).map((tool) => tool.name))

      for (const name of Object.keys(OUTPUT_FIXTURES)) {
        expect(everyToolName.has(name), `${name} is not a registered tool`).toBe(true)
      }
    })
  })

  describe('§7.5 pseudonymization-mode completeness (BRU-2426)', () => {
    function applicableToolNames(): string[] {
      const declared = new Set([
        ...migratedToolNames(),
        ...migratedToolNames({ assignmentSubmission: true }),
      ])
      return [...declared].filter((name) => PSEUDONYMIZER_WRAPPED_TOOLS.includes(name))
    }

    it('every migrated tool that also carries student PII has dual-mode fixture coverage', () => {
      // Derived from the real migrated-tool registry (via migratedToolNames,
      // same source as the completeness gate above) and the real
      // PSEUDONYMIZER_WRAPPED_TOOLS registry — not a hand-maintained list.
      const gaps = pseudonymizationCoverageGaps(
        applicableToolNames(),
        PSEUDONYMIZER_WRAPPED_TOOLS,
        OUTPUT_FIXTURES,
      )
      expect(gaps).toEqual([])
    })

    it('documents the pages pilot: the intersection with PSEUDONYMIZER_WRAPPED_TOOLS is currently empty', () => {
      // Pages carry no student PII, so the dual-mode round-trip loop below
      // executes zero fixtures today. If this assertion starts failing, a PII
      // tool has migrated to structured output — give it `pseudonymization`
      // coverage in OUTPUT_FIXTURES rather than loosening the gate above.
      expect(applicableToolNames()).toEqual([])
    })

    it('anti-vacuity: rejects an intentionally missing pseudonymization-mode case', () => {
      // Synthetic registries standing in for "a PII tool migrated to
      // structured output without dual-mode coverage" — necessary because the
      // real intersection above is empty today, so this proves the gate is
      // load-bearing rather than vacuously passing.
      const gaps = pseudonymizationCoverageGaps(['get_user', 'list_pages'], ['get_user'], {
        get_user: { pseudonymization: null },
        list_pages: OUTPUT_FIXTURES.list_pages,
      })
      expect(gaps).toEqual(['get_user'])
    })

    it('anti-vacuity: accepts a case that does carry pseudonymization-mode coverage', () => {
      const gaps = pseudonymizationCoverageGaps(['get_user'], ['get_user'], {
        get_user: {
          pseudonymization: {
            buildCanvas: () => OUTPUT_FIXTURES.list_pages.buildCanvas(),
            buildPseudonymizer: (enabled) =>
              new Pseudonymizer({
                baseUrl: TEST_BASE_URL,
                env: enabled ? { CANVAS_PSEUDONYMIZE_STUDENTS: 'true' } : {},
              }),
            readPseudonymizedField: (structured) => structured.title,
          },
        },
      })
      expect(gaps).toEqual([])
    })
  })

  describe('§7.2 fixture round-trip through a real strict client', () => {
    for (const [name, fixture] of Object.entries(OUTPUT_FIXTURES)) {
      describe(name, () => {
        it('is accepted by a client that has listed tools', async () => {
          const result = await callArmed(fixture.buildCanvas(), name, fixture.args)

          expect(result.isError).toBeFalsy()
          expect(result.structuredContent).toBeDefined()
        })

        it('agrees with the text surface', async () => {
          const result = await callArmed(fixture.buildCanvas(), name, fixture.args)
          const parsed: unknown = JSON.parse(result.content[0].text)

          expect(fixture.envelopeKey === null ? parsed : { [fixture.envelopeKey]: parsed }).toEqual(
            result.structuredContent,
          )
        })

        if (fixture.readUndeclared !== null) {
          it('carries a field the schema does not declare, and passes anyway', async () => {
            const result = await callArmed(fixture.buildCanvas(), name, fixture.args)

            expect(fixture.readUndeclared!(result.structuredContent!)).toBeDefined()
          })
        }
      })
    }
  })

  describe('§7.2 dual-mode round trip for PII-bearing migrated tools', () => {
    // Data-driven from OUTPUT_FIXTURES itself, so a future fixture that adds
    // `pseudonymization` coverage is exercised here with no test-file change.
    // Zero iterations today — see "documents the pages pilot" above.
    const applicable = Object.entries(OUTPUT_FIXTURES).filter(
      ([, fixture]) => fixture.pseudonymization !== null,
    )

    if (applicable.length === 0) {
      it('has nothing to execute yet — see "documents the pages pilot" above', () => {
        expect(applicable).toEqual([])
      })
    }

    for (const [name, fixture] of applicable) {
      const coverage = fixture.pseudonymization!
      describe(name, () => {
        it('produces valid structured output with pseudonymization disabled', async () => {
          const result = await callArmedWithPseudonymizer(
            coverage.buildCanvas(),
            coverage.buildPseudonymizer(false),
            name,
            fixture.args,
          )

          expect(result.isError).toBeFalsy()
          expect(result.structuredContent).toBeDefined()
        })

        it('produces valid structured output with pseudonymization enabled, and the PII field changes', async () => {
          const disabled = await callArmedWithPseudonymizer(
            coverage.buildCanvas(),
            coverage.buildPseudonymizer(false),
            name,
            fixture.args,
          )
          const enabled = await callArmedWithPseudonymizer(
            coverage.buildCanvas(),
            coverage.buildPseudonymizer(true),
            name,
            fixture.args,
          )

          expect(enabled.isError).toBeFalsy()
          expect(enabled.structuredContent).toBeDefined()
          expect(coverage.readPseudonymizedField(enabled.structuredContent!)).not.toEqual(
            coverage.readPseudonymizedField(disabled.structuredContent!),
          )
        })
      })
    }
  })

  describe('callArmedWithPseudonymizer (dual-mode runner proof)', () => {
    // The loop above has zero iterations while the pages pilot's intersection
    // with PSEUDONYMIZER_WRAPPED_TOOLS is empty, so it never exercises
    // callArmedWithPseudonymizer. Prove the runner itself works end to end
    // against a real PII-wrapped tool (`get_user`, not structured-output —
    // structuredContent is read from the parsed text surface instead) so the
    // machinery the dual-mode loop depends on is not untested.
    let pseudonymRoot: string

    beforeEach(async () => {
      pseudonymRoot = await mkdtemp(join(tmpdir(), 'output-contract-pseudonym-'))
    })

    afterEach(async () => {
      await rm(pseudonymRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    })

    it('threads pseudonymization through a real handler, off vs. on', async () => {
      const canvas = {
        users: {
          get: async () => ({ id: 42, name: 'Ada Lovelace', sortable_name: 'Lovelace, Ada' }),
        },
      } as unknown as CanvasClient
      const buildPseudonymizer = (enabled: boolean) =>
        new Pseudonymizer({
          baseUrl: TEST_BASE_URL,
          rootDir: pseudonymRoot,
          env: enabled ? { CANVAS_PSEUDONYMIZE_STUDENTS: 'true' } : {},
        })

      const disabled = await callArmedWithPseudonymizer(
        canvas,
        buildPseudonymizer(false),
        'get_user',
        { user_id: 42 },
      )
      const enabled = await callArmedWithPseudonymizer(
        canvas,
        buildPseudonymizer(true),
        'get_user',
        { user_id: 42 },
      )

      expect(disabled.isError).toBeFalsy()
      expect(enabled.isError).toBeFalsy()
      const disabledName = (JSON.parse(disabled.content[0].text) as { name: string }).name
      const enabledName = (JSON.parse(enabled.content[0].text) as { name: string }).name
      expect(disabledName).toBe('Ada Lovelace')
      expect(enabledName).not.toBe('Ada Lovelace')
    })
  })

  describe('§7.6 no tool advertises an unusable output schema', () => {
    it('every advertised output schema is a non-empty object schema', () => {
      // Measured on SDK 1.30.0: an empty shape is advertised as
      // `{type:'object', properties:{}, additionalProperties:false}`, and every
      // call to that tool then fails with `data must NOT have additional
      // properties`. A tool broken for every client, from one line.
      const canvas = new CanvasClient({ token: TEST_TOKEN, baseUrl: TEST_BASE_URL })
      const migrated = getAllTools(canvas).filter((tool) => tool.output !== undefined)

      for (const tool of migrated) {
        const json = z.toJSONSchema(tool.output!.schema, { io: 'output' }) as {
          type?: string
          properties?: Record<string, unknown>
        }
        expect(json.type, `${tool.name} output schema is not an object`).toBe('object')
        expect(
          Object.keys(json.properties ?? {}).length,
          `${tool.name} output schema declares no properties`,
        ).toBeGreaterThan(0)
      }
    })

    it('every advertised output schema is representable as JSON Schema', () => {
      // `tools/list` builds every schema inside one map, so a single
      // unrepresentable type (`z.date()`) throws and returns *zero* tools —
      // a whole-server outage from one tool's contract.
      const canvas = new CanvasClient({ token: TEST_TOKEN, baseUrl: TEST_BASE_URL })
      const migrated = getAllTools(canvas).filter((tool) => tool.output !== undefined)

      for (const tool of migrated) {
        expect(() => z.toJSONSchema(tool.output!.schema, { io: 'output' })).not.toThrow()
      }
    })
  })

  describe('§3 boundary policy holds for every migrated tool', () => {
    it('declares no format, pattern or length constraint on a Canvas-sourced value', () => {
      // A constraint on data we do not produce is a runtime failure waiting for
      // the first Canvas instance that disagrees with us — `z.iso.datetime()`
      // emits a pattern requiring a `Z` suffix, which rejects offset timestamps.
      const banned = ['format', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'enum']
      const canvas = new CanvasClient({ token: TEST_TOKEN, baseUrl: TEST_BASE_URL })
      const violations: string[] = []

      const walk = (node: unknown, path: string): void => {
        if (Array.isArray(node)) {
          node.forEach((item, i) => walk(item, `${path}[${i}]`))
          return
        }
        if (typeof node !== 'object' || node === null) return
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          if (banned.includes(key)) violations.push(`${path}.${key}`)
          walk(value, `${path}.${key}`)
        }
      }

      for (const tool of getAllTools(canvas).filter((t) => t.output !== undefined)) {
        walk(z.toJSONSchema(tool.output!.schema, { io: 'output' }), tool.name)
      }

      expect(violations).toEqual([])
    })
  })

  describe('envelope construction', () => {
    it('object contracts pass the value through untouched', () => {
      const value = { page_id: 1, url: 'a', title: 'A', extra: true }

      expect(buildEnvelope(objectOutput(canvasPageSchema), value)).toBe(value)
    })

    it('list contracts wrap the array under the authored key', () => {
      const value = [{ page_id: 1, url: 'a', title: 'A' }]

      expect(buildEnvelope(listOutput('pages', canvasPageSchema), value)).toEqual({ pages: value })
    })

    it('ack contracts emit the fixed acknowledgement, ignoring the undefined value', () => {
      expect(buildEnvelope(ackOutput(), undefined)).toEqual({ ok: true, message: ACK_MESSAGE })
    })

    it('the ack envelope validates against its own schema', () => {
      const contract = ackOutput()

      expect(validateEnvelope(contract, buildEnvelope(contract, undefined))).toEqual({ ok: true })
    })
  })

  describe('validation', () => {
    it('accepts undeclared fields inside a loose Canvas entity', () => {
      const contract = listOutput('pages', canvasPageSchema)
      const envelope = buildEnvelope(contract, [
        { page_id: 1, url: 'a', title: 'A', invented_by_canvas: 'later' },
      ])

      expect(validateEnvelope(contract, envelope)).toEqual({ ok: true })
    })

    it('rejects an undeclared field on a shape this server authors', () => {
      // The other half of the loose/strict split: `delete_page`'s payload is
      // ours, so an unexpected key there is our bug rather than Canvas drift.
      const result = validateEnvelope(objectOutput(pageDeletionSchema), {
        deleted: true,
        page_url: 'a',
        unexpected: 1,
      })

      expect(result.ok).toBe(false)
    })

    it('rejects a missing required field', () => {
      const result = validateEnvelope(objectOutput(canvasPageSchema), { url: 'a', title: 'A' })

      expect(result.ok).toBe(false)
      expect(result.ok === false && result.issues.join(' ')).toContain('page_id')
    })

    it('reports issues as path and message only, never the offending value', () => {
      const result = validateEnvelope(objectOutput(canvasPageSchema), {
        page_id: 'SECRET-CANARY-VALUE',
        url: 'a',
        title: 'A',
      })

      expect(result.ok).toBe(false)
      const issues = result.ok === false ? result.issues.join(' ') : ''
      expect(issues).toContain('page_id')
      expect(issues).not.toContain('SECRET-CANARY-VALUE')
    })
  })

  describe('the model-facing error message', () => {
    it('names the tool and nothing else about the failure', () => {
      const message = outputContractError('get_page')

      expect(message).toContain('get_page')
      expect(message).toContain('canvas-lms-mcp bug')
      expect(message).toContain('not a Canvas permission problem')
    })
  })
})
