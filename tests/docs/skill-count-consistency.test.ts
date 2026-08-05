import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')

// Oracle: count directories under skills/ that contain a SKILL.md, the same
// way docs/generated/tool-manifest.json is the generated oracle for tool
// counts in tool-count-consistency.test.ts. Never hard-code the skill count.
const skillsDir = resolve(ROOT, 'skills')
const SKILL_COUNT = readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => existsSync(join(skillsDir, entry.name, 'SKILL.md'))).length

const pluginJson = JSON.parse(readFileSync(resolve(ROOT, '.claude-plugin/plugin.json'), 'utf8'))
const marketplaceJson = JSON.parse(
  readFileSync(resolve(ROOT, '.claude-plugin/marketplace.json'), 'utf8'),
)
const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8')
const indexHtml = readFileSync(resolve(ROOT, 'docs/index.html'), 'utf8')

describe('skill-count consistency', () => {
  it('.claude-plugin/plugin.json description', () => {
    const m = pluginJson.description.match(/(\d+) educator\/student workflow skills/)
    expect(
      m,
      '.claude-plugin/plugin.json description "N educator/student workflow skills" not found',
    ).toBeTruthy()
    expect(
      Number(m![1]),
      `.claude-plugin/plugin.json description says ${m![1]} skills but skills/ has ${SKILL_COUNT} directories with a SKILL.md — update .claude-plugin/plugin.json`,
    ).toBe(SKILL_COUNT)
  })

  it('.claude-plugin/marketplace.json plugins[0] description', () => {
    const description = marketplaceJson.plugins[0].description as string
    const m = description.match(/(\d+) educator\/student workflow skills/)
    expect(
      m,
      '.claude-plugin/marketplace.json plugins[0].description "N educator/student workflow skills" not found',
    ).toBeTruthy()
    expect(
      Number(m![1]),
      `.claude-plugin/marketplace.json plugins[0].description says ${m![1]} skills but skills/ has ${SKILL_COUNT} directories with a SKILL.md — update .claude-plugin/marketplace.json`,
    ).toBe(SKILL_COUNT)
  })

  describe('README.md', () => {
    it('every "N [Agent Skills]" claim', () => {
      const matches = [...readme.matchAll(/(\d+) \[Agent Skills\]\(#agent-skills\)/g)]
      expect(
        matches.length,
        'README.md "N [Agent Skills](#agent-skills)" not found',
      ).toBeGreaterThan(0)
      for (const m of matches) {
        expect(
          Number(m[1]),
          `README.md says "${m[1]} [Agent Skills]" but skills/ has ${SKILL_COUNT} directories with a SKILL.md — update README.md`,
        ).toBe(SKILL_COUNT)
      }
    })
  })

  describe('docs/index.html', () => {
    it('terminal demo "N agent skills installed"', () => {
      const m = indexHtml.match(/(\d+) agent skills installed/)
      expect(m, 'docs/index.html "N agent skills installed" not found').toBeTruthy()
      expect(
        Number(m![1]),
        `docs/index.html says "${m![1]} agent skills installed" but skills/ has ${SKILL_COUNT} directories with a SKILL.md — update docs/index.html`,
      ).toBe(SKILL_COUNT)
    })
  })
})
