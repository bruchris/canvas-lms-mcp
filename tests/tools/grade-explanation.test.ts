import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { CanvasApiError } from '../../src/canvas/client'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import { gradeExplanationTools } from '../../src/tools/grade-explanation'

// ── Output shape (mirrors the tool contract; partial for assertion typing) ───

interface AssignmentOut {
  assignment_id: number
  assignment_name: string
  points_possible: number
  score: number | null
  status: string
  dropped: boolean
  drop_reason: string | null
}

interface ModeBlock {
  earned_points: number
  possible_points: number
  percentage: number | null
  weighted_contribution: number | null
}

interface GroupOut {
  group_id: number
  group_name: string
  group_weight: number
  rules: { drop_lowest: number; drop_highest: number; never_drop: number[] }
  assignments: AssignmentOut[]
  current: ModeBlock
  final: ModeBlock
}

interface TotalsBlock {
  computed_percentage: number | null
  canvas_posted_score: number | null
  discrepancy: number | null
  matches: boolean | null
  letter: string | null
  canvas_posted_letter: string | null
}

interface GradeExplanation {
  student: { id: number; name: string }
  course: { id: number; name: string; weighted: boolean; grading_standard_id: number | null }
  groups: GroupOut[]
  totals: { current: TotalsBlock; final: TotalsBlock }
  caveats: string[]
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const GRADING_SCHEME = [
  { name: 'A', value: 0.9 },
  { name: 'B', value: 0.8 },
  { name: 'C', value: 0.7 },
  { name: 'F', value: 0.0 },
]

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
  return gradeExplanationTools(canvas, pseudonymizer)[0]
}

async function run(
  overrides: MockOverrides,
  params: Record<string, unknown> = { course_id: 1 },
): Promise<GradeExplanation> {
  const canvas = buildMockCanvas(overrides)
  return (await tool(canvas, overrides.pseudonymizer).handler(params)) as GradeExplanation
}

function graded(assignment_id: number, score: number): unknown {
  return { assignment_id, workflow_state: 'graded', score }
}

function findGroup(result: GradeExplanation, id: number): GroupOut {
  return result.groups.find((g) => g.group_id === id)!
}

function findAssignment(group: GroupOut, id: number): AssignmentOut {
  return group.assignments.find((a) => a.assignment_id === id)!
}

// ── Fixture A — weighted, drop_lowest + never_drop ───────────────────────────

const FIXTURE_A: MockOverrides = {
  course: {
    id: 1,
    name: 'Bio 101',
    apply_assignment_group_weights: true,
    grading_standard_id: 42,
    account_id: 7,
  },
  groups: [
    {
      id: 1,
      name: 'Homework',
      position: 1,
      group_weight: 30,
      rules: { drop_lowest: 1, never_drop: [3] },
      assignments: [
        { id: 1, name: 'HW1', points_possible: 10, grading_type: 'points' },
        { id: 2, name: 'HW2', points_possible: 10, grading_type: 'points' },
        { id: 3, name: 'HW3', points_possible: 10, grading_type: 'points' },
      ],
    },
    {
      id: 2,
      name: 'Exams',
      position: 2,
      group_weight: 70,
      assignments: [
        { id: 4, name: 'Midterm', points_possible: 100, grading_type: 'points' },
        { id: 5, name: 'Final', points_possible: 100, grading_type: 'points' },
      ],
    },
  ],
  submissions: [graded(1, 8), graded(2, 5), graded(3, 6), graded(4, 88), graded(5, 75)],
  courseStandards: [
    {
      id: 42,
      title: 'Standard',
      context_type: 'Course',
      context_id: 1,
      grading_scheme: GRADING_SCHEME,
    },
  ],
}

describe('explain_grade — Fixture A (weighted, drop_lowest + never_drop)', () => {
  it('drops the lowest droppable score and pins the never_drop assignment', async () => {
    const result = await run(FIXTURE_A)
    const homework = findGroup(result, 1)
    expect(findAssignment(homework, 2)).toMatchObject({ dropped: true, drop_reason: 'drop_lowest' })
    expect(findAssignment(homework, 3)).toMatchObject({ dropped: false, drop_reason: null })
    // Homework retained: HW1 (8) + HW3 (6) = 14/20 → 70%
    expect(homework.current.earned_points).toBe(14)
    expect(homework.current.possible_points).toBe(20)
    expect(homework.current.percentage).toBeCloseTo(70, 5)
    expect(homework.current.weighted_contribution).toBeCloseTo(21, 5)
  })

  it('computes the weighted overall percentage and maps the letter', async () => {
    const result = await run(FIXTURE_A)
    expect(result.course.weighted).toBe(true)
    expect(result.totals.current.computed_percentage).toBeCloseTo(78.05, 2)
    expect(result.totals.current.letter).toBe('C')
  })
})

// ── Fixture B — unweighted, no drop rules ────────────────────────────────────

describe('explain_grade — Fixture B (unweighted)', () => {
  const fixture: MockOverrides = {
    course: {
      id: 1,
      name: 'Math 200',
      apply_assignment_group_weights: false,
      grading_standard_id: null,
    },
    groups: [
      {
        id: 1,
        name: 'Group A',
        position: 1,
        group_weight: 0,
        assignments: [{ id: 1, name: 'A1', points_possible: 100, grading_type: 'points' }],
      },
      {
        id: 2,
        name: 'Group B',
        position: 2,
        group_weight: 0,
        assignments: [{ id: 2, name: 'B1', points_possible: 50, grading_type: 'points' }],
      },
    ],
    submissions: [graded(1, 90), graded(2, 40)],
  }

  it('reports weighted=false and null weighted_contribution', async () => {
    const result = await run(fixture)
    expect(result.course.weighted).toBe(false)
    for (const group of result.groups) {
      expect(group.current.weighted_contribution).toBeNull()
      expect(group.final.weighted_contribution).toBeNull()
    }
  })

  it('totals the raw points across groups regardless of weight', async () => {
    const result = await run(fixture)
    // 130 / 150 = 86.67%
    expect(result.totals.current.computed_percentage).toBeCloseTo(86.67, 2)
    expect(result.totals.current.letter).toBeNull()
  })
})

// ── Fixture C — reconciliation: match vs discrepancy ─────────────────────────

describe('explain_grade — Fixture C (reconciliation)', () => {
  it('flags a match within the 0.5pp tolerance', async () => {
    const result = await run({
      ...FIXTURE_A,
      enrollments: [
        {
          type: 'StudentEnrollment',
          grades: { current_score: 78.1, current_grade: 'C', final_score: null, final_grade: null },
        },
      ],
    })
    expect(result.totals.current.canvas_posted_score).toBe(78.1)
    expect(result.totals.current.discrepancy).toBeCloseTo(0.05, 2)
    expect(result.totals.current.matches).toBe(true)
    expect(result.totals.current.canvas_posted_letter).toBe('C')
    expect(result.caveats.some((c) => c.includes('curve'))).toBe(false)
  })

  it('flags a discrepancy beyond tolerance and adds a curve caveat', async () => {
    const result = await run({
      ...FIXTURE_A,
      enrollments: [
        {
          type: 'StudentEnrollment',
          grades: { current_score: 81.0, current_grade: 'B', final_score: null, final_grade: null },
        },
      ],
    })
    expect(result.totals.current.discrepancy).toBeCloseTo(2.95, 2)
    expect(result.totals.current.matches).toBe(false)
    expect(result.caveats.some((c) => c.includes('curve') || c.includes('fudge'))).toBe(true)
  })
})

// ── Fixture D — excused + missing + submitted/pending ────────────────────────

describe('explain_grade — Fixture D (excused / missing / pending)', () => {
  const fixture: MockOverrides = {
    course: {
      id: 1,
      name: 'Hist 101',
      apply_assignment_group_weights: false,
      grading_standard_id: null,
    },
    groups: [
      {
        id: 1,
        name: 'Work',
        position: 1,
        group_weight: 0,
        assignments: [
          { id: 1, name: 'A1', points_possible: 10, grading_type: 'points' },
          { id: 2, name: 'A2', points_possible: 10, grading_type: 'points' },
          { id: 3, name: 'A3', points_possible: 10, grading_type: 'points' },
          { id: 4, name: 'A4', points_possible: 10, grading_type: 'points' },
        ],
      },
    ],
    submissions: [
      graded(1, 8),
      { assignment_id: 2, workflow_state: 'graded', score: null, excused: true },
      { assignment_id: 3, workflow_state: 'unsubmitted', score: null, missing: true },
      { assignment_id: 4, workflow_state: 'pending_review', score: null },
    ],
  }

  it('classifies excused, missing, and pending_review correctly', async () => {
    const group = findGroup(await run(fixture), 1)
    expect(findAssignment(group, 2)).toMatchObject({ status: 'excused', dropped: false })
    expect(findAssignment(group, 3).status).toBe('missing')
    expect(findAssignment(group, 4).status).toBe('submitted')
  })

  it('counts only graded work in current mode, all non-excused in final mode', async () => {
    const group = findGroup(await run(fixture), 1)
    expect(group.current.earned_points).toBe(8)
    expect(group.current.possible_points).toBe(10)
    expect(group.final.earned_points).toBe(8)
    expect(group.final.possible_points).toBe(30)
  })
})

// ── Fixture E — drop_highest (bonus exclusion) ───────────────────────────────

describe('explain_grade — Fixture E (drop_highest)', () => {
  const fixture: MockOverrides = {
    course: {
      id: 1,
      name: 'Phys 101',
      apply_assignment_group_weights: false,
      grading_standard_id: null,
    },
    groups: [
      {
        id: 1,
        name: 'Quizzes',
        position: 1,
        group_weight: 0,
        rules: { drop_highest: 1 },
        assignments: [
          { id: 1, name: 'Q1', points_possible: 10, grading_type: 'points' },
          { id: 2, name: 'Q2', points_possible: 10, grading_type: 'points' },
          { id: 3, name: 'Q3', points_possible: 10, grading_type: 'points' },
          { id: 4, name: 'Q4', points_possible: 10, grading_type: 'points' },
        ],
      },
    ],
    submissions: [graded(1, 10), graded(2, 8), graded(3, 6), graded(4, 4)],
  }

  it('drops the highest-ratio assignment and recomputes', async () => {
    const group = findGroup(await run(fixture), 1)
    expect(findAssignment(group, 1)).toMatchObject({ dropped: true, drop_reason: 'drop_highest' })
    // retained Q2+Q3+Q4 = 18/30 → 60%
    expect(group.current.percentage).toBeCloseTo(60, 5)
  })
})

// ── Fixture F — FERPA pseudonymization ───────────────────────────────────────

describe('explain_grade — Fixture F (pseudonymization)', () => {
  let tmpRoot: string
  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'grade-explain-'))
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
          name: 'Course',
          apply_assignment_group_weights: false,
          grading_standard_id: null,
        },
        groups: [],
        user: { id: 1234, name: 'Alice Student' },
        pseudonymizer: ps,
      },
      { course_id: 1, student_id: 1234 },
    )
    // Pseudonymizer replaces the real name with a stable "Student N" label
    // (Canvas's pseudonym index starts at 1) but preserves the numeric id.
    expect(result.student.name).toMatch(/^Student \d+$/)
    expect(result.student.name).not.toBe('Alice Student')
    expect(result.student.id).toBe(1234)
  })

  it('does not pseudonymize the authenticated user (self)', async () => {
    const ps = new Pseudonymizer({
      baseUrl: 'https://school.instructure.com/api/v1',
      rootDir: tmpRoot,
      env: { CANVAS_PSEUDONYMIZE_STUDENTS: 'true' },
    })
    const result = await run(
      {
        course: {
          id: 1,
          name: 'Course',
          apply_assignment_group_weights: false,
          grading_standard_id: null,
        },
        groups: [],
        user: { id: 99, name: 'Real Name' },
        pseudonymizer: ps,
      },
      { course_id: 1 },
    )
    expect(result.student.name).toBe('Real Name')
  })
})

// ── Fixture G — missing enrollment ───────────────────────────────────────────

describe('explain_grade — Fixture G (missing enrollment)', () => {
  it('returns null posted scores, a caveat, and still computes the grade', async () => {
    const result = await run({
      course: {
        id: 1,
        name: 'Course',
        apply_assignment_group_weights: false,
        grading_standard_id: null,
      },
      groups: [
        {
          id: 1,
          name: 'Work',
          position: 1,
          group_weight: 0,
          assignments: [{ id: 1, name: 'A1', points_possible: 10, grading_type: 'points' }],
        },
      ],
      submissions: [graded(1, 9)],
      enrollments: [],
    })
    expect(result.totals.current.canvas_posted_score).toBeNull()
    expect(result.totals.current.discrepancy).toBeNull()
    expect(result.totals.current.matches).toBeNull()
    expect(result.caveats.some((c) => c.includes('No student enrollment found'))).toBe(true)
    expect(result.totals.current.computed_percentage).toBeCloseTo(90, 5)
  })
})

// ── Fixture H — greedy fallback for pathologically large groups ──────────────

describe('explain_grade — Fixture H (greedy cap)', () => {
  it('falls back to a greedy drop and adds a caveat when combinations explode', async () => {
    // 16 assignments, drop_lowest 8 → C(16,8) = 12_870 > 10_000 cap.
    const assignments = Array.from({ length: 16 }, (_, i) => ({
      id: i + 1,
      name: `A${i + 1}`,
      points_possible: 10,
      grading_type: 'points',
    }))
    // Scores 0..15; greedy keeps the top 8 (scores 8..15), sum 92 / 80 = 115%? no:
    // retained 8 highest scores = 8+9+10+11+12+13+14+15 = 92 over 80 possible.
    const submissions = assignments.map((a, i) => graded(a.id, i))
    const result = await run({
      course: {
        id: 1,
        name: 'Big',
        apply_assignment_group_weights: false,
        grading_standard_id: null,
      },
      groups: [
        {
          id: 1,
          name: 'Daily',
          position: 1,
          group_weight: 0,
          rules: { drop_lowest: 8 },
          assignments,
        },
      ],
      submissions,
    })
    const group = findGroup(result, 1)
    expect(group.current.possible_points).toBe(80)
    expect(group.current.earned_points).toBe(92)
    expect(result.caveats.some((c) => c.includes('greedy approximation'))).toBe(true)
  })
})

// ── Tool metadata + error propagation ────────────────────────────────────────

describe('explain_grade — tool metadata', () => {
  it('exposes a single read-only, open-world tool', () => {
    const tools = gradeExplanationTools(buildMockCanvas())
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('explain_grade')
    expect(tools[0].annotations.readOnlyHint).toBe(true)
    expect(tools[0].annotations.openWorldHint).toBe(true)
    expect(tools[0].annotations.destructiveHint).toBe(false)
  })

  it('filters to a single assignment group and caveats the partial total', async () => {
    const result = await run(FIXTURE_A, { course_id: 1, assignment_group_id: 2 })
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].group_id).toBe(2)
    expect(result.caveats.some((c) => c.includes('filtered to assignment group'))).toBe(true)
  })

  it('does not swallow Canvas errors', async () => {
    const canvas = buildMockCanvas(FIXTURE_A)
    ;(canvas.courses.get as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CanvasApiError('Not Found', 404, '/api/v1/courses/1'),
    )
    await expect(tool(canvas).handler({ course_id: 1 })).rejects.toThrow(CanvasApiError)
  })
})
