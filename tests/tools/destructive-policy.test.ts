import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DESTRUCTIVE_TOOLS_MODE,
  GATED_DESTRUCTIVE_TOOLS,
  UNGATED_DELETE_TOOLS,
  applyDestructiveToolsPolicy,
  parseDestructiveToolsMode,
  resolveDestructiveToolsMode,
  type DestructiveToolsMode,
} from '../../src/tools/destructive-policy'

/**
 * Parser-level coverage for `CANVAS_DESTRUCTIVE_TOOLS` / `--destructive-tools`
 * (BRU-2444, design BRU-2390 §7/§8.1).
 *
 * This is a kill-switch, so the parse is byte-exact: no trimming, no
 * case-folding, no truthiness. Every normalisation step widens the set of
 * strings that *accidentally* land on a mode the deployer did not choose, and
 * the accident that matters here is a typo'd `block` silently registering the
 * delete tools. Unknown input therefore throws at startup rather than falling
 * back to `allow`.
 */

// The near-miss matrix from design §8.1, plus the whitespace and casing
// variants the task's acceptance criteria call out. Every one of these is a
// value a deployer could plausibly write while *intending* to block.
const INVALID_VALUES = [
  '',
  ' ',
  'Block',
  'BLOCK',
  'block ',
  ' block',
  '\tblock',
  'block\n',
  'Allow',
  'ALLOW',
  ' allow',
  'allow ',
  'blocked',
  'deny',
  'none',
  'off',
  'on',
  '0',
  '1',
  'true',
  'false',
  'yes',
  'no',
  'Confirm',
  ' confirm',
  'confirm ',
]

describe('parseDestructiveToolsMode', () => {
  it('defaults to allow when unset', () => {
    expect(parseDestructiveToolsMode(undefined, 'CANVAS_DESTRUCTIVE_TOOLS')).toBe('allow')
    expect(DEFAULT_DESTRUCTIVE_TOOLS_MODE).toBe('allow')
  })

  it('accepts the two byte-exact shipped modes', () => {
    expect(parseDestructiveToolsMode('allow', 'CANVAS_DESTRUCTIVE_TOOLS')).toBe('allow')
    expect(parseDestructiveToolsMode('block', 'CANVAS_DESTRUCTIVE_TOOLS')).toBe('block')
  })

  it.each(INVALID_VALUES)('throws on %j instead of falling back to allow', (value) => {
    expect(() => parseDestructiveToolsMode(value, 'CANVAS_DESTRUCTIVE_TOOLS')).toThrow(
      /CANVAS_DESTRUCTIVE_TOOLS/,
    )
  })

  it('names the offending value in the error so a typo is self-diagnosing', () => {
    expect(() => parseDestructiveToolsMode('Block', 'CANVAS_DESTRUCTIVE_TOOLS')).toThrow(/"Block"/)
    expect(() => parseDestructiveToolsMode(' block', '--destructive-tools')).toThrow(/" block"/)
  })

  it('names the source so env and CLI failures are distinguishable', () => {
    expect(() => parseDestructiveToolsMode('nope', '--destructive-tools')).toThrow(
      /--destructive-tools/,
    )
  })

  it('rejects the reserved `confirm` mode with a distinct not-implemented error', () => {
    // Phase 1 ships `allow` and `block` only. `confirm` is named by the design
    // but has no token machinery behind it, so it must fail loudly rather than
    // resolve to either neighbour — resolving to `allow` would silently permit
    // the deletes a deployer asked to be confirmed.
    expect(() => parseDestructiveToolsMode('confirm', 'CANVAS_DESTRUCTIVE_TOOLS')).toThrow(
      /not implemented/i,
    )
    expect(() => parseDestructiveToolsMode('confirm', 'CANVAS_DESTRUCTIVE_TOOLS')).not.toThrow(
      /Expected exactly/,
    )
    // ...and the generic path must NOT claim to be the reserved-mode path.
    expect(() => parseDestructiveToolsMode('nope', 'CANVAS_DESTRUCTIVE_TOOLS')).toThrow(
      /Expected exactly/,
    )
  })
})

describe('resolveDestructiveToolsMode', () => {
  it('prefers an explicit configured value over the environment', () => {
    expect(resolveDestructiveToolsMode('block', 'allow')).toBe('block')
    expect(resolveDestructiveToolsMode('allow', 'block')).toBe('allow')
  })

  it('falls back to the environment when nothing is configured', () => {
    expect(resolveDestructiveToolsMode(undefined, 'block')).toBe('block')
  })

  it('defaults to allow when neither is set', () => {
    expect(resolveDestructiveToolsMode(undefined, undefined)).toBe('allow')
  })

  it('validates the configured value too, so a JS caller cannot fail open', () => {
    // TypeScript stops `'Block'` at the call site; a plain-JS embedder is the
    // real risk, and an unvalidated passthrough would be treated as "not
    // block" by every downstream comparison.
    expect(() => resolveDestructiveToolsMode('Block', undefined)).toThrow(/destructiveTools/)
  })
})

describe('destructive tool registry', () => {
  it('gates exactly the seven irreversible deletes selected by the design', () => {
    expect([...GATED_DESTRUCTIVE_TOOLS].sort()).toEqual([
      'delete_appointment_group',
      'delete_assignment',
      'delete_discussion',
      'delete_file',
      'delete_new_quiz',
      'delete_new_quiz_item',
      'delete_page',
    ])
  })

  it('documents delete_peer_review as the deliberate exclusion', () => {
    expect([...UNGATED_DELETE_TOOLS]).toEqual(['delete_peer_review'])
    expect(GATED_DESTRUCTIVE_TOOLS.has('delete_peer_review')).toBe(false)
  })
})

describe('applyDestructiveToolsPolicy', () => {
  const tools = [
    { name: 'list_courses' },
    { name: 'delete_assignment' },
    { name: 'delete_peer_review' },
    { name: 'delete_page' },
  ]

  it('returns the input untouched under allow', () => {
    expect(applyDestructiveToolsPolicy(tools, 'allow').map((t) => t.name)).toEqual([
      'list_courses',
      'delete_assignment',
      'delete_peer_review',
      'delete_page',
    ])
  })

  it('removes only the gated names under block', () => {
    expect(applyDestructiveToolsPolicy(tools, 'block').map((t) => t.name)).toEqual([
      'list_courses',
      'delete_peer_review',
    ])
  })

  it('fails closed: any value that is not exactly `allow` blocks', () => {
    // Defence in depth against a mode that reached this function without
    // passing the parser (a cast, a corrupted config object, a future mode
    // added to the type but not to the filter). Blocking is the safe default;
    // permitting the deletes is not.
    const smuggled = 'confirm' as unknown as DestructiveToolsMode
    expect(applyDestructiveToolsPolicy(tools, smuggled).map((t) => t.name)).toEqual([
      'list_courses',
      'delete_peer_review',
    ])
  })
})
