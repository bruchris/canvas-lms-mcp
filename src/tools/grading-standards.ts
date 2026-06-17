import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import { CanvasApiError } from '../canvas/client'
import type { ToolDefinition } from './types'

const schemeEntrySchema = z.object({
  name: z.string().min(1).describe('Letter grade name (e.g. "A", "B+", "F")'),
  value: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'Lower-bound threshold as a fraction 0–1 (e.g. 0.94 means this grade starts at 94%). ' +
        "Canvas computes the upper bound as the next higher grade's value.",
    ),
})

export function gradingStandardsTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_grading_standards',
      description:
        'List grading standards available in a course or account context. ' +
        'Provide either course_id (to see standards scoped to a course) or account_id ' +
        '(to see account-level standards, requires admin access). ' +
        'Returns an array of grading standard objects, each with an id, title, context, ' +
        'and grading_scheme array of { name, value } entries.',
      inputSchema: {
        course_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Course ID to list standards for (mutually exclusive with account_id)'),
        account_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Account ID to list standards for (mutually exclusive with course_id; requires admin)',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number | undefined
        const accountId = params.account_id as number | undefined
        if (courseId !== undefined && accountId !== undefined) {
          throw new Error('Provide either course_id or account_id, not both.')
        }
        if (courseId !== undefined) {
          return canvas.gradingStandards.listForCourse(courseId)
        }
        if (accountId !== undefined) {
          return canvas.gradingStandards.listForAccount(accountId)
        }
        throw new Error('Provide either course_id or account_id.')
      },
    },
    {
      name: 'create_grading_standard',
      description:
        'Create a new grading standard (letter-to-percentage scheme) in a course or account context. ' +
        'Provide either course_id or account_id (account requires admin). ' +
        'scheme_entries is an array of { name, value } objects where value is the lower-bound ' +
        'percentage as a fraction 0–1 (e.g. { name: "A", value: 0.94 } means A ≥ 94%). ' +
        'Entries will be sorted descending by value before sending to Canvas. ' +
        'Canvas POST body key is grading_scheme_entry (singular); the returned object uses grading_scheme (plural). ' +
        'Returns the created grading standard object including its id — use that id with ' +
        'apply_grading_standard_to_course to activate it on a course.',
      inputSchema: {
        course_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Course ID to create the standard in (mutually exclusive with account_id)'),
        account_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Account ID to create the standard in (requires admin; mutually exclusive with course_id)',
          ),
        title: z
          .string()
          .min(1)
          .describe('Display name for this grading standard (e.g. "GPA 4.0 Scale")'),
        scheme_entries: z
          .array(schemeEntrySchema)
          .min(1)
          .describe(
            'Grading scheme entries. Each entry: { name: string, value: number (0–1) }. ' +
              'The lowest grade should have value 0.0.',
          ),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number | undefined
        const accountId = params.account_id as number | undefined
        const title = params.title as string
        const schemeEntries = params.scheme_entries as Array<{ name: string; value: number }>
        if (courseId !== undefined && accountId !== undefined) {
          throw new Error('Provide either course_id or account_id, not both.')
        }
        try {
          if (courseId !== undefined) {
            return await canvas.gradingStandards.createForCourse(courseId, title, schemeEntries)
          }
          if (accountId !== undefined) {
            return await canvas.gradingStandards.createForAccount(accountId, title, schemeEntries)
          }
          throw new Error('Provide either course_id or account_id.')
        } catch (error) {
          // Only re-wrap a permissions 403 from a true account-only call. The
          // mutual-exclusivity guard above guarantees course_id is unset here, so a
          // course-context 403 (which routes through createForCourse) keeps its own
          // formatError message. Exclude rate-limit 403s ("Rate Limit Exceeded"),
          // which formatError surfaces with its own "wait and retry" guidance.
          if (
            error instanceof CanvasApiError &&
            error.status === 403 &&
            courseId === undefined &&
            accountId !== undefined &&
            !error.message.toLowerCase().includes('rate limit exceeded')
          ) {
            throw new Error(
              'Creating grading standards at the account level requires Canvas admin permissions. ' +
                'Try creating the standard in a course context instead (use course_id).',
              { cause: error },
            )
          }
          throw error
        }
      },
    },
    {
      name: 'apply_grading_standard_to_course',
      description:
        'Apply an existing grading standard to a course so the gradebook uses it. ' +
        'Pass the grading_standard_id returned by create_grading_standard or list_grading_standards. ' +
        'Pass null for grading_standard_id to remove the current grading standard from the course. ' +
        'Returns the updated course object.',
      inputSchema: {
        course_id: z.number().int().positive().describe('The Canvas course ID to update'),
        grading_standard_id: z
          .number()
          .int()
          .positive()
          .nullable()
          .describe('The grading standard ID to apply, or null to remove the current standard'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const gradingStandardId = params.grading_standard_id as number | null
        return canvas.courses.update(courseId, { grading_standard_id: gradingStandardId })
      },
    },
  ]
}
