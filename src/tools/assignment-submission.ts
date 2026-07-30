import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

export function assignmentSubmissionTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'upload_submission_file',
      description:
        "Upload a file to the authenticated student's own submission area for one assignment, " +
        'as step 1 of an online_upload submission (step 2: pass the returned file id to ' +
        'submit_assignment). Opt-in tool: only available when the server was started with ' +
        'CANVAS_ENABLE_ASSIGNMENT_SUBMISSION. Content must be base64-encoded. This uploads ' +
        'only — nothing is submitted until submit_assignment is called.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID'),
        name: z.string().describe('The filename, including extension'),
        content_base64: z.string().describe('The file content, base64-encoded'),
        content_type: z.string().describe('The MIME type, e.g. application/pdf'),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
      handler: async (params) => {
        return canvas.files.uploadToSubmission(
          params.course_id as number,
          params.assignment_id as number,
          params.name as string,
          params.content_base64 as string,
          params.content_type as string,
        )
      },
    },
    {
      name: 'submit_assignment',
      description:
        "Submit the authenticated student's own work to an assignment. Opt-in tool: only " +
        'available when the server was started with CANVAS_ENABLE_ASSIGNMENT_SUBMISSION. ' +
        'IMPORTANT: before calling, show the user exactly what will be submitted (assignment ' +
        'name, submission type, and full content/URL/file list) and get their explicit ' +
        'confirmation — submissions cannot be retracted and may consume a limited attempt. ' +
        'Submits as the token holder only; submitting on behalf of another user is not ' +
        'supported. For online_upload, first upload each file with upload_submission_file ' +
        'and pass the returned file ids.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The Canvas assignment ID'),
        submission_type: z
          .enum(['online_text_entry', 'online_url', 'online_upload'])
          .describe("Must be one of the assignment's allowed submission_types"),
        body: z
          .string()
          .optional()
          .describe('The submission text/HTML. Required iff submission_type is online_text_entry'),
        url: z
          .string()
          .optional()
          .describe('The submission URL (http/https). Required iff submission_type is online_url'),
        file_ids: z
          .array(z.number())
          .optional()
          .describe(
            'File IDs from prior upload_submission_file calls. Required (non-empty) iff submission_type is online_upload',
          ),
        comment: z
          .string()
          .optional()
          .describe('Optional text comment to attach alongside the submission'),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
      handler: async (params) => {
        const submissionType = params.submission_type as
          'online_text_entry' | 'online_url' | 'online_upload'
        const body = params.body as string | undefined
        const url = params.url as string | undefined
        const fileIds = params.file_ids as number[] | undefined
        const comment = params.comment as string | undefined

        if (submissionType === 'online_text_entry') {
          if (!body) {
            throw new Error(
              "submission_type 'online_text_entry' requires 'body' and does not accept 'url' or 'file_ids'",
            )
          }
          if (url !== undefined || fileIds !== undefined) {
            throw new Error(
              "submission_type 'online_text_entry' requires 'body' and does not accept 'url' or 'file_ids'",
            )
          }
        } else if (submissionType === 'online_url') {
          if (!url) {
            throw new Error(
              "submission_type 'online_url' requires 'url' and does not accept 'body' or 'file_ids'",
            )
          }
          let parsedUrl: URL
          try {
            parsedUrl = new URL(url)
          } catch {
            throw new Error(
              "submission_type 'online_url' requires 'url' and does not accept 'body' or 'file_ids'",
            )
          }
          if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            throw new Error(
              "submission_type 'online_url' requires 'url' and does not accept 'body' or 'file_ids'",
            )
          }
          if (body !== undefined || fileIds !== undefined) {
            throw new Error(
              "submission_type 'online_url' requires 'url' and does not accept 'body' or 'file_ids'",
            )
          }
        } else if (submissionType === 'online_upload') {
          if (!fileIds || fileIds.length === 0) {
            throw new Error(
              "submission_type 'online_upload' requires non-empty 'file_ids' and does not accept 'body' or 'url'",
            )
          }
          if (body !== undefined || url !== undefined) {
            throw new Error(
              "submission_type 'online_upload' requires non-empty 'file_ids' and does not accept 'body' or 'url'",
            )
          }
        }

        return canvas.submissions.submit(
          params.course_id as number,
          params.assignment_id as number,
          {
            submission_type: submissionType,
            body,
            url,
            file_ids: fileIds,
            comment,
          },
        )
      },
    },
  ]
}
