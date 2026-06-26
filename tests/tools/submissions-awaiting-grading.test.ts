import { describe, expect, it, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasAssignment, CanvasSubmission } from '../../src/canvas/types'
import type { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import { submissionsAwaitingGradingTools } from '../../src/tools/submissions-awaiting-grading'

const COURSE_ID = 555

// ── Output shape (mirrors the tool contract; for assertion typing) ───────────

interface SubmissionRow {
  submission_id: number
  user_id: number
  user_name: string | null
  workflow_state: 'submitted' | 'pending_review'
  submitted_at: string | null
  has_pending_manual_questions: boolean
}

interface Item {
  assignment_id: number
  assignment_name: string
  type: 'classic_quiz' | 'assignment'
  due_at: string | null
  submissions_awaiting_count: number
  submissions: SubmissionRow[]
}

interface Result {
  course_id: number
  total_submissions_awaiting: number
  items: Item[]
  caveats: string[]
}

// ── Fixtures factories ───────────────────────────────────────────────────────

function mkAssignment(props: {
  id: number
  name?: string
  needs_grading_count?: number
  is_quiz_assignment?: boolean
  quiz_id?: number | null
  submission_types?: string[]
  due_at?: string | null
}): CanvasAssignment {
  return {
    id: props.id,
    name: props.name ?? `Assignment ${props.id}`,
    description: null,
    due_at: props.due_at ?? null,
    points_possible: 100,
    grading_type: 'points',
    submission_types: props.submission_types ?? ['online_text_entry'],
    course_id: COURSE_ID,
    allowed_attempts: 1,
    is_quiz_assignment: props.is_quiz_assignment,
    quiz_id: props.quiz_id ?? null,
    needs_grading_count: props.needs_grading_count,
  } as CanvasAssignment
}

function mkSubmission(props: {
  id: number
  assignment_id: number
  workflow_state: string
  submitted_at?: string | null
  user?: { id: number; name: string } | null
  user_id?: number
}): CanvasSubmission {
  return {
    id: props.id,
    assignment_id: props.assignment_id,
    user_id: props.user_id ?? props.user?.id ?? 0,
    submitted_at: props.submitted_at ?? null,
    score: null,
    grade: null,
    body: null,
    url: null,
    attempt: 1,
    workflow_state: props.workflow_state,
    user: props.user ?? undefined,
  } as CanvasSubmission
}

// A1: regular assignment, 2 awaiting; A2: Classic Quiz, 1 awaiting; A3: nothing.
const A1 = mkAssignment({ id: 1, name: 'Essay', needs_grading_count: 2 })
const A2 = mkAssignment({
  id: 2,
  name: 'Midterm Quiz',
  needs_grading_count: 1,
  is_quiz_assignment: true,
  quiz_id: 10,
  due_at: '2026-07-01T00:00:00Z',
})
const A3 = mkAssignment({ id: 3, name: 'Graded already', needs_grading_count: 0 })

const S1 = mkSubmission({
  id: 1001,
  assignment_id: A1.id,
  user: { id: 101, name: 'Alice' },
  workflow_state: 'submitted',
  submitted_at: '2026-06-20T10:00:00Z',
})
const S2 = mkSubmission({
  id: 1002,
  assignment_id: A1.id,
  user: { id: 102, name: 'Bob' },
  workflow_state: 'submitted',
  submitted_at: '2026-06-21T10:00:00Z',
})
const S3 = mkSubmission({
  id: 1003,
  assignment_id: A2.id,
  user: { id: 103, name: 'Carol' },
  workflow_state: 'pending_review',
  submitted_at: '2026-06-19T10:00:00Z',
})

function buildMockCanvas(opts: {
  assignments?: CanvasAssignment[]
  submissions?: CanvasSubmission[]
  /** When false, listForStudents ignores assignment_ids (simulates a stray Canvas response). */
  filterSubmissions?: boolean
}): CanvasClient {
  const filterSubmissions = opts.filterSubmissions ?? true
  return {
    assignments: {
      list: vi.fn(async (_courseId: number, listOpts?: { assignment_ids?: number[] }) => {
        const all = opts.assignments ?? []
        const ids = listOpts?.assignment_ids
        return ids && ids.length > 0 ? all.filter((a) => ids.includes(a.id)) : all
      }),
    },
    submissions: {
      listForStudents: vi.fn(async (_courseId: number, subOpts?: { assignment_ids?: number[] }) => {
        const all = opts.submissions ?? []
        const ids = subOpts?.assignment_ids
        if (!filterSubmissions || !ids || ids.length === 0) return all
        return all.filter((s) => ids.includes(s.assignment_id))
      }),
    },
  } as unknown as CanvasClient
}

function makeEnabledPseudonymizer(): Pseudonymizer {
  return {
    isEnabled: () => true,
    anonymizeSubmission: vi.fn(async (_courseId: number, sub: CanvasSubmission) => ({
      ...sub,
      user: sub.user ? { ...sub.user, name: 'Student 0' } : sub.user,
    })),
  } as unknown as Pseudonymizer
}

async function run(
  canvas: CanvasClient,
  params: Record<string, unknown> = { course_id: COURSE_ID },
  pseudonymizer?: Pseudonymizer,
): Promise<Result> {
  const tool = submissionsAwaitingGradingTools(canvas, pseudonymizer)[0]
  return (await tool.handler(params)) as Result
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('list_submissions_awaiting_grading', () => {
  it('Fixture A — happy path: mixed states, sorting, type detection', async () => {
    const canvas = buildMockCanvas({
      assignments: [A1, A2, A3],
      submissions: [S1, S2, S3],
    })
    const result = await run(canvas)

    expect(result.total_submissions_awaiting).toBe(3)
    expect(result.items).toHaveLength(2)
    // A2's oldest submission (06-19) precedes A1's oldest (06-20).
    expect(result.items[0].assignment_id).toBe(A2.id)
    expect(result.items[0].type).toBe('classic_quiz')
    expect(result.items[0].due_at).toBe('2026-07-01T00:00:00Z')
    expect(result.items[0].submissions[0].has_pending_manual_questions).toBe(true)
    expect(result.items[1].assignment_id).toBe(A1.id)
    expect(result.items[1].submissions[0].submitted_at).toBe('2026-06-20T10:00:00Z')
    expect(result.items[1].submissions[0].has_pending_manual_questions).toBe(false)

    const listForStudents = canvas.submissions.listForStudents as ReturnType<typeof vi.fn>
    const calledWith = listForStudents.mock.calls[0][1] as { assignment_ids: number[] }
    expect(calledWith.assignment_ids).toContain(A1.id)
    expect(calledWith.assignment_ids).toContain(A2.id)
    expect(calledWith.assignment_ids).not.toContain(A3.id)

    expect(result.caveats.some((c) => c.includes('New Quizzes'))).toBe(true)
  })

  it('Fixture B — only_pending_review: true', async () => {
    const canvas = buildMockCanvas({ assignments: [A1, A2, A3], submissions: [S1, S2, S3] })
    const result = await run(canvas, { course_id: COURSE_ID, only_pending_review: true })

    expect(result.total_submissions_awaiting).toBe(1)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].assignment_id).toBe(A2.id)
    expect(result.items[0].submissions[0].workflow_state).toBe('pending_review')
    expect(result.caveats.some((c) => c.includes('Fill-in-the-blank'))).toBe(false)
    // The New Quizzes caveat is unconditional — not gated behind only_pending_review.
    expect(result.caveats.some((c) => c.includes('New Quizzes'))).toBe(true)
  })

  it('Fixture C — assignment_ids scope', async () => {
    const canvas = buildMockCanvas({ assignments: [A1, A2, A3], submissions: [S1, S2, S3] })
    const result = await run(canvas, { course_id: COURSE_ID, assignment_ids: [A2.id] })

    expect(result.total_submissions_awaiting).toBe(1)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].assignment_id).toBe(A2.id)

    const list = canvas.assignments.list as ReturnType<typeof vi.fn>
    const calledWith = list.mock.calls[0][1] as { assignment_ids: number[] }
    expect(calledWith.assignment_ids).toEqual([A2.id])
  })

  it('Fixture D — include_quizzes: false', async () => {
    const canvas = buildMockCanvas({ assignments: [A1, A2, A3], submissions: [S1, S2, S3] })
    const result = await run(canvas, { course_id: COURSE_ID, include_quizzes: false })

    expect(result.items.every((i) => i.type === 'assignment')).toBe(true)
    expect(result.items.some((i) => i.assignment_id === A2.id)).toBe(false)
  })

  it('Fixture E — include_assignments: false', async () => {
    const canvas = buildMockCanvas({ assignments: [A1, A2, A3], submissions: [S1, S2, S3] })
    const result = await run(canvas, { course_id: COURSE_ID, include_assignments: false })

    expect(result.items.every((i) => i.type === 'classic_quiz')).toBe(true)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].assignment_id).toBe(A2.id)
  })

  it('Fixture F — both toggles false rejects', async () => {
    const canvas = buildMockCanvas({ assignments: [A1, A2, A3], submissions: [S1, S2, S3] })
    // Codebase convention: the handler throws; buildHandler converts it to an
    // isError response. This asserts the guard directly (per spec, Fixture F).
    await expect(
      run(canvas, { course_id: COURSE_ID, include_quizzes: false, include_assignments: false }),
    ).rejects.toThrow('At least one of include_quizzes or include_assignments must be true')
  })

  it('Fixture G — no submissions awaiting (all graded): early-return, no fetch', async () => {
    const canvas = buildMockCanvas({
      assignments: [mkAssignment({ id: 1, needs_grading_count: 0 })],
      submissions: [],
    })
    const result = await run(canvas)

    expect(result.items).toHaveLength(0)
    expect(result.total_submissions_awaiting).toBe(0)
    expect(canvas.submissions.listForStudents).not.toHaveBeenCalled()
    // The early-return branch must still carry the fixed caveats (counts were 0,
    // not undefined, so no missing-count caveat).
    expect(result.caveats.some((c) => c.includes('New Quizzes'))).toBe(true)
    expect(result.caveats.some((c) => c.includes('Fill-in-the-blank'))).toBe(true)
    expect(result.caveats.some((c) => c.includes('needs_grading_count'))).toBe(false)
  })

  it('Fixture G2 — needs_grading_count absent (undefined) on all assignments', async () => {
    const canvas = buildMockCanvas({
      assignments: [mkAssignment({ id: 1 }), mkAssignment({ id: 2 })],
      submissions: [],
    })
    const result = await run(canvas)

    expect(result.items).toHaveLength(0)
    expect(canvas.submissions.listForStudents).not.toHaveBeenCalled()
    // Undefined counts must not be mistaken for "nothing to grade": a caveat names
    // the skipped count so the empty result is not silently authoritative.
    expect(result.caveats.some((c) => c.includes('needs_grading_count'))).toBe(true)
    expect(result.caveats.some((c) => c.includes('2 assignment(s)'))).toBe(true)
  })

  it('Fixture H — FERPA pseudonymization rewrites the name, keeps the id', async () => {
    const canvas = buildMockCanvas({
      assignments: [A1],
      submissions: [S1],
    })
    const ps = makeEnabledPseudonymizer()
    const result = await run(canvas, { course_id: COURSE_ID }, ps)

    expect(result.items[0].submissions[0].user_name).toBe('Student 0')
    expect(result.items[0].submissions[0].user_id).toBe(101)
  })

  it('Fixture H2 — FERPA: user absent → null name, anonymizeSubmission not called', async () => {
    const subNoUser = mkSubmission({
      id: 1001,
      assignment_id: A1.id,
      user: null,
      user_id: 101,
      workflow_state: 'submitted',
      submitted_at: '2026-06-20T10:00:00Z',
    })
    const canvas = buildMockCanvas({ assignments: [A1], submissions: [subNoUser] })
    const ps = makeEnabledPseudonymizer()
    const result = await run(canvas, { course_id: COURSE_ID }, ps)

    expect(result.items[0].submissions[0].user_name).toBeNull()
    expect(ps.anonymizeSubmission).not.toHaveBeenCalled()
  })

  it('Fixture H3 — FERPA: tool does not second-guess the pseudonymizer (staff passthrough)', async () => {
    const canvas = buildMockCanvas({ assignments: [A1], submissions: [S1] })
    // The real pseudonymizer leaves staff names intact; the tool must surface
    // whatever name the pseudonymizer returns, not impose its own decision.
    const ps = {
      isEnabled: () => true,
      anonymizeSubmission: vi.fn(async (_courseId: number, sub: CanvasSubmission) => sub),
    } as unknown as Pseudonymizer
    const result = await run(canvas, { course_id: COURSE_ID }, ps)

    expect(ps.anonymizeSubmission).toHaveBeenCalledTimes(1)
    expect(result.items[0].submissions[0].user_name).toBe('Alice')
  })

  it('Fixture I — sorting correctness: older item first', async () => {
    const a1 = mkAssignment({ id: 1, needs_grading_count: 1 })
    const a2 = mkAssignment({ id: 2, needs_grading_count: 1 })
    const canvas = buildMockCanvas({
      assignments: [a1, a2],
      submissions: [
        mkSubmission({
          id: 1,
          assignment_id: a1.id,
          workflow_state: 'submitted',
          submitted_at: '2026-06-25T10:00:00Z',
          user: { id: 1, name: 'A' },
        }),
        mkSubmission({
          id: 2,
          assignment_id: a2.id,
          workflow_state: 'submitted',
          submitted_at: '2026-06-23T10:00:00Z',
          user: { id: 2, name: 'B' },
        }),
      ],
    })
    const result = await run(canvas)

    expect(result.items[0].assignment_id).toBe(a2.id)
    expect(result.items[1].assignment_id).toBe(a1.id)
  })

  it('Fixture I2 — null submitted_at: no NaN corruption in items sort', async () => {
    const a1 = mkAssignment({ id: 1, needs_grading_count: 1 })
    const a2 = mkAssignment({ id: 2, needs_grading_count: 1 })
    const canvas = buildMockCanvas({
      assignments: [a1, a2],
      submissions: [
        mkSubmission({
          id: 1,
          assignment_id: a1.id,
          workflow_state: 'submitted',
          submitted_at: null,
          user: { id: 1, name: 'A' },
        }),
        mkSubmission({
          id: 2,
          assignment_id: a2.id,
          workflow_state: 'submitted',
          submitted_at: null,
          user: { id: 2, name: 'B' },
        }),
      ],
    })
    const result = await run(canvas)

    expect(result.items).toHaveLength(2)
  })

  it('Fixture J — external-tool (LTI) assignment included, labeled assignment', async () => {
    const aLti = mkAssignment({
      id: 1,
      needs_grading_count: 2,
      submission_types: ['external_tool'],
      is_quiz_assignment: false,
      quiz_id: null,
    })
    const canvas = buildMockCanvas({
      assignments: [aLti],
      submissions: [
        mkSubmission({
          id: 1,
          assignment_id: aLti.id,
          workflow_state: 'submitted',
          user: { id: 1, name: 'A' },
        }),
        mkSubmission({
          id: 2,
          assignment_id: aLti.id,
          workflow_state: 'submitted',
          user: { id: 2, name: 'B' },
        }),
      ],
    })
    const result = await run(canvas)

    expect(result.items).toHaveLength(1)
    expect(result.items[0].assignment_id).toBe(aLti.id)
    expect(result.items[0].type).toBe('assignment')
    expect(result.total_submissions_awaiting).toBe(2)
  })

  it('Fixture K — stray submission defensively skipped with caveat', async () => {
    const a1 = mkAssignment({ id: 1, needs_grading_count: 2 })
    const canvas = buildMockCanvas({
      assignments: [a1],
      filterSubmissions: false,
      submissions: [
        mkSubmission({
          id: 1,
          assignment_id: a1.id,
          workflow_state: 'submitted',
          user: { id: 1, name: 'A' },
        }),
        mkSubmission({
          id: 2,
          assignment_id: 9999,
          workflow_state: 'submitted',
          user: { id: 2, name: 'B' },
        }),
      ],
    })
    const result = await run(canvas)

    expect(result.items).toHaveLength(1)
    expect(result.items[0].assignment_id).toBe(a1.id)
    expect(
      result.caveats.some((c) =>
        c.includes('Some submissions could not be matched to an assignment'),
      ),
    ).toBe(true)
  })
})
