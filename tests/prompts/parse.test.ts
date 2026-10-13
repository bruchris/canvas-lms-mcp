import { describe, expect, it } from 'vitest'
import { parseSkillFile } from '../../src/prompts/generate'
import { ARGUMENT_VOCABULARY } from '../../src/prompts/arguments'

const VALID = `---
name: canvas-grading-pass
description: Educator grading workflow for Canvas. Trigger phrases include "grade submissions", "start grading".
metadata:
  io.github.bruchris/canvas-lms-mcp-audience: educator
  io.github.bruchris/canvas-lms-mcp-arguments: course_id assignment_id
---

# Canvas Grading Pass

Walk ungraded submissions one at a time.
`

describe('parseSkillFile', () => {
  it('extracts name, title, description, audience and arguments', () => {
    const parsed = parseSkillFile('canvas-grading-pass/SKILL.md', VALID)

    expect(parsed.name).toBe('canvas-grading-pass')
    expect(parsed.title).toBe('Canvas Grading Pass')
    expect(parsed.description).toContain('Educator grading workflow')
    expect(parsed.audience).toBe('educator')
    expect(parsed.argumentNames).toEqual(['course_id', 'assignment_id'])
  })

  it('keeps the whole description, quotes included', () => {
    const parsed = parseSkillFile('x/SKILL.md', VALID)
    expect(parsed.description.endsWith('"start grading".')).toBe(true)
  })

  it('returns the body without frontmatter and without leading blank lines', () => {
    const parsed = parseSkillFile('canvas-grading-pass/SKILL.md', VALID)
    expect(parsed.body.startsWith('# Canvas Grading Pass')).toBe(true)
    expect(parsed.body).not.toContain('io.github.bruchris')
  })

  it('treats a skill with no arguments key as declaring none', () => {
    const noArgs = VALID.replace(
      '  io.github.bruchris/canvas-lms-mcp-arguments: course_id assignment_id\n',
      '',
    )
    expect(parseSkillFile('x/SKILL.md', noArgs).argumentNames).toEqual([])
  })

  it('ignores third-party metadata keys', () => {
    const extra = VALID.replace('metadata:\n', 'metadata:\n  com.example/other: something\n')
    expect(parseSkillFile('x/SKILL.md', extra).audience).toBe('educator')
  })

  it('ignores unknown top-level frontmatter keys defined by the skills spec', () => {
    const licensed = VALID.replace('name:', 'license: MIT\nname:')
    expect(parseSkillFile('x/SKILL.md', licensed).name).toBe('canvas-grading-pass')
  })

  it('accepts a quoted description containing a colon', () => {
    // The canvas-admin-roster shape, fixed in Task 0. A hand-rolled parser that
    // split on the first colon would accept this unquoted too; a real YAML
    // parser does not, and this asserts we use the real one.
    const quoted = VALID.replace(
      /description:.*/,
      "description: 'Admin skill for walking the hierarchy: list accounts.'",
    )
    expect(parseSkillFile('x/SKILL.md', quoted).description).toBe(
      'Admin skill for walking the hierarchy: list accounts.',
    )
  })

  it.each([
    [
      'missing audience',
      VALID.replace(/ *io\.github\.bruchris\/canvas-lms-mcp-audience.*\n/, ''),
      /audience/i,
    ],
    [
      'unknown audience',
      // Target the audience line explicitly. A bare replace('educator', …)
      // works only while no other line happens to contain that word.
      VALID.replace(
        'io.github.bruchris/canvas-lms-mcp-audience: educator',
        'io.github.bruchris/canvas-lms-mcp-audience: teacher',
      ),
      /teacher/,
    ],
    [
      'unknown argument',
      VALID.replace('course_id assignment_id', 'course_id bogus_id'),
      /bogus_id/,
    ],
    [
      'duplicate argument',
      VALID.replace('course_id assignment_id', 'course_id course_id'),
      /duplicate/i,
    ],
    ['no frontmatter', '# Just a heading\n', /frontmatter/i],
    ['unterminated frontmatter', '---\nname: x\n', /frontmatter/i],
    ['missing description', VALID.replace(/description:.*\n/, ''), /description/i],
    [
      'missing body heading',
      VALID.replace('# Canvas Grading Pass', 'Canvas Grading Pass'),
      /heading/i,
    ],
    [
      'unquoted colon in description',
      VALID.replace(/description:.*/, 'description: Walks it: like this'),
      /yaml/i,
    ],
    ['frontmatter that is not a mapping', '---\n- a\n- b\n---\n\n# T\n', /mapping/i],
    [
      'a description past the 1024-character spec limit',
      VALID.replace(/description:.*/, `description: ${'x'.repeat(1025)}`),
      /1024/,
    ],
    [
      'a non-string arguments value',
      VALID.replace(
        'io.github.bruchris/canvas-lms-mcp-arguments: course_id assignment_id',
        'io.github.bruchris/canvas-lms-mcp-arguments:\n    - course_id',
      ),
      /space-separated/i,
    ],
  ])('rejects %s', (_label, raw, pattern) => {
    expect(() => parseSkillFile('canvas-grading-pass/SKILL.md', raw)).toThrow(pattern)
  })

  it('accepts a description exactly at the 1024-character limit', () => {
    const atLimit = VALID.replace(/description:.*/, `description: ${'x'.repeat(1024)}`)
    expect(parseSkillFile('x/SKILL.md', atLimit).description).toHaveLength(1024)
  })

  it('names the offending file in every error', () => {
    expect(() => parseSkillFile('canvas-week-plan/SKILL.md', '# nope\n')).toThrow(
      /canvas-week-plan\/SKILL\.md/,
    )
  })
})

describe('ARGUMENT_VOCABULARY', () => {
  it('is the closed set the spec defines', () => {
    expect(Object.keys(ARGUMENT_VOCABULARY).sort()).toEqual([
      'account_id',
      'assignment_id',
      'course_id',
      'quiz_id',
      'student_id',
    ])
  })

  it('gives every argument a non-empty description', () => {
    for (const [name, description] of Object.entries(ARGUMENT_VOCABULARY)) {
      expect(description.length, name).toBeGreaterThan(0)
    }
  })
})
