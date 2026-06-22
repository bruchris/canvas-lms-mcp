import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ListStudentSubmissionsOptions, SubmissionWorkflowState } from '../canvas/submissions'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'

const WORKFLOW_STATE = ['submitted', 'graded', 'pending_review', 'unsubmitted'] as const

const DEFAULT_MAX_FILES = 500
const MAX_MAX_FILES = 2000

const URL_EXPIRY_NOTE =
  'Attachment download URLs are time-limited (typically 1 hour). Use file_id with the download_file tool to re-fetch a fresh URL.'

interface SubmissionFileEntry {
  assignment_id: number
  assignment_name: string | null
  user_id: number
  user_name: string | null
  original_filename: string
  file_id: number
  download_url: string
  content_type: string
  size: number
  submitted_at: string | null
  _warning?: string
}

/**
 * `list_course_submission_files` — walk every assignment in a course and produce
 * a flat manifest of every file attachment students have submitted. Read-only
 * composition of `canvas.submissions.listForStudents`; no new Canvas endpoints.
 */
export function submissionFileTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
  return [
    {
      name: 'list_course_submission_files',
      description:
        'List every file attachment submitted by students across all assignments in a course. ' +
        'Returns a manifest — one entry per file — including the original filename, a file_id for ' +
        're-fetching via download_file, content type, and size. Useful for bulk-archiving student ' +
        'work before a course expires or a Free-For-Teacher account is concluded. ' +
        'Outputs are bounded by max_files (default 500); when the limit is hit, truncated is true ' +
        'and truncation_note explains how to retrieve the rest. ' +
        'Download URLs are time-limited (typically 1 hour) — use the returned file_id with ' +
        'download_file to get a fresh URL at download time. ' +
        'When CANVAS_PSEUDONYMIZE_STUDENTS is enabled, user_name is a stable per-course pseudonym ' +
        '(e.g. "Student 1"); user_id (the raw numeric Canvas ID) is always returned and works as a ' +
        'stable per-student folder key.',
      inputSchema: {
        course_id: z.number().int().positive().describe('Canvas course ID.'),
        assignment_ids: z
          .array(z.number().int().positive())
          .optional()
          .describe('Restrict to these assignment IDs. Omit to scan all assignments.'),
        student_ids: z
          .array(z.number().int().positive())
          .optional()
          .describe(
            'Restrict to these student user IDs. Omit to include all students. When ' +
              'CANVAS_PSEUDONYMIZE_STUDENTS is enabled, pass the real Canvas user_id after ' +
              'resolving the pseudonym via resolve_pseudonym.',
          ),
        workflow_state: z
          .enum(WORKFLOW_STATE)
          .optional()
          .describe('Only include submissions in this workflow state. Omit to include all states.'),
        attachments_only: z
          .boolean()
          .default(true)
          .describe(
            'When true (default), skip submissions that have no file attachments. When false, ' +
              'still only emit file entries but process every submission.',
          ),
        max_files: z
          .number()
          .int()
          .min(1)
          .max(MAX_MAX_FILES)
          .default(DEFAULT_MAX_FILES)
          .describe(
            `Maximum number of file entries to return (1–${MAX_MAX_FILES}). Default ${DEFAULT_MAX_FILES}. ` +
              'When the limit is hit, truncated is set to true.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const maxFiles = (params.max_files as number | undefined) ?? DEFAULT_MAX_FILES
        const attachmentsOnly = (params.attachments_only as boolean | undefined) ?? true

        const listOpts: ListStudentSubmissionsOptions = {
          student_ids: (params.student_ids as number[] | undefined) ?? (['all'] as const),
          include: ['user', 'assignment'] as const,
        }
        if (params.assignment_ids !== undefined)
          listOpts.assignment_ids = params.assignment_ids as number[]
        if (params.workflow_state !== undefined)
          listOpts.workflow_state = params.workflow_state as SubmissionWorkflowState

        const submissions = await canvas.submissions.listForStudents(courseId, listOpts)

        const files: SubmissionFileEntry[] = []
        let submissionsScanned = 0
        let truncated = false

        for (const sub of submissions) {
          submissionsScanned++

          if (attachmentsOnly && (!sub.attachments || sub.attachments.length === 0)) {
            continue
          }

          let userId = sub.user_id
          let userName: string | null = null
          let userWarning: string | undefined

          if (sub.user) {
            const resolvedUser = pseudonymizer?.isEnabled()
              ? await pseudonymizer.anonymizeUser(courseId, sub.user)
              : sub.user
            userId = resolvedUser.id
            userName = resolvedUser.name
          } else {
            userWarning = 'user data unavailable'
          }

          for (const att of sub.attachments ?? []) {
            if (files.length >= maxFiles) {
              truncated = true
              break
            }
            // Canvas can return an attachment whose signed URL is not yet ready
            // (e.g. a file still processing). Flag it rather than emit a
            // good-looking entry with a broken download_url; file_id still lets
            // the caller re-fetch via download_file once it is ready.
            const attWarning = att.url
              ? undefined
              : 'attachment url unavailable (file may still be processing) — retry download_file with file_id'
            const warning = [userWarning, attWarning].filter(Boolean).join('; ') || undefined
            files.push({
              assignment_id: sub.assignment_id,
              assignment_name: sub.assignment?.name ?? null,
              user_id: userId,
              user_name: userName,
              original_filename: att.display_name,
              file_id: att.id,
              download_url: att.url,
              content_type: att.content_type,
              size: att.size,
              submitted_at: sub.submitted_at,
              ...(warning !== undefined ? { _warning: warning } : {}),
            })
          }

          if (truncated) break
        }

        return {
          course_id: courseId,
          total_files: files.length,
          total_submissions_scanned: submissionsScanned,
          truncated,
          truncation_note: truncated
            ? `Results truncated at ${maxFiles} files — the manifest is incomplete. To retrieve the rest, raise max_files (up to ${MAX_MAX_FILES}) and/or re-run scoped to a subset of assignment_ids or student_ids (iterate per assignment to fully cover a large course).`
            : null,
          url_expiry_note: URL_EXPIRY_NOTE,
          files,
        }
      },
    },
  ]
}
