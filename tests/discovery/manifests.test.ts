import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildToolManifest, buildWorkflowManifest } from '../../src/discovery/manifests'
import type { ToolDomainRegistration } from '../../src/tools/catalog'
import type { ToolAudience, ToolDefinition } from '../../src/tools/types'

function createTool(
  name: string,
  annotations: ToolDefinition['annotations'],
  description = `${name} description`,
): ToolDefinition {
  return {
    name,
    description,
    inputSchema: {},
    annotations,
    handler: async () => undefined,
  }
}

function createRegistration(
  tool: ToolDefinition,
  defaultPrimaryAudience: ToolAudience = 'shared',
): ToolDomainRegistration {
  return {
    domain: 'test',
    defaultPrimaryAudience,
    getTools: () => [tool],
  }
}

describe('tool manifest generation', () => {
  it('serializes the registered tool surface with discovery metadata', () => {
    const manifest = buildToolManifest()

    expect(manifest.schemaVersion).toBe('1.0')
    expect(manifest.tools).toHaveLength(105)
    expect(manifest.tools.find((tool) => tool.name === 'grade_submission')).toEqual({
      name: 'grade_submission',
      domain: 'submissions',
      description: 'Post or update a grade for a submission. Requires grading permissions.',
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      access: 'write',
      primaryAudience: 'educator',
      relatedWorkflows: ['educator-assignment-review'],
    })
    expect(manifest.tools.find((tool) => tool.name === 'get_gradebook_history_feed')).toEqual({
      name: 'get_gradebook_history_feed',
      domain: 'gradebook_history',
      description:
        'Get the paginated gradebook history feed for a course, optionally filtered by assignment or user and optionally sorted oldest-first.',
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      access: 'read',
      primaryAudience: 'educator',
      relatedWorkflows: [],
    })
    expect(manifest.tools.find((tool) => tool.name === 'get_outcome')).toEqual({
      name: 'get_outcome',
      domain: 'outcomes',
      description: 'Get the full details for a specific learning outcome by ID.',
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      access: 'read',
      primaryAudience: 'educator',
      relatedWorkflows: [],
    })
  })

  it('matches the committed generated JSON artifact', () => {
    const generated = buildToolManifest()
    const committed = JSON.parse(readFileSync(resolve('docs/generated/tool-manifest.json'), 'utf8'))

    expect(committed).toEqual(generated)
  })

  it('fails when an audience override references an unknown tool', () => {
    expect(() =>
      buildToolManifest({
        toolCatalog: [createRegistration(createTool('known_tool', { readOnlyHint: true }))],
        toolAudienceOverrides: {
          missing_tool: 'student',
        },
      }),
    ).toThrow('Audience override references unknown tool "missing_tool".')
  })

  it('fails when a tool omits both readOnlyHint and destructiveHint', () => {
    expect(() =>
      buildToolManifest({
        toolCatalog: [
          createRegistration(
            createTool('ambiguous_tool', {
              openWorldHint: true,
            }),
          ),
        ],
        toolAudienceOverrides: {},
        workflowCatalog: [],
      }),
    ).toThrow('Tool "ambiguous_tool" must declare exactly one of readOnlyHint or destructiveHint.')
  })

  it('fails when a tool declares both readOnlyHint and destructiveHint', () => {
    expect(() =>
      buildToolManifest({
        toolCatalog: [
          createRegistration(
            createTool('contradictory_tool', {
              readOnlyHint: true,
              destructiveHint: true,
            }),
          ),
        ],
        toolAudienceOverrides: {},
        workflowCatalog: [],
      }),
    ).toThrow(
      'Tool "contradictory_tool" must declare exactly one of readOnlyHint or destructiveHint.',
    )
  })

  it('fails when tool registration touches the Canvas client during manifest generation', () => {
    expect(() =>
      buildToolManifest({
        toolCatalog: [
          {
            domain: 'test',
            defaultPrimaryAudience: 'shared',
            getTools: (canvas) => {
              void canvas.users
              return [createTool('health_check', { readOnlyHint: true })]
            },
          },
        ],
      }),
    ).toThrow('Manifest generation accessed Canvas client during tool registration via "users".')
  })
})

describe('workflow manifest generation', () => {
  it('links workflows to related tools through a stable schema', () => {
    const manifest = buildWorkflowManifest()

    expect(manifest.schemaVersion).toBe('1.0')
    expect(manifest.workflows).toEqual([
      {
        id: 'educator-assignment-review',
        title: 'Educator Assignment Review',
        description: 'Review an assignment, inspect submissions, apply grades, and leave feedback.',
        primaryAudience: 'educator',
        status: 'available',
        documentationPath: 'docs/workflows/educator-assignment-review.md',
        relatedTools: [
          'list_assignments',
          'get_assignment',
          'list_submissions',
          'get_submission',
          'get_rubric',
          'get_rubric_assessment',
          'grade_submission',
          'comment_on_submission',
          'submit_rubric_assessment',
        ],
      },
      {
        id: 'student-weekly-planning',
        title: 'Student Weekly Planning',
        description:
          'Review dashboard items, upcoming deadlines, and current course load for weekly planning.',
        primaryAudience: 'student',
        status: 'available',
        documentationPath: 'docs/workflows/student-weekly-planning.md',
        relatedTools: [
          'get_dashboard_cards',
          'get_todo_items',
          'get_upcoming_events',
          'get_my_upcoming_assignments',
          'get_my_courses',
          'get_my_grades',
        ],
      },
    ])
  })

  it('matches the committed generated JSON artifact', () => {
    const generated = buildWorkflowManifest()
    const committed = JSON.parse(
      readFileSync(resolve('docs/generated/workflow-manifest.json'), 'utf8'),
    )

    expect(committed).toEqual(generated)
  })

  it('fails when a workflow references an unknown tool', () => {
    expect(() =>
      buildWorkflowManifest({
        toolCatalog: [createRegistration(createTool('known_tool', { readOnlyHint: true }))],
        workflowCatalog: [
          {
            id: 'bad-workflow',
            title: 'Bad Workflow',
            description: 'References a missing tool.',
            primaryAudience: 'student',
            status: 'proposed',
            relatedTools: ['missing_tool'],
          },
        ],
      }),
    ).toThrow('Workflow "bad-workflow" references unknown tool "missing_tool".')
  })
})
