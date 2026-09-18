import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  buildGeneratedSkills,
  collectWriteToolNames,
  deriveWriteTools,
  renderGeneratedModule,
} from '../../src/prompts/generate'
import { GENERATED_SKILLS } from '../../src/prompts/skills.generated'
import { ARGUMENT_VOCABULARY } from '../../src/prompts/arguments'

const ROOT = resolve(__dirname, '../..')
const SKILLS_DIR = resolve(ROOT, 'skills')

const skillDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => existsSync(join(SKILLS_DIR, entry.name, 'SKILL.md')))
  .map((entry) => entry.name)

describe('write-tool derivation', () => {
  const writeToolNames = collectWriteToolNames()

  it('resolves backticked names that are registered write tools', () => {
    expect(
      deriveWriteTools('call `grade_submission` then `list_submissions`', writeToolNames),
    ).toEqual(['grade_submission'])
  })

  it('ignores identifiers a skill names only to say they do not exist', () => {
    // canvas-discussion-facilitator and canvas-admin-roster warn the model away
    // from tools this server does not expose. Those must never be flagged.
    const body = 'There is no `list_discussion_entries` tool, and no `get_account_tree` either.'
    expect(deriveWriteTools(body, writeToolNames)).toEqual([])
  })

  it('sorts and dedupes', () => {
    const body = '`update_page` `create_page` `update_page`'
    expect(deriveWriteTools(body, writeToolNames)).toEqual(['create_page', 'update_page'])
  })

  it('includes tools that are behind a feature flag at runtime', () => {
    expect(writeToolNames.has('submit_assignment')).toBe(true)
  })

  it('does not treat a read-only tool as a write tool', () => {
    expect(deriveWriteTools('`list_courses`', writeToolNames)).toEqual([])
  })
})

describe('GENERATED_SKILLS', () => {
  it('has one entry per skill directory, with matching names', () => {
    expect(GENERATED_SKILLS.map((skill) => skill.name).sort()).toEqual([...skillDirs].sort())
  })

  it('matches a fresh generation — regenerate with `pnpm generate:prompts`', () => {
    expect(buildGeneratedSkills()).toEqual([...GENERATED_SKILLS])
  })

  it('is byte-identical to the committed module', async () => {
    const rendered = await renderGeneratedModule(buildGeneratedSkills())
    const committed = readFileSync(resolve(ROOT, 'src/prompts/skills.generated.ts'), 'utf8')
    expect(committed).toBe(rendered)
  })

  it('carries a body that matches the file on disk after its frontmatter', () => {
    for (const skill of GENERATED_SKILLS) {
      const raw = readFileSync(join(SKILLS_DIR, skill.name, 'SKILL.md'), 'utf8')
      expect(raw, skill.name).toContain(skill.body.slice(0, 200))
      expect(skill.body, skill.name).not.toContain('io.github.bruchris/canvas-lms-mcp-audience')
    }
  })

  it('declares only vocabulary arguments and a concrete audience', () => {
    for (const skill of GENERATED_SKILLS) {
      expect(['student', 'educator', 'admin', 'shared'], skill.name).toContain(skill.audience)
      for (const argument of skill.argumentNames) {
        expect(Object.keys(ARGUMENT_VOCABULARY), skill.name).toContain(argument)
      }
    }
  })

  it('flags the skills that reach write tools and no others', () => {
    const flagged = GENERATED_SKILLS.filter((skill) => skill.writeTools.length > 0).map(
      (skill) => skill.name,
    )
    expect(flagged.sort()).toEqual([
      'canvas-admin-roster',
      'canvas-at-risk-students',
      'canvas-discussion-facilitator',
      'canvas-grading-pass',
      'canvas-office-hours',
      'canvas-peer-review-tracker',
      'canvas-quiz-review',
      'canvas-syllabus-coach',
    ])
  })

  it('names the exact write tools for the grading workflow', () => {
    const skill = GENERATED_SKILLS.find((entry) => entry.name === 'canvas-grading-pass')
    expect(skill?.writeTools).toEqual([
      'comment_on_submission',
      'grade_submission',
      'submit_rubric_assessment',
    ])
  })
})
