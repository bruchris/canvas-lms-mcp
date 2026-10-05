import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'

const ROOT = resolve(__dirname, '../..')
const skillsDir = resolve(ROOT, 'skills')

// Oracle: same directory-scan pattern as skill-count-consistency.test.ts —
// never hard-code the skill count.
const SKILL_COUNT = readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => existsSync(join(skillsDir, entry.name, 'SKILL.md'))).length

const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => existsSync(join(skillsDir, entry.name, 'SKILL.md')))
  .map((entry) => entry.name)

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/

function parseFrontmatter(dir: string): { name?: unknown; description?: unknown } {
  const raw = readFileSync(join(skillsDir, dir, 'SKILL.md'), 'utf8')
  const match = raw.match(FRONTMATTER_RE)
  expect(match, `${dir}/SKILL.md is missing a leading/closing --- frontmatter block`).toBeTruthy()
  return parse(match![1], { strict: true, uniqueKeys: true }) as {
    name?: unknown
    description?: unknown
  }
}

describe('SKILL.md frontmatter', () => {
  let checkedCount = 0

  for (const dir of skillDirs) {
    it(`${dir}/SKILL.md has valid YAML frontmatter with a name and description`, () => {
      checkedCount++
      const frontmatter = parseFrontmatter(dir)

      expect(frontmatter.name).toBe(dir)

      expect(typeof frontmatter.description).toBe('string')
      const description = frontmatter.description as string
      expect(description.length).toBeGreaterThan(0)
      expect(description.length).toBeLessThanOrEqual(1024)

      // canvas-admin-roster's frontmatter was invalid YAML (unquoted "key: value"
      // colon inside the description); pin the exact original wording so the fix
      // that quotes it cannot also reword it.
      if (dir === 'canvas-admin-roster') {
        expect(description).toBe(
          'Admin skill for walking the Canvas account hierarchy: list accounts and sub-accounts, see courses and users under each, look up which canned reports are available, and enroll or remove users from a specific course — one action at a time. Trigger phrases include "admin roster", "list accounts", "sub accounts", "account users", "users in this account", "enroll a user", "remove an enrollment", "account reports", or "what accounts can I see".',
        )
      }
    })
  }

  it('checked every skill directory (anti-vacuity)', () => {
    expect(checkedCount).toBe(SKILL_COUNT)
  })
})
