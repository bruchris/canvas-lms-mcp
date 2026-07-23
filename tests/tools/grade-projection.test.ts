import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { CanvasApiError } from '../../src/canvas/client'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import { gradeProjectionTools } from '../../src/tools/grade-projection'

// ── Output shape (mirrors the tool contract; partial for assertion typing) ───

interface RemainingAssignmentOut {
  assignment_id: number
  assignment_name: string
  points_possible: number
  status: 'missing' | 'submitted'
}

interface GroupProjectionOut {
  group_id: number
  group_name: string
  group_weight: number
  locked_in: { earned: number; possible: number; percentage: number | null }
  remaining_points_possible: number
  remaining_assignments: RemainingAssignmentOut[]
}

interface GradeProjection {
  student: { id: number; name: string }
  course: { id: number; name: string; weighted: boolean; grading_standard_id: number | null }
  target: { requested: string; percentage: number; letter: string | null }
  current_grade: { percentage: number | null; letter: string | null }
  projection: {
    minimum_pct_on_remaining: number | null
    feasibility: 'already_secured' | 'achievable' | 'impossible'
    remaining_points_possible: number
    locked_in: { earned: number; possible: number }
    groups: GroupProjectionOut[]
  }
  caveats: string[]
  summary: string
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

interface MockOverrides {
  course?: unknown
  groups?: unknown[]
  submissions?: unknown[]
  enrollments?: unknown[]
  user?: unknown
  courseStandards?: unknown[]
  accountStandards?: unknown[]
  pseudonymizer?: Pseudonymizer
}

function buildMockCanvas(overrides: MockOverrides = {}): CanvasClient {
  return {
    courses: {
      get: vi.fn().mockResolvedValue(overrides.course ?? { id: 1, name: 'Course' }),
    },
    assignments: {
      listGroups: vi.fn().mockResolvedValue(overrides.groups ?? []),
    },
    submissions: {
      listMy: vi.fn().mockResolvedValue(overrides.submissions ?? []),
      listForStudents: vi.fn().mockResolvedValue(overrides.submissions ?? []),
    },
    enrollments: {
      listForCourse: vi.fn().mockResolvedValue(overrides.enrollments ?? []),
    },
    users: {
      getSelf: vi.fn().mockResolvedValue(overrides.user ?? { id: 1, name: 'Self User' }),
      get: vi.fn().mockResolvedValue(overrides.user ?? { id: 1, name: 'Self User' }),
    },
    gradingStandards: {
      listForCourse: vi.fn().mockResolvedValue(overrides.courseStandards ?? []),
      listForAccount: vi.fn().mockResolvedValue(overrides.accountStandards ?? []),
    },
  } as unknown as CanvasClient
}

function tool(canvas: CanvasClient, pseudonymizer?: Pseudonymizer) {
  return gradeProjectionTools(canvas, pseudonymizer)[0]
}

async function run(
  overrides: MockOverrides,
  params: Record<string, unknown>,
): Promise<GradeProjection> {
  const canvas = buildMockCanvas(overrides)
  return (await tool(canvas, overrides.pseudonymizer).handler(params)) as GradeProjection
}

function graded(assignment_id: number, score: number): unknown {
  return { assignment_id, workflow_state: 'graded', score }
}

function findGroup(result: GradeProjection, id: number): GroupProjectionOut {
  return result.projection.groups.find((g) => g.group_id === id)!
}

function pointsGroup(
  id: number,
  name: string,
  assignments: Array<{ id: number; points: number }>,
  rules?: unknown,
): unknown {
  return {
    id,
    name,
    position: id,
    group_weight: 0,
    ...(rules ? { rules } : {}),
    assignments: assignments.map((a) => ({
      id: a.id,
      name: `A${a.id}`,
      points_possible: a.points,
      grading_type: 'points',
    })),
  }
}

// ── Fixture A — points-based, achievable target (exact boundary) ─────────────

describe('project_grade — Fixture A (points-based, achievable, exact boundary)', () => {
  it('computes minimum_pct_on_remaining = 100% at the boundary', async () => {
    const result = await run(
      {
        course: {
          id: 1,
          name: 'C',
          apply_assignment_group_weights: false,
          grading_standard_id: null,
        },
        groups: [
          pointsGroup(1, 'G', [
            { id: 1, points: 100 },
            { id: 2, points: 100 },
            { id: 3, points: 100 },
          ]),
        ],
        submissions: [graded(1, 90), graded(2, 80)],
      },
      { course_id: 1, target_percentage: 90 },
    )
    expect(result.projection.feasibility).toBe('achievable')
    expect(result.projection.minimum_pct_on_remaining).toBeCloseTo(100, 2)
    expect(result.projection.remaining_points_possible).toBe(100)
    expect(result.projection.locked_in.earned).toBe(170)
    expect(result.projection.locked_in.possible).toBe(200)
    const group = findGroup(result, 1)
    expect(group.remaining_assignments).toHaveLength(1)
    expect(group.remaining_assignments[0]?.assignment_id).toBe(3)
    expect(result.summary).toContain('100.0%')
  })
})

// ── Fixture B — points-based, already secured (negative x) ───────────────────

describe('project_grade — Fixture B (already secured)', () => {
  it('yields a negative x and reports already_secured', async () => {
    const result = await run(
      {
        course: {
          id: 1,
          name: 'C',
          apply_assignment_group_weights: false,
          grading_standard_id: null,
        },
        groups: [
          pointsGroup(1, 'G', [
            { id: 1, points: 100 },
            { id: 2, points: 100 },
            { id: 3, points: 20 },
          ]),
        ],
        submissions: [graded(1, 95), graded(2, 90)],
      },
      { course_id: 1, target_percentage: 80 },
    )
    expect(result.projection.feasibility).toBe('already_secured')
    expect(result.projection.minimum_pct_on_remaining).toBeCloseTo(-45, 2)
    expect(result.summary).toContain('already secured')
  })
})

// ── Fixture C — points-based, impossible target ───────────────────────────────

describe('project_grade — Fixture C (impossible)', () => {
  it('yields x > 100% and reports impossible', async () => {
    const result = await run(
      {
        course: {
          id: 1,
          name: 'C',
          apply_assignment_group_weights: false,
          grading_standard_id: null,
        },
        groups: [
          pointsGroup(1, 'G', [
            { id: 1, points: 100 },
            { id: 2, points: 100 },
            { id: 3, points: 50 },
          ]),
        ],
        submissions: [graded(1, 50), graded(2, 50)],
      },
      { course_id: 1, target_percentage: 90 },
    )
    expect(result.projection.feasibility).toBe('impossible')
    expect(result.projection.minimum_pct_on_remaining).toBeCloseTo(250, 2)
    expect(result.summary).toContain('not possible')
  })
})

// ── Fixture D — weighted course, achievable ───────────────────────────────────

describe('project_grade — Fixture D (weighted, achievable)', () => {
  it('solves the weighted linear equation across groups', async () => {
    const groups = [
      {
        id: 1,
        name: 'Homework',
        position: 1,
        group_weight: 30,
        assignments: [
          { id: 1, name: 'A1', points_possible: 100, grading_type: 'points' },
          { id: 2, name: 'A2', points_possible: 100, grading_type: 'points' },
        ],
      },
      {
        id: 2,
        name: 'Exams',
        position: 2,
        group_weight: 70,
        assignments: [
          { id: 3, name: 'A3', points_possible: 100, grading_type: 'points' },
          { id: 4, name: 'A4', points_possible: 100, grading_type: 'points' },
        ],
      },
    ]
    const result = await run(
      {
        course: {
          id: 1,
          name: 'C',
          apply_assignment_group_weights: true,
          grading_standard_id: null,
        },
        groups,
        submissions: [graded(1, 80), graded(3, 85)],
      },
      { course_id: 1, target_percentage: 90 },
    )
    expect(result.projection.feasibility).toBe('achievable')
    expect(result.projection.minimum_pct_on_remaining).toBeCloseTo(96.5, 2)
    expect(result.current_grade.percentage).toBeCloseTo(83.5, 2)
    expect(result.projection.groups).toHaveLength(2)
    for (const group of result.projection.groups) {
      expect(group.remaining_points_possible).toBe(100)
    }
  })
})

// ── Fixture E — target letter grade (resolved correctly) ─────────────────────

describe('project_grade — Fixture E (target letter)', () => {
  it('resolves target_letter to its lower-bound percentage', async () => {
    const result = await run(
      {
        course: {
          id: 1,
          name: 'C',
          apply_assignment_group_weights: false,
          grading_standard_id: 42,
        },
        groups: [
          pointsGroup(1, 'G', [
            { id: 1, points: 100 },
            { id: 2, points: 100 },
          ]),
        ],
        submissions: [graded(1, 80)],
        courseStandards: [
          {
            id: 42,
            title: 'Standard',
            context_type: 'Course',
            context_id: 1,
            grading_scheme: [
              { name: 'A', value: 0.9 },
              { name: 'B', value: 0.8 },
              { name: 'C', value: 0.7 },
              { name: 'F', value: 0.0 },
            ],
          },
        ],
      },
      { course_id: 1, target_letter: 'B' },
    )
    expect(result.target.percentage).toBe(80)
    expect(result.target.requested).toBe('B')
    expect(result.target.letter).toBe('B')
    expect(result.projection.minimum_pct_on_remaining).toBeCloseTo(80, 2)
    expect(result.projection.feasibility).toBe('achievable')
  })
})

// ── Fixture F — letter target, no grading scheme ─────────────────────────────

describe('project_grade — Fixture F (letter target, no scheme)', () => {
  it('errors when the course has no grading standard configured', async () => {
    const canvas = buildMockCanvas({
      course: {
        id: 1,
        name: 'C',
        apply_assignment_group_weights: false,
        grading_standard_id: null,
      },
      groups: [],
    })
    await expect(tool(canvas).handler({ course_id: 1, target_letter: 'A' })).rejects.toThrow(
      'no grading standard configured',
    )
  })
})

// ── Fixture G — letter target, letter not in scheme ──────────────────────────

describe('project_grade — Fixture G (letter target, letter not in scheme)', () => {
  it('errors with a valid-letters list', async () => {
    const canvas = buildMockCanvas({
      course: { id: 1, name: 'C', apply_assignment_group_weights: false, grading_standard_id: 42 },
      groups: [],
      courseStandards: [
        {
          id: 42,
          title: 'Standard',
          context_type: 'Course',
          context_id: 1,
          grading_scheme: [
            { name: 'A', value: 0.9 },
            { name: 'F', value: 0.0 },
          ],
        },
      ],
    })
    await expect(tool(canvas).handler({ course_id: 1, target_letter: 'B' })).rejects.toThrow(
      /Letter grade 'B' is not in the course grading scheme.*A, F/,
    )
  })
})

// ── Fixture H — drop-lowest interaction ───────────────────────────────────────

describe('project_grade — Fixture H (drop_lowest interaction)', () => {
  it('excludes the dropped item from locked-in and adds a drop-rules caveat', async () => {
    const result = await run(
      {
        course: {
          id: 1,
          name: 'C',
          apply_assignment_group_weights: false,
          grading_standard_id: null,
        },
        groups: [
          pointsGroup(
            1,
            'G',
            [
              { id: 1, points: 50 },
              { id: 2, points: 50 },
              { id: 3, points: 50 },
            ],
            { drop_lowest: 1 },
          ),
        ],
        submissions: [graded(1, 10), graded(2, 40)],
      },
      { course_id: 1, target_percentage: 80 },
    )
    expect(result.projection.locked_in.earned).toBe(40)
    expect(result.projection.locked_in.possible).toBe(50)
    expect(result.projection.remaining_points_possible).toBe(50)
    expect(result.projection.minimum_pct_on_remaining).toBeCloseTo(80, 2)
    expect(result.caveats.some((c) => c.toLowerCase().includes('drop rules'))).toBe(true)
  })
})

// ── Fixture I — no remaining work, already secured ────────────────────────────

describe('project_grade — Fixture I (no remaining work, secured)', () => {
  it('returns a null minimum and already_secured', async () => {
    const result = await run(
      {
        course: {
          id: 1,
          name: 'C',
          apply_assignment_group_weights: false,
          grading_standard_id: null,
        },
        groups: [
          pointsGroup(1, 'G', [
            { id: 1, points: 100 },
            { id: 2, points: 100 },
          ]),
        ],
        submissions: [graded(1, 95), graded(2, 90)],
      },
      { course_id: 1, target_percentage: 80 },
    )
    expect(result.projection.minimum_pct_on_remaining).toBeNull()
    expect(result.projection.feasibility).toBe('already_secured')
    expect(result.projection.remaining_points_possible).toBe(0)
    expect(result.current_grade.percentage).toBeCloseTo(92.5, 2)
  })
})

// ── Fixture J — no remaining work, impossible ─────────────────────────────────

describe('project_grade — Fixture J (no remaining work, impossible)', () => {
  it('returns a null minimum and impossible', async () => {
    const result = await run(
      {
        course: {
          id: 1,
          name: 'C',
          apply_assignment_group_weights: false,
          grading_standard_id: null,
        },
        groups: [
          pointsGroup(1, 'G', [
            { id: 1, points: 100 },
            { id: 2, points: 100 },
          ]),
        ],
        submissions: [graded(1, 50), graded(2, 60)],
      },
      { course_id: 1, target_percentage: 90 },
    )
    expect(result.projection.minimum_pct_on_remaining).toBeNull()
    expect(result.projection.feasibility).toBe('impossible')
  })
})

// ── Fixture K — FERPA pseudonymization ────────────────────────────────────────

describe('project_grade — Fixture K (FERPA pseudonymization)', () => {
  let tmpRoot: string
  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'grade-project-'))
  })
  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('pseudonymizes a specified student but preserves the numeric id', async () => {
    const ps = new Pseudonymizer({
      baseUrl: 'https://school.instructure.com/api/v1',
      rootDir: tmpRoot,
      env: { CANVAS_PSEUDONYMIZE_STUDENTS: 'true' },
    })
    const result = await run(
      {
        course: {
          id: 1,
          name: 'C',
          apply_assignment_group_weights: false,
          grading_standard_id: null,
        },
        groups: [],
        user: { id: 1234, name: 'Alice Student' },
        pseudonymizer: ps,
      },
      { course_id: 1, target_percentage: 90, student_id: 1234 },
    )
    expect(result.student.name).toMatch(/^Student \d+$/)
    expect(result.student.id).toBe(1234)
  })
})

// ── Fixture L — weighted course, inactive group excluded ─────────────────────

describe('project_grade — Fixture L (weighted, inactive group excluded)', () => {
  it('excludes a group with no assignments from active_weight_sum', async () => {
    const result = await run(
      {
        course: {
          id: 1,
          name: 'C',
          apply_assignment_group_weights: true,
          grading_standard_id: null,
        },
        groups: [
          {
            id: 1,
            name: 'Exams',
            position: 1,
            group_weight: 70,
            assignments: [
              { id: 1, name: 'A1', points_possible: 100, grading_type: 'points' },
              { id: 2, name: 'A2', points_possible: 100, grading_type: 'points' },
            ],
          },
          {
            id: 2,
            name: 'Extra Credit',
            position: 2,
            group_weight: 10,
            assignments: [],
          },
        ],
        submissions: [graded(1, 80)],
      },
      { course_id: 1, target_percentage: 90 },
    )
    expect(result.projection.minimum_pct_on_remaining).toBeCloseTo(100, 2)
    expect(result.projection.feasibility).toBe('achievable')
    expect(result.caveats.some((c) => c.includes('no assignment groups'))).toBe(false)
  })
})

// ── Input validation ──────────────────────────────────────────────────────────

describe('project_grade — input validation', () => {
  it('rejects when both target_percentage and target_letter are provided', async () => {
    const canvas = buildMockCanvas()
    await expect(
      tool(canvas).handler({ course_id: 1, target_percentage: 90, target_letter: 'A' }),
    ).rejects.toThrow('Provide either target_percentage or target_letter, not both.')
  })

  it('rejects when neither target_percentage nor target_letter are provided', async () => {
    const canvas = buildMockCanvas()
    await expect(tool(canvas).handler({ course_id: 1 })).rejects.toThrow(
      'Provide one of target_percentage or target_letter.',
    )
  })
})

// ── Tool metadata + error propagation ────────────────────────────────────────

describe('project_grade — tool metadata', () => {
  it('exposes a single read-only, open-world tool', () => {
    const tools = gradeProjectionTools(buildMockCanvas())
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('project_grade')
    expect(tools[0].annotations.readOnlyHint).toBe(true)
    expect(tools[0].annotations.openWorldHint).toBe(true)
    expect(tools[0].annotations.destructiveHint).toBe(false)
  })

  it('does not swallow Canvas errors', async () => {
    const canvas = buildMockCanvas()
    ;(canvas.courses.get as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CanvasApiError('Not Found', 404, '/api/v1/courses/1'),
    )
    await expect(tool(canvas).handler({ course_id: 1, target_percentage: 90 })).rejects.toThrow(
      CanvasApiError,
    )
  })
})
