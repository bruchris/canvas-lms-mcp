import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import { CanvasApiError } from '../canvas/client'
import type { CreateAssignmentOverrideParams } from '../canvas/types'
import type { ToolDefinition } from './types'

interface AssignmentOverrideResult {
  assignment_id: number
  assignment_name: string
  override_id?: number
  applied: boolean
  error?: string
}

export function assignmentOverrideTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_assignment_overrides',
      description:
        'List all due-date / availability overrides for a specific assignment in a course. ' +
        'Returns overrides targeting individual students, sections, or groups. ' +
        'Useful for auditing before creating a new override — Canvas returns a 422 if a ' +
        'student-set override already exists for the same students on the same assignment.',
      inputSchema: {
        course_id: z.number().int().positive().describe('Canvas course ID'),
        assignment_id: z.number().int().positive().describe('Canvas assignment ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const assignmentId = params.assignment_id as number
        return canvas.assignments.listOverrides(courseId, assignmentId)
      },
    },
    {
      name: 'create_assignment_override',
      description:
        'Create a due-date / availability override for a specific assignment, targeting a set of ' +
        'students, a course section, or a group. Exactly one of student_ids, course_section_id, ' +
        'or group_id must be provided. At least one date field (due_at, unlock_at, lock_at) should ' +
        'be provided; omit a date field to leave the corresponding date unchanged for the override target. ' +
        'Dates must be ISO 8601 strings (e.g. "2026-09-15T23:59:00Z"). ' +
        'Canvas returns a 422 if a student-set override already exists for the same students on this ' +
        'assignment — use list_assignment_overrides to audit first. ' +
        'Provide student_ids as real Canvas user IDs. If CANVAS_PSEUDONYMIZE_STUDENTS is enabled, ' +
        'call resolve_pseudonym first to resolve pseudonyms to real user IDs.',
      inputSchema: {
        course_id: z.number().int().positive().describe('Canvas course ID'),
        assignment_id: z.number().int().positive().describe('Canvas assignment ID'),
        student_ids: z
          .array(z.number().int().positive())
          .min(1)
          .optional()
          .describe(
            'Real Canvas user IDs to grant the override to. ' +
              'Mutually exclusive with course_section_id and group_id.',
          ),
        course_section_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'ID of the course section to override. ' +
              'Mutually exclusive with student_ids and group_id.',
          ),
        group_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'ID of the group to override. ' +
              'Mutually exclusive with student_ids and course_section_id.',
          ),
        title: z
          .string()
          .optional()
          .describe(
            'Human-readable label for this override (e.g. "Disability accommodation — Jane D").',
          ),
        due_at: z
          .string()
          .optional()
          .nullable()
          .describe(
            'New due date in ISO 8601 format. Pass null to remove the due date for this target.',
          ),
        unlock_at: z
          .string()
          .optional()
          .nullable()
          .describe('Availability open date in ISO 8601 format. Pass null to remove.'),
        lock_at: z
          .string()
          .optional()
          .nullable()
          .describe('Availability close date in ISO 8601 format. Pass null to remove.'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const assignmentId = params.assignment_id as number
        const studentIds = params.student_ids as number[] | undefined
        const sectionId = params.course_section_id as number | undefined
        const groupId = params.group_id as number | undefined

        const targetCount = [studentIds, sectionId, groupId].filter((v) => v !== undefined).length
        if (targetCount === 0) {
          throw new Error('Provide exactly one of student_ids, course_section_id, or group_id.')
        }
        if (targetCount > 1) {
          throw new Error(
            'Provide exactly one of student_ids, course_section_id, or group_id — they are mutually exclusive.',
          )
        }

        const overrideParams: CreateAssignmentOverrideParams = {}
        if (studentIds !== undefined) overrideParams.student_ids = studentIds
        if (sectionId !== undefined) overrideParams.course_section_id = sectionId
        if (groupId !== undefined) overrideParams.group_id = groupId
        if (params.title !== undefined) overrideParams.title = params.title as string
        if (params.due_at !== undefined) overrideParams.due_at = params.due_at as string | null
        if (params.unlock_at !== undefined)
          overrideParams.unlock_at = params.unlock_at as string | null
        if (params.lock_at !== undefined) overrideParams.lock_at = params.lock_at as string | null

        return canvas.assignments.createOverride(courseId, assignmentId, overrideParams)
      },
    },
    {
      name: 'set_student_assignment_dates',
      description:
        'Fan a due-date / availability override for a specific student across all (or a filtered subset of) ' +
        'assignments in a course. Creates one student-set override per assignment via the Canvas assignment ' +
        'overrides API. Partial failures are tolerated — a failure on one assignment does not abort the rest. ' +
        'Note: for courses with many assignments this makes one Canvas API call per assignment. ' +
        'V1 is create-only: if an override for this student already exists on an assignment, Canvas returns ' +
        'a 422 and that assignment appears in the failed[] list. Use list_assignment_overrides to audit first. ' +
        'Dates must be ISO 8601 strings. To shift dates by a relative amount, first call list_assignments ' +
        'with include=overrides to retrieve current dates, compute absolute timestamps, then call this tool. ' +
        'Provide user_id as the real Canvas user ID. If CANVAS_PSEUDONYMIZE_STUDENTS is enabled, ' +
        'call resolve_pseudonym first to obtain the real user_id from a pseudonym.',
      inputSchema: {
        course_id: z.number().int().positive().describe('Canvas course ID'),
        user_id: z
          .number()
          .int()
          .positive()
          .describe('Real Canvas user ID of the student to accommodate'),
        assignment_ids: z
          .array(z.number().int().positive())
          .optional()
          .describe(
            'Limit the fan-out to these specific assignment IDs. ' +
              'Omit to target all assignments in the course.',
          ),
        title: z
          .string()
          .optional()
          .describe(
            'Label for each override (e.g. "Disability accommodation"). Defaults to "Student accommodation".',
          ),
        due_at: z
          .string()
          .optional()
          .nullable()
          .describe('New due date in ISO 8601 format. Pass null to remove the due date.'),
        unlock_at: z
          .string()
          .optional()
          .nullable()
          .describe('Availability open date in ISO 8601 format. Pass null to remove.'),
        lock_at: z
          .string()
          .optional()
          .nullable()
          .describe('Availability close date in ISO 8601 format. Pass null to remove.'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const userId = params.user_id as number
        const assignmentIds = params.assignment_ids as number[] | undefined
        const dueAt = params.due_at as string | null | undefined
        const unlockAt = params.unlock_at as string | null | undefined
        const lockAt = params.lock_at as string | null | undefined
        const title = (params.title as string | undefined) ?? 'Student accommodation'

        if (dueAt === undefined && unlockAt === undefined && lockAt === undefined) {
          throw new Error('Provide at least one of due_at, unlock_at, or lock_at.')
        }

        let assignments = await canvas.assignments.list(courseId)
        if (assignmentIds && assignmentIds.length > 0) {
          const idSet = new Set(assignmentIds)
          assignments = assignments.filter((a) => idSet.has(a.id))
        }

        const applied: AssignmentOverrideResult[] = []
        const skipped: AssignmentOverrideResult[] = []
        const failed: AssignmentOverrideResult[] = []

        for (const assignment of assignments) {
          const overrideParams: CreateAssignmentOverrideParams = {
            student_ids: [userId],
            title,
          }
          if (dueAt !== undefined) overrideParams.due_at = dueAt
          if (unlockAt !== undefined) overrideParams.unlock_at = unlockAt
          if (lockAt !== undefined) overrideParams.lock_at = lockAt

          try {
            const override = await canvas.assignments.createOverride(
              courseId,
              assignment.id,
              overrideParams,
            )
            applied.push({
              assignment_id: assignment.id,
              assignment_name: assignment.name,
              override_id: override.id,
              applied: true,
            })
          } catch (err) {
            if (!(err instanceof CanvasApiError)) {
              // A non-Canvas error inside the fan-out is caught here so partial
              // results survive — but that means it never reaches buildHandler's
              // logging. Log it here, mirroring that boundary, so a programming
              // bug is not silently reduced to an opaque per-assignment string.
              console.error(
                `Unexpected error creating assignment override (course ${courseId}, assignment ${assignment.id}):`,
                err,
              )
            }
            const message = err instanceof Error ? err.message : 'Unknown error'
            failed.push({
              assignment_id: assignment.id,
              assignment_name: assignment.name,
              applied: false,
              error: message,
            })
          }
        }

        return {
          applied,
          skipped,
          failed,
          summary: {
            total_assignments: assignments.length,
            applied: applied.length,
            skipped: skipped.length,
            failed: failed.length,
          },
        }
      },
    },
  ]
}
