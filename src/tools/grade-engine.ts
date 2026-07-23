import type { CanvasClient } from '../canvas'
import type {
  CanvasAssignment,
  CanvasAssignmentGroup,
  CanvasCourse,
  CanvasGradingSchemeEntry,
  CanvasSubmission,
} from '../canvas/types'

// ── Constants ──────────────────────────────────────────────────────────────

/** Rounding drift (in percentage points) absorbed before a difference counts. */
export const RECONCILIATION_TOLERANCE = 0.5
/** Discrepancy (pp) above which a curve/fudge-points caveat is surfaced. */
export const CURVE_CAVEAT_THRESHOLD = 0.5
/** Hard cap on brute-force drop combinations before falling back to greedy. */
export const MAX_DROP_COMBINATIONS = 10_000

// ── Types ──────────────────────────────────────────────────────────────────

export type Mode = 'current' | 'final'
export type AssignmentStatus = 'graded' | 'submitted' | 'missing' | 'excused' | 'not_graded'
export type DropReason = 'drop_lowest' | 'drop_highest' | null
export type DropStrategy = 'maximize_retained' | 'minimize_retained'

export interface GradeItem {
  assignment: CanvasAssignment
  status: AssignmentStatus
  /** Effective score: a number for graded assignments, otherwise null. */
  score: number | null
  /**
   * points_possible normalized to a finite number. Canvas can return null or
   * omit the field for "no points" assignments; coercing it through arithmetic
   * would either silently inflate the percentage (null → +0 denominator) or
   * poison the total to NaN (undefined). Normalizing once keeps the math safe.
   */
  points: number
  /** never_drop assignments are pinned: never considered for dropping. */
  pinned: boolean
  dropped: boolean
  dropReason: DropReason
}

/** Coerce a possibly-null/absent points_possible to a finite number. */
export function normalizePoints(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export interface GroupModeResult {
  items: GradeItem[]
  earned: number
  possible: number
  usedGreedy: boolean
}

// ── Combinatorial helpers (in-tree, no dependencies) ─────────────────────────

/** C(n, k) computed iteratively to avoid factorial overflow. */
export function binomial(n: number, k: number): number {
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
export function combinations<T>(items: readonly T[], k: number): T[][] {
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

export function classify(
  assignment: CanvasAssignment,
  sub: CanvasSubmission | undefined,
  neverDrop: ReadonlySet<number>,
): GradeItem {
  const base = {
    assignment,
    points: normalizePoints(assignment.points_possible),
    dropped: false,
    dropReason: null as DropReason,
  }
  if (assignment.grading_type === 'not_graded') {
    return { ...base, status: 'not_graded', score: null, pinned: false }
  }
  if (sub?.excused === true) {
    return { ...base, status: 'excused', score: null, pinned: false }
  }
  const pinned = neverDrop.has(assignment.id)
  if (sub?.workflow_state === 'graded' && sub.score !== null) {
    return { ...base, status: 'graded', score: sub.score, pinned }
  }
  if (sub?.workflow_state === 'submitted' || sub?.workflow_state === 'pending_review') {
    return { ...base, status: 'submitted', score: null, pinned }
  }
  // missing / unsubmitted / no submission record (sub === undefined)
  return { ...base, status: 'missing', score: null, pinned }
}

/** Excused and not_graded assignments never participate in the grade. */
export function isCountable(item: GradeItem): boolean {
  return item.status !== 'excused' && item.status !== 'not_graded'
}

/** Percentage (0–1) of a retained set, applying mode null-score semantics. */
export function retainedFraction(items: readonly GradeItem[], mode: Mode): number | null {
  let earned = 0
  let possible = 0
  for (const item of items) {
    if (mode === 'current' && item.score === null) continue
    earned += item.score ?? 0
    possible += item.points
  }
  return possible === 0 ? null : earned / possible
}

/** score/points ratio for greedy ranking; null scores sort worst per mode. */
export function sortRatio(item: GradeItem, mode: Mode): number {
  if (item.score === null) return mode === 'current' ? -Infinity : 0
  // A zero/absent points_possible cannot yield a meaningful ratio; treat it as
  // neutral so a 0-point item never corrupts the greedy ranking with Infinity.
  if (item.points <= 0) return 0
  return item.score / item.points
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
export function greedyDrop(
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
export function applyDrop(
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
export function computeGroupGrade(
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
    possible += item.points
  }

  return { items, earned, possible, usedGreedy }
}

export function percentageOf(earned: number, possible: number): number | null {
  return possible === 0 ? null : (earned / possible) * 100
}

/** Overall course percentage for a single mode, weighted or not. */
export function computeOverall(
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
export function mapLetter(
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

/** Resolve the course grading scheme, falling back to the account standard. */
export async function resolveGradingScheme(
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
