import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Drift guard (BRU-2080) — `changelog-sections` in release-please-config.json
// REPLACES release-please's defaults rather than extending them, so any commit
// type absent from this array produces no changelog entry AND does not
// regenerate an open release PR. That is a real hole for `perf`: commits under
// src/ compile into dist/, and package.json's `files` allowlist ships dist/ in
// the npm tarball, so a perf: commit can change published runtime behaviour
// while leaving no trace in the changelog and no signal on a pending release
// gate (surfaced on PR #297 / BRU-2072). This test fails if `perf` ever falls
// out of the array again.

const ROOT = resolve(__dirname, '../..')
const config = JSON.parse(readFileSync(resolve(ROOT, 'release-please-config.json'), 'utf8'))
const sections = config.packages['.']['changelog-sections'] as Array<{
  type: string
  section: string
}>

describe('release-please-config.json changelog-sections', () => {
  it('declares a perf section using the conventional-commits standard name', () => {
    const perf = sections.find((s) => s.type === 'perf')
    expect(
      perf,
      'changelog-sections has no `perf` entry — perf: commits touching src/ compile into dist/ and ' +
        'ship in the npm tarball, but would produce no changelog entry and would not regenerate an ' +
        'open release PR, so they could ship invisibly (see BRU-2080)',
    ).toBeTruthy()
    expect(perf!.section).toBe('Performance Improvements')
  })

  it('orders perf after fix, matching Features -> Bug Fixes -> Performance Improvements', () => {
    const fixIndex = sections.findIndex((s) => s.type === 'fix')
    const perfIndex = sections.findIndex((s) => s.type === 'perf')
    expect(fixIndex).toBeGreaterThanOrEqual(0)
    expect(perfIndex).toBeGreaterThan(fixIndex)
  })

  it('does not declare test, refactor, or style sections', () => {
    // These commit types never touch files in package.json's `files` allowlist
    // (["bin/", "dist/"]), so their inertness in the changelog is correct and
    // relied upon (PR #292 left an open release gate completely unmoved by
    // design). Do not "helpfully" add them back.
    const inertTypes = sections.filter((s) => ['test', 'refactor', 'style'].includes(s.type))
    expect(inertTypes).toEqual([])
  })
})
