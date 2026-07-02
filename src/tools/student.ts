import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { SubmissionListInclude } from '../canvas/submissions'
import type { CanvasSubmission, CanvasSubmissionComment } from '../canvas/types'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'

const MY_SUBMISSION_FEEDBACK_INCLUDE = [
  'submission_comments',
  'user',
  'assignment',
  'course',
  'read_status',
] as const satisfies ReadonlyArray<SubmissionListInclude>

type CommentAuthorRole = 'self' | 'teacher' | 'peer'

interface FeedbackComment {
  id: number
  author_role: CommentAuthorRole
  author_name: string
  comment: string
  created_at: string
}

interface SubmissionFeedback {
  course_id: number
  course_name: string | null
  assignment_id: number
  assignment_name: string | null
  submission_id: number
  workflow_state: string
  score: number | null
  read_status: 'read' | 'unread' | null
  feedback_author_roles: CommentAuthorRole[] // deduped, excludes 'self'
  latest_feedback_comment: FeedbackComment
  comments: FeedbackComment[] // full thread, chronological, includes 'self' comments
  html_url: string | null
}

function classifyCommentAuthor(
  comment: CanvasSubmissionComment,
  submission: CanvasSubmission,
): CommentAuthorRole {
  if (comment.author_id === submission.user_id) return 'self'
  if (submission.grader_id != null && comment.author_id === submission.grader_id) return 'teacher'
  return 'peer'
}

function toFeedbackComment(
  comment: CanvasSubmissionComment,
  role: CommentAuthorRole,
): FeedbackComment {
  return {
    id: comment.id,
    author_role: role,
    author_name: comment.author_name,
    comment: comment.comment,
    created_at: comment.created_at,
  }
}

export function studentTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
  return [
    {
      name: 'get_my_courses',
      description: 'List active courses for the authenticated student.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        return canvas.courses.list({ enrollment_state: 'active' })
      },
    },
    {
      name: 'get_my_grades',
      description:
        'Get grade data for the authenticated student. If course_id is omitted, returns grades across all enrolled courses.',
      inputSchema: {
        course_id: z.number().optional().describe('The Canvas course ID (omit for all courses)'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number | undefined
        return canvas.enrollments.listMyGrades(course_id)
      },
    },
    {
      name: 'get_my_submissions',
      description: 'List all submissions for the authenticated student in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.submissions.listMy(course_id)
      },
    },
    {
      name: 'get_my_upcoming_assignments',
      description: 'List upcoming assignment events for the authenticated student.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        return canvas.users.getUpcomingAssignments()
      },
    },
    {
      name: 'get_my_submission_feedback',
      description:
        "List the authenticated student's own submissions that carry feedback comments from an " +
        'instructor or a peer reviewer — comments left by the student themselves do not count as ' +
        'feedback and submissions with no non-self comments are omitted. Omit `course_id` to scan ' +
        'every active course. Sorted most-recent-feedback-first. Comment author role is best-effort: ' +
        "'teacher' is only identified when the author is the submission's recorded grader; other " +
        "non-self authors are labeled 'peer', including any staff member who comments without being " +
        'the recorded grader.',
      inputSchema: {
        course_id: z
          .number()
          .optional()
          .describe("The Canvas course ID. Omit to scan all of the student's active courses."),
        unread_only: z
          .boolean()
          .optional()
          .describe(
            "Only include submissions the student hasn't opened yet (Canvas read_status). " +
              'Defaults to false.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseIdParam = params.course_id as number | undefined
        const unreadOnly = (params.unread_only as boolean | undefined) ?? false

        const courseIds =
          courseIdParam !== undefined
            ? [courseIdParam]
            : (await canvas.courses.list({ enrollment_state: 'active' })).map((c) => c.id)

        const perCourse = await Promise.all(
          courseIds.map(async (courseId) => ({
            courseId,
            submissions: await canvas.submissions.listMy(courseId, {
              include: MY_SUBMISSION_FEEDBACK_INCLUDE,
            }),
          })),
        )

        let submissionsScanned = 0
        const candidates: Array<{ courseId: number; submission: CanvasSubmission }> = []
        for (const { courseId, submissions } of perCourse) {
          for (const submission of submissions) {
            submissionsScanned += 1
            const comments = submission.submission_comments ?? []
            if (comments.length === 0) continue
            const hasFeedback = comments.some(
              (c) => classifyCommentAuthor(c, submission) !== 'self',
            )
            if (!hasFeedback) continue
            if (unreadOnly && submission.read_status !== 'unread') continue
            candidates.push({ courseId, submission })
          }
        }

        if (pseudonymizer?.isEnabled()) {
          const peerAuthors = new Map<string, { courseId: number; id: number; name: string }>()
          for (const { courseId, submission } of candidates) {
            for (const comment of submission.submission_comments ?? []) {
              if (classifyCommentAuthor(comment, submission) === 'peer') {
                peerAuthors.set(`${courseId}:${comment.author_id}`, {
                  courseId,
                  id: comment.author_id,
                  name: comment.author_name,
                })
              }
            }
          }
          await Promise.all(
            [...peerAuthors.values()].map((p) =>
              pseudonymizer.anonymizeUser(p.courseId, { id: p.id, name: p.name }),
            ),
          )
        }

        const findings: SubmissionFeedback[] = []
        for (const { courseId, submission } of candidates) {
          const roles = new Map<number, CommentAuthorRole>()
          for (const c of submission.submission_comments ?? []) {
            roles.set(c.id, classifyCommentAuthor(c, submission))
          }

          const resolved = pseudonymizer?.isEnabled()
            ? await pseudonymizer.anonymizeSubmission(courseId, submission)
            : submission

          const comments = (resolved.submission_comments ?? []).map((c) =>
            toFeedbackComment(c, roles.get(c.id) ?? 'peer'),
          )
          const feedbackComments = comments.filter((c) => c.author_role !== 'self')
          const latest = feedbackComments.reduce((a, b) => (a.created_at >= b.created_at ? a : b))

          findings.push({
            course_id: courseId,
            course_name: resolved.course?.name ?? null,
            assignment_id: resolved.assignment_id,
            assignment_name: resolved.assignment?.name ?? null,
            submission_id: resolved.id,
            workflow_state: resolved.workflow_state,
            score: resolved.score,
            read_status: resolved.read_status ?? null,
            feedback_author_roles: [...new Set(feedbackComments.map((c) => c.author_role))],
            latest_feedback_comment: latest,
            comments,
            html_url: resolved.html_url ?? null,
          })
        }

        findings.sort((a, b) => {
          const A = a.latest_feedback_comment.created_at
          const B = b.latest_feedback_comment.created_at
          return A === B ? 0 : A < B ? 1 : -1
        })

        return {
          courses_scanned: courseIds.length,
          submissions_scanned: submissionsScanned,
          findings_count: findings.length,
          findings,
        }
      },
    },
  ]
}
