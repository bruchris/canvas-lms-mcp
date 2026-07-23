import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { CanvasAssignmentGroup, CanvasGradingSchemeEntry } from '../canvas/types'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import {
  computeGroupGrade,
  computeOverall,
  mapLetter,
  percentageOf,
  resolveGradingScheme,
} from './grade-engine'
import type { GroupModeResult } from './grade-engine'
import type { ToolDefinition } from './types'

type Feasibility = 'already_secured' | 'achievable' | 'impossible'

interface GroupProjectionData {
  group: CanvasAssignmentGroup
  result: GroupModeResult
  earned: number
  pGraded: number
  pRemaining: number
  pTotal: number
}

/**
 * Partition a group's current-mode-retained items into locked-in (graded) vs
 * remaining (missing/submitted) totals. Dropped, excused, and not_graded items
 * never contribute to either side.
 */
function buildGroupProjectionData(
  group: CanvasAssignmentGroup,
  result: GroupModeResult,
): GroupProjectionData {
  let earned = 0
  let pGraded = 0
  let pRemaining = 0
  for (const item of result.items) {
    if (item.dropped || item.status === 'excused' || item.status === 'not_graded') continue
    if (item.status === 'graded') {
      earned += item.score ?? 0
      pGraded += item.points
    } else {
      pRemaining += item.points
    }
  }
  return { group, result, earned, pGraded, pRemaining, pTotal: pGraded + pRemaining }
}

function feasibilityFromX(x: number): Feasibility {
  return x <= 0 ? 'already_secured' : x <= 1 ? 'achievable' : 'impossible'
}

interface ProjectionOutcome {
  minimumPctOnRemaining: number | null
  feasibility: Feasibility
  activeWeightSumZero: boolean
}

function computeProjection(
  projData: readonly GroupProjectionData[],
  weighted: boolean,
  targetFraction: number,
): ProjectionOutcome {
  if (!weighted) {
    const E = projData.reduce((s, d) => s + d.earned, 0)
    const pTotal = projData.reduce((s, d) => s + d.pTotal, 0)
    const pRemaining = projData.reduce((s, d) => s + d.pRemaining, 0)

    if (pRemaining === 0) {
      const currentFraction = pTotal > 0 ? E / pTotal : null
      const feasibility: Feasibility =
        currentFraction !== null && currentFraction >= targetFraction
          ? 'already_secured'
          : 'impossible'
      return { minimumPctOnRemaining: null, feasibility, activeWeightSumZero: false }
    }

    const x = (targetFraction * pTotal - E) / pRemaining
    return {
      minimumPctOnRemaining: x * 100,
      feasibility: feasibilityFromX(x),
      activeWeightSumZero: false,
    }
  }

  const activeGroups = projData.filter((d) => d.pTotal > 0)
  const activeWeightSum = activeGroups.reduce((s, d) => s + (d.group.group_weight ?? 0), 0)

  if (activeWeightSum === 0) {
    return { minimumPctOnRemaining: null, feasibility: 'impossible', activeWeightSumZero: true }
  }

  const A = activeGroups.reduce((s, d) => {
    const w = (d.group.group_weight ?? 0) / activeWeightSum
    return s + w * (d.earned / d.pTotal)
  }, 0)
  const B = activeGroups.reduce((s, d) => {
    const w = (d.group.group_weight ?? 0) / activeWeightSum
    return s + w * (d.pRemaining / d.pTotal)
  }, 0)

  if (B === 0) {
    const feasibility: Feasibility = A >= targetFraction ? 'already_secured' : 'impossible'
    return { minimumPctOnRemaining: null, feasibility, activeWeightSumZero: false }
  }

  const x = (targetFraction - A) / B
  return {
    minimumPctOnRemaining: x * 100,
    feasibility: feasibilityFromX(x),
    activeWeightSumZero: false,
  }
}

function buildProjectionSummary(
  feasibility: Feasibility,
  minimumPct: number | null,
  targetStr: string,
  currentPct: number | null,
  totalRemaining: number,
): string {
  const currentStr = currentPct !== null ? `${currentPct.toFixed(1)}%` : 'unknown'
  if (feasibility === 'already_secured') {
    return (
      `With a current grade of ${currentStr}, the target of ${targetStr} is already secured ` +
      `— no minimum score is required on the remaining work.`
    )
  }
  if (feasibility === 'impossible') {
    return (
      `Reaching ${targetStr} (current grade: ${currentStr}) is not possible — even scoring ` +
      `100% on all remaining ${totalRemaining} points of ungraded work would not be sufficient.`
    )
  }
  return (
    `To reach ${targetStr} (current grade: ${currentStr}), a minimum average of ` +
    `${minimumPct!.toFixed(1)}% is needed on the remaining ${totalRemaining} points of ` +
    `ungraded work.`
  )
}

/** Resolve a letter grade to its lower-bound percentage via the grading scheme. */
function resolveTargetLetter(
  letter: string,
  gradingScheme: ReadonlyArray<CanvasGradingSchemeEntry> | null,
): number {
  if (!gradingScheme) {
    throw new Error(
      'A letter-grade target requires a grading scheme, but this course has no grading standard ' +
        'configured. Pass target_percentage instead.',
    )
  }
  const sorted = [...gradingScheme].sort((a, b) => b.value - a.value)
  const entry = sorted.find((e) => e.name.toLowerCase() === letter.toLowerCase())
  if (!entry) {
    const valid = sorted.map((e) => e.name).join(', ')
    throw new Error(
      `Letter grade '${letter}' is not in the course grading scheme. Valid letters: ${valid}.`,
    )
  }
  return entry.value * 100
}

export function gradeProjectionTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
  return [
    {
      name: 'project_grade',
      description:
        'Projects the minimum score needed on remaining assignments to reach a target course grade.\n\n' +
        'Given a target (as a percentage, e.g. 90, or a letter grade, e.g. "A") and the student\'s ' +
        'current scores, computes the minimum uniform percentage that must be earned on all remaining ' +
        '(not yet graded) assignments for the overall course grade to reach the target. Accounts for ' +
        'assignment-group weights, drop_lowest / drop_highest / never_drop rules, and the course ' +
        'grading scheme (for letter-grade targets and output letter mapping).\n\n' +
        'Returns:\n' +
        '- minimum_pct_on_remaining: the uniform percentage needed on all remaining items.\n' +
        "- feasibility: 'achievable' | 'already_secured' | 'impossible'.\n" +
        '- Per-group breakdown of locked-in scores and remaining assignments.\n' +
        '- A plain-language summary.\n\n' +
        'Limitations:\n' +
        '- Uses a uniform-x model: the same percentage is assumed for every remaining item. This is ' +
        'the natural interpretation of "minimum average needed." Per-item optimization is not supported.\n' +
        '- Drop rules are frozen at their current state (based on already-graded scores); which items ' +
        'are dropped may shift as remaining assignments are graded.\n' +
        '- Late-submission penalties are not factored in.\n' +
        '- V1 computes one student per call. Omit student_id to compute for the authenticated user. ' +
        'When CANVAS_PSEUDONYMIZE_STUDENTS is enabled, resolve the pseudonym first via resolve_pseudonym.',
      inputSchema: {
        course_id: z
          .number()
          .int()
          .positive()
          .describe('Canvas course ID to compute the grade projection for.'),
        target_percentage: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe(
            'Target course grade as a percentage (0–100). Exactly one of target_percentage or ' +
              'target_letter must be provided. Example: 90.0 for a 90% target.',
          ),
        target_letter: z
          .string()
          .optional()
          .describe(
            'Target course grade as a letter (e.g. "A", "B+"). Requires the course to have a ' +
              'grading standard configured. Exactly one of target_percentage or target_letter must ' +
              'be provided. Case-insensitive.',
          ),
        student_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Canvas user_id of the student to compute for. Omit to compute for the authenticated user. ' +
              "Instructors may pass any enrolled student's user_id. When CANVAS_PSEUDONYMIZE_STUDENTS " +
              'is enabled, pass the numeric Canvas user_id after resolving the pseudonym via resolve_pseudonym.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const targetPercentageParam = params.target_percentage as number | undefined
        const targetLetterParam = params.target_letter as string | undefined
        const studentParam = params.student_id as number | undefined
        const studentId: number | 'self' = studentParam === undefined ? 'self' : studentParam

        if (targetPercentageParam !== undefined && targetLetterParam !== undefined) {
          throw new Error('Provide either target_percentage or target_letter, not both.')
        }
        if (targetPercentageParam === undefined && targetLetterParam === undefined) {
          throw new Error('Provide one of target_percentage or target_letter.')
        }

        const course = await canvas.courses.get(courseId)

        let gradingScheme: ReadonlyArray<CanvasGradingSchemeEntry> | null = null
        if (course.grading_standard_id != null) {
          gradingScheme = await resolveGradingScheme(canvas, courseId, course)
        }

        const targetPercentage =
          targetLetterParam !== undefined
            ? resolveTargetLetter(targetLetterParam, gradingScheme)
            : (targetPercentageParam as number)

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

        const enrollmentEmpty = enrollments.length === 0
        const submissionsById = new Map(submissions.map((sub) => [sub.assignment_id, sub]))
        const weighted = course.apply_assignment_group_weights ?? false

        const currentResults: Array<{ group: CanvasAssignmentGroup; result: GroupModeResult }> =
          groups.map((group) => ({
            group,
            result: computeGroupGrade(group, submissionsById, 'current'),
          }))
        const projData = currentResults.map(({ group, result }) =>
          buildGroupProjectionData(group, result),
        )

        const targetFraction = targetPercentage / 100
        const outcome = computeProjection(projData, weighted, targetFraction)

        const hasDropRules = groups.some(
          (g) => (g.rules?.drop_lowest ?? 0) > 0 || (g.rules?.drop_highest ?? 0) > 0,
        )

        const caveats: string[] = []
        if (enrollmentEmpty) {
          caveats.push(
            'No enrollment record was found for this student in this course; the current grade ' +
              'cannot be determined from Canvas enrollment data.',
          )
        }
        if (outcome.activeWeightSumZero) {
          caveats.push(
            'No assignment groups have any gradeable assignments; overall grade cannot be computed.',
          )
        }
        caveats.push(
          'Submitted but ungraded assignments are treated as remaining; their actual scores may ' +
            'differ from the projected minimum.',
        )
        caveats.push(
          'This projection does not account for late-submission penalties; if the course deducts ' +
            'points for late work, the actual score needed may be higher.',
        )
        if (hasDropRules) {
          caveats.push(
            'Drop rules are applied using currently graded scores only; which items are dropped may ' +
              'change as remaining assignments are graded.',
          )
        }

        const computedCurrent = computeOverall(currentResults, weighted)
        const currentGradeLetter = mapLetter(computedCurrent, gradingScheme)
        const targetLetter = mapLetter(targetPercentage, gradingScheme)

        const lockedInEarned = projData.reduce((s, d) => s + d.earned, 0)
        const lockedInPossible = projData.reduce((s, d) => s + d.pGraded, 0)
        const remainingPointsPossible = projData.reduce((s, d) => s + d.pRemaining, 0)

        const groupOutputs = projData.map((d) => ({
          group_id: d.group.id,
          group_name: d.group.name,
          group_weight: d.group.group_weight ?? 0,
          locked_in: {
            earned: d.earned,
            possible: d.pGraded,
            percentage: percentageOf(d.earned, d.pGraded),
          },
          remaining_points_possible: d.pRemaining,
          remaining_assignments: d.result.items
            .filter(
              (item) => !item.dropped && (item.status === 'missing' || item.status === 'submitted'),
            )
            .map((item) => ({
              assignment_id: item.assignment.id,
              assignment_name: item.assignment.name,
              points_possible: item.points,
              status: item.status as 'missing' | 'submitted',
            })),
        }))

        const targetStr = targetLetterParam
          ? `${targetLetterParam} (${targetPercentage.toFixed(1)}%)`
          : `${targetPercentage.toFixed(1)}%`
        const summary = buildProjectionSummary(
          outcome.feasibility,
          outcome.minimumPctOnRemaining,
          targetStr,
          computedCurrent,
          remainingPointsPossible,
        )

        // FERPA: pseudonymize only when viewing another student's data.
        const anonUser =
          pseudonymizer?.isEnabled() && typeof studentId === 'number'
            ? await pseudonymizer.anonymizeUser(courseId, user, enrollments)
            : user

        return {
          student: { id: anonUser.id, name: anonUser.name },
          course: {
            id: course.id,
            name: course.name,
            weighted,
            grading_standard_id: course.grading_standard_id ?? null,
          },
          target: {
            requested: targetLetterParam ?? String(targetPercentageParam),
            percentage: targetPercentage,
            letter: targetLetter,
          },
          current_grade: enrollmentEmpty
            ? { percentage: null, letter: null }
            : { percentage: computedCurrent, letter: currentGradeLetter },
          projection: {
            minimum_pct_on_remaining: outcome.minimumPctOnRemaining,
            feasibility: outcome.feasibility,
            remaining_points_possible: remainingPointsPossible,
            locked_in: { earned: lockedInEarned, possible: lockedInPossible },
            groups: groupOutputs,
          },
          caveats,
          summary,
        }
      },
    },
  ]
}
