import { z } from 'zod'
import { CanvasApiError } from '../canvas/client'
import type { CanvasClient } from '../canvas'
import type {
  CanvasSubmission,
  CanvasSubmissionComment,
  CanvasStudentSummary,
} from '../canvas/types'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'

const ATTENTION_INCLUDE = ['submission_comments', 'user', 'assignment', 'read_status'] as const

function latestComment(
  comments: ReadonlyArray<CanvasSubmissionComment>,
): CanvasSubmissionComment | undefined {
  if (comments.length === 0) return undefined
  return [...comments].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )[0]
}

function trailingStudentCommentCount(
  comments: ReadonlyArray<CanvasSubmissionComment>,
  userId: number,
): number {
  const sorted = [...comments].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
  let count = 0
  for (const c of sorted) {
    if (c.author_id === userId) count++
    else break
  }
  return count
}

function isNeedsAttention(
  submission: CanvasSubmission,
  latest: CanvasSubmissionComment,
  unreadOnly: boolean,
): boolean {
  if (latest.author_id !== submission.user_id) return false
  const ungradedOrAfterGrade =
    !submission.graded_at ||
    new Date(latest.created_at).getTime() > new Date(submission.graded_at).getTime()
  if (!ungradedOrAfterGrade) return false
  if (unreadOnly && submission.read_status !== 'unread') return false
  return true
}

export function attentionTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
  return [
    {
      name: 'list_submission_comments_needing_attention',
      description:
        'List submissions where the most recent comment is from the student and has not been addressed by grading or a reply — i.e. comments the instructor has likely not seen. Returns a triage list, oldest-unaddressed first. Requires instructor/TA permissions in the course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_ids: z
          .array(z.number())
          .optional()
          .describe(
            'Scope the scan to specific assignment IDs (fetches all assignments when omitted)',
          ),
        unread_only: z
          .boolean()
          .optional()
          .describe(
            'When true, only return submissions where read_status is "unread". Default false.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const assignmentIds = params.assignment_ids as number[] | undefined
        const unreadOnly = (params.unread_only as boolean | undefined) ?? false

        const rawSubmissions = await canvas.submissions.listForStudents(courseId, {
          student_ids: ['all'],
          assignment_ids: assignmentIds,
          include: ATTENTION_INCLUDE,
        })

        const submissions: CanvasSubmission[] = pseudonymizer?.isEnabled()
          ? await Promise.all(
              rawSubmissions.map((s) => pseudonymizer.anonymizeSubmission(courseId, s)),
            )
          : rawSubmissions

        const findings: object[] = []

        for (const s of submissions) {
          const comments = s.submission_comments
          if (!comments || comments.length === 0) continue

          const latest = latestComment(comments)
          if (!latest) continue
          if (!isNeedsAttention(s, latest, unreadOnly)) continue

          const reason = !s.graded_at ? 'student_comment_ungraded' : 'student_comment_after_grading'

          findings.push({
            assignment_id: s.assignment_id,
            assignment_name: s.assignment?.name ?? null,
            user_id: s.user_id,
            user_name: s.user?.name ?? null,
            reason,
            graded_at: s.graded_at ?? null,
            score: s.score,
            workflow_state: s.workflow_state,
            read_status: s.read_status ?? null,
            unaddressed_comment_count: trailingStudentCommentCount(comments, s.user_id),
            latest_student_comment: {
              id: latest.id,
              comment: latest.comment,
              created_at: latest.created_at,
            },
            html_url: s.html_url ?? null,
          })
        }

        findings.sort((a, b) => {
          const aTime = new Date(
            (a as { latest_student_comment: { created_at: string } }).latest_student_comment
              .created_at,
          ).getTime()
          const bTime = new Date(
            (b as { latest_student_comment: { created_at: string } }).latest_student_comment
              .created_at,
          ).getTime()
          return aTime - bTime
        })

        return {
          course_id: courseId,
          scanned_submissions: submissions.length,
          findings_count: findings.length,
          findings,
        }
      },
    },
    {
      name: 'list_students_needing_attention',
      description:
        'Report students who may need instructor attention based on inactivity, missing or late submissions, and low current score. Each finding lists the exact signals that fired and the thresholds used — this is a factual report, not a prediction. Requires instructor/TA permissions in the course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        inactive_days: z
          .number()
          .optional()
          .describe('Flag students with no activity in the last N days (default 7)'),
        min_missing: z
          .number()
          .optional()
          .describe('Flag students with at least N missing submissions (default 1)'),
        min_late: z
          .number()
          .optional()
          .describe('Flag students with at least N late submissions (default 3)'),
        score_threshold: z
          .number()
          .optional()
          .describe('Flag students with a current score below this value (default 70)'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const inactiveDays = (params.inactive_days as number | undefined) ?? 7
        const minMissing = (params.min_missing as number | undefined) ?? 1
        const minLate = (params.min_late as number | undefined) ?? 3
        const scoreThreshold = (params.score_threshold as number | undefined) ?? 70

        const thresholds = {
          inactive_days: inactiveDays,
          min_missing: minMissing,
          min_late: minLate,
          score_threshold: scoreThreshold,
        }

        const rawEnrollments = await canvas.enrollments.listForCourse(courseId, {
          type: ['StudentEnrollment'],
          state: ['active'],
          include: ['grades'],
        })

        const enrollments = pseudonymizer?.isEnabled()
          ? await Promise.all(
              rawEnrollments.map((e) => pseudonymizer.anonymizeEnrollment(courseId, e)),
            )
          : rawEnrollments

        const summaryMap = new Map<number, CanvasStudentSummary>()
        let analyticsAvailable = true
        try {
          const summaries = await canvas.analytics.getStudentSummaries(courseId)
          for (const s of summaries) {
            summaryMap.set(s.id, s)
          }
        } catch (err) {
          if (err instanceof CanvasApiError && err.status === 404) {
            analyticsAvailable = false
          } else {
            throw err
          }
        }

        const now = Date.now()
        const inactiveCutoffMs = inactiveDays * 24 * 60 * 60 * 1000
        const riskOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }

        const findings: object[] = []

        for (const e of enrollments) {
          const signals: object[] = []
          const summary = summaryMap.get(e.user_id)

          const lastActivityMs = e.last_activity_at ? new Date(e.last_activity_at).getTime() : null
          if (lastActivityMs === null || now - lastActivityMs > inactiveCutoffMs) {
            const daysSince =
              lastActivityMs !== null
                ? Math.floor((now - lastActivityMs) / (24 * 60 * 60 * 1000))
                : null
            signals.push({
              type: 'inactive',
              value: e.last_activity_at ?? null,
              threshold: `${inactiveDays} days`,
              detail:
                daysSince !== null
                  ? `No course activity for ${daysSince} days`
                  : 'No course activity recorded',
            })
          }

          const score = e.grades?.current_score ?? null
          if (score !== null && score < scoreThreshold) {
            signals.push({
              type: 'low_score',
              value: score,
              threshold: scoreThreshold,
              detail: `Current score ${score}%`,
            })
          }

          if (analyticsAvailable && summary) {
            const tb = summary.tardiness_breakdown
            if (tb.missing >= minMissing) {
              signals.push({
                type: 'missing_submissions',
                value: tb.missing,
                threshold: minMissing,
                detail: `${tb.missing} assignment${tb.missing === 1 ? '' : 's'} missing`,
              })
            }
            if (tb.late >= minLate) {
              signals.push({
                type: 'late_pattern',
                value: tb.late,
                threshold: minLate,
                detail: `${tb.late} assignment${tb.late === 1 ? '' : 's'} late`,
              })
            }
          }

          if (signals.length === 0) continue

          const count = signals.length
          const riskLevel = count >= 3 ? 'high' : count === 2 ? 'medium' : 'low'

          findings.push({
            user_id: e.user_id,
            user_name: e.user?.name ?? null,
            risk_level: riskLevel,
            signals,
            last_activity_at: e.last_activity_at ?? null,
            current_score: score,
            missing_count: summary?.tardiness_breakdown.missing ?? null,
            late_count: summary?.tardiness_breakdown.late ?? null,
          })
        }

        findings.sort((a, b) => {
          const aRisk = (a as { risk_level: string }).risk_level
          const bRisk = (b as { risk_level: string }).risk_level
          const rDiff = (riskOrder[aRisk] ?? 3) - (riskOrder[bRisk] ?? 3)
          if (rDiff !== 0) return rDiff
          const aCount = (a as { signals: object[] }).signals.length
          const bCount = (b as { signals: object[] }).signals.length
          return bCount - aCount
        })

        const response: Record<string, unknown> = {
          course_id: courseId,
          students_scanned: enrollments.length,
          analytics_available: analyticsAvailable,
          thresholds_used: thresholds,
          findings,
        }

        if (!analyticsAvailable) {
          response.note =
            'Analytics not available for this course. Reporting on inactivity and low score only (missing_submissions and late_pattern signals skipped).'
        }

        return response
      },
    },
  ]
}
