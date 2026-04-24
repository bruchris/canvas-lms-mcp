import { describe, expect, it, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { outcomeTools } from '../../src/tools/outcomes'

describe('outcomeTools', () => {
  function buildMockCanvas(): CanvasClient {
    return {
      outcomes: {
        getRootOutcomeGroup: vi.fn().mockResolvedValue({ id: 1 }),
        listOutcomeGroups: vi.fn().mockResolvedValue([]),
        listOutcomeGroupLinks: vi.fn().mockResolvedValue([]),
        getOutcomeGroup: vi.fn().mockResolvedValue({ id: 2 }),
        listGroupOutcomes: vi.fn().mockResolvedValue([]),
        listGroupSubgroups: vi.fn().mockResolvedValue([]),
        getOutcome: vi.fn().mockResolvedValue({ id: 3 }),
        getOutcomeAlignments: vi.fn().mockResolvedValue([]),
        getOutcomeResults: vi.fn().mockResolvedValue({ outcome_results: [] }),
        getOutcomeRollups: vi.fn().mockResolvedValue({ rollups: [] }),
        getOutcomeContributingScores: vi.fn().mockResolvedValue({ scores: [] }),
        getOutcomeMasteryDistribution: vi.fn().mockResolvedValue({ outcomes: [] }),
      },
    } as unknown as CanvasClient
  }

  it('returns 12 read-only tool definitions', () => {
    expect(outcomeTools(buildMockCanvas())).toHaveLength(12)
  })

  it('exports tools with the expected names', () => {
    const names = outcomeTools(buildMockCanvas()).map((tool) => tool.name)
    expect(names).toEqual([
      'get_root_outcome_group',
      'list_outcome_groups',
      'list_outcome_group_links',
      'get_outcome_group',
      'list_outcome_group_outcomes',
      'list_outcome_group_subgroups',
      'get_outcome',
      'get_outcome_alignments',
      'get_outcome_results',
      'get_outcome_rollups',
      'get_outcome_contributing_scores',
      'get_outcome_mastery_distribution',
    ])
  })

  it('marks every outcome tool as read-only and open-world', () => {
    for (const tool of outcomeTools(buildMockCanvas())) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    }
  })

  it('delegates get_root_outcome_group to the outcomes module', async () => {
    const canvas = buildMockCanvas()
    const tool = outcomeTools(canvas).find((t) => t.name === 'get_root_outcome_group')!
    await tool.handler({ context_type: 'course', context_id: 42 })
    expect(canvas.outcomes.getRootOutcomeGroup).toHaveBeenCalledWith('course', 42)
  })

  it('delegates list_outcome_group_links with detail options', async () => {
    const canvas = buildMockCanvas()
    const tool = outcomeTools(canvas).find((t) => t.name === 'list_outcome_group_links')!
    await tool.handler({
      context_type: 'account',
      context_id: 9,
      outcome_style: 'full',
      outcome_group_style: 'full',
    })
    expect(canvas.outcomes.listOutcomeGroupLinks).toHaveBeenCalledWith('account', 9, {
      outcome_style: 'full',
      outcome_group_style: 'full',
    })
  })

  it('delegates get_outcome with add_defaults', async () => {
    const canvas = buildMockCanvas()
    const tool = outcomeTools(canvas).find((t) => t.name === 'get_outcome')!
    await tool.handler({ outcome_id: 5, add_defaults: true })
    expect(canvas.outcomes.getOutcome).toHaveBeenCalledWith(5, { add_defaults: true })
  })

  it('delegates get_outcome_results filters', async () => {
    const canvas = buildMockCanvas()
    const tool = outcomeTools(canvas).find((t) => t.name === 'get_outcome_results')!
    await tool.handler({
      course_id: 42,
      user_ids: [10, 'sis_user_id:abc'],
      outcome_ids: [1, 2],
      include_alignments: true,
      include_hidden: true,
    })
    expect(canvas.outcomes.getOutcomeResults).toHaveBeenCalledWith(42, {
      user_ids: [10, 'sis_user_id:abc'],
      outcome_ids: [1, 2],
      include_alignments: true,
      include_hidden: true,
    })
  })

  it('delegates get_outcome_rollups filters', async () => {
    const canvas = buildMockCanvas()
    const tool = outcomeTools(canvas).find((t) => t.name === 'get_outcome_rollups')!
    await tool.handler({
      course_id: 42,
      aggregate: 'course',
      aggregate_stat: 'mean',
      user_ids: [10],
      outcome_ids: [3],
      include_courses: true,
      exclude: ['missing_user_rollups'],
      sort_by: 'student',
      sort_order: 'asc',
      add_defaults: true,
    })
    expect(canvas.outcomes.getOutcomeRollups).toHaveBeenCalledWith(42, {
      aggregate: 'course',
      aggregate_stat: 'mean',
      user_ids: [10],
      outcome_ids: [3],
      include_courses: true,
      exclude: ['missing_user_rollups'],
      sort_by: 'student',
      sort_outcome_id: undefined,
      sort_order: 'asc',
      add_defaults: true,
    })
  })

  it('delegates get_outcome_mastery_distribution filters', async () => {
    const canvas = buildMockCanvas()
    const tool = outcomeTools(canvas).find((t) => t.name === 'get_outcome_mastery_distribution')!
    await tool.handler({
      course_id: 42,
      exclude: ['missing_outcome_results'],
      outcome_ids: [8],
      student_ids: [10],
      include_alignment_distributions: true,
      only_assignment_alignments: true,
      show_unpublished_assignments: true,
      add_defaults: true,
    })
    expect(canvas.outcomes.getOutcomeMasteryDistribution).toHaveBeenCalledWith(42, {
      exclude: ['missing_outcome_results'],
      outcome_ids: [8],
      student_ids: [10],
      include_alignment_distributions: true,
      only_assignment_alignments: true,
      show_unpublished_assignments: true,
      add_defaults: true,
    })
  })

  it('delegates list_outcome_groups to the outcomes module', async () => {
    const canvas = buildMockCanvas()
    const tool = outcomeTools(canvas).find((t) => t.name === 'list_outcome_groups')!
    await tool.handler({ context_type: 'account', context_id: 7 })
    expect(canvas.outcomes.listOutcomeGroups).toHaveBeenCalledWith('account', 7)
  })

  it('delegates get_outcome_group to the outcomes module', async () => {
    const canvas = buildMockCanvas()
    const tool = outcomeTools(canvas).find((t) => t.name === 'get_outcome_group')!
    await tool.handler({ context_type: 'course', context_id: 42, outcome_group_id: 15 })
    expect(canvas.outcomes.getOutcomeGroup).toHaveBeenCalledWith('course', 42, 15)
  })

  it('delegates list_outcome_group_outcomes with optional style', async () => {
    const canvas = buildMockCanvas()
    const tool = outcomeTools(canvas).find((t) => t.name === 'list_outcome_group_outcomes')!
    await tool.handler({ context_type: 'course', context_id: 42, outcome_group_id: 15, outcome_style: 'full' })
    expect(canvas.outcomes.listGroupOutcomes).toHaveBeenCalledWith('course', 42, 15, {
      outcome_style: 'full',
    })
  })

  it('delegates list_outcome_group_subgroups to the outcomes module', async () => {
    const canvas = buildMockCanvas()
    const tool = outcomeTools(canvas).find((t) => t.name === 'list_outcome_group_subgroups')!
    await tool.handler({ context_type: 'account', context_id: 3, outcome_group_id: 8 })
    expect(canvas.outcomes.listGroupSubgroups).toHaveBeenCalledWith('account', 3, 8)
  })

  it('delegates get_outcome_alignments with optional filters', async () => {
    const canvas = buildMockCanvas()
    const tool = outcomeTools(canvas).find((t) => t.name === 'get_outcome_alignments')!
    await tool.handler({ course_id: 42, student_id: 10, assignment_id: 5 })
    expect(canvas.outcomes.getOutcomeAlignments).toHaveBeenCalledWith(42, {
      student_id: 10,
      assignment_id: 5,
    })
  })

  it('delegates get_outcome_contributing_scores with optional filters', async () => {
    const canvas = buildMockCanvas()
    const tool = outcomeTools(canvas).find((t) => t.name === 'get_outcome_contributing_scores')!
    await tool.handler({
      course_id: 42,
      outcome_id: 7,
      user_ids: [10, 'sis_user_id:xyz'],
      only_assignment_alignments: true,
      show_unpublished_assignments: false,
    })
    expect(canvas.outcomes.getOutcomeContributingScores).toHaveBeenCalledWith(42, 7, {
      user_ids: [10, 'sis_user_id:xyz'],
      only_assignment_alignments: true,
      show_unpublished_assignments: false,
    })
  })
})
