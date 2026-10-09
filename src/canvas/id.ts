/**
 * The canonical Canvas identifier input type.
 *
 * Phase 1, PR 1a of the 64-bit identifier design
 * (`docs/superpowers/specs/2026-10-05-bru-2730-canvas-64bit-identifiers.md`,
 * BRU-2730 / BRU-2816). This module adds the type and nothing else: no call
 * site adopts it yet, which is PR 1b.
 *
 * The defect it exists to fix is that a Canvas object whose global ID exceeds
 * `Number.MAX_SAFE_INTEGER` — every object on shard >= 901 — cannot be
 * addressed at all today. `JSON.parse('{"course_id":9007199254740993}')`,
 * which is what every MCP transport does to wire bytes, silently yields
 * `…992` and the request succeeds against the wrong object; the string form
 * that *would* carry the value exactly is rejected, because the schema is
 * `z.number()`.
 *
 * ## Why a string and not `string | number`
 *
 * Per §4.1: with `type CanvasId = string | number` on **both** sides of a
 * comparison, `a === b` is legal TypeScript and `false` at runtime whenever
 * the two representations differ. The compiler catches only the asymmetric
 * cases, and this codebase has 14 ID-to-ID comparisons in `src/tools/**`
 * plus 18 `Map<number, …>` / `Set<number>` occurrences — exactly where the
 * union would go blind. One canonical representation makes those correct by
 * construction and makes the arithmetic sites fail to compile, which is
 * where a human decision is wanted.
 *
 * ## Why the checks are composed the way they are
 *
 * Every departure from the obvious composition is load-bearing and has a
 * measurement behind it (§4.2.1): the `{ abort: true }` on the pattern check
 * (N1), the per-member error messages rather than one union-level message
 * (N3), and the fact that the `.transform()` makes the emitted JSON Schema
 * available only under `io: 'input'` (N2). `tests/canvas/id-input-wire.test.ts`
 * holds the wire-level assertion for each; reverting any one of them fails a
 * named, disjoint set of tests.
 */
import { z } from 'zod'

/**
 * Canvas's own ceiling, not a value chosen here: `MAX_ID = 2**63 - 1` in
 * `lib/api.rb`, alongside `MAX_ID_LENGTH = 19` and
 * `ID_REGEX = /\A\d{1,19}\z/`.
 */
export const CANVAS_MAX_ID = 9223372036854775807n

/**
 * The largest ID a JSON **number** can carry without ambiguity. Above this,
 * the value and its neighbour are the same double, so a number is no longer
 * a faithful representation and the string form is the only one that works.
 */
export const MAX_SAFE_CANVAS_NUMBER_ID = Number.MAX_SAFE_INTEGER

/**
 * Canvas's `ID_REGEX` minus leading zeros. Canvas tolerates `"007"`
 * (`\d{1,19}` then `.to_i`); we do not, because one object must have exactly
 * one canonical string or `Map` keys fork and §4.1's whole argument is
 * defeated.
 */
const CANONICAL_DECIMAL_ID = /^[1-9][0-9]{0,18}$/

/** A Canvas identifier in canonical form: a decimal string, no sign, no leading zeros. */
export type CanvasId = string

/**
 * What the **wire** may carry, for use in `src/canvas/types.ts` before
 * normalization. Never let this escape the HTTP client boundary (§4.1).
 */
export type CanvasWireId = string | number

export interface CanvasIdInputOptions {
  /**
   * Non-ID literals this call site accepts in an ID position — Canvas's
   * `"self"` and `"all"`. Only the literals a call site explicitly declares
   * are accepted; declaring one does not open the field to arbitrary strings.
   */
  readonly sentinels?: readonly string[]
  /**
   * Canvas SIS-style alternate identifier prefixes this call site accepts,
   * written **without** the trailing colon: `['sis_user_id']` accepts
   * `"sis_user_id:A1234"` and nothing else that is not already a Canvas ID.
   *
   * This option is PR 1b's resolution of PR #395 correction C4. Four call
   * sites in `src/tools/outcomes.ts` document and accept
   * `"sis_user_id:<sis id>"`, which `sentinels` cannot express: a sentinel is
   * an exact literal, and the SIS identifier after the colon is free-form.
   * Dropping the form would break tools that work today, and accepting any
   * string would reintroduce exactly what §4.1 exists to remove, so the
   * prefix is **declared per call site** on the same terms as a sentinel.
   *
   * The remainder after the colon is deliberately unconstrained beyond being
   * non-empty: a Canvas SIS ID is an arbitrary institution-assigned string,
   * and Canvas itself splits on the first colon and passes the rest through
   * (`Api.sis_parse_id`). A prefixed value is returned unchanged, so it is
   * never confused with a canonical numeric ID.
   */
  readonly prefixes?: readonly string[]
}

/** The subset of a Zod issue the messages below read. */
interface IdIssueContext {
  readonly input: unknown
  readonly path?: ReadonlyArray<PropertyKey> | undefined
}

/** Longest rendering of a received value admitted into a message. */
const MAX_RECEIVED_CHARS = 42

function describeReceived(value: unknown): string {
  if (typeof value === 'string') {
    const quoted = JSON.stringify(value)
    return quoted.length > MAX_RECEIVED_CHARS ? `${quoted.slice(0, MAX_RECEIVED_CHARS)}…` : quoted
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value)
  }
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  return Array.isArray(value) ? 'an array' : `a ${typeof value}`
}

/**
 * The field name to lead the message with. The **last string** segment, not
 * `path.join('.')`: inside a `canvasIdList()` the path is
 * `['student_ids', 3]`, and `student_ids` is the name the caller wrote. The
 * MCP SDK appends the full path to the message separately, so no information
 * is lost.
 */
function issueLabel(path: ReadonlyArray<PropertyKey> | undefined): string {
  for (let index = (path?.length ?? 0) - 1; index >= 0; index -= 1) {
    const segment = path?.[index]
    if (typeof segment === 'string') return segment
  }
  return 'value'
}

/**
 * The message a caller hitting the precision bug sees. Set on each union
 * **member** as well as on the union, because a union-level `error` does not
 * reach a member's own issues: without this, `9007199254740992` yields
 * `Too big: expected int to be <=9007199254740991`, which names neither the
 * received value nor the remedy (§4.2.1 N3).
 */
function contractMessage(issue: IdIssueContext): string {
  return (
    `${issueLabel(issue.path)} must be a Canvas ID: a positive integer at or below ` +
    `${MAX_SAFE_CANVAS_NUMBER_ID}, or a decimal string for larger IDs ` +
    `(received ${describeReceived(issue.input)}). ` +
    `Pass large IDs as strings, e.g. "9010000000000001".`
  )
}

/**
 * The string arm's range failure. A separate message because the "pass it as
 * a string" remedy does not apply here — the value is above Canvas's own
 * `MAX_ID`, so no representation can address it. Without a message of its
 * own the `.refine` reports a bare `custom` / `Invalid input` (§4.2.1 N3).
 */
function ceilingMessage(issue: IdIssueContext): string {
  return (
    `${issueLabel(issue.path)} must be a Canvas ID at or below ${CANVAS_MAX_ID}, ` +
    `the largest value Canvas can store (received ${describeReceived(issue.input)}).`
  )
}

/**
 * Exactly `z.number().int().positive()`, which in Zod 4 is a **safe-integer**
 * check and therefore already rejects `2**53` with `too_big` — not
 * hand-rolled, per §4.2 rule 1.
 */
function numberArm(): z.ZodType<number, unknown> {
  return z.number().int({ error: contractMessage }).positive({ error: contractMessage })
}

/**
 * `{ abort: true }` is not a style preference. Zod 4 runs *all* checks on a
 * string schema and collects issues rather than short-circuiting, so without
 * it the `.refine` below calls `BigInt()` on values the pattern has already
 * rejected — and `BigInt('7.0')` throws a `SyntaxError` that escapes
 * `safeParse` *and* the enclosing union, surfacing to the caller as an
 * internal message instead of an `-32602` (§4.2.1 N1).
 *
 * The `.refine` deliberately calls `BigInt` unguarded, so that removing the
 * abort flag is observable rather than silently compensated for.
 */
function stringArm(): z.ZodType<string, unknown> {
  return z
    .string()
    .regex(CANONICAL_DECIMAL_ID, { abort: true, error: contractMessage })
    .refine((value) => BigInt(value) <= CANVAS_MAX_ID, {
      error: ceilingMessage,
    })
}

/**
 * The message a declared SIS prefix publishes when the value starts with the
 * prefix but carries nothing after the colon. Its own message for the same
 * reason `ceilingMessage` has one: a union-level `error` does not reach a
 * member's issues (§4.2.1 N3).
 */
function prefixMessage(prefix: string): (issue: IdIssueContext) => string {
  return (issue) =>
    `${issueLabel(issue.path)} may be a Canvas ID, or an SIS identifier written ` +
    `"${prefix}:<sis id>" with a non-empty SIS id (received ${describeReceived(issue.input)}).`
}

/** Escapes every ECMAScript regex metacharacter, so a prefix matches literally. */
function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * One declared SIS-prefix arm. A `.regex` rather than a `.startsWith` +
 * `.refine` so that the accepted form is **published** in the emitted JSON
 * Schema as a `pattern` — §9's argument for a self-documenting schema applies
 * to this arm as much as to the canonical one. `[\s\S]` rather than `.` so a
 * literal newline inside an institution-assigned SIS id is not silently a
 * rejection the pattern does not explain.
 */
function prefixedArm(prefix: string): z.ZodType<string, unknown> {
  return z.string().regex(new RegExp(`^${escapeForRegExp(prefix)}:[\\s\\S]+$`), {
    error: prefixMessage(prefix),
  })
}

/**
 * A required Canvas identifier input. Accepts a safe positive integer or a
 * canonical decimal string, and always yields the canonical decimal string.
 *
 * ```ts
 * course_id: canvasIdInput()
 * user_id: canvasIdInput({ sentinels: ['self'] }).optional()
 * user_ids: canvasIdList({ prefixes: ['sis_user_id'] }).optional()
 * ```
 */
export function canvasIdInput(options?: CanvasIdInputOptions): z.ZodType<CanvasId, unknown> {
  const sentinels = options?.sentinels ?? []
  const members = [
    numberArm(),
    stringArm(),
    ...(options?.prefixes ?? []).map(prefixedArm),
    ...(sentinels.length > 0 ? [z.literal([...sentinels])] : []),
  ] as [z.ZodType<unknown, unknown>, z.ZodType<unknown, unknown>, ...z.ZodType<unknown, unknown>[]]

  return z.union(members, { error: contractMessage }).transform((value) => String(value))
}

/**
 * A list of Canvas identifiers. Sentinels are **per element**, which is how
 * Canvas takes them (`student_ids[]=all`), so a declared sentinel may appear
 * alongside real IDs in the same list.
 */
export function canvasIdList(options?: CanvasIdInputOptions): z.ZodType<CanvasId[], unknown> {
  return z.array(canvasIdInput(options))
}

/**
 * Numeric ordering of two canonical Canvas IDs, without `Number()`.
 *
 * `a - b` is the obvious thing and is exactly what §4.4 forbids: it rounds both
 * operands above `2**53` and can order two distinct IDs as equal. Because a
 * `CanvasId` is a decimal string with no sign and no leading zeros, "shorter is
 * smaller, same length compares lexicographically" is total and exact at any
 * magnitude — no `BigInt` allocation per comparison.
 *
 * Sentinel and SIS-prefixed values are not decimal and sort after the numeric
 * ones by the same rule; no call site mixes them into a sort today.
 */
export function compareCanvasIds(a: CanvasId, b: CanvasId): number {
  if (a.length !== b.length) return a.length - b.length
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * The Phase 1 → Phase 2 bridge, and deliberately the narrowest thing that
 * works.
 *
 * PR 1b migrates the **input** side: every ID a caller supplies is a
 * `CanvasId`, and every `src/canvas/` parameter takes one. Response types are
 * still `number` until PR 2a (§8 ordering constraint — PR 1b widens only
 * `CourseSearchResult`). So a tool that reads an ID out of one Canvas response
 * and passes it into the next request now meets a `CanvasId` parameter with a
 * `number` in hand.
 *
 * `String()` is loss-free in that direction: the rounding, if any, already
 * happened inside `JSON.parse` on the response body, and no Canvas ID is large
 * enough for `String()` to emit exponential notation (that starts at `1e21`;
 * `MAX_ID` is ~9.2e18). The remaining precision loss is exactly what PR 2a
 * removes, and it is **not** `Number(id)` — the direction §4.4 forbids.
 *
 * Named rather than written inline so the transitional sites are greppable:
 * PR 2a's work is to widen the response types and delete every call to this
 * function. A bare `String(x)` would hide that list.
 */
export function canvasIdFromResponse(value: CanvasWireId): CanvasId {
  return String(value)
}

/**
 * The same §4.2 rules, callable outside a Zod parse — for code that receives
 * an identifier from somewhere other than a tool input schema.
 *
 * Returns the canonical decimal string, or throws a `TypeError` carrying the
 * same message the schema would publish. Throws rather than returning a
 * result object so that a caller cannot accidentally thread a non-canonical
 * value onward, which is the failure §4.1 exists to prevent.
 */
export function normalizeCanvasIdInput(value: unknown, options?: CanvasIdInputOptions): CanvasId {
  const issue: IdIssueContext = { input: value }

  if (typeof value === 'string') {
    if (options?.sentinels?.includes(value)) return value
    // A declared SIS prefix is matched by `startsWith`, not by the published
    // pattern, so this path needs no escaping to be correct — and a prefix
    // containing a regex metacharacter cannot diverge between the two.
    for (const prefix of options?.prefixes ?? []) {
      if (!value.startsWith(`${prefix}:`)) continue
      if (value.length === prefix.length + 1) throw new TypeError(prefixMessage(prefix)(issue))
      return value
    }
    // Order matters, for the same reason `{ abort: true }` does above: a
    // `BigInt` call on a non-numeric string throws a SyntaxError, so the
    // pattern check has to come first (§4.2.1 N1, outside Zod).
    if (!CANONICAL_DECIMAL_ID.test(value)) throw new TypeError(contractMessage(issue))
    if (BigInt(value) > CANVAS_MAX_ID) throw new TypeError(ceilingMessage(issue))
    return value
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(contractMessage(issue))
    return String(value)
  }

  throw new TypeError(contractMessage(issue))
}
