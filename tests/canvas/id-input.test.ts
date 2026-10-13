import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  CANVAS_MAX_ID,
  MAX_SAFE_CANVAS_NUMBER_ID,
  canvasIdInput,
  canvasIdList,
  normalizeCanvasIdInput,
} from '../../src/canvas/id'

/**
 * Phase 1, PR 1a (BRU-2816) of the 64-bit identifier design
 * (`docs/superpowers/specs/2026-10-05-bru-2730-canvas-64bit-identifiers.md`).
 * This file is the §4.2.2 boundary table, which is the contract: one row per
 * input, each row individually attributable. Every row here was **red-first**
 * against a stub `canvasIdInput()` that accepted everything and returned the
 * input unchanged, except the three noted in the PR body (the string-valued
 * accept rows, which the identity stub satisfies by construction).
 *
 * Issue codes rather than message text, per §4.2.2: messages are asserted
 * separately and only where the design names a specific message (N3).
 */

/**
 * The nested set of Zod issue codes, with each `invalid_union`'s member
 * errors flattened in. §4.2.2 asserts on this set rather than on the
 * top-level code alone, because for a hostile *string* the number arm also
 * reports `invalid_type` — a test that asserted only the string leaf
 * (`invalid_format`) would be incomplete.
 */
function nestedIssueCodes(error: z.ZodError): string[] {
  const walk = (issues: readonly z.core.$ZodIssue[]): string[] =>
    issues.flatMap((issue) => [
      issue.code,
      ...(issue.code === 'invalid_union'
        ? (issue.errors ?? []).flatMap((member) => walk(member as z.core.$ZodIssue[]))
        : []),
    ])
  return [...new Set(walk(error.issues))].sort()
}

const ID = canvasIdInput()

/**
 * `9007199254740993` cannot be written as a numeric literal — the source
 * literal would itself round (and trips `no-loss-of-precision`). Going
 * through `JSON.parse` is what every MCP transport does to wire bytes, and
 * makes the rounding visible at the boundary where it actually happens.
 * The resulting *value* is `2**53`, which is the row's whole point: the
 * original is unrecoverable before validation ever runs.
 */
const ROUNDED_FROM_UNSAFE = JSON.parse('9007199254740993') as number

describe('§4.2.2 boundary table — accepted inputs normalize to the canonical decimal string', () => {
  const accepted: Array<[label: string, input: unknown, expected: string]> = [
    ['1', 1, '1'],
    ['Number.MAX_SAFE_INTEGER exactly', 9007199254740991, '9007199254740991'],
    ['"9007199254740992" (exact as a string)', '9007199254740992', '9007199254740992'],
    ['"9223372036854775807" (= Canvas MAX_ID)', '9223372036854775807', '9223372036854775807'],
    ['"9010000000000001" (the shard-901 case)', '9010000000000001', '9010000000000001'],
  ]

  it.each(accepted)('accepts %s and yields %o', (_label, input, expected) => {
    const result = ID.safeParse(input)
    expect(result.success).toBe(true)
    expect(result.success && result.data).toBe(expected)
  })
})

describe('§4.2.2 boundary table — rejected inputs, by nested issue-code set', () => {
  const TYPE_AND_FORMAT = ['invalid_format', 'invalid_type', 'invalid_union']
  const NON_INTEGER_NUMBER = ['invalid_type', 'invalid_union']

  const rejected: Array<[label: string, input: unknown, codes: string[]]> = [
    // Numbers: out of range surfaces as a *top-level* too_big / too_small with
    // no union wrapper; only the non-integers go through the union (§13).
    ['9007199254740992 (2**53)', 9007199254740992, ['too_big']],
    ['9007199254740993, already rounded to 2**53 by JSON.parse', ROUNDED_FROM_UNSAFE, ['too_big']],
    ['0', 0, ['too_small']],
    ['-7', -7, ['too_small']],
    ['7.5 (not an integer)', 7.5, NON_INTEGER_NUMBER],
    ['Infinity', Infinity, NON_INTEGER_NUMBER],
    ['-Infinity', -Infinity, NON_INTEGER_NUMBER],
    ['NaN', NaN, NON_INTEGER_NUMBER],
    // Strings.
    [
      '"9223372036854775808" (> MAX_ID; the refine, not the regex)',
      '9223372036854775808',
      ['custom'],
    ],
    ['"12345678901234567890" (20 digits)', '12345678901234567890', TYPE_AND_FORMAT],
    ['"0"', '0', TYPE_AND_FORMAT],
    ['"-7"', '-7', TYPE_AND_FORMAT],
    ['"007" (leading zeros — Canvas tolerates them, we do not)', '007', TYPE_AND_FORMAT],
    ['"7.0"', '7.0', TYPE_AND_FORMAT],
    ['"1e3"', '1e3', TYPE_AND_FORMAT],
    ['" 7" (leading space)', ' 7', TYPE_AND_FORMAT],
    ['"7 " (trailing space)', '7 ', TYPE_AND_FORMAT],
    ['"1_000"', '1_000', TYPE_AND_FORMAT],
    ['"+7" (explicit sign)', '+7', TYPE_AND_FORMAT],
    ['"" (empty)', '', TYPE_AND_FORMAT],
    ['"Infinity"', 'Infinity', TYPE_AND_FORMAT],
    ['"NaN"', 'NaN', TYPE_AND_FORMAT],
    ['"٧٧" (U+0667 Arabic-Indic digits)', '٧٧', TYPE_AND_FORMAT],
    ['"７" (U+FF17 fullwidth digit)', '７', TYPE_AND_FORMAT],
    ['"self" where no sentinel is declared', 'self', TYPE_AND_FORMAT],
  ]

  it.each(rejected)('rejects %s with codes %o', (_label, input, codes) => {
    const result = ID.safeParse(input)
    expect(result.success).toBe(false)
    expect(result.success ? [] : nestedIssueCodes(result.error)).toEqual(codes)
  })
})

describe('§4.2.2 — the two bounds are Canvas’s own, not ours', () => {
  it('exports MAX_ID as 2**63 - 1, from lib/api.rb', () => {
    expect(CANVAS_MAX_ID).toBe(9223372036854775807n)
    expect(CANVAS_MAX_ID).toBe(2n ** 63n - 1n)
  })

  it('exports the numeric ceiling as Number.MAX_SAFE_INTEGER, the point the two representations diverge', () => {
    expect(MAX_SAFE_CANVAS_NUMBER_ID).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('§4.2 rule 3 — sentinels are accepted only where a call site declares them', () => {
  it('accepts "self" when declared, and still normalizes real IDs', () => {
    const schema = canvasIdInput({ sentinels: ['self'] })
    expect(schema.safeParse('self')).toMatchObject({ success: true, data: 'self' })
    expect(schema.safeParse(92)).toMatchObject({ success: true, data: '92' })
  })

  it('rejects a sentinel the call site did not declare', () => {
    const schema = canvasIdInput({ sentinels: ['self'] })
    expect(schema.safeParse('all').success).toBe(false)
  })

  it('declaring one sentinel does not open the gate to arbitrary strings', () => {
    const schema = canvasIdInput({ sentinels: ['self'] })
    expect(schema.safeParse('007').success).toBe(false)
    expect(schema.safeParse('').success).toBe(false)
  })

  it('publishes the declared sentinels as an enum member, so a client can see them', () => {
    const json = z.toJSONSchema(canvasIdInput({ sentinels: ['self', 'all'] }), {
      io: 'input',
    }) as { anyOf: Array<Record<string, unknown>> }
    expect(json.anyOf).toHaveLength(3)
    expect(json.anyOf[2]).toEqual({ type: 'string', enum: ['self', 'all'] })
  })
})

describe('the documented API surface composes with Zod modifiers', () => {
  it('canvasIdInput().optional() accepts undefined and still normalizes a value', () => {
    const schema = canvasIdInput().optional()
    expect(schema.safeParse(undefined)).toMatchObject({ success: true, data: undefined })
    expect(schema.safeParse(7)).toMatchObject({ success: true, data: '7' })
    expect(schema.safeParse('007').success).toBe(false)
  })

  it('an optional field is published as not-required, so the modifier survives registration', () => {
    const json = z.toJSONSchema(
      z.object({ course_id: canvasIdInput(), user_id: canvasIdInput().optional() }),
      { io: 'input' },
    ) as { required?: string[] }
    expect(json.required).toEqual(['course_id'])
  })
})

describe('canvasIdList() — per-element normalization, sentinels per element', () => {
  it('normalizes a mixed list of numbers and strings to canonical strings', () => {
    const result = canvasIdList().safeParse([1, '9010000000000001'])
    expect(result).toMatchObject({ success: true, data: ['1', '9010000000000001'] })
  })

  it('accepts a declared sentinel as a list element, which is how Canvas takes student_ids[]=all', () => {
    const schema = canvasIdList({ sentinels: ['self', 'all'] })
    expect(schema.safeParse(['all'])).toMatchObject({ success: true, data: ['all'] })
    expect(schema.safeParse([42, 'self'])).toMatchObject({ success: true, data: ['42', 'self'] })
  })

  it('rejects the whole list when any element is not a Canvas ID, and names the index', () => {
    const result = canvasIdList().safeParse([1, '007'])
    expect(result.success).toBe(false)
    expect(result.success ? [] : result.error.issues[0].path).toEqual([1])
  })

  it('rejects a non-array', () => {
    expect(canvasIdList().safeParse('1').success).toBe(false)
  })
})

describe('normalizeCanvasIdInput() — the same rules, callable outside a Zod parse', () => {
  it('returns the canonical decimal string for every accepted form', () => {
    expect(normalizeCanvasIdInput(92)).toBe('92')
    expect(normalizeCanvasIdInput('9010000000000001')).toBe('9010000000000001')
    expect(normalizeCanvasIdInput('9223372036854775807')).toBe('9223372036854775807')
  })

  it('throws, naming the received value, rather than returning a non-canonical string', () => {
    expect(() => normalizeCanvasIdInput('007')).toThrow(/received "007"/)
    expect(() => normalizeCanvasIdInput(9007199254740992)).toThrow(/received 9007199254740992/)
  })

  it('does not call BigInt on a value the pattern rejects (the N1 failure mode, outside Zod)', () => {
    // Were the order reversed, this would be a `SyntaxError: Cannot convert
    // 7.0 to a BigInt` rather than the contract's own TypeError.
    expect(() => normalizeCanvasIdInput('7.0')).toThrow(TypeError)
    expect(() => normalizeCanvasIdInput('7.0')).not.toThrow(/BigInt/)
  })

  it('honours declared sentinels and returns them unchanged', () => {
    expect(normalizeCanvasIdInput('self', { sentinels: ['self'] })).toBe('self')
    expect(() => normalizeCanvasIdInput('self')).toThrow(TypeError)
  })

  it('rejects a value of the wrong type outright', () => {
    expect(() => normalizeCanvasIdInput(null)).toThrow(TypeError)
    expect(() => normalizeCanvasIdInput({ id: 1 })).toThrow(TypeError)
  })
})
