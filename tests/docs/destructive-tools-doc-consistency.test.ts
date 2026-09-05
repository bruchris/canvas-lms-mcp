import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GATED_DESTRUCTIVE_TOOLS, UNGATED_DELETE_TOOLS } from '../../src/tools/destructive-policy'

// Drift guard (BRU-2444) — mirrors tests/docs/tool-count-consistency.test.ts.
//
// The README's "Destructive tool policy" table is a *safety* list: a reader
// decides whether `block` covers their risk by reading it. A table that lists
// six of the seven blocked tools is worse than no table, because it reads as
// complete. Partial documentation of a write-tool list has already shipped in
// this repo once, so this asserts completeness in both directions rather than
// merely that the section exists.
const ROOT = resolve(__dirname, '../..')
const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8')

const SECTION_HEADING = '## Destructive tool policy'

function destructiveSection(): string {
  const start = readme.indexOf(SECTION_HEADING)
  expect(start, `README is missing the "${SECTION_HEADING}" section`).toBeGreaterThan(-1)
  const next = readme.indexOf('\n## ', start + SECTION_HEADING.length)
  return readme.slice(start, next === -1 ? undefined : next)
}

describe('README destructive-tools documentation', () => {
  it('documents every gated tool by name', () => {
    const section = destructiveSection()
    // Anti-vacuity: an empty registry would satisfy the loop below trivially.
    expect(GATED_DESTRUCTIVE_TOOLS.size).toBe(7)

    const undocumented = [...GATED_DESTRUCTIVE_TOOLS].filter(
      (name) => !section.includes(`\`${name}\``),
    )
    expect(undocumented).toEqual([])
  })

  it('documents the deliberate exclusion, so the gap is visible rather than implied', () => {
    const section = destructiveSection()
    for (const name of UNGATED_DELETE_TOOLS) {
      expect(section).toContain(`\`${name}\``)
    }
  })

  it('does not claim to block a tool the policy leaves registered', () => {
    // The reverse direction: a stale README naming a tool that was later
    // removed from the registry would over-promise the guarantee.
    const section = destructiveSection()
    const claimed = [...section.matchAll(/`(delete_[a-z_]+)`/g)].map((m) => m[1] as string)
    const overclaimed = [...new Set(claimed)].filter(
      (name) => !GATED_DESTRUCTIVE_TOOLS.has(name) && !UNGATED_DELETE_TOOLS.has(name),
    )
    expect(overclaimed).toEqual([])
  })

  it('documents both shipped modes and the byte-exact parse', () => {
    const section = destructiveSection()
    expect(section).toContain('`allow`')
    expect(section).toContain('`block`')
    // The failure mode a deployer most needs to know about.
    expect(section).toMatch(/byte-exact/i)
  })

  it('lists the env var and the CLI flag in the reference tables', () => {
    expect(readme).toContain('`CANVAS_DESTRUCTIVE_TOOLS`')
    expect(readme).toContain('`--destructive-tools=<mode>`')
  })
})
