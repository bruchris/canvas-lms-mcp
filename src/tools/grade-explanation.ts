import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type {
  CanvasAssignmentGroup,
  CanvasEnrollment,
  CanvasGradingSchemeEntry,
} from '../canvas/types'
import {
  CURVE_CAVEAT_THRESHOLD,
  computeGroupGrade,
  computeOverall,
  mapLetter,
  percentageOf,
  resolveGradingScheme,
} from './grade-engine'
import type { GroupModeResult } from './grade-engine'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'

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
      points_possible: item.points,
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

/** Rounding drift (in percentage points) absorbed before a difference counts. */
const RECONCILIATION_TOLERANCE = 0.5

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
        // Reconciliation needs an enrollment that actually carries posted scores.
        // Two distinct "unavailable" cases must each be surfaced rather than
        // returning a silent null reconciliation:
        //   1. no enrollment / no grades object (empty list, observer/TA records);
        //   2. a grades object whose current_score AND final_score are both null
        //      (muted/hidden grades, or no grade posted yet).
        if (!enrollment?.grades) {
          caveats.push(
            'No student enrollment found with posted grades for this course — Canvas posted ' +
              'scores are unavailable.',
          )
        } else if (
          enrollment.grades.current_score == null &&
          enrollment.grades.final_score == null
        ) {
          caveats.push(
            'Canvas has not posted a current or final score for this student (grades may be ' +
              'hidden or not yet released), so the reconciliation could not be performed.',
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

        const submissionsById = new Map(submissions.map((sub) => [sub.assignment_id, sub]))

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

        // Explain weighted-mode edge cases so a null/odd total is never silent.
        if (weighted && groupFilter === undefined) {
          const hasGradedWork = currentResults.some((r) => r.result.possible > 0)
          if (computedCurrent === null && hasGradedWork) {
            caveats.push(
              'This course is set to weight assignment groups, but no group weights are ' +
                'configured, so the overall percentage cannot be computed.',
            )
          } else if (
            hasGradedWork &&
            currentResults.some((r) => (r.group.group_weight ?? 0) > 0 && r.result.possible <= 0)
          ) {
            caveats.push(
              'One or more weighted assignment groups have no graded work yet, so their weight ' +
                'is redistributed across the remaining groups (matching Canvas). Per-group ' +
                'weighted_contribution values are nominal (group_weight × percentage) and may ' +
                'not sum to the overall percentage.',
            )
          }
        }

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
        // one's own grade (self) exposes no third-party PII. Pass the already-
        // fetched enrollments so role classification uses real enrollment types
        // (a staff member fetched by id is correctly left un-pseudonymized).
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
          groups: groupOutputs,
          totals: { current: totalsCurrent, final: totalsFinal },
          caveats,
        }
      },
    },
  ]
}
