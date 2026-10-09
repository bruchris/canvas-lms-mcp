import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  canvasIdInput,
  canvasIdList,
  normalizeCanvasIdInput,
  canvasIdFromResponse,
  compareCanvasIds,
} from '../../src/canvas/id'

/**
 * The three additions PR 1b (BRU-2827) makes to `src/canvas/id.ts`. PR 1a's
 * contract tests live in `id-input.test.ts` and `id-input-wire.test.ts`; this
 * file covers only what 1b added.
 */

const SHARD_901_ID = '9010000000000001'

describe('`prefixes` — PR #395 correction C4, the SIS-prefixed outcomes sites', () => {
  /**
   * Four `src/tools/outcomes.ts` sites and one in `users.ts` document and
   * accept `"sis_user_id:<sis id>"`. `sentinels` cannot express that: a
   * sentinel is an exact literal and the SIS identifier after the colon is
   * free-form. Dropping the form would break tools that work today; accepting
   * any string would reintroduce exactly what §4.1 exists to remove.
   */
  const schema = canvasIdInput({ prefixes: ['sis_user_id'] })

  it('accepts a declared SIS-prefixed identifier, unchanged', () => {
    const parsed = schema.parse('sis_user_id:A1234')

    // Returned verbatim, not normalized: it is not a decimal ID and must never
    // be confused with one.
    expect(parsed).toBe('sis_user_id:A1234')
  })

  it('accepts an SIS id containing characters a decimal ID never has', () => {
    // A Canvas SIS id is an arbitrary institution-assigned string, and Canvas
    // itself splits on the first colon and passes the rest through
    // (`Api.sis_parse_id`), so the remainder is deliberately unconstrained.
    for (const value of ['sis_user_id:a-b_c.1', 'sis_user_id:has space', 'sis_user_id:x:y']) {
      expect(schema.parse(value)).toBe(value)
    }
  })

  it('rejects the prefix with an empty remainder, which addresses nothing', () => {
    const result = schema.safeParse('sis_user_id:')

    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error!.issues)).toContain('non-empty SIS id')
  })

  it('rejects an undeclared prefix, so declaring one does not open the field (§4.2 rule 3)', () => {
    for (const value of ['sis_login_id:abc', 'lti_user_id:abc', 'hex:sis_user_id:ab']) {
      expect(schema.safeParse(value).success, value).toBe(false)
    }
  })

  it('still rejects an arbitrary string, which is the property the whole option has to preserve', () => {
    for (const value of ['abc', '007', '7.0', '', 'self', 'sis_user_idX:1']) {
      expect(schema.safeParse(value).success, value).toBe(false)
    }
  })

  it('still accepts both canonical representations alongside the prefix form', () => {
    expect(schema.parse(42)).toBe('42')
    expect(schema.parse(SHARD_901_ID)).toBe(SHARD_901_ID)
  })

  it('matches a declared prefix LITERALLY, so a regex metacharacter in it cannot widen the pattern', () => {
    // The published pattern is built from the prefix, so the prefix is escaped.
    // Without the escape, `.` would match any character and `a.c` would accept
    // `abc:1` — a declared prefix silently admitting values nobody declared.
    const dotted = canvasIdInput({ prefixes: ['a.c'] })

    expect(dotted.parse('a.c:1')).toBe('a.c:1')
    expect(dotted.safeParse('abc:1').success).toBe(false)
    // The non-regex path must agree, or the two disagree exactly where it matters.
    expect(normalizeCanvasIdInput('a.c:1', { prefixes: ['a.c'] })).toBe('a.c:1')
    expect(() => normalizeCanvasIdInput('abc:1', { prefixes: ['a.c'] })).toThrow(TypeError)
  })

  it('publishes the accepted prefix form as a `pattern`, so the schema is self-documenting (§9)', () => {
    // `{ io: 'input' }` is mandatory — the `.transform()` makes the default
    // mode throw (§4.2.1 N2).
    const json = z.toJSONSchema(schema, { io: 'input' }) as {
      anyOf: Array<Record<string, unknown>>
    }
    const patterns = json.anyOf.filter((m) => typeof m.pattern === 'string').map((m) => m.pattern)

    expect(patterns).toContain('^[1-9][0-9]{0,18}$')
    expect(patterns).toContain('^sis_user_id:[\\s\\S]+$')
  })

  it('`normalizeCanvasIdInput` applies the same prefix rules as the schema', () => {
    expect(normalizeCanvasIdInput('sis_user_id:A1', { prefixes: ['sis_user_id'] })).toBe(
      'sis_user_id:A1',
    )
    expect(() => normalizeCanvasIdInput('sis_user_id:', { prefixes: ['sis_user_id'] })).toThrow(
      /non-empty SIS id/,
    )
    expect(() => normalizeCanvasIdInput('sis_login_id:A1', { prefixes: ['sis_user_id'] })).toThrow(
      TypeError,
    )
  })

  it('`canvasIdList` carries the prefix per element, so SIS and numeric ids mix in one list', () => {
    const list = canvasIdList({ prefixes: ['sis_user_id'] })

    expect(list.parse([1, SHARD_901_ID, 'sis_user_id:A1'])).toEqual([
      '1',
      SHARD_901_ID,
      'sis_user_id:A1',
    ])
    expect(list.safeParse([1, 'abc']).success).toBe(false)
  })

  it('declares no prefix by default, so no existing call site gains the form implicitly', () => {
    expect(canvasIdInput().safeParse('sis_user_id:A1').success).toBe(false)
  })
})

describe('`compareCanvasIds` — ordering IDs without `a - b` (§4.4)', () => {
  it('orders two IDs that differ only above 2**53, where subtraction cannot', () => {
    const ids = ['9007199254740993', '9007199254740992']

    expect([...ids].sort(compareCanvasIds)).toEqual(['9007199254740992', '9007199254740993'])
  })

  it('control: the obvious `Number(a) - Number(b)` comparator fails on that same input', () => {
    // Without this the test above is a claim about `compareCanvasIds`, not a
    // reason to have written it.
    const ids = ['9007199254740993', '9007199254740992']
    const naive = [...ids].sort((a, b) => Number(a) - Number(b))

    // Both parse to the same double, so the comparator returns 0 and the sort
    // leaves the larger value first.
    expect(Number(ids[0]) - Number(ids[1])).toBe(0)
    expect(naive).toEqual(['9007199254740993', '9007199254740992'])
  })

  it('orders by magnitude, not lexicographically', () => {
    const ids = ['100', '99', '1000', '9']

    expect([...ids].sort(compareCanvasIds)).toEqual(['9', '99', '100', '1000'])
    // Lexicographic order would put '100' before '9'.
    expect([...ids].sort()).toEqual(['100', '1000', '9', '99'])
  })

  it('is a total order: reflexive, antisymmetric and transitive on the ids it is given', () => {
    const ids = ['1', '9', '10', '9007199254740992', '9223372036854775807']
    for (const a of ids) {
      expect(compareCanvasIds(a, a)).toBe(0)
      for (const b of ids) {
        // Summed rather than negated: `Math.sign(0)` is `0` and `-Math.sign(0)`
        // is `-0`, which `toBe` (Object.is) treats as different.
        expect(Math.sign(compareCanvasIds(a, b)) + Math.sign(compareCanvasIds(b, a))).toBe(0)
      }
    }
  })

  it('orders Canvas MAX_ID above every smaller 19-digit id', () => {
    expect(compareCanvasIds('9223372036854775807', '9223372036854775806')).toBeGreaterThan(0)
    expect(compareCanvasIds('1000000000000000000', '9223372036854775807')).toBeLessThan(0)
  })
})

describe('`canvasIdFromResponse` — the Phase 1 to Phase 2 bridge', () => {
  it('turns a response-sourced number into the canonical string', () => {
    expect(canvasIdFromResponse(12345)).toBe('12345')
  })

  it('passes a string through, so a payload Canvas already stringified is untouched', () => {
    expect(canvasIdFromResponse(SHARD_901_ID)).toBe(SHARD_901_ID)
  })

  it('never emits exponential notation for any value Canvas can store', () => {
    // `String()` switches to exponential at 1e21; Canvas's MAX_ID is ~9.2e18,
    // so the whole representable range is safe — asserted rather than assumed,
    // because the claim is what makes the plain `String()` acceptable here.
    // Written as exponentials where a decimal literal would itself lose
    // precision at parse time (and trip `no-loss-of-precision`).
    for (const value of [2 ** 53, 9.2e18, 1e18, 9.1e18]) {
      expect(canvasIdFromResponse(value)).not.toContain('e')
    }
  })

  it('does not pretend to recover precision the response already lost', () => {
    // The rounding happened inside `JSON.parse` on the response body. This
    // function is not a fix for that — PR 2a is — and the test says so, so a
    // reader does not mistake it for one.
    const rounded = (JSON.parse('{"id":9007199254740993}') as { id: number }).id

    expect(canvasIdFromResponse(rounded)).toBe('9007199254740992')
  })
})
