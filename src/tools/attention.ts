import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { CanvasSubmission, CanvasSubmissionComment } from '../canvas/types'
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
  ]
}
