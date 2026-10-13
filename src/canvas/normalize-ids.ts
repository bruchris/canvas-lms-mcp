/**
 * Response-side Canvas identifier normalization.
 *
 * Phase 2, PR 2a of the 64-bit identifier design
 * (`docs/superpowers/specs/2026-10-05-bru-2730-canvas-64bit-identifiers.md`
 * §4.3, BRU-2730 / BRU-2828). Every parsed Canvas response body passes through
 * `normalizeCanvasIds()` on all three `CanvasHttpClient` paths, so that after
 * the HTTP boundary **every identifier in the process is a `CanvasId` string**
 * — the same representation `canvasIdInput()` produces on the way in.
 *
 * ## Why this runs unconditionally, and lands before the Accept header
 *
 * Canvas offers `Accept: application/json+canvas-string-ids`, which stringifies
 * response IDs. On its own it is **not** a drop-in, and the measurement that
 * settles it is a grade:
 *
 * `StringifyIds.recursively_stringify_ids` converts a value only when the key
 * matches `/(^|_)id$/i` (scalar) or `/(^|_)ids$/i` (array). Canvas's
 * `assignment_group.rules.never_drop` holds a list of assignment IDs and
 * matches neither, so the header leaves it numeric while stringifying the
 * sibling `assignment.id` it is compared against. `src/tools/grade-engine.ts`
 * builds `new Set(rules.never_drop)` and tests `has(assignment.id)`, so every
 * pinned assignment silently becomes droppable: on the §2.3.1 fixture the
 * reported course grade moves from **47.5 to 92.5**, with no error and no log
 * line. `explain_grade` and `project_grade` share that engine.
 *
 * So the normalization must be uniform, and it must hold whether or not the
 * header was sent. Then PR 2b's header becomes a pure precision improvement
 * rather than a semantic change, and it can be turned on and off without
 * changing any join. The order is not negotiable: normalization first.
 *
 * ## Why the key policy is Canvas's regexes *plus* an explicit exception list
 *
 * The two regexes are the right base — on today's `types.ts` no field whose
 * name matches `(^|_)ids?$` is a quantity, so the over-match risk on them is
 * zero (§3.1). But they miss 12 identifier fields (§3.2), and those are exactly
 * the ones that fail a join silently. The over-match risk on the *exceptions*
 * is **not** zero, which is why they carry a parent scope (§4.3).
 *
 * `tests/canvas/normalize-ids.test.ts` asserts the inverse of this list
 * directly against `src/canvas/types.ts`: no numeric field may remain that this
 * module would convert. That is the soundness gate — a field this module
 * stringifies while `types.ts` still declares it `number` is a declared type
 * that lies.
 */

/** Canvas's scalar key rule, from `gems/stringify_ids`. */
const SCALAR_ID_KEY = /(^|_)id$/i

/** Canvas's array key rule, from `gems/stringify_ids`. */
const ARRAY_ID_KEY = /(^|_)ids$/i

/**
 * The parent of a property at the top of a response body, where there is no
 * enclosing key. A distinct value rather than `null` so that an exception
 * declaring it reads as a deliberate choice about a wire shape.
 */
export const RESPONSE_ROOT = Symbol('canvas response root')
export type ResponseParent = string | typeof RESPONSE_ROOT

export interface IdFieldException {
  /** The property name, exactly as Canvas spells it on the wire. */
  readonly name: string
  /** `scalar` for a single identifier, `array` for a list of them. */
  readonly kind: 'scalar' | 'array'
  /**
   * The nearest enclosing property names this exception applies under, or
   * `'any'` where the name is unique enough across Canvas's payloads that a
   * scope would add no safety. Array indices are transparent: the parent of a
   * property inside `graders: [{…}]` is `graders`.
   */
  readonly parents: 'any' | readonly ResponseParent[]
  /** Why Canvas's own regexes miss it, and what breaks if it is left numeric. */
  readonly why: string
}

/**
 * The 12 identifier fields of §3.2, as 11 entries — `links.user` covers both
 * `CanvasOutcomeResult.links.user` and `CanvasOutcomeRollup.links.user`.
 *
 * Exported so the tests can assert a count floor on it: §8 requires that an
 * entry cannot be silently dropped, because dropping one reintroduces a silent
 * join failure rather than a visible error.
 */
export const ID_FIELD_EXCEPTIONS: readonly IdFieldException[] = [
  {
    name: 'never_drop',
    kind: 'array',
    parents: 'any',
    why: 'Assignment IDs pinned against `drop_lowest`. The §2.3 grade divergence: left numeric, every pinned assignment silently becomes droppable.',
  },
  {
    name: 'assignment_visibility',
    kind: 'array',
    parents: 'any',
    why: 'User IDs a differentiated assignment is visible to. Left numeric, visibility checks silently come back empty.',
  },
  {
    name: 'assignments',
    // `GradebookHistoryModule.listDays()` returns `[{date, graders: [...]}]`,
    // but `getDay()` returns the grader array *at the response root* with no
    // `graders` key at all. Scoping this to `graders` alone would silently miss
    // `get_gradebook_history_day` — the §4.3 instruction to path-scope this
    // field is right, but one parent is not enough to cover its two call sites.
    kind: 'array',
    parents: [RESPONSE_ROOT, 'graders'],
    why: 'Assignment IDs a grader touched, on `CanvasGradebookHistoryGrader` only. Left numeric, gradebook-history joins silently miss.',
  },
  {
    name: 'courseId',
    kind: 'scalar',
    parents: 'any',
    why: 'Dashboard cards are the one camelCase payload Canvas returns; `(^|_)id$` needs `^id` or `_id`, and `courseId` matches neither.',
  },
  {
    name: 'answer',
    // Scoped to the envelope key `getSubmissionAnswers()` reads, because a bare
    // name match would reach free-text answers in unrelated payloads (§4.3).
    kind: 'scalar',
    parents: ['quiz_submission_questions'],
    why: 'An answer ID for choice question types. See the polymorphism note below — this field is not an identifier for every question type.',
  },
  {
    name: 'course',
    kind: 'scalar',
    parents: ['links'],
    why: "An outcome rollup's course ID. The three `links` objects in types.ts are all outcome-related; these member names are far too generic to match unscoped.",
  },
  {
    name: 'user',
    kind: 'scalar',
    parents: ['links'],
    why: "An outcome rollup's and an outcome result's user ID — two field sites, one entry.",
  },
  {
    name: 'section',
    kind: 'scalar',
    parents: ['links'],
    why: "An outcome rollup's course-section ID.",
  },
  {
    name: 'learning_outcome',
    kind: 'scalar',
    parents: ['links'],
    why: "An outcome result's outcome ID. Already `string | number` on the wire, which is itself evidence that Canvas's outcomes endpoints return these as strings on some paths.",
  },
  {
    name: 'alignment',
    kind: 'scalar',
    parents: ['links'],
    why: "An outcome result's alignment ID. Already `string | number`.",
  },
  {
    name: 'outcome',
    kind: 'scalar',
    parents: ['links'],
    why: "An outcome rollup score's outcome ID. Its own siblings `score` and `count` are quantities in the same object — the clearest illustration of why this has to be field-level, not type-level.",
  },
]

/**
 * `answer` is the one exception whose field is **polymorphic by question type**,
 * and §3.2's description of it ("an answer ID for choice questions") is not the
 * whole story: a `numerical_question` answer is a quantity, and
 * `CanvasQuizSubmissionQuestion` carries no `question_type` to discriminate on.
 *
 * `Number.isInteger` is therefore the only guard available, which bounds the
 * blast radius to *integral* numerical answers: `42.5` survives as a number,
 * `42` becomes `"42"`. The field's declared type already admits `string`, its
 * sole consumer (`src/tools/quiz-question-responses.ts`) passes it straight
 * into a text payload without joining on it, and the alternative — dropping it
 * from the list — leaves choice-question answer IDs unjoinable, which is the
 * failure §4.3 exists to remove. Recorded here rather than left implicit.
 */

type ExceptionIndex = ReadonlyMap<string, 'any' | ReadonlySet<ResponseParent>>

function indexExceptions(kind: IdFieldException['kind']): ExceptionIndex {
  const index = new Map<string, 'any' | ReadonlySet<ResponseParent>>()
  for (const exception of ID_FIELD_EXCEPTIONS) {
    if (exception.kind !== kind) continue
    index.set(exception.name, exception.parents === 'any' ? 'any' : new Set(exception.parents))
  }
  return index
}

const SCALAR_EXCEPTIONS = indexExceptions('scalar')
const ARRAY_EXCEPTIONS = indexExceptions('array')

function isExcepted(index: ExceptionIndex, key: string, parent: ResponseParent): boolean {
  const parents = index.get(key)
  if (parents === undefined) return false
  return parents === 'any' || parents.has(parent)
}

/**
 * Canvas's own conversion guard: only an `Integer` becomes a string. A float
 * under an identifier key is not an identifier, and stringifying it would be a
 * quantity change rather than a representation change.
 */
function normalizeScalar(value: unknown): unknown {
  return typeof value === 'number' && Number.isInteger(value) ? String(value) : value
}

function visit(node: unknown, parent: ResponseParent): void {
  if (Array.isArray(node)) {
    // Array indices are transparent: the members of an object inside
    // `graders: [{…}]` have `graders` as their parent, not an index.
    for (const item of node) {
      if (item !== null && typeof item === 'object') visit(item, parent)
    }
    return
  }
  if (node === null || typeof node !== 'object') return

  const record = node as Record<string, unknown>
  for (const key of Object.keys(record)) {
    const value = record[key]

    if (typeof value === 'number') {
      if (SCALAR_ID_KEY.test(key) || isExcepted(SCALAR_EXCEPTIONS, key, parent)) {
        record[key] = normalizeScalar(value)
      }
      continue
    }

    if (Array.isArray(value)) {
      if (ARRAY_ID_KEY.test(key) || isExcepted(ARRAY_EXCEPTIONS, key, parent)) {
        for (let index = 0; index < value.length; index += 1) {
          value[index] = normalizeScalar(value[index])
        }
      }
      visit(value, key)
      continue
    }

    if (value !== null && typeof value === 'object') visit(value, key)
  }
}

/**
 * Rewrites every Canvas identifier in a parsed response body to its canonical
 * decimal string, **in place**, and returns the same reference.
 *
 * In place because this runs on every response on every path: a structural copy
 * would double the allocation of the largest thing the client handles, and
 * nothing holds a reference to the pre-normalization body (it is the direct
 * result of `response.json()`).
 */
export function normalizeCanvasIds<T>(body: T): T {
  visit(body, RESPONSE_ROOT)
  return body
}
