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

  it('includes deletes that the destructive-tools policy can remove', () => {
    // getAllTools applies DEFAULT_DESTRUCTIVE_TOOLS_MODE unless told otherwise,
    // and under 'block' the registry drops from 48 write tools to 41. If that
    // default ever flips, derivation must not quietly follow it — otherwise
    // canvas-office-hours silently stops being marked as a workflow that
    // deletes. collectWriteToolNames pins the policy for exactly this reason.
    expect(writeToolNames.has('delete_appointment_group')).toBe(true)
  })

  it('matches the write tools published by the tool manifest, exactly', () => {
    // Independent oracle. docs/generated/tool-manifest.json is built by a
    // different code path (buildToolManifest walks the domain catalog directly,
    // bypassing both feature gates and the destructive-tools policy), so an
    // exact set match catches derivation silently narrowing or widening.
    const manifest = JSON.parse(
      readFileSync(resolve(ROOT, 'docs/generated/tool-manifest.json'), 'utf8'),
    ) as { tools: { name: string; access: 'read' | 'write' }[] }
    const manifestWrites = manifest.tools
      .filter((tool) => tool.access === 'write')
      .map((tool) => tool.name)
      .sort()

    expect([...writeToolNames].sort()).toEqual(manifestWrites)
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

  it.each(skillDirs)('%s body is the file on disk, in full, minus its frontmatter', (name) => {
    // Full equality against the file, not a prefix: a regression in the body
    // trimming that dropped or mangled anything past the opening paragraph
    // would survive a containment check, and the staleness gate cannot catch
    // it either because both sides of that comparison run the same parser.
    const raw = readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8')
    const afterFrontmatter = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    const skill = GENERATED_SKILLS.find((entry) => entry.name === name)

    expect(skill?.body).toBe(afterFrontmatter.replace(/^\s*\n/, '').trimEnd())
    expect(skill?.body).not.toContain('io.github.bruchris/canvas-lms-mcp-audience')
  })

  it('declares only vocabulary arguments and a concrete audience', () => {
    for (const skill of GENERATED_SKILLS) {
      expect(['student', 'educator', 'admin', 'shared'], skill.name).toContain(skill.audience)
      for (const argument of skill.argumentNames) {
        expect(Object.keys(ARGUMENT_VOCABULARY), skill.name).toContain(argument)
      }
    }
  })

  it('tags each skill with the audience the design assigned it', () => {
    // An explicit table, not a restatement of ROLE_VISIBILITY. Every parity
    // test elsewhere computes its expectation from each skill's own audience,
    // so a mis-tag — canvas-admin-roster slipping from admin to educator, say,
    // exposing an admin workflow to CANVAS_ROLE=teacher — would agree with
    // itself and pass. This is the oracle that makes those tests mean something.
    const audiences = Object.fromEntries(
      GENERATED_SKILLS.map((skill) => [skill.name, skill.audience]),
    )
    expect(audiences).toEqual({
      'canvas-accessibility-sweep': 'educator',
      'canvas-admin-roster': 'admin',
      'canvas-at-risk-students': 'educator',
      'canvas-course-pulse': 'educator',
      'canvas-course-qc': 'educator',
      'canvas-discussion-facilitator': 'educator',
      'canvas-gradebook-audit': 'educator',
      'canvas-grading-pass': 'educator',
      'canvas-morning-check': 'educator',
      'canvas-office-hours': 'educator',
      'canvas-outcome-tracker': 'educator',
      'canvas-peer-review-tracker': 'educator',
      'canvas-quiz-review': 'educator',
      'canvas-student-todo': 'student',
      'canvas-syllabus-coach': 'educator',
      'canvas-week-plan': 'student',
    })
  })

  it('declares the arguments the design assigned each skill', () => {
    const args = Object.fromEntries(
      GENERATED_SKILLS.map((skill) => [skill.name, skill.argumentNames.join(' ')]),
    )
    expect(args).toEqual({
      'canvas-accessibility-sweep': 'course_id',
      'canvas-admin-roster': 'account_id course_id',
      'canvas-at-risk-students': 'course_id',
      'canvas-course-pulse': 'course_id',
      'canvas-course-qc': 'course_id',
      'canvas-discussion-facilitator': 'course_id',
      'canvas-gradebook-audit': 'course_id assignment_id student_id',
      'canvas-grading-pass': 'course_id assignment_id',
      'canvas-morning-check': '',
      'canvas-office-hours': 'course_id',
      'canvas-outcome-tracker': 'course_id student_id',
      'canvas-peer-review-tracker': 'course_id assignment_id',
      'canvas-quiz-review': 'course_id quiz_id student_id',
      'canvas-student-todo': '',
      'canvas-syllabus-coach': 'course_id',
      'canvas-week-plan': '',
    })
  })

  it('keeps every frontmatter description within the 1024-character spec limit', () => {
    for (const skill of GENERATED_SKILLS) {
      expect(skill.description.length, skill.name).toBeLessThanOrEqual(1024)
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
