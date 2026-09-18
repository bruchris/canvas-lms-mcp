import { describe, expect, it } from 'vitest'
import {
  buildPromptDefinitions,
  buildPromptMeta,
  buildPromptText,
  PROMPT_META_KEY,
} from '../../src/prompts/catalog'
import { GENERATED_SKILLS } from '../../src/prompts/skills.generated'
import { ROLE_VISIBILITY } from '../../src/tools/roles'
import type { CanvasRole } from '../../src/tools/types'

function definition(name: string) {
  const found = buildPromptDefinitions().find((entry) => entry.name === name)
  if (!found) throw new Error(`No prompt named ${name}`)
  return found
}

describe('buildPromptDefinitions', () => {
  it('returns every skill when no role is set', () => {
    expect(buildPromptDefinitions()).toHaveLength(GENERATED_SKILLS.length)
  })

  it.each(['student', 'teacher', 'admin'] as const)(
    'filters to exactly the audiences %s can see',
    (role: CanvasRole) => {
      const visible = ROLE_VISIBILITY[role]
      const expected = GENERATED_SKILLS.filter((skill) => visible.has(skill.audience))
        .map((skill) => skill.name)
        .sort()
      expect(
        buildPromptDefinitions(role)
          .map((entry) => entry.name)
          .sort(),
      ).toEqual(expected)
    },
  )

  it('uses the body heading as the title', () => {
    expect(definition('canvas-grading-pass').title).toBe('Canvas Grading Pass')
  })

  it('appends a write-tool sentence only to skills that reach write tools', () => {
    const writing = definition('canvas-grading-pass')
    expect(writing.description).toContain(
      'Uses write tools: comment_on_submission, grade_submission, submit_rubric_assessment.',
    )
    expect(writing.description).toContain('confirm before each write')

    const reading = definition('canvas-week-plan')
    expect(reading.description).not.toContain('Uses write tools')
    expect(reading.description).toBe(
      GENERATED_SKILLS.find((skill) => skill.name === 'canvas-week-plan')?.description,
    )
  })

  it('describes every declared argument as optional, in declaration order', () => {
    const entry = definition('canvas-grading-pass')
    expect(entry.arguments.map((argument) => argument.name)).toEqual(['course_id', 'assignment_id'])
    for (const argument of entry.arguments) {
      expect(argument.required).toBe(false)
      expect(argument.description.length).toBeGreaterThan(0)
    }
  })

  it('gives an argument-free skill an empty argument list', () => {
    expect(definition('canvas-morning-check').arguments).toEqual([])
  })
})

describe('buildPromptText', () => {
  const entry = definition('canvas-grading-pass')

  it('returns the body unchanged when nothing is supplied', () => {
    expect(buildPromptText(entry, {})).toBe(entry.body)
  })

  it('prepends one context block naming each supplied argument', () => {
    const text = buildPromptText(entry, { course_id: '42', assignment_id: '7' })
    expect(text).toBe(
      `Context supplied by the user:\n- course_id: 42\n- assignment_id: 7\n\n${entry.body}`,
    )
  })

  it('keeps declaration order regardless of the order supplied', () => {
    const text = buildPromptText(entry, { assignment_id: '7', course_id: '42' })
    expect(text.indexOf('course_id')).toBeLessThan(text.indexOf('assignment_id'))
  })

  it('ignores blank and whitespace-only values', () => {
    expect(buildPromptText(entry, { course_id: '', assignment_id: '   ' })).toBe(entry.body)
  })

  it('trims a supplied value', () => {
    expect(buildPromptText(entry, { course_id: '  42  ' })).toContain('- course_id: 42\n')
  })

  it('ignores a value for an argument this prompt does not declare', () => {
    expect(buildPromptText(definition('canvas-morning-check'), { course_id: '42' })).toBe(
      definition('canvas-morning-check').body,
    )
  })
})

describe('buildPromptMeta', () => {
  it('namespaces audience and write tools under the server key', () => {
    expect(buildPromptMeta(definition('canvas-grading-pass'))).toEqual({
      [PROMPT_META_KEY]: {
        audience: 'educator',
        writeTools: ['comment_on_submission', 'grade_submission', 'submit_rubric_assessment'],
      },
    })
  })

  it('reports an empty write-tool list for a read-only workflow', () => {
    const meta = buildPromptMeta(definition('canvas-week-plan'))
    expect(meta[PROMPT_META_KEY]).toEqual({ audience: 'student', writeTools: [] })
  })
})
