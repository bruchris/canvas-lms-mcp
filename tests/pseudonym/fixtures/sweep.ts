import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CanvasClient } from '../../../src/canvas'
import { Pseudonymizer } from '../../../src/pseudonym/pseudonymizer'
import { getAllTools } from '../../../src/tools'
import type { PseudonymizationModeFixture } from '../../tools/fixtures/output-fixtures'
import { findMarkedKeys, findMarks, type MarkSite } from './marks'

/**
 * Host the sweep's pseudonym maps are keyed by. Any parseable origin works;
 * what matters is that it *is* parseable — `normalizeHost` returning `null`
 * makes every `anonymize*` method a pass-through, which would turn the whole
 * sweep red for a reason that has nothing to do with the code under test.
 */
export const SWEEP_BASE_URL = 'https://fixture.instructure.com/api/v1'

/**
 * Where the current sweep's `Pseudonymizer` writes its map. Set by
 * {@link runSweep} around each fixture and nulled afterwards.
 *
 * The null default is load-bearing. `Pseudonymizer` takes `rootDir`, and an
 * omitted (or misspelled) one silently falls back to the real user state
 * directory — which pollutes live pseudonym maps and makes numbering jump in a
 * way that reads as a bug in the code under test (BRU-3146 §10). Throwing
 * instead of defaulting makes that failure impossible to repeat quietly.
 */
let sweepRootDir: string | null = null

/**
 * The shared `buildPseudonymizer` every fixture uses. `enabled` maps to
 * `CANVAS_PSEUDONYMIZE_STUDENTS`, exactly as
 * {@link PseudonymizationModeFixture.buildPseudonymizer} declares.
 */
export const buildSweepPseudonymizer = (enabled: boolean): Pseudonymizer => {
  if (sweepRootDir === null) {
    throw new Error(
      'buildSweepPseudonymizer called outside runSweep: no temp rootDir is set, and ' +
        'falling back to the real user state directory would pollute live pseudonym maps',
    )
  }
  return new Pseudonymizer({
    baseUrl: SWEEP_BASE_URL,
    rootDir: sweepRootDir,
    env: enabled ? { CANVAS_PSEUDONYMIZE_STUDENTS: 'true' } : {},
  })
}

/**
 * One marked-name fixture: the Canvas payload a tool's endpoint returns, with
 * every person's name written as `REAL_NAME_<n>`.
 *
 * `buildCanvas` and `buildPseudonymizer` are reused from the registry type
 * `PseudonymizationModeFixture` (BRU-3146 §1.3) rather than redeclared, so
 * there is one dual-mode fixture shape in the repo and not two. Its third
 * member, `readPseudonymizedField`, is deliberately *not* reused: it asks the
 * author which field to read, and the whole point of a mark is that the oracle
 * reads every field without being told which one matters.
 */
export interface MarkedNameFixture {
  /** Arguments for the tool call. */
  args: Record<string, unknown>
  /** A Canvas mock serving the payload, with person names marked. */
  buildCanvas: PseudonymizationModeFixture['buildCanvas']
  /** A Pseudonymizer for the given mode; normally {@link buildSweepPseudonymizer}. */
  buildPseudonymizer: PseudonymizationModeFixture['buildPseudonymizer']
}

/**
 * - `CLEAN`   — the control fired and no mark survived pseudonymized mode.
 * - `VACUOUS` — no mark reached the output even unpseudonymized, so the
 *   flag-on assertion proves nothing. Reported as a failure, never a pass:
 *   a traversal that silently finds nothing is the failure mode this whole
 *   design exists to kill (§5.1).
 * - `LEAK`    — a real name survived with pseudonymization on.
 */
export type Verdict = 'CLEAN' | 'VACUOUS' | 'LEAK'

export interface SweepResult {
  name: string
  verdict: Verdict
  /** Marks visible with the flag OFF. Non-empty is what arms the assertion. */
  control: MarkSite[]
  /** Marks still visible with the flag ON. Non-empty is a leak. */
  surviving: MarkSite[]
  /**
   * Marks found in a *key* position in the unpseudonymized payload (§5.4).
   * Always expected empty; read off the flag-OFF run because that is the
   * payload the fixture authored, before any `anonymize*` method touched it.
   */
  controlKeys: MarkSite[]
}

export function classifyVerdict(
  control: ReadonlyArray<MarkSite>,
  surviving: ReadonlyArray<MarkSite>,
): Verdict {
  if (control.length === 0) return 'VACUOUS'
  return surviving.length > 0 ? 'LEAK' : 'CLEAN'
}

function resolveTool(canvas: CanvasClient, pseudonymizer: Pseudonymizer, name: string) {
  const tool = getAllTools(canvas, pseudonymizer).find((t) => t.name === name)
  if (!tool) throw new Error(`${name} is not registered by getAllTools(canvas, pseudonymizer)`)
  return tool
}

/**
 * Run one fixture in both modes and classify it.
 *
 * Each call gets its own temp `rootDir`, so a fixture's verdict cannot depend
 * on which fixtures ran before it. That is not hygiene theatre:
 * `anonymizeSubmission` rewrites a comment's `author_name` only when that
 * author is already in the scope's map, so a shared map would let one fixture
 * warm another's and hide a real single-payload leak.
 */
export async function runSweep(name: string, fixture: MarkedNameFixture): Promise<SweepResult> {
  const root = await mkdtemp(join(tmpdir(), 'pseudonym-sweep-'))
  sweepRootDir = root
  try {
    const off = await resolveTool(
      fixture.buildCanvas(),
      fixture.buildPseudonymizer(false),
      name,
    ).handler(fixture.args)
    const on = await resolveTool(
      fixture.buildCanvas(),
      fixture.buildPseudonymizer(true),
      name,
    ).handler(fixture.args)
    const control = findMarks(off)
    const surviving = findMarks(on)
    return {
      name,
      verdict: classifyVerdict(control, surviving),
      control,
      surviving,
      controlKeys: findMarkedKeys(off),
    }
  } finally {
    sweepRootDir = null
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
