/**
 * PR 2a of the 64-bit identifier design
 * (`docs/superpowers/specs/2026-10-05-bru-2730-canvas-64bit-identifiers.md`,
 * BRU-2730 / BRU-2828): response-side identifier normalization.
 *
 * The headline assertion is the §2.3 grade regression: a 45-point divergence in
 * a student's reported course grade, with no error and no log line, caused
 * purely by whether Canvas stringified the response. Every other test here
 * exists because the design measured a specific way for the normalizer to be
 * wrong.
 */
import { describe, expect, it } from 'vitest'
import {
  ID_FIELD_EXCEPTIONS,
  normalizeCanvasIds,
  RESPONSE_ROOT,
  type IdFieldException,
} from '../../src/canvas/normalize-ids'
import { computeGroupGrade, percentageOf } from '../../src/tools/grade-engine'
import type { CanvasAssignmentGroup, CanvasSubmission } from '../../src/canvas/types'
import {
  CANVAS_ARRAY_ID_KEY,
  CANVAS_SCALAR_ID_KEY,
  canvasIdLeaves,
  numericLeaves,
} from './helpers/types-leaf-walk'

/**
 * A faithful port of `StringifyIds.recursively_stringify_ids` at the pinned
 * Canvas SHA (§2.3). Used to produce the "header on" half of every round-trip
 * assertion, so that both halves of §4.3's "it must run whether or not the
 * header was sent" are exercised against the same fixture.
 */
function canvasStringifyIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canvasStringifyIds)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
      if (CANVAS_SCALAR_ID_KEY.test(key) && Number.isInteger(member)) out[key] = String(member)
      else if (CANVAS_ARRAY_ID_KEY.test(key) && Array.isArray(member)) {
        out[key] = member.map((x) => (Number.isInteger(x) ? String(x) : canvasStringifyIds(x)))
      } else out[key] = canvasStringifyIds(member)
    }
    return out
  }
  return value
}

/** Normalizes a deep clone, so a fixture can be reused across both modes. */
function normalized(body: unknown): unknown {
  return normalizeCanvasIds(structuredClone(body))
}

/** Normalizes the Canvas-stringified form of the same body. */
function normalizedStringified(body: unknown): unknown {
  return normalizeCanvasIds(canvasStringifyIds(structuredClone(body)))
}

describe("normalizeCanvasIds: Canvas's own key regexes", () => {
  it('converts scalar `*_id` integers to canonical decimal strings', () => {
    expect(normalized({ id: 7, course_id: 7, user_id: 4 })).toEqual({
      id: '7',
      course_id: '7',
      user_id: '4',
    })
  })

  it('converts array `*_ids` integer members', () => {
    expect(normalized({ student_ids: [5, 6] })).toEqual({ student_ids: ['5', '6'] })
  })

  it('reaches identifiers nested in objects and arrays', () => {
    expect(normalized({ nested: [{ user_id: 4, score: 95.5 }] })).toEqual({
      nested: [{ user_id: '4', score: 95.5 }],
    })
  })

  it('leaves a non-integer in an identifier position alone, as Canvas does', () => {
    // `Number.isInteger` is Canvas's own guard. A float under an ID key is not
    // an identifier, and silently stringifying it would be a quantity change.
    expect(normalized({ id: 1.5 })).toEqual({ id: 1.5 })
  })

  it('leaves `null` and string identifiers untouched', () => {
    expect(normalized({ id: null, course_id: '9010000000000001' })).toEqual({
      id: null,
      course_id: '9010000000000001',
    })
  })

  it('does not apply the scalar rule to an array value, nor the array rule to a scalar', () => {
    // Canvas's two rules are disjoint by shape as well as by name: the scalar
    // rule requires an Integer and the array rule requires an Array.
    expect(normalized({ id: [1, 2], student_ids: 5 })).toEqual({ id: [1, 2], student_ids: 5 })
  })

  it('never emits exponential notation for any value Canvas can store', () => {
    // `String()` switches to exponential at 1e21 and Canvas's MAX_ID is ~9.2e18,
    // so the whole representable range is safe. Asserted rather than assumed,
    // because it is what makes a plain `String()` the right conversion here.
    // Written as exponentials where a decimal literal would itself lose
    // precision at parse time (and trip `no-loss-of-precision`).
    for (const value of [2 ** 53, 9.2e18, 1e18, 9.1e18]) {
      const result = normalizeCanvasIds({ id: value }) as { id: string }
      expect(result.id).not.toContain('e')
    }
  })

  it('does not pretend to recover precision the response already lost', () => {
    // Without PR 2b's Accept header the rounding happens inside `JSON.parse`,
    // before anything we control. Normalization makes the representation
    // uniform; it is not a fix for the rounding, and the test says so, so a
    // reader does not mistake one for the other.
    const body = JSON.parse('{"id":9007199254740993}') as { id: number }

    expect(normalizeCanvasIds(body)).toEqual({ id: '9007199254740992' })
  })

  it('normalizes in place and returns the same reference', () => {
    const body = { id: 7 }
    expect(normalizeCanvasIds(body)).toBe(body)
    expect(body.id).toBe('7')
  })

  it('preserves an identifier above Number.MAX_SAFE_INTEGER that arrived as a string', () => {
    // The shard-901 case. Where Canvas stringified the body, the exact value
    // survives — which is the whole payoff of §4.3 running on every response.
    const body = JSON.parse('{"id":"9010000000000001"}') as { id: string }

    expect(normalizeCanvasIds(body)).toEqual({ id: '9010000000000001' })
  })

  it('cannot recover a large identifier that arrived as a JSON number, and does not hide it', () => {
    // §8's compatibility assertion 5 asks for the stringified and unstringified
    // forms of the same payload to round-trip to the *same* canonical string.
    // The second half of that is **not achievable in PR 2a**, and the reason is
    // structural rather than a gap in this implementation: `response.json()` is
    // `JSON.parse`, so a value above 2**53 is already rounded before any code
    // here runs. Only PR 2b's `Accept: application/json+canvas-string-ids`
    // makes Canvas send the string form in the first place.
    //
    // The value must be built by parsing, never written as a numeric literal:
    // `{ id: 9010000000000001 }` in this file's own source is already
    // `9010000000000000` before the call, so asserting against the literal
    // would be self-confirming.
    const body = JSON.parse('{"id":9010000000000001}') as { id: number }

    expect(normalizeCanvasIds(body)).toEqual({ id: '9010000000000000' })
    expect(normalizeCanvasIds(JSON.parse('{"id":"9010000000000001"}'))).toEqual({
      id: '9010000000000001',
    })
  })

  it('agrees between the two modes for every identifier a JSON number can carry', () => {
    // The achievable half of assertion 5: at or below MAX_SAFE_INTEGER the two
    // representations are interchangeable, which is what makes PR 2b's header a
    // pure precision improvement rather than a semantic change.
    const body = { id: Number.MAX_SAFE_INTEGER, course_id: 7, student_ids: [5, 6] }

    expect(normalized(body)).toEqual(normalizedStringified(body))
    expect(normalized(body)).toEqual({
      id: '9007199254740991',
      course_id: '7',
      student_ids: ['5', '6'],
    })
  })
})

describe('normalizeCanvasIds: the §3.2 misses Canvas does not convert', () => {
  // Each row is one of the 12 identifier fields the two key regexes miss, at
  // the wire path it actually arrives on. A header-only change leaves every one
  // of these numeric, which is why §4.3 normalizes rather than trusting Canvas.
  const rows: ReadonlyArray<{
    field: string
    body: unknown
    expected: unknown
  }> = [
    {
      field: 'CanvasAssignmentGroup.rules.never_drop',
      body: { id: 1, rules: { drop_lowest: 1, never_drop: [101, 102] } },
      expected: { id: '1', rules: { drop_lowest: 1, never_drop: ['101', '102'] } },
    },
    {
      field: 'CanvasAssignment.assignment_visibility',
      body: { id: 1, assignment_visibility: [9, 10] },
      expected: { id: '1', assignment_visibility: ['9', '10'] },
    },
    {
      field: 'CanvasGradebookHistoryGrader.assignments (under `graders`)',
      body: [{ date: '2026-10-09', graders: [{ id: 3, name: 'G', assignments: [101, 102] }] }],
      expected: [
        { date: '2026-10-09', graders: [{ id: '3', name: 'G', assignments: ['101', '102'] }] },
      ],
    },
    {
      field: 'CanvasGradebookHistoryGrader.assignments (at the response root)',
      // `GradebookHistoryModule.getDay()` returns the grader array *at the
      // root*, with no `graders` key. Scoping this exception to a single parent
      // would silently miss `get_gradebook_history_day`.
      body: [{ id: 3, name: 'G', assignments: [101, 102] }],
      expected: [{ id: '3', name: 'G', assignments: ['101', '102'] }],
    },
    {
      field: 'CanvasOutcomeRollup.links.{course,user,section}',
      body: { links: { course: 7, user: 4, section: 11 } },
      expected: { links: { course: '7', user: '4', section: '11' } },
    },
    {
      field: 'CanvasDashboardCard.courseId',
      body: { courseId: 7, shortName: 'X' },
      expected: { courseId: '7', shortName: 'X' },
    },
    {
      field: 'CanvasQuizSubmissionQuestion.answer',
      body: { quiz_submission_questions: [{ id: 1, quiz_id: 2, answer: 4321, flagged: false }] },
      expected: {
        quiz_submission_questions: [{ id: '1', quiz_id: '2', answer: '4321', flagged: false }],
      },
    },
    {
      field: 'CanvasOutcomeResult.links.{user,learning_outcome,alignment}',
      body: { links: { user: 4, learning_outcome: 12, alignment: 13 } },
      expected: { links: { user: '4', learning_outcome: '12', alignment: '13' } },
    },
    {
      field: 'CanvasOutcomeRollupScore.links.outcome',
      // `score` and `count` are this field's own siblings and are quantities.
      // The pair is the point: same object, same `number` type, opposite
      // treatment (§3.3).
      body: { score: 3, count: 2, links: { outcome: 12 } },
      expected: { score: 3, count: 2, links: { outcome: '12' } },
    },
  ]

  for (const row of rows) {
    it(`normalizes ${row.field}`, () => {
      expect(normalized(row.body)).toEqual(row.expected)
    })

    it(`normalizes ${row.field} identically when Canvas already stringified the body`, () => {
      expect(normalizedStringified(row.body)).toEqual(row.expected)
    })
  }

  it('covers every one of the 12 §3.2 fields with an exception entry', () => {
    // A count floor, so an entry cannot be silently dropped (§8 PR 2a). Eleven
    // entries cover twelve field sites: `links.user` is both
    // `CanvasOutcomeResult.links.user` and `CanvasOutcomeRollup.links.user`.
    expect(ID_FIELD_EXCEPTIONS).toHaveLength(11)
    expect(new Set(ID_FIELD_EXCEPTIONS.map((e) => e.name)).size).toBe(11)
  })
})

describe('normalizeCanvasIds: ID_FIELD_EXCEPTIONS cross-checked against declared leaf types', () => {
  // Independent of the `converts` soundness gate above, which only encodes
  // Canvas's own two key regexes and says nothing about this module's own
  // exception list. These assertions instead check the exceptions against
  // `src/canvas/types.ts`'s declared types directly: each entry should name a
  // field actually declared `CanvasId`/`CanvasId[]` there (not a stale or
  // mistyped entry matching nothing), and no field matching an exception name
  // should still be declared `number`/`number[]` (a declared-type regression
  // that would make this module's conversion silently redundant, or worse,
  // paper over a type that lied about what the wire actually carries).
  const idLeaves = canvasIdLeaves()
  const numLeaves = numericLeaves()

  // `answer` is excluded from the ID-shaped check below: it is the one
  // exception whose field is polymorphic by Canvas question type (see the
  // comment above `ID_FIELD_EXCEPTIONS` in normalize-ids.ts) and is declared
  // as `string | number | string[] | Record<string, unknown> | null` rather
  // than `CanvasId` — it already admits `string` directly, which is the
  // property that actually matters and is asserted on its own below.
  const ID_SHAPED_EXCEPTIONS = ID_FIELD_EXCEPTIONS.filter((e) => e.name !== 'answer')

  const matchesException =
    (leaf: { name: string; arrayed: boolean }) =>
    (exception: IdFieldException): boolean =>
      exception.name === leaf.name && leaf.arrayed === (exception.kind === 'array')

  it('every ID-shaped exception entry matches at least one declared CanvasId leaf (name + array/scalar kind)', () => {
    const unmatched = ID_SHAPED_EXCEPTIONS.filter(
      (exception) =>
        !idLeaves.some(
          (leaf) => leaf.name === exception.name && leaf.arrayed === (exception.kind === 'array'),
        ),
    )
    expect(unmatched.map((e) => e.name)).toEqual([])
  })

  it('declares `answer` as a union that already admits string, not a lying number-only type', () => {
    const answerLeaf = numLeaves.find((l) => l.name === 'answer')
    expect(answerLeaf).toBeDefined()
    expect(answerLeaf?.declared).toContain('string')
    expect(answerLeaf?.declared).not.toBe('number')
  })

  it('no field matching an exception name still carries a numeric declaration in types.ts', () => {
    const regressed = numLeaves.filter((leaf) => ID_FIELD_EXCEPTIONS.some(matchesException(leaf)))
    expect(regressed.map((l) => l.path)).toEqual([])
  })

  it('negative control: the numeric-declaration check catches a reverted exception field', () => {
    // A minimal synthetic types.ts snippet where `never_drop` — a real
    // ID_FIELD_EXCEPTIONS entry — regresses from `CanvasId[]` back to the
    // pre-migration `number[]`. This is exactly the drift the assertion above
    // exists to catch; without it, a declared-type regression on an
    // exception field would pass silently because the `converts` soundness
    // gate only checks Canvas's name regexes, which `never_drop` never
    // matches either way.
    const regressedSource = `
      export interface CanvasAssignmentGroup {
        id: CanvasId
        rules?: {
          drop_lowest?: number
          never_drop?: number[]
        }
      }
    `
    const regressedLeaves = numericLeaves(regressedSource)
    const caught = regressedLeaves.filter((leaf) =>
      ID_FIELD_EXCEPTIONS.some(matchesException(leaf)),
    )
    expect(caught.map((l) => l.name)).toEqual(['never_drop'])

    // Control: `drop_lowest` is a genuine quantity (not in ID_FIELD_EXCEPTIONS)
    // and must NOT be flagged by the same check, or the check would be
    // over-broad rather than targeted at the exception list.
    expect(regressedLeaves.some((l) => l.name === 'drop_lowest')).toBe(true)
    expect(caught.map((l) => l.name)).not.toContain('drop_lowest')
  })
})

describe('normalizeCanvasIds: the exceptions are path-scoped, not name-scoped', () => {
  it('does not treat a free-text `answer` outside a quiz-submission payload as an identifier', () => {
    // §4.3: a bare `answer` match would reach unrelated payloads. The scope is
    // the envelope key the field actually arrives under.
    expect(normalized({ answer: 42 })).toEqual({ answer: 42 })
    expect(normalized({ responses: [{ answer: 42 }] })).toEqual({ responses: [{ answer: 42 }] })
  })

  it('leaves a non-integral numerical `answer` alone even in scope', () => {
    // A `numerical_question` answer is a quantity, not an identifier, and
    // `CanvasQuizSubmissionQuestion` carries no `question_type` to discriminate
    // on. `Number.isInteger` is the only guard available, so a fractional
    // answer survives as a number.
    expect(normalized({ quiz_submission_questions: [{ answer: 42.5 }] })).toEqual({
      quiz_submission_questions: [{ answer: 42.5 }],
    })
  })

  it('does not treat an `assignments` array of objects as a list of identifiers', () => {
    expect(normalized({ graders: [{ assignments: [{ id: 101 }] }] })).toEqual({
      graders: [{ assignments: [{ id: '101' }] }],
    })
  })

  it('does not treat `assignments` under an unrelated parent as identifiers', () => {
    expect(normalized({ group: { assignments: [101, 102] } })).toEqual({
      group: { assignments: [101, 102] },
    })
  })

  it('does not treat the generic `links` member names as identifiers elsewhere', () => {
    expect(normalized({ course: 7, user: 4, section: 11, outcome: 12 })).toEqual({
      course: 7,
      user: 4,
      section: 11,
      outcome: 12,
    })
  })

  it('does not let `custom_links` stand in for `links`', () => {
    // `CanvasExternalTool.custom_links` is a different key, and the parent match
    // is on the whole key, not a suffix.
    expect(normalized({ custom_links: { course: 7 } })).toEqual({ custom_links: { course: 7 } })
  })

  it('declares RESPONSE_ROOT as an allowed parent only where a payload needs it', () => {
    const rootScoped = ID_FIELD_EXCEPTIONS.filter(
      (e) => e.parents !== 'any' && e.parents.includes(RESPONSE_ROOT),
    )
    expect(rootScoped.map((e) => e.name)).toEqual(['assignments'])
  })
})

describe('normalizeCanvasIds: the §3.3 quantities are untouched', () => {
  // Derived from `src/canvas/types.ts` by the §3.0 strict-leaf walk rather than
  // from a hand-maintained list, so a new Canvas field cannot slip past it.
  const leaves = numericLeaves()

  it('leaves no numeric field in types.ts that the normalizer would convert', () => {
    // The soundness gate for the whole PR. Any numeric leaf still matched by
    // Canvas's key regexes, or by an exception entry, is declared `number`
    // while arriving as a string — the declared type would be a lie.
    const unsound = leaves.filter((leaf) => leaf.converts)
    expect(unsound.map((l) => l.path)).toEqual([])
  })

  it('finds the quantities, so the assertion above is not vacuous', () => {
    expect(leaves.length).toBeGreaterThanOrEqual(100)
  })

  it('leaves every remaining numeric field in types.ts as a number', () => {
    const body: Record<string, unknown> = {}
    for (const leaf of leaves) body[leaf.name] = 42
    const result = normalizeCanvasIds(body) as Record<string, unknown>
    const changed = Object.keys(result).filter((key) => typeof result[key] !== 'number')
    expect(changed).toEqual([])
  })

  it('leaves `drop_lowest` alone in the same object as the headline `never_drop`', () => {
    expect(normalized({ rules: { drop_lowest: 1, drop_highest: 2, never_drop: [101] } })).toEqual({
      rules: { drop_lowest: 1, drop_highest: 2, never_drop: ['101'] },
    })
  })

  it('leaves points, positions and counts alone next to an identifier', () => {
    expect(
      normalized({ id: 7, position: 3, points_possible: 10, needs_grading_count: 2, score: 95.5 }),
    ).toEqual({ id: '7', position: 3, points_possible: 10, needs_grading_count: 2, score: 95.5 })
  })
})

describe('the §2.3 grade divergence is closed', () => {
  // The fixture is §2.3.1's, unchanged: three assignments with `drop_lowest: 1`
  // and `never_drop: [101]`, and scores 0 / 90 / 95 chosen so that losing the
  // pin flips the dropped item from the 90 to the 0 — a 45-point move in the
  // student's reported grade.
  const GROUP = {
    id: 1,
    name: 'Homework',
    group_weight: 100,
    rules: { drop_lowest: 1, never_drop: [101] },
    assignments: [
      { id: 101, name: 'A', points_possible: 100, grading_type: 'points' },
      { id: 102, name: 'B', points_possible: 100, grading_type: 'points' },
      { id: 103, name: 'C', points_possible: 100, grading_type: 'points' },
    ],
  }
  const SUBS = [
    { id: 1, assignment_id: 101, score: 0, workflow_state: 'graded', excused: false },
    { id: 2, assignment_id: 102, score: 90, workflow_state: 'graded', excused: false },
    { id: 3, assignment_id: 103, score: 95, workflow_state: 'graded', excused: false },
  ]

  function run(stringifiedByCanvas: boolean) {
    const group = (
      stringifiedByCanvas ? normalizedStringified(GROUP) : normalized(GROUP)
    ) as CanvasAssignmentGroup
    const subs = (
      stringifiedByCanvas ? normalizedStringified(SUBS) : normalized(SUBS)
    ) as CanvasSubmission[]
    const byId = new Map(subs.map((s) => [s.assignment_id, s]))
    const result = computeGroupGrade(group, byId, 'current')
    return {
      dropped: result.items.filter((i) => i.dropped).map((i) => i.assignment.id),
      pinned: result.items.filter((i) => i.pinned).map((i) => i.assignment.id),
      earned: result.earned,
      possible: result.possible,
      computedPercentage: percentageOf(result.earned, result.possible),
    }
  }

  const expected = {
    dropped: ['102'],
    pinned: ['101'],
    earned: 95,
    possible: 200,
    computedPercentage: 47.5,
  }

  it('reports 47.5 on an unstringified payload', () => {
    expect(run(false)).toEqual(expected)
  })

  it('reports 47.5 on a Canvas-stringified payload', () => {
    // Before PR 2a this returned 92.5, dropping the 0 instead of the 90,
    // because `new Set(never_drop)` held numbers and `assignment.id` was a
    // string. No error, no log line.
    expect(run(true)).toEqual(expected)
  })

  it('agrees exactly between the two modes', () => {
    expect(run(true)).toEqual(run(false))
  })
})
