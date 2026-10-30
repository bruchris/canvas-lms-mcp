import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { PSEUDONYMIZER_WRAPPED_TOOLS } from '../../src/pseudonym/coverage'
import { MARKED_NAME_FIXTURES } from './fixtures'
import { duplicateMarks, findMarkedKeys, findMarks } from './fixtures/marks'
import {
  buildSweepPseudonymizer,
  classifyVerdict,
  runSweep,
  type MarkedNameFixture,
  type SweepResult,
} from './fixtures/sweep'

/**
 * BRU-3146 Phase 1 — the independent oracle for pseudonymizer coverage.
 *
 * `coverage.test.ts` next door asserts that the two hand lists agree with each
 * other. Measured in §1.1 of the design, that is *blind* to the failure class
 * it exists to catch: all three October leaks (`91e57e1`, `159f758`,
 * `9ab1fbb`) can be restored at once with those three tests still green,
 * because "a listed name is registered" is not violated by a missing wrap.
 *
 * This file asserts something a hand list cannot: that no real name authored
 * into a Canvas payload survives the handler with `CANVAS_PSEUDONYMIZE_STUDENTS`
 * on. Both files stay for Phase 1; Phase 2 deletes the hand lists.
 */

// One sweep per tool, memoised, so the per-tool verdict tests and the derived-set
// regression share a run rather than paying for it twice. Each `runSweep` gets
// its own temp pseudonym rootDir, so order still cannot change a verdict.
const sweeps = new Map<string, Promise<SweepResult>>()
function sweepOnce(name: string): Promise<SweepResult> {
  const cached = sweeps.get(name)
  if (cached) return cached
  const fixture = MARKED_NAME_FIXTURES[name]
  if (!fixture) throw new Error(`no marked-name fixture for ${name}`)
  const run = runSweep(name, fixture)
  sweeps.set(name, run)
  return run
}

/** Marks must be written as a quoted literal; see the §5.4 lint below. */
function marksOutsideStringLiterals(source: string): string[] {
  return (source.match(/(^|[^'])REAL_NAME_\d+/gm) ?? []).map((m) => m.trim())
}

/** §5.5: which known-PII tools the derived set fails to cover. */
function missingFromDerived(
  derived: ReadonlySet<string>,
  expected: ReadonlyArray<string>,
): string[] {
  return expected.filter((name) => !derived.has(name))
}

describe('BRU-3146 §6.1 Phase 1: marked-name fixture sweep', () => {
  describe('completeness against the hand list', () => {
    it('every tool in PSEUDONYMIZER_WRAPPED_TOOLS has a marked-name fixture', () => {
      const missing = PSEUDONYMIZER_WRAPPED_TOOLS.filter((n) => !MARKED_NAME_FIXTURES[n])
      expect(missing).toEqual([])
    })

    it('carries no fixture outside the Phase 1 population', () => {
      // Phase 1 is scoped to the 35 names in the hand list. A fixture for any
      // other tool is Phase 2 work arriving early, and would make the count
      // floors of §5.2 land on a population nobody has reviewed.
      const wrapped = new Set(PSEUDONYMIZER_WRAPPED_TOOLS)
      const extra = Object.keys(MARKED_NAME_FIXTURES).filter((n) => !wrapped.has(n))
      expect(extra).toEqual([])
    })
  })

  describe('§5.4 no stray marks', () => {
    const fixtureDir = new URL('./fixtures/', import.meta.url)
    const fixtureSources = readdirSync(fixtureDir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => [f, readFileSync(new URL(f, fixtureDir), 'utf8')] as const)

    it('reads at least one fixture source file', () => {
      // Control for the two assertions below: a glob that matched nothing would
      // make both of them vacuously green.
      expect(fixtureSources.length).toBeGreaterThan(0)
    })

    it('writes every mark as a quoted string literal, never in prose', () => {
      // A mark in a comment is not data, and a mark in an unquoted position is
      // not a payload value. Prose refers to the pattern as REAL_NAME_<n>,
      // without digits, so it does not match.
      const offenders = fixtureSources
        .map(([file, src]) => [file, marksOutsideStringLiterals(src)] as const)
        .filter(([, found]) => found.length > 0)
      expect(offenders).toEqual([])
    })

    it('anti-vacuity: the quoted-literal lint flags a mark written in prose', () => {
      expect(marksOutsideStringLiterals('// the leader is REAL_NAME_2\n')).toHaveLength(1)
      expect(marksOutsideStringLiterals("display_name: 'REAL_NAME_2',\n")).toEqual([])
    })

    for (const name of Object.keys(MARKED_NAME_FIXTURES)) {
      it(`${name}: marks appear only in values, with unique indices`, async () => {
        const { control, controlKeys } = await sweepOnce(name)
        // A mark on a *key* would make a correct implementation fail the
        // flag-on assertion, which is how a guard gets relaxed rather than
        // fixed. A repeated index makes the payload's name count unreadable.
        expect(controlKeys).toEqual([])
        expect(duplicateMarks(control)).toEqual([])
      })
    }

    it('anti-vacuity: the structural checks flag a smuggled key and a repeated index', () => {
      expect(findMarkedKeys({ REAL_NAME_1: 'Jamie' })).toEqual([
        { path: 'REAL_NAME_1', mark: 'REAL_NAME_1' },
      ])
      expect(
        duplicateMarks([
          { path: 'a', mark: 'REAL_NAME_1' },
          { path: 'b', mark: 'REAL_NAME_1' },
        ]),
      ).toEqual(['REAL_NAME_1'])
    })
  })

  describe('the sweep', () => {
    for (const name of Object.keys(MARKED_NAME_FIXTURES)) {
      describe(name, () => {
        it('control fires: a real name reaches the client with pseudonymization OFF', async () => {
          const { control } = await sweepOnce(name)
          expect(control.length).toBeGreaterThan(0)
        })

        it('no real name survives with pseudonymization ON', async () => {
          const { surviving, verdict } = await sweepOnce(name)
          expect({ verdict, surviving }).toEqual({ verdict: 'CLEAN', surviving: [] })
        })
      })
    }
  })

  describe('§5.5 derived-set regression', () => {
    it('every known-PII tool is a tool whose fixture actually surfaces a name', async () => {
      const results = await Promise.all(Object.keys(MARKED_NAME_FIXTURES).map(sweepOnce))
      const derived = new Set(results.filter((r) => r.control.length > 0).map((r) => r.name))
      expect(missingFromDerived(derived, PSEUDONYMIZER_WRAPPED_TOOLS)).toEqual([])
    })

    it('anti-vacuity: the regression names a tool whose fixture stopped marking', () => {
      expect(missingFromDerived(new Set(['get_user']), ['get_user', 'list_students'])).toEqual([
        'list_students',
      ])
      expect(missingFromDerived(new Set(['get_user', 'list_students']), ['get_user'])).toEqual([])
    })
  })

  describe('§5.1 the three verdicts are distinguishable, by injection', () => {
    it('classifies an unarmed fixture VACUOUS, not CLEAN', async () => {
      // §5.1's recipe: replace a fixture's buildCanvas with one returning [].
      const unarmed: MarkedNameFixture = {
        ...MARKED_NAME_FIXTURES.list_students,
        buildCanvas: () => ({ users: { listStudents: async () => [] } }) as unknown as CanvasClient,
      }
      const result = await runSweep('list_students', unarmed)
      expect(result.verdict).toBe('VACUOUS')
    })

    it('classifies an unwrapped handler LEAK, with the path of the surviving name', async () => {
      // The flag-on arm must be capable of going red. A pseudonymizer that is
      // disabled in BOTH modes stands in for a handler that forgot to wrap:
      // the payload is identical, only the scrub is missing.
      const unwrapped: MarkedNameFixture = {
        ...MARKED_NAME_FIXTURES.list_students,
        buildPseudonymizer: () => buildSweepPseudonymizer(false),
      }
      const result = await runSweep('list_students', unwrapped)
      expect(result.verdict).toBe('LEAK')
      expect(result.surviving.map((s) => s.path)).toContain('[0].name')
    })

    it('classifies the verdicts from the control/survivor counts alone', () => {
      const site = { path: 'x', mark: 'REAL_NAME_1' }
      expect(classifyVerdict([], [])).toBe('VACUOUS')
      expect(classifyVerdict([], [site])).toBe('VACUOUS')
      expect(classifyVerdict([site], [site])).toBe('LEAK')
      expect(classifyVerdict([site], [])).toBe('CLEAN')
    })
  })

  describe('the sweep reads what a client reads', () => {
    it('finds a mark nested anywhere, including inside a longer string', () => {
      const found = findMarks({ a: [{ b: 'x REAL_NAME_1 y' }], c: 'REAL_NAME_2@school.example' })
      expect(found).toEqual([
        { path: 'a[0].b', mark: 'REAL_NAME_1' },
        { path: 'c', mark: 'REAL_NAME_2' },
      ])
    })

    it('terminates on a cyclic payload rather than throwing like JSON.stringify would', () => {
      const node: Record<string, unknown> = { name: 'REAL_NAME_1' }
      node.self = node
      expect(findMarks(node)).toEqual([{ path: 'name', mark: 'REAL_NAME_1' }])
      expect(() => JSON.stringify(node)).toThrow()
    })
  })
})
