import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { toolDomainCatalog } from '../../src/tools/catalog'
import { CANVAS_TOOLSETS, TOOLSET_SUMMARIES, type CanvasToolset } from '../../src/tools/toolsets'

/**
 * Coverage gate for the domain -> toolset mapping (GH #442 Phase 1, BRU-3128).
 *
 * "Exactly one toolset per domain" is half type and half test. The required,
 * single-valued `toolset` field on `ToolDomainRegistration` makes an *omission*
 * a compile error and a *duplicate* assignment unrepresentable — neither can
 * reach this file. What a type cannot say is that the value is one of the nine
 * published names, that no toolset is empty, and that the nine partition the
 * whole registry, so that is what is asserted here.
 */

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../../docs/generated/tool-manifest.json'), 'utf8'),
) as {
  toolCount: number
  tools: Array<{ name: string; domain: string; toolset: CanvasToolset }>
}

describe('domain -> toolset coverage', () => {
  it('every registered domain declares a known toolset', () => {
    // Anti-vacuity: a traversal that silently stopped resolving would pass the
    // loop below on an empty list.
    expect(toolDomainCatalog.length).toBeGreaterThanOrEqual(40)

    const known = new Set<string>(CANVAS_TOOLSETS)
    const unknown = toolDomainCatalog
      .filter((registration) => !known.has(registration.toolset))
      .map((registration) => `${registration.domain} -> ${String(registration.toolset)}`)

    expect(unknown).toEqual([])
  })

  it('maps each domain exactly once, covering every domain in the catalog', () => {
    const domains = toolDomainCatalog.map((registration) => registration.domain)

    // One registration per domain name, so "exactly one toolset per domain"
    // cannot be defeated by registering the same domain twice under different
    // toolsets — the shape the single-valued field alone does not rule out.
    expect(new Set(domains).size).toBe(domains.length)
  })

  it('no toolset is empty, and every published name is used', () => {
    const used = new Set(toolDomainCatalog.map((registration) => registration.toolset))

    for (const toolset of CANVAS_TOOLSETS) {
      expect(used.has(toolset), `toolset "${toolset}" has no domains`).toBe(true)
    }
    // And nothing is used that is not published.
    expect([...used].sort()).toEqual([...CANVAS_TOOLSETS].sort())
  })

  it('every toolset carries a one-line summary for --help and the docs', () => {
    expect(Object.keys(TOOLSET_SUMMARIES).sort()).toEqual([...CANVAS_TOOLSETS].sort())
    for (const toolset of CANVAS_TOOLSETS) {
      expect(TOOLSET_SUMMARIES[toolset].trim().length).toBeGreaterThan(10)
    }
  })

  it('the nine toolsets partition the whole published tool surface', () => {
    expect(manifest.tools.length).toBe(manifest.toolCount)
    expect(manifest.toolCount).toBeGreaterThanOrEqual(180)

    const byToolset = new Map<CanvasToolset, string[]>()
    for (const tool of manifest.tools) {
      const bucket = byToolset.get(tool.toolset) ?? []
      bucket.push(tool.name)
      byToolset.set(tool.toolset, bucket)
    }

    // Partition: the buckets are disjoint by construction (one `toolset` per
    // entry) and their sizes must add back up to the whole surface, so no tool
    // can be left unclassified.
    const total = [...byToolset.values()].reduce((sum, names) => sum + names.length, 0)
    expect(total).toBe(manifest.toolCount)
    expect([...byToolset.keys()].sort()).toEqual([...CANVAS_TOOLSETS].sort())
  })

  it('the README documents every toolset, and invents none', () => {
    // A doc gate rather than a count: the table lists names, so what can drift
    // is the *set* of names, and that is checkable against the catalog.
    const readme = readFileSync(resolve(__dirname, '../../README.md'), 'utf8')
    const start = readme.indexOf('## Toolset filtering')
    expect(start, 'README is missing the "## Toolset filtering" section').toBeGreaterThan(-1)
    const section = readme.slice(start, readme.indexOf('\n## ', start + 1))

    // Every published name appears as a table cell in backticks.
    for (const toolset of CANVAS_TOOLSETS) {
      expect(section, `README does not document toolset "${toolset}"`).toContain(`| \`${toolset}\``)
    }

    // And the reverse: no row names something that is not a toolset. Rows are
    // `| \`name\` | …`, so the first cell is the claim to check.
    const documented = [...section.matchAll(/^\| `([a-z_]+)` \|/gm)].map((match) => match[1]!)
    expect(documented.sort()).toEqual([...CANVAS_TOOLSETS].sort())
  })

  it("the manifest's toolset agrees with the catalog for every tool", () => {
    const expected = new Map(
      toolDomainCatalog.map((registration) => [registration.domain, registration.toolset]),
    )
    const mismatched = manifest.tools
      .filter((tool) => expected.get(tool.domain) !== tool.toolset)
      .map((tool) => `${tool.name} (${tool.domain}): ${tool.toolset}`)

    expect(mismatched).toEqual([])
  })
})
