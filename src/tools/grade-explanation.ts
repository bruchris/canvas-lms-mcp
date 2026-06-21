import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type {
  CanvasAssignment,
  CanvasAssignmentGroup,
  CanvasCourse,
  CanvasEnrollment,
  CanvasGradingSchemeEntry,
  CanvasSubmission,
} from '../canvas/types'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'

// ── Constants ──────────────────────────────────────────────────────────────

/** Rounding drift (in percentage points) absorbed before a difference counts. */
const RECONCILIATION_TOLERANCE = 0.5
/** Discrepancy (pp) above which a curve/fudge-points caveat is surfaced. */
const CURVE_CAVEAT_THRESHOLD = 0.5
/** Hard cap on brute-force drop combinations before falling back to greedy. */
const MAX_DROP_COMBINATIONS = 10_000

// ── Types ──────────────────────────────────────────────────────────────────

type Mode = 'current' | 'final'
type AssignmentStatus = 'graded' | 'submitted' | 'missing' | 'excused' | 'not_graded'
type DropReason = 'drop_lowest' | 'drop_highest' | null
type DropStrategy = 'maximize_retained' | 'minimize_retained'

interface GradeItem {
  assignment: CanvasAssignment
  status: AssignmentStatus
  /** Effective score: a number for graded assignments, otherwise null. */
  score: number | null
  /** never_drop assignments are pinned: never considered for dropping. */
  pinned: boolean
  dropped: boolean
  dropReason: DropReason
}

interface GroupModeResult {
  items: GradeItem[]
  earned: number
  possible: number
  usedGreedy: boolean
}

// ── Combinatorial helpers (in-tree, no dependencies) ─────────────────────────

/** C(n, k) computed iteratively to avoid factorial overflow. */
function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  if (k === 0 || k === n) return 1
  const kk = Math.min(k, n - k)
  let result = 1
  for (let i = 0; i < kk; i++) {
    result = (result * (n - i)) / (i + 1)
  }
  return Math.round(result)
}

/** All k-element subsets of `items` (each subset is an array of references). */
function combinations<T>(items: readonly T[], k: number): T[][] {
  const result: T[][] = []
  const combo: T[] = []
  const recurse = (start: number): void => {
    if (combo.length === k) {
      result.push([...combo])
      return
    }
    for (let i = start; i < items.length; i++) {
      const item = items[i]
      if (item === undefined) continue
      combo.push(item)
      recurse(i + 1)
      combo.pop()
    }
  }
  recurse(0)
  return result
}

// ── Grade computation ────────────────────────────────────────────────────────

function classify(
  assignment: CanvasAssignment,
  sub: CanvasSubmission | undefined,
  neverDrop: ReadonlySet<number>,
): GradeItem {
  const base = { assignment, dropped: false, dropReason: null as DropReason }
  if (assignment.grading_type === 'not_graded') {
    return { ...base, status: 'not_graded', score: null, pinned: false }
  }
  if (sub?.excused === true) {
    return { ...base, status: 'excused', score: null, pinned: false }
  }
  const pinned = neverDrop.has(assignment.id)
  if (sub?.workflow_state === 'graded' && sub.score !== null) {
    return { ...base, status: 'graded', score: sub.score ?? null, pinned }
  }
  if (sub?.workflow_state === 'submitted' || sub?.workflow_state === 'pending_review') {
    return { ...base, status: 'submitted', score: null, pinned }
  }
  // missing / unsubmitted / no submission record (sub === undefined)
  return { ...base, status: 'missing', score: null, pinned }
}

/** Excused and not_graded assignments never participate in the grade. */
function isCountable(item: GradeItem): boolean {
  return item.status !== 'excused' && item.status !== 'not_graded'
}

/** Percentage (0–1) of a retained set, applying mode null-score semantics. */
function retainedFraction(items: readonly GradeItem[], mode: Mode): number | null {
  let earned = 0
  let possible = 0
  for (const item of items) {
    if (mode === 'current' && item.score === null) continue
    earned += item.score ?? 0
    possible += item.assignment.points_possible
  }
  return possible === 0 ? null : earned / possible
}

/** score/points ratio for greedy ranking; null scores sort worst per mode. */
function sortRatio(item: GradeItem, mode: Mode): number {
  if (item.score === null) return mode === 'current' ? -Infinity : 0
  const pts = item.assignment.points_possible
  if (pts <= 0) return item.score > 0 ? Infinity : 0
  return item.score / pts
}

interface DropOutcome {
  retained: GradeItem[]
  dropped: GradeItem[]
  usedGreedy: boolean
}

/**
 * Greedy fallback for pathologically large groups: rank by score/points ratio
 * and drop the `count` best (drop_highest) or worst (drop_lowest) items.
 */
function greedyDrop(
  items: GradeItem[],
  count: number,
  strategy: DropStrategy,
  mode: Mode,
): DropOutcome {
  const ranked = [...items].sort((a, b) => sortRatio(a, mode) - sortRatio(b, mode))
  const dropped =
    strategy === 'minimize_retained'
      ? ranked.slice(ranked.length - count) // drop the highest-ratio items
      : ranked.slice(0, count) // drop the lowest-ratio items
  const droppedSet = new Set(dropped)
  return { retained: items.filter((i) => !droppedSet.has(i)), dropped, usedGreedy: true }
}

/**
 * Choose the `count` items to drop. Brute-force searches every combination and
 * keeps the one that best serves the strategy: `maximize_retained` (drop_lowest,
 * helps the grade most) or `minimize_retained` (drop_highest, bonus exclusion).
 */
function applyDrop(
  items: GradeItem[],
  count: number,
  strategy: DropStrategy,
  mode: Mode,
): DropOutcome {
  if (items.length === 0 || count >= items.length) {
    return { retained: items, dropped: [], usedGreedy: false }
  }
  if (binomial(items.length, count) > MAX_DROP_COMBINATIONS) {
    return greedyDrop(items, count, strategy, mode)
  }

  let bestRetained: GradeItem[] = items
  let bestDropped: GradeItem[] = []
  let bestFraction: number | null = null

  for (const combo of combinations(items, count)) {
    const droppedSet = new Set(combo)
    const retained = items.filter((i) => !droppedSet.has(i))
    const fraction = retainedFraction(retained, mode) ?? (mode === 'current' ? -Infinity : 0)
    if (
      bestFraction === null ||
      (strategy === 'maximize_retained' && fraction > bestFraction) ||
      (strategy === 'minimize_retained' && fraction < bestFraction)
    ) {
      bestRetained = retained
      bestDropped = combo
      bestFraction = fraction
    }
  }

  return { retained: bestRetained, dropped: bestDropped, usedGreedy: false }
}

/** Compute one group's earned/possible totals for a single mode. */
function computeGroupGrade(
  group: CanvasAssignmentGroup,
  submissionsById: ReadonlyMap<number, CanvasSubmission>,
  mode: Mode,
): GroupModeResult {
  const dropLowest = group.rules?.drop_lowest ?? 0
  const dropHighest = group.rules?.drop_highest ?? 0
  const neverDrop = new Set(group.rules?.never_drop ?? [])

  // Fresh items per call so per-mode drop annotations never leak between passes.
  const items = (group.assignments ?? []).map((a) =>
    classify(a, submissionsById.get(a.id), neverDrop),
  )

  const countable = items.filter(isCountable)
  let working = countable.filter((i) => !i.pinned)
  const pinned = countable.filter((i) => i.pinned)
  let usedGreedy = false

  // Canvas documented order: drop_highest first, then drop_lowest.
  if (dropHighest > 0 && working.length > dropHighest) {
    const outcome = applyDrop(working, dropHighest, 'minimize_retained', mode)
    for (const d of outcome.dropped) {
      d.dropped = true
      d.dropReason = 'drop_highest'
    }
    working = outcome.retained
    usedGreedy = usedGreedy || outcome.usedGreedy
  }
  if (dropLowest > 0 && working.length > dropLowest) {
    const outcome = applyDrop(working, dropLowest, 'maximize_retained', mode)
    for (const d of outcome.dropped) {
      d.dropped = true
      d.dropReason = 'drop_lowest'
    }
    working = outcome.retained
    usedGreedy = usedGreedy || outcome.usedGreedy
  }

  let earned = 0
  let possible = 0
  for (const item of [...working, ...pinned]) {
    if (mode === 'current' && item.score === null) continue
    earned += item.score ?? 0
    possible += item.assignment.points_possible
  }

  return { items, earned, possible, usedGreedy }
}

function percentageOf(earned: number, possible: number): number | null {
  return possible === 0 ? null : (earned / possible) * 100
}

/** Overall course percentage for a single mode, weighted or not. */
function computeOverall(
  results: ReadonlyArray<{ group: CanvasAssignmentGroup; result: GroupModeResult }>,
  weighted: boolean,
): number | null {
  if (!weighted) {
    let earned = 0
    let possible = 0
    for (const { result } of results) {
      earned += result.earned
      possible += result.possible
    }
    return percentageOf(earned, possible)
  }

  let contributionSum = 0
  let activeWeightSum = 0
  for (const { group, result } of results) {
    if (result.possible <= 0) continue
    const weight = group.group_weight ?? 0
    const fraction = result.earned / result.possible
    contributionSum += weight * fraction
    activeWeightSum += weight
  }
  if (activeWeightSum === 0) return null
  return (contributionSum / activeWeightSum) * 100
}

/** Map a 0–100 percentage to a letter via a (descending) grading scheme. */
function mapLetter(
  percentage: number | null,
  scheme: ReadonlyArray<CanvasGradingSchemeEntry> | null,
): string | null {
  if (percentage === null || !scheme || scheme.length === 0) return null
  const sorted = [...scheme].sort((a, b) => b.value - a.value)
  const fraction = percentage / 100
  for (const entry of sorted) {
    if (fraction >= entry.value) return entry.name
  }
  const lowest = sorted[sorted.length - 1]
  return lowest ? lowest.name : null
}

// ── Output assembly ──────────────────────────────────────────────────────────

function buildGroupOutput(
  group: CanvasAssignmentGroup,
  current: GroupModeResult,
  final: GroupModeResult,
  weighted: boolean,
): unknown {
  const groupWeight = group.group_weight ?? 0
  const block = (result: GroupModeResult): unknown => {
    const percentage = percentageOf(result.earned, result.possible)
    return {
      earned_points: result.earned,
      possible_points: result.possible,
      percentage,
      weighted_contribution:
        weighted && percentage !== null ? groupWeight * (percentage / 100) : null,
    }
  }

  return {
    group_id: group.id,
    group_name: group.name,
    group_weight: groupWeight,
    rules: {
      drop_lowest: group.rules?.drop_lowest ?? 0,
      drop_highest: group.rules?.drop_highest ?? 0,
      never_drop: group.rules?.never_drop ?? [],
    },
    // current-mode annotations drive the displayed dropped/status fields; both
    // modes share identical status and score (only earned/possible differ).
    assignments: current.items.map((item) => ({
      assignment_id: item.assignment.id,
      assignment_name: item.assignment.name,
      points_possible: item.assignment.points_possible,
      score: item.score,
      status: item.status,
      dropped: item.dropped,
      drop_reason: item.dropReason,
    })),
    current: block(current),
    final: block(final),
  }
}

function buildTotals(
  computedPercentage: number | null,
  postedScore: number | null,
  postedLetter: string | null,
  letter: string | null,
): unknown {
  const discrepancy =
    computedPercentage !== null && postedScore !== null
      ? Math.abs(computedPercentage - postedScore)
      : null
  const matches = discrepancy === null ? null : discrepancy <= RECONCILIATION_TOLERANCE
  return {
    computed_percentage: computedPercentage,
    canvas_posted_score: postedScore,
    discrepancy,
    matches,
    letter,
    canvas_posted_letter: postedLetter,
  }
}

// ── Canvas orchestration ─────────────────────────────────────────────────────

/** Pick the enrollment that carries grades (prefer the student enrollment). */
function selectGradedEnrollment(
  enrollments: ReadonlyArray<CanvasEnrollment>,
): CanvasEnrollment | null {
  return (
    enrollments.find((e) => e.type === 'StudentEnrollment' && e.grades) ??
    enrollments.find((e) => e.grades) ??
    enrollments[0] ??
    null
  )
}

/** Resolve the course grading scheme, falling back to the account standard. */
async function resolveGradingScheme(
  canvas: CanvasClient,
  courseId: number,
  course: CanvasCourse,
): Promise<ReadonlyArray<CanvasGradingSchemeEntry> | null> {
  const targetId = course.grading_standard_id
  if (targetId == null) return null

  const courseStandards = await canvas.gradingStandards.listForCourse(courseId)
  const courseMatch = courseStandards.find((s) => s.id === targetId)
  if (courseMatch) return courseMatch.grading_scheme

  if (course.account_id != null) {
    const accountStandards = await canvas.gradingStandards.listForAccount(course.account_id)
    const accountMatch = accountStandards.find((s) => s.id === targetId)
    if (accountMatch) return accountMatch.grading_scheme
  }
  return null
}

// ── Tool definition ──────────────────────────────────────────────────────────

export function gradeExplanationTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
  return [
    {
      name: 'explain_grade',
      description:
        'Recomputes and explains the weighted course grade for a student, including assignment-group ' +
        'weights, drop_lowest / drop_highest / never_drop rules, per-group breakdowns (earned points, ' +
        'dropped assignments, weighted contributions), the mapped letter grade (via the course grading ' +
        "standard when present), and a reconciliation check against Canvas's posted current_score / " +
        'final_score.\n\n' +
        "Use this when you need to verify that Canvas's displayed grade matches the rules, or to explain " +
        'to a student or instructor how their grade was calculated.\n\n' +
        'Limitations:\n' +
        '- V1 computes one student per call. Omit student_id to compute for the authenticated user.\n' +
        '- Instructor-applied curves and fudge points are not exposed via the Canvas REST API and cannot ' +
        'be reflected in the computation; a caveat is added when the discrepancy exceeds 0.5 pp.\n' +
        '- When the course uses grading periods, reconciliation is against the overall (cross-period) grade.\n' +
        '- When CANVAS_PSEUDONYMIZE_STUDENTS is enabled and you are passing a student_id, first call ' +
        'resolve_pseudonym to obtain the real Canvas user_id.',
      inputSchema: {
        course_id: z
          .number()
          .int()
          .positive()
          .describe('Canvas course ID to compute the grade for.'),
        student_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Canvas user_id of the student to compute the grade for. Omit to compute for the ' +
              "currently authenticated user. Instructors may pass any enrolled student's user_id. " +
              'When CANVAS_PSEUDONYMIZE_STUDENTS is enabled, pass the numeric Canvas user_id after ' +
              'resolving the pseudonym via resolve_pseudonym.',
          ),
        assignment_group_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Narrow the output to a single assignment group. When omitted all groups are included and ' +
              'the overall course grade is computed.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const studentParam = params.student_id as number | undefined
        const studentId: number | 'self' = studentParam === undefined ? 'self' : studentParam
        const groupFilter = params.assignment_group_id as number | undefined

        const course = await canvas.courses.get(courseId)

        const [groups, submissions, enrollments, user] = await Promise.all([
          canvas.assignments.listGroups(courseId, { include: ['assignments'] }),
          studentId === 'self'
            ? canvas.submissions.listMy(courseId)
            : canvas.submissions.listForStudents(courseId, { student_ids: [studentId] }),
          canvas.enrollments.listForCourse(courseId, {
            user_id: studentId === 'self' ? 'self' : studentId,
            include: ['grades'],
          }),
          studentId === 'self' ? canvas.users.getSelf() : canvas.users.get(studentId),
        ])

        const caveats: string[] = []

        const enrollment = selectGradedEnrollment(enrollments)
        if (enrollments.length === 0) {
          caveats.push(
            'No student enrollment found for this course — Canvas posted scores are unavailable.',
          )
        }

        let gradingScheme: ReadonlyArray<CanvasGradingSchemeEntry> | null = null
        if (course.grading_standard_id != null) {
          gradingScheme = await resolveGradingScheme(canvas, courseId, course)
          if (gradingScheme === null) {
            caveats.push(
              `The course's grading standard (id: ${course.grading_standard_id}) could not be ` +
                'retrieved — letter grades are unavailable.',
            )
          }
        }

        const submissionsById = new Map<number, CanvasSubmission>()
        for (const sub of submissions) submissionsById.set(sub.assignment_id, sub)

        const weighted = course.apply_assignment_group_weights ?? false

        let selectedGroups = groups
        if (groupFilter !== undefined) {
          selectedGroups = groups.filter((g) => g.id === groupFilter)
          const matched = selectedGroups[0]
          if (matched === undefined) {
            caveats.push(`Assignment group ${groupFilter} was not found in this course.`)
          } else {
            caveats.push(
              `Results are filtered to assignment group '${matched.name}' — totals reflect only ` +
                'this group, not the overall course grade.',
            )
          }
        }

        const groupOutputs: unknown[] = []
        const currentResults: Array<{ group: CanvasAssignmentGroup; result: GroupModeResult }> = []
        const finalResults: Array<{ group: CanvasAssignmentGroup; result: GroupModeResult }> = []

        for (const group of selectedGroups) {
          const current = computeGroupGrade(group, submissionsById, 'current')
          const final = computeGroupGrade(group, submissionsById, 'final')
          if (current.usedGreedy || final.usedGreedy) {
            caveats.push(
              `Drop-rule optimisation used a greedy approximation for group '${group.name}' due to ` +
                'the large number of assignments. Result may differ slightly from Canvas.',
            )
          }
          groupOutputs.push(buildGroupOutput(group, current, final, weighted))
          currentResults.push({ group, result: current })
          finalResults.push({ group, result: final })
        }

        const computedCurrent = computeOverall(currentResults, weighted)
        const computedFinal = computeOverall(finalResults, weighted)

        const totalsCurrent = buildTotals(
          computedCurrent,
          enrollment?.grades?.current_score ?? null,
          enrollment?.grades?.current_grade ?? null,
          mapLetter(computedCurrent, gradingScheme),
        ) as { discrepancy: number | null }
        const totalsFinal = buildTotals(
          computedFinal,
          enrollment?.grades?.final_score ?? null,
          enrollment?.grades?.final_grade ?? null,
          mapLetter(computedFinal, gradingScheme),
        ) as { discrepancy: number | null }

        // Curve caveat — suppressed in single-group mode, where a large
        // discrepancy against the full-course posted score is expected.
        if (groupFilter === undefined) {
          const discrepancies = [totalsCurrent.discrepancy, totalsFinal.discrepancy].filter(
            (d): d is number => d !== null,
          )
          const maxDiscrepancy = discrepancies.length > 0 ? Math.max(...discrepancies) : null
          if (maxDiscrepancy !== null && maxDiscrepancy > CURVE_CAVEAT_THRESHOLD) {
            caveats.push(
              `Canvas's posted score differs from the computed value by ${maxDiscrepancy.toFixed(1)} ` +
                'pp. If the instructor applied a curve or fudge points these are not accessible via ' +
                'the API and cannot be reflected here.',
            )
          }
        }

        // FERPA: pseudonymize only when viewing another student's data. Viewing
        // one's own grade (self) exposes no third-party PII.
        const anonUser =
          pseudonymizer && typeof studentId === 'number'
            ? await pseudonymizer.anonymizeUser(courseId, user)
            : user

        return {
          student: { id: anonUser.id, name: anonUser.name },
          course: {
            id: course.id,
            name: course.name,
            weighted,
            grading_standard_id: course.grading_standard_id ?? null,
          },
          groups: groupOutputs,
          totals: { current: totalsCurrent, final: totalsFinal },
          caveats,
        }
      },
    },
  ]
}
