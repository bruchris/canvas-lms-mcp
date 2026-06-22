import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { CanvasApiError } from '../../src/canvas/client'
import { courseSetupTools } from '../../src/tools/course-setup'

interface SetupFinding {
  type: string
  id: number
  name: string
  detail: string
  parent_module_name?: string
}

interface SetupReport {
  summary: { course_id: number; checks_run: string[]; total_findings: number }
  findings: Array<{ check: string; severity: string; items: SetupFinding[] }>
}

const DEFAULT_COURSE = { id: 10, name: 'Test Course', apply_assignment_group_weights: true }

const DEFAULT_ASSIGNMENTS = [
  {
    id: 1,
    name: 'Essay 1',
    published: true,
    due_at: null,
    all_dates: [],
    grading_type: 'points',
    points_possible: 10,
  },
  {
    id: 2,
    name: 'Essay 2',
    published: true,
    due_at: '2026-09-01T23:59:00Z',
    all_dates: [],
    grading_type: 'points',
    points_possible: 20,
  },
  {
    id: 3,
    name: 'Ungraded',
    published: false,
    due_at: null,
    all_dates: [],
    grading_type: 'not_graded',
    points_possible: 0,
  },
]

const DEFAULT_GROUPS = [
  { id: 1, name: 'Homework', position: 1, group_weight: 50 },
  { id: 2, name: 'Exams', position: 2, group_weight: 50 },
]

const DEFAULT_MODULES = [
  {
    id: 1,
    name: 'Week 1',
    published: true,
    items: [
      { id: 10, module_id: 1, title: 'Reading', type: 'Page', position: 1, published: true },
      { id: 11, module_id: 1, title: 'Quiz', type: 'Quiz', position: 2, published: false },
    ],
  },
  {
    id: 2,
    name: 'Week 2 (Draft)',
    published: false,
    items: [
      { id: 20, module_id: 2, title: 'Lecture', type: 'Page', position: 1, published: false },
    ],
  },
]

function buildMockCanvas(
  overrides: {
    course?: unknown
    assignments?: unknown[]
    groups?: unknown[]
    modules?: unknown[]
  } = {},
): CanvasClient {
  return {
    courses: {
      get: vi.fn().mockResolvedValue(overrides.course ?? DEFAULT_COURSE),
    },
    assignments: {
      list: vi.fn().mockResolvedValue(overrides.assignments ?? DEFAULT_ASSIGNMENTS),
      listGroups: vi.fn().mockResolvedValue(overrides.groups ?? DEFAULT_GROUPS),
    },
    modules: {
      listWithItems: vi.fn().mockResolvedValue(overrides.modules ?? DEFAULT_MODULES),
    },
  } as unknown as CanvasClient
}

function getTool(canvas: CanvasClient) {
  const tools = courseSetupTools(canvas)
  return tools[0]
}

async function run(canvas: CanvasClient, params: Record<string, unknown>): Promise<SetupReport> {
  return (await getTool(canvas).handler(params)) as SetupReport
}

function itemsFor(report: SetupReport, check: string): SetupFinding[] {
  return report.findings.find((f) => f.check === check)?.items ?? []
}

describe('courseSetupTools', () => {
  it('returns exactly one tool definition named check_course_setup', () => {
    const tools = courseSetupTools(buildMockCanvas())
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('check_course_setup')
  })

  it('declares read-only, open-world annotations', () => {
    const tool = getTool(buildMockCanvas())
    expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
  })

  it('runs all four checks when no checks param is supplied', async () => {
    const report = await run(buildMockCanvas(), { course_id: 10 })
    expect(report.summary.checks_run).toEqual([
      'missing_due_dates',
      'unpublished_items',
      'assignment_group_weights',
      'ungraded_setup',
    ])
    expect(report.findings).toHaveLength(4)
  })

  describe('missing_due_dates', () => {
    it('flags a published assignment with no due date', async () => {
      const report = await run(buildMockCanvas(), { course_id: 10 })
      const items = itemsFor(report, 'missing_due_dates')
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ type: 'assignment', id: 1, name: 'Essay 1' })
      expect(items[0].detail).toContain('published, no due_at')
    })

    it('skips unpublished assignments even when due_at is null', async () => {
      const report = await run(buildMockCanvas(), { course_id: 10 })
      const items = itemsFor(report, 'missing_due_dates')
      expect(items.some((i) => i.id === 3)).toBe(false)
    })

    it('skips an assignment that has an override due date', async () => {
      const canvas = buildMockCanvas({
        assignments: [
          {
            id: 1,
            name: 'Essay 1',
            published: true,
            due_at: null,
            all_dates: [{ due_at: '2026-09-15T23:59:00Z', unlock_at: null, lock_at: null }],
            grading_type: 'points',
            points_possible: 10,
          },
        ],
      })
      const report = await run(canvas, { course_id: 10 })
      const items = itemsFor(report, 'missing_due_dates')
      expect(items.some((i) => i.id === 1)).toBe(false)
    })

    it('still flags when all_dates is populated but every entry has a null due date', async () => {
      // Canvas inlines a base entry (base: true) in all_dates that mirrors the
      // top-level due_at. When due_at is null the base entry is also null, so a
      // populated-but-all-null all_dates must NOT suppress the finding. This pins
      // the spec's explicit warning against adding a `!d.base` exclusion filter.
      const canvas = buildMockCanvas({
        assignments: [
          {
            id: 1,
            name: 'Essay 1',
            published: true,
            due_at: null,
            all_dates: [
              { base: true, due_at: null, unlock_at: null, lock_at: null },
              { due_at: null, unlock_at: null, lock_at: null },
            ],
            grading_type: 'points',
            points_possible: 10,
          },
        ],
      })
      const report = await run(canvas, { course_id: 10 })
      const items = itemsFor(report, 'missing_due_dates')
      expect(items).toContainEqual(expect.objectContaining({ type: 'assignment', id: 1 }))
    })

    it('is skipped when not requested but assignments are still fetched for other checks', async () => {
      const canvas = buildMockCanvas()
      const report = await run(canvas, { course_id: 10, checks: ['ungraded_setup'] })
      expect(canvas.assignments.list).toHaveBeenCalled()
      expect(report.summary.checks_run).toEqual(['ungraded_setup'])
      expect(report.findings.some((f) => f.check === 'missing_due_dates')).toBe(false)
    })
  })

  describe('unpublished_items', () => {
    it('flags an unpublished assignment', async () => {
      const report = await run(buildMockCanvas(), { course_id: 10 })
      const items = itemsFor(report, 'unpublished_items')
      expect(items).toContainEqual(
        expect.objectContaining({ type: 'assignment', id: 3, name: 'Ungraded' }),
      )
    })

    it('flags an unpublished module', async () => {
      const report = await run(buildMockCanvas(), { course_id: 10 })
      const items = itemsFor(report, 'unpublished_items')
      expect(items).toContainEqual(
        expect.objectContaining({ type: 'module', id: 2, name: 'Week 2 (Draft)' }),
      )
    })

    it('flags an unpublished item inside a published module', async () => {
      const report = await run(buildMockCanvas(), { course_id: 10 })
      const items = itemsFor(report, 'unpublished_items')
      expect(items).toContainEqual(
        expect.objectContaining({
          type: 'module_item',
          id: 11,
          name: 'Quiz',
          parent_module_name: 'Week 1',
        }),
      )
    })

    it('does not flag items inside an unpublished module individually', async () => {
      const report = await run(buildMockCanvas(), { course_id: 10 })
      const items = itemsFor(report, 'unpublished_items')
      // The unpublished module itself is reported once...
      expect(items.filter((i) => i.type === 'module' && i.id === 2)).toHaveLength(1)
      // ...but its child item (id 20) must NOT appear as a module_item finding.
      expect(items.some((i) => i.type === 'module_item' && i.id === 20)).toBe(false)
    })

    it('returns an empty items array when everything is published', async () => {
      const canvas = buildMockCanvas({
        assignments: [
          {
            id: 1,
            name: 'Essay 1',
            published: true,
            due_at: '2026-09-01T23:59:00Z',
            all_dates: [],
            grading_type: 'points',
            points_possible: 10,
          },
        ],
        modules: [
          {
            id: 1,
            name: 'Week 1',
            published: true,
            items: [
              {
                id: 10,
                module_id: 1,
                title: 'Reading',
                type: 'Page',
                position: 1,
                published: true,
              },
            ],
          },
        ],
      })
      const report = await run(canvas, { course_id: 10 })
      expect(itemsFor(report, 'unpublished_items')).toEqual([])
    })

    it('does not fetch modules when unpublished_items is not requested', async () => {
      const canvas = buildMockCanvas()
      await run(canvas, { course_id: 10, checks: ['missing_due_dates'] })
      expect(canvas.modules.listWithItems).not.toHaveBeenCalled()
    })
  })

  describe('assignment_group_weights', () => {
    it('produces no finding when weights sum to 100', async () => {
      const report = await run(buildMockCanvas(), { course_id: 10 })
      expect(itemsFor(report, 'assignment_group_weights')).toEqual([])
    })

    it('flags weights that do not sum to 100', async () => {
      const canvas = buildMockCanvas({
        groups: [
          { id: 1, name: 'Homework', position: 1, group_weight: 40 },
          { id: 2, name: 'Exams', position: 2, group_weight: 50 },
        ],
      })
      const report = await run(canvas, { course_id: 10 })
      const items = itemsFor(report, 'assignment_group_weights')
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ type: 'course', id: 10, name: 'Test Course' })
      expect(items[0].detail).toContain('sum to 90.00, not 100')
    })

    it('does not flag a sum within the 0.5 rounding tolerance', async () => {
      // Three groups each rounded to 2dp can accumulate rounding error; 99.98 is
      // a legitimate "sums to 100" course and must not produce a false positive.
      // Pins the spec's deliberate 0.5 tolerance against a regression to a tight bound.
      const canvas = buildMockCanvas({
        groups: [
          { id: 1, name: 'A', position: 1, group_weight: 33.33 },
          { id: 2, name: 'B', position: 2, group_weight: 33.33 },
          { id: 3, name: 'C', position: 3, group_weight: 33.32 },
        ],
      })
      const report = await run(canvas, { course_id: 10 })
      expect(itemsFor(report, 'assignment_group_weights')).toEqual([])
    })

    it('flags a sum just outside the 0.5 tolerance', async () => {
      const canvas = buildMockCanvas({
        groups: [
          { id: 1, name: 'Homework', position: 1, group_weight: 49.4 },
          { id: 2, name: 'Exams', position: 2, group_weight: 50 },
        ],
      })
      const report = await run(canvas, { course_id: 10 })
      const items = itemsFor(report, 'assignment_group_weights')
      expect(items).toHaveLength(1)
      expect(items[0].detail).toContain('sum to 99.40, not 100')
    })

    it('treats a group with no group_weight as contributing zero', async () => {
      // Canvas can omit group_weight; the `?? 0` fallback must not poison the sum
      // with NaN. Here 100 + (missing) should read as 100 → no finding.
      const canvas = buildMockCanvas({
        groups: [
          { id: 1, name: 'Everything', position: 1, group_weight: 100 },
          { id: 2, name: 'Unweighted', position: 2 },
        ],
      })
      const report = await run(canvas, { course_id: 10 })
      expect(itemsFor(report, 'assignment_group_weights')).toEqual([])
    })

    it('produces no finding when weighting is disabled but still fetches the data on a full run', async () => {
      const canvas = buildMockCanvas({
        course: { id: 10, name: 'Test Course', apply_assignment_group_weights: false },
        groups: [
          { id: 1, name: 'Homework', position: 1, group_weight: 40 },
          { id: 2, name: 'Exams', position: 2, group_weight: 50 },
        ],
      })
      const report = await run(canvas, { course_id: 10 })
      expect(canvas.courses.get).toHaveBeenCalled()
      expect(canvas.assignments.listGroups).toHaveBeenCalled()
      expect(itemsFor(report, 'assignment_group_weights')).toEqual([])
    })

    it('does not fetch course or groups when the weight check is not requested', async () => {
      const canvas = buildMockCanvas()
      await run(canvas, { course_id: 10, checks: ['missing_due_dates', 'unpublished_items'] })
      expect(canvas.assignments.listGroups).not.toHaveBeenCalled()
      expect(canvas.courses.get).not.toHaveBeenCalled()
    })
  })

  describe('ungraded_setup', () => {
    it('flags a graded assignment with zero points', async () => {
      const canvas = buildMockCanvas({
        assignments: [
          {
            id: 4,
            name: 'Extra Credit',
            published: true,
            due_at: null,
            all_dates: [],
            grading_type: 'points',
            points_possible: 0,
          },
        ],
      })
      const report = await run(canvas, { course_id: 10 })
      const items = itemsFor(report, 'ungraded_setup')
      expect(items).toContainEqual(
        expect.objectContaining({ type: 'assignment', id: 4, name: 'Extra Credit' }),
      )
      const finding = items.find((i) => i.id === 4)!
      expect(finding.detail).toContain('grading_type is "points"')
      expect(finding.detail).toContain('points_possible is 0')
    })

    it('does not flag a not_graded assignment with zero points', async () => {
      const canvas = buildMockCanvas({
        assignments: [
          {
            id: 6,
            name: 'Survey',
            published: true,
            due_at: null,
            all_dates: [],
            grading_type: 'not_graded',
            points_possible: 0,
          },
        ],
      })
      const report = await run(canvas, { course_id: 10 })
      expect(itemsFor(report, 'ungraded_setup').some((i) => i.id === 6)).toBe(false)
    })

    it('does not flag an unpublished graded-zero assignment', async () => {
      const canvas = buildMockCanvas({
        assignments: [
          {
            id: 5,
            name: 'Draft Zero',
            published: false,
            due_at: null,
            all_dates: [],
            grading_type: 'points',
            points_possible: 0,
          },
        ],
      })
      const report = await run(canvas, { course_id: 10 })
      expect(itemsFor(report, 'ungraded_setup').some((i) => i.id === 5)).toBe(false)
    })

    it('does not flag graded assignments with more than zero points', async () => {
      const report = await run(buildMockCanvas(), { course_id: 10 })
      const items = itemsFor(report, 'ungraded_setup')
      expect(items.some((i) => i.id === 1)).toBe(false)
      expect(items.some((i) => i.id === 2)).toBe(false)
    })

    it('does not flag an assignment whose points_possible is null', async () => {
      // The check uses strict `=== 0`, so a null/undefined points_possible (which
      // Canvas can return for some assignment types) does not trigger a finding.
      const canvas = buildMockCanvas({
        assignments: [
          {
            id: 7,
            name: 'No Points Field',
            published: true,
            due_at: '2026-09-01T23:59:00Z',
            all_dates: [],
            grading_type: 'points',
            points_possible: null,
          },
        ],
      })
      const report = await run(canvas, { course_id: 10 })
      expect(itemsFor(report, 'ungraded_setup').some((i) => i.id === 7)).toBe(false)
    })
  })

  describe('checks filter', () => {
    it('runs only the requested subset and skips unneeded fetches', async () => {
      const canvas = buildMockCanvas()
      const report = await run(canvas, {
        course_id: 10,
        checks: ['missing_due_dates', 'ungraded_setup'],
      })
      expect(report.summary.checks_run).toHaveLength(2)
      expect(report.findings).toHaveLength(2)
      expect(canvas.modules.listWithItems).not.toHaveBeenCalled()
      expect(canvas.assignments.listGroups).not.toHaveBeenCalled()
      expect(canvas.courses.get).not.toHaveBeenCalled()
    })

    it('reports total_findings equal to the sum of all item counts', async () => {
      const report = await run(buildMockCanvas(), { course_id: 10 })
      const summed = report.findings.reduce((n, f) => n + f.items.length, 0)
      expect(report.summary.total_findings).toBe(summed)
    })
  })

  describe('error propagation', () => {
    it('rejects (does not swallow) when a Canvas fetch fails', async () => {
      // The no-silent-failure guarantee relies on the handler re-throwing so the
      // central catch in src/tools/index.ts can surface the error. A regression
      // that wrapped a fetch in a swallowing try/catch (returning an empty report)
      // would be caught here.
      const canvas = buildMockCanvas()
      ;(canvas.assignments.list as ReturnType<typeof vi.fn>).mockRejectedValue(
        new CanvasApiError('Not Found', 404, '/api/v1/courses/10/assignments'),
      )
      await expect(getTool(canvas).handler({ course_id: 10 })).rejects.toThrow(CanvasApiError)
    })
  })
})
