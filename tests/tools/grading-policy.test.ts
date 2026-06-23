import { describe, expect, it, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { CanvasApiError } from '../../src/canvas/client'
import type { CanvasLatePolicy } from '../../src/canvas/types'
import { gradingPolicyTools } from '../../src/tools/grading-policy'

// ── Output shape (mirrors the tool contract; partial for assertion typing) ───

interface PolicyBlock {
  source: 'api' | 'default'
  enabled: boolean
  deduction_percent: number
}

interface LateBlock extends PolicyBlock {
  interval: 'hour' | 'day'
  minimum_percent_enabled: boolean
  minimum_percent: number
}

interface GradingPolicyOut {
  course: { id: number; name: string }
  missing_submission_policy: PolicyBlock | null
  late_submission_policy: LateBlock | null
  group_weighting: {
    weighted: boolean
    groups: Array<{ id: number; name: string; weight: number }>
  }
  grading_scheme: { applied: boolean; standard_id: number | null; standard_title: string | null }
  summary: string
  caveats: string[]
}

// ── Fixtures helpers ─────────────────────────────────────────────────────────

function latePolicy(p: Partial<CanvasLatePolicy> = {}): CanvasLatePolicy {
  return {
    late_submission_deduction_enabled: false,
    late_submission_deduction: 0,
    late_submission_interval: 'day',
    late_submission_minimum_percent_enabled: false,
    late_submission_minimum_percent: 0,
    missing_submission_deduction_enabled: false,
    missing_submission_deduction: 0,
    ...p,
  }
}

interface MockOverrides {
  /** Resolved late-policy value. Ignored when `latePolicyError` is set. */
  latePolicy?: CanvasLatePolicy
  /** When set, `canvas.latePolicy.get` rejects with this error. */
  latePolicyError?: unknown
  course?: unknown
  groups?: unknown[]
  courseStandards?: unknown[]
  accountStandards?: unknown[]
}

function buildMockCanvas(o: MockOverrides = {}): CanvasClient {
  const latePolicyGet =
    o.latePolicyError !== undefined
      ? vi.fn().mockRejectedValue(o.latePolicyError)
      : vi.fn().mockResolvedValue(o.latePolicy ?? latePolicy())
  return {
    latePolicy: { get: latePolicyGet },
    courses: {
      get: vi.fn().mockResolvedValue(o.course ?? { id: 1, name: 'Course' }),
    },
    assignments: {
      listGroups: vi.fn().mockResolvedValue(o.groups ?? []),
    },
    gradingStandards: {
      listForCourse: vi.fn().mockResolvedValue(o.courseStandards ?? []),
      listForAccount: vi.fn().mockResolvedValue(o.accountStandards ?? []),
    },
  } as unknown as CanvasClient
}

async function run(
  overrides: MockOverrides,
  params: Record<string, unknown> = { course_id: 1 },
): Promise<{ result: GradingPolicyOut; canvas: CanvasClient }> {
  const canvas = buildMockCanvas(overrides)
  const result = (await gradingPolicyTools(canvas)[0].handler(params)) as GradingPolicyOut
  return { result, canvas }
}

// ── Tool metadata ────────────────────────────────────────────────────────────

describe('explain_grading_policy — metadata', () => {
  it('is a read-only, open-world tool with the expected name', () => {
    const tool = gradingPolicyTools(buildMockCanvas())[0]
    expect(tool.name).toBe('explain_grading_policy')
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    })
  })
})

// ── Fixture A — full instructor view ─────────────────────────────────────────

describe('explain_grading_policy — Fixture A (auto-zero + late penalty + weighted + scheme)', () => {
  const overrides: MockOverrides = {
    course: {
      id: 1,
      name: 'Physics 101',
      apply_assignment_group_weights: true,
      grading_standard_id: 42,
      account_id: 10,
    },
    latePolicy: latePolicy({
      missing_submission_deduction_enabled: true,
      missing_submission_deduction: 100,
      late_submission_deduction_enabled: true,
      late_submission_deduction: 10,
      late_submission_interval: 'day',
      late_submission_minimum_percent_enabled: true,
      late_submission_minimum_percent: 50,
    }),
    groups: [
      { id: 1, name: 'Exams', group_weight: 60 },
      { id: 2, name: 'Homework', group_weight: 40 },
    ],
    courseStandards: [{ id: 42, title: 'Default Grading Scale', grading_scheme: [] }],
  }

  it('surfaces the full policy with an instructor-facing summary', async () => {
    const { result } = await run(overrides)
    expect(result.missing_submission_policy).toEqual({
      source: 'api',
      enabled: true,
      deduction_percent: 100,
    })
    expect(result.late_submission_policy).toEqual({
      source: 'api',
      enabled: true,
      deduction_percent: 10,
      interval: 'day',
      minimum_percent_enabled: true,
      minimum_percent: 50,
    })
    expect(result.group_weighting.weighted).toBe(true)
    expect(result.group_weighting.groups).toEqual([
      { id: 1, name: 'Exams', weight: 60 },
      { id: 2, name: 'Homework', weight: 40 },
    ])
    expect(result.grading_scheme.applied).toBe(true)
    expect(result.grading_scheme.standard_title).toBe('Default Grading Scale')
    for (const fragment of ['auto-zero', '10%', 'day', '50%', 'Exams', 'Homework']) {
      expect(result.summary).toContain(fragment)
    }
    expect(result.caveats).toEqual([])
  })
})

// ── Fixture B — no policy configured (404) ───────────────────────────────────

describe('explain_grading_policy — Fixture B (late_policy 404)', () => {
  const overrides: MockOverrides = {
    course: {
      id: 1,
      name: 'Course',
      apply_assignment_group_weights: false,
      grading_standard_id: null,
    },
    latePolicyError: new CanvasApiError('Not Found', 404, '/api/v1/courses/1/late_policy'),
    groups: [{ id: 1, name: 'Assignments', group_weight: 0 }],
  }

  it('normalises a 404 to defaults (source: default), no caveat', async () => {
    const { result } = await run(overrides)
    expect(result.missing_submission_policy).not.toBeNull()
    expect(result.missing_submission_policy?.enabled).toBe(false)
    expect(result.missing_submission_policy?.source).toBe('default')
    expect(result.late_submission_policy?.enabled).toBe(false)
    expect(result.late_submission_policy?.source).toBe('default')
    expect(result.group_weighting.weighted).toBe(false)
    expect(result.grading_scheme.applied).toBe(false)
    expect(result.grading_scheme.standard_id).toBeNull()
    for (const fragment of ['No automatic', 'not weighted', 'No letter-grade']) {
      expect(result.summary).toContain(fragment)
    }
    expect(result.caveats).toEqual([])
  })
})

// ── Fixture C — student token (403) ──────────────────────────────────────────

describe('explain_grading_policy — Fixture C (late_policy 403)', () => {
  const overrides: MockOverrides = {
    course: {
      id: 1,
      name: 'Course',
      apply_assignment_group_weights: true,
      grading_standard_id: null,
    },
    latePolicyError: new CanvasApiError('Forbidden', 403, '/api/v1/courses/1/late_policy'),
    groups: [{ id: 1, name: 'Exams', group_weight: 100 }],
  }

  it('returns null policy blocks and exactly one permission caveat', async () => {
    const { result } = await run(overrides)
    expect(result.missing_submission_policy).toBeNull()
    expect(result.late_submission_policy).toBeNull()
    expect(result.group_weighting.weighted).toBe(true)
    expect(result.group_weighting.groups[0]?.weight).toBe(100)
    expect(result.caveats).toHaveLength(1)
    expect(result.caveats[0]).toContain('instructor or admin permissions')
    for (const fragment of ['Exams', '100%', 'instructor permissions']) {
      expect(result.summary).toContain(fragment)
    }
  })
})

// ── Fixture D — account-scoped grading standard (two-level fallback) ──────────

describe('explain_grading_policy — Fixture D (account-scoped standard)', () => {
  const overrides: MockOverrides = {
    course: {
      id: 1,
      name: 'Course',
      apply_assignment_group_weights: false,
      grading_standard_id: 42,
      account_id: 10,
    },
    latePolicy: latePolicy(),
    courseStandards: [],
    accountStandards: [{ id: 42, title: 'Institutional Scale', grading_scheme: [] }],
    groups: [{ id: 1, name: 'Assignments', group_weight: 0 }],
  }

  it('falls back to the account standard and records both lookups', async () => {
    const { result, canvas } = await run(overrides)
    expect(result.grading_scheme.applied).toBe(true)
    expect(result.grading_scheme.standard_title).toBe('Institutional Scale')
    expect(canvas.gradingStandards.listForCourse).toHaveBeenCalledWith(1)
    expect(canvas.gradingStandards.listForAccount).toHaveBeenCalledWith(10)
    expect(result.caveats).toEqual([])
  })
})

// ── Fixture E — grading standard not retrievable at either level ──────────────

describe('explain_grading_policy — Fixture E (standard unretrievable)', () => {
  const overrides: MockOverrides = {
    course: {
      id: 1,
      name: 'Course',
      apply_assignment_group_weights: false,
      grading_standard_id: 99,
      account_id: 10,
    },
    latePolicy: latePolicy(),
    courseStandards: [{ id: 1, title: 'Other', grading_scheme: [] }],
    accountStandards: [],
    groups: [{ id: 1, name: 'Assignments', group_weight: 0 }],
  }

  it('reports applied but with a null title and a retrieval caveat', async () => {
    const { result } = await run(overrides)
    expect(result.grading_scheme.applied).toBe(true)
    expect(result.grading_scheme.standard_id).toBe(99)
    expect(result.grading_scheme.standard_title).toBeNull()
    expect(
      result.caveats.some((c) => c.includes('Grading standard (id: 99) could not be retrieved')),
    ).toBe(true)
  })
})

// ── Fixture F — late penalty with no floor ───────────────────────────────────

describe('explain_grading_policy — Fixture F (late penalty, no floor)', () => {
  const overrides: MockOverrides = {
    course: {
      id: 1,
      name: 'Course',
      apply_assignment_group_weights: false,
      grading_standard_id: null,
    },
    latePolicy: latePolicy({
      late_submission_deduction_enabled: true,
      late_submission_deduction: 5,
      late_submission_interval: 'hour',
      late_submission_minimum_percent_enabled: false,
      late_submission_minimum_percent: 0,
    }),
    groups: [{ id: 1, name: 'Assignments', group_weight: 0 }],
  }

  it('omits the floor sentence when no minimum is configured', async () => {
    const { result } = await run(overrides)
    expect(result.late_submission_policy?.minimum_percent_enabled).toBe(false)
    expect(result.late_submission_policy?.minimum_percent).toBe(0)
    expect(result.summary).toContain('5%')
    expect(result.summary).toContain('hour')
    expect(result.summary).not.toContain('floor')
    expect(result.summary).not.toContain('minimum')
    expect(result.summary).not.toContain('below')
  })
})

// ── Fixture G — deduction 0 with policy enabled (edge case) ───────────────────

describe('explain_grading_policy — Fixture G (enabled, 0% deduction)', () => {
  const overrides: MockOverrides = {
    course: {
      id: 1,
      name: 'Course',
      apply_assignment_group_weights: false,
      grading_standard_id: null,
    },
    latePolicy: latePolicy({
      missing_submission_deduction_enabled: true,
      missing_submission_deduction: 0,
    }),
    groups: [{ id: 1, name: 'Assignments', group_weight: 0 }],
  }

  it('says "no deduction (0%)" rather than inferring 100%', async () => {
    const { result } = await run(overrides)
    expect(result.summary).toContain('no deduction (0%)')
    expect(result.summary).not.toContain('100%')
  })
})

// ── Error propagation — required calls ───────────────────────────────────────

describe('explain_grading_policy — required-call failures propagate', () => {
  it('propagates a non-403/404 error from the late_policy call', async () => {
    const canvas = buildMockCanvas({
      course: { id: 1, name: 'Course', grading_standard_id: null },
      latePolicyError: new CanvasApiError('Server Error', 500, '/api/v1/courses/1/late_policy'),
      groups: [{ id: 1, name: 'Assignments', group_weight: 0 }],
    })
    await expect(gradingPolicyTools(canvas)[0].handler({ course_id: 1 })).rejects.toThrow(
      CanvasApiError,
    )
  })

  it('propagates a failure from the required course call', async () => {
    const canvas = {
      latePolicy: { get: vi.fn().mockResolvedValue(latePolicy()) },
      courses: {
        get: vi.fn().mockRejectedValue(new CanvasApiError('Not Found', 404, '/api/v1/courses/1')),
      },
      assignments: { listGroups: vi.fn().mockResolvedValue([]) },
      gradingStandards: {
        listForCourse: vi.fn().mockResolvedValue([]),
        listForAccount: vi.fn().mockResolvedValue([]),
      },
    } as unknown as CanvasClient
    await expect(gradingPolicyTools(canvas)[0].handler({ course_id: 1 })).rejects.toThrow(
      CanvasApiError,
    )
  })
})
