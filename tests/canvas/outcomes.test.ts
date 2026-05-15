import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasHttpClient } from '../../src/canvas/client'
import { OutcomesModule } from '../../src/canvas/outcomes'

describe('OutcomesModule', () => {
  let client: CanvasHttpClient
  let outcomes: OutcomesModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    outcomes = new OutcomesModule(client)
  })

  it('gets the root outcome group for a course context', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ id: 7, title: 'Course Outcomes' })
    const result = await outcomes.getRootOutcomeGroup('course', 42)
    expect(result).toMatchObject({ id: 7, title: 'Course Outcomes' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/42/root_outcome_group')
  })

  it('lists outcome groups for an account context', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 1, title: 'Institution Outcomes' }])
    const result = await outcomes.listOutcomeGroups('account', 9)
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/accounts/9/outcome_groups')
  })

  it('lists outcome group links with detail params', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 1 }])
    await outcomes.listOutcomeGroupLinks('course', 42, {
      outcome_style: 'full',
      outcome_group_style: 'full',
    })
    expect(client.paginate).toHaveBeenCalledWith(
      '/api/v1/courses/42/outcome_group_links?outcome_style=full&outcome_group_style=full',
    )
  })

  it('gets a specific outcome group', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ id: 13, title: 'Writing Skills' })
    const result = await outcomes.getOutcomeGroup('course', 42, 13)
    expect(result).toMatchObject({ id: 13, title: 'Writing Skills' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/42/outcome_groups/13')
  })

  it('lists outcomes in an outcome group with optional detail level', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 2 }])
    await outcomes.listGroupOutcomes('account', 9, 3, { outcome_style: 'full' })
    expect(client.paginate).toHaveBeenCalledWith(
      '/api/v1/accounts/9/outcome_groups/3/outcomes?outcome_style=full',
    )
  })

  it('lists subgroups in an outcome group', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([{ id: 5, title: 'Subgroup' }])
    const result = await outcomes.listGroupSubgroups('course', 42, 3)
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/42/outcome_groups/3/subgroups')
  })

  it('gets an outcome with add_defaults enabled', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ id: 8, title: 'Critical Thinking' })
    const result = await outcomes.getOutcome(8, { add_defaults: true })
    expect(result).toMatchObject({ id: 8, title: 'Critical Thinking' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/outcomes/8?add_defaults=true')
  })

  it('gets outcome alignments for a student and assignment filter', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce([{ id: 9, title: 'Quiz 1' }])
    const result = await outcomes.getOutcomeAlignments(42, {
      student_id: 55,
      assignment_id: 99,
    })
    expect(result).toHaveLength(1)
    expect(client.request).toHaveBeenCalledWith(
      '/api/v1/courses/42/outcome_alignments?student_id=55&assignment_id=99',
    )
  })

  it('gets outcome results with repeated user and outcome filters', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ outcome_results: [] })
    await outcomes.getOutcomeResults(42, {
      user_ids: [10, 'sis_user_id:abc'],
      outcome_ids: [1, 2],
      include_alignments: true,
      include_hidden: true,
    })
    expect(client.request).toHaveBeenCalledWith(
      '/api/v1/courses/42/outcome_results?user_ids%5B%5D=10&user_ids%5B%5D=sis_user_id%3Aabc&outcome_ids%5B%5D=1&outcome_ids%5B%5D=2&include%5B%5D=alignments&include_hidden=true',
    )
  })

  it('gets outcome results with no options — no query string appended', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ outcome_results: [] })
    await outcomes.getOutcomeResults(42)
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/42/outcome_results')
  })

  it('omits include[]=alignments when include_alignments is false', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ outcome_results: [] })
    await outcomes.getOutcomeResults(42, { include_alignments: false })
    const url = vi.mocked(client.request).mock.calls[0][0] as string
    expect(url).not.toContain('alignments')
  })

  it('gets outcome rollups with aggregate, filters, and sorting options', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ rollups: [] })
    await outcomes.getOutcomeRollups(42, {
      aggregate: 'course',
      aggregate_stat: 'median',
      user_ids: [10],
      outcome_ids: [3],
      include_courses: true,
      exclude: ['missing_user_rollups'],
      sort_by: 'outcome',
      sort_outcome_id: 3,
      sort_order: 'desc',
      add_defaults: true,
    })
    expect(client.request).toHaveBeenCalledWith(
      '/api/v1/courses/42/outcome_rollups?aggregate=course&aggregate_stat=median&user_ids%5B%5D=10&outcome_ids%5B%5D=3&include%5B%5D=courses&exclude%5B%5D=missing_user_rollups&sort_by=outcome&sort_outcome_id=3&sort_order=desc&add_defaults=true',
    )
  })

  it('gets outcome rollups with no options — no query string appended', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ rollups: [] })
    await outcomes.getOutcomeRollups(42)
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/42/outcome_rollups')
  })

  it('omits include[]=courses when include_courses is false', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ rollups: [] })
    await outcomes.getOutcomeRollups(42, { include_courses: false })
    const url = vi.mocked(client.request).mock.calls[0][0] as string
    expect(url).not.toContain('include')
  })

  it('gets contributing scores for a specific outcome', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ scores: [] })
    await outcomes.getOutcomeContributingScores(42, 8, {
      user_ids: [10],
      only_assignment_alignments: true,
      show_unpublished_assignments: true,
    })
    expect(client.request).toHaveBeenCalledWith(
      '/api/v1/courses/42/outcomes/8/contributing_scores?user_ids%5B%5D=10&only_assignment_alignments=true&show_unpublished_assignments=true',
    )
  })

  it('gets contributing scores with no options — no query string appended', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ scores: [] })
    await outcomes.getOutcomeContributingScores(42, 8)
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/42/outcomes/8/contributing_scores')
  })

  it('gets outcome mastery distribution with alignment distributions', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ outcomes: [] })
    await outcomes.getOutcomeMasteryDistribution(42, {
      exclude: ['missing_outcome_results'],
      outcome_ids: [8],
      student_ids: [10],
      include_alignment_distributions: true,
      only_assignment_alignments: true,
      show_unpublished_assignments: true,
      add_defaults: true,
    })
    expect(client.request).toHaveBeenCalledWith(
      '/api/v1/courses/42/outcome_mastery_distribution?exclude%5B%5D=missing_outcome_results&outcome_ids%5B%5D=8&student_ids%5B%5D=10&include%5B%5D=alignment_distributions&only_assignment_alignments=true&show_unpublished_assignments=true&add_defaults=true',
    )
  })

  it('gets outcome mastery distribution with no options — no query string appended', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ outcomes: [] })
    await outcomes.getOutcomeMasteryDistribution(42)
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/42/outcome_mastery_distribution')
  })

  it('omits include[]=alignment_distributions when include_alignment_distributions is false', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ outcomes: [] })
    await outcomes.getOutcomeMasteryDistribution(42, { include_alignment_distributions: false })
    const url = vi.mocked(client.request).mock.calls[0][0] as string
    expect(url).not.toContain('alignment_distributions')
  })
})
