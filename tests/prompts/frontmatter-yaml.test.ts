import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'

const SKILLS_DIR = resolve(__dirname, '../../skills')
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/

const skillDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => existsSync(join(SKILLS_DIR, entry.name, 'SKILL.md')))
  .map((entry) => entry.name)

function frontmatterOf(name: string): Record<string, unknown> {
  const raw = readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8')
  const match = raw.match(FRONTMATTER)
  if (!match) throw new Error(`${name}/SKILL.md has no YAML frontmatter block`)
  // A hand-rolled "split on the first colon" parser accepts a description
  // containing ": " that every real YAML parser rejects. This gate is what
  // keeps our notion of valid from diverging from the ecosystem's.
  return parse(match[1]!) as Record<string, unknown>
}

describe('SKILL.md frontmatter is valid YAML', () => {
  it('finds skill directories to check', () => {
    expect(skillDirs.length).toBeGreaterThan(0)
  })

  it.each(skillDirs)('%s parses, with a string name and description', (name) => {
    const parsed = frontmatterOf(name)
    expect(typeof parsed.name, name).toBe('string')
    expect(typeof parsed.description, name).toBe('string')
  })

  it.each(skillDirs)('%s frontmatter name matches its directory', (name) => {
    expect(frontmatterOf(name).name).toBe(name)
  })

  it.each(skillDirs)('%s description stays within the 1024-character spec limit', (name) => {
    expect(String(frontmatterOf(name).description).length).toBeLessThanOrEqual(1024)
  })
})
