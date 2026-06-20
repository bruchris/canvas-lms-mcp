import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type {
  CanvasAssignment,
  CanvasAssignmentGroup,
  CanvasCourse,
  CanvasModule,
  CanvasModuleItem,
} from '../canvas/types'
import type { ToolDefinition } from './types'

const ALL_CHECKS = [
  'missing_due_dates',
  'unpublished_items',
  'assignment_group_weights',
  'ungraded_setup',
] as const

type CheckName = (typeof ALL_CHECKS)[number]

interface SetupFinding {
  type: string
  id: number
  name: string
  detail: string
  parent_module_name?: string
}

interface CheckResult {
  check: CheckName
  severity: 'warn'
  items: SetupFinding[]
}

export function courseSetupTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'check_course_setup',
      description:
        'Run a factual course-readiness report that surfaces common configuration problems — ' +
        'assignments missing due dates, unpublished items students will not see, ' +
        'gradebook weighting gaps, and graded assignments with no points. ' +
        'Returns findings grouped by check with a plain-language detail per item. ' +
        'This is a config-health report only; it does not inspect student submissions or performance ' +
        '(see list_students_needing_attention / get_missing_submissions for those). ' +
        'Requires instructor permissions in the course.',
      inputSchema: {
        course_id: z.number().int().positive().describe('Canvas course ID'),
        checks: z
          .array(
            z.enum([
              'missing_due_dates',
              'unpublished_items',
              'assignment_group_weights',
              'ungraded_setup',
            ]),
          )
          .optional()
          .describe(
            'Subset of checks to run. Omit to run all four checks. ' +
              'Valid values: missing_due_dates, unpublished_items, ' +
              'assignment_group_weights, ungraded_setup.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const requestedChecks = (params.checks as CheckName[] | undefined) ?? [...ALL_CHECKS]
        const activeChecks = new Set<CheckName>(requestedChecks)

        // Parallel fetch — skip API calls not needed for the active checks.
        // `assignments.list` is always fetched (three of four checks need it).
        const [course, assignments, assignmentGroups, modules]: [
          CanvasCourse | null,
          CanvasAssignment[],
          CanvasAssignmentGroup[],
          (CanvasModule & { items?: CanvasModuleItem[] })[],
        ] = await Promise.all([
          activeChecks.has('assignment_group_weights')
            ? canvas.courses.get(courseId)
            : Promise.resolve(null),
          canvas.assignments.list(courseId, { include: ['all_dates'] }),
          activeChecks.has('assignment_group_weights')
            ? canvas.assignments.listGroups(courseId)
            : Promise.resolve([]),
          activeChecks.has('unpublished_items')
            ? canvas.modules.listWithItems(courseId)
            : Promise.resolve([]),
        ])

        const results: CheckResult[] = []

        // ── check: missing_due_dates ──────────────────────────────────
        // `published !== true` is deliberately conservative: only definitely-
        // published assignments are scanned here and in ungraded_setup. An
        // unpublished or unknown-publish-state assignment is intentional in-
        // progress work, so it is skipped to avoid false positives (the spec's
        // "only published assignments are flagged" rule). unpublished_items
        // applies the inverse and surfaces those instead.
        if (activeChecks.has('missing_due_dates')) {
          const items: SetupFinding[] = []
          for (const a of assignments) {
            if (a.published !== true) continue
            if (a.due_at !== null) continue
            const hasOverrideDueDate = (a.all_dates ?? []).some((d) => d.due_at !== null)
            if (!hasOverrideDueDate) {
              items.push({
                type: 'assignment',
                id: a.id,
                name: a.name,
                detail: 'published, no due_at and no override dates with a due date',
              })
            }
          }
          results.push({ check: 'missing_due_dates', severity: 'warn', items })
        }

        // ── check: unpublished_items ──────────────────────────────────
        if (activeChecks.has('unpublished_items')) {
          const items: SetupFinding[] = []

          for (const a of assignments) {
            if (a.published !== true) {
              items.push({
                type: 'assignment',
                id: a.id,
                name: a.name,
                detail: 'not published — students cannot see this assignment',
              })
            }
          }

          for (const mod of modules) {
            if (mod.published !== true) {
              items.push({
                type: 'module',
                id: mod.id,
                name: mod.name,
                detail: 'not published — students cannot see this module or any of its items',
              })
            } else {
              for (const item of mod.items ?? []) {
                if (item.published !== true) {
                  items.push({
                    type: 'module_item',
                    id: item.id,
                    name: item.title,
                    detail: `not published (inside published module "${mod.name}")`,
                    parent_module_name: mod.name,
                  })
                }
              }
            }
          }

          results.push({ check: 'unpublished_items', severity: 'warn', items })
        }

        // ── check: assignment_group_weights ───────────────────────────
        if (activeChecks.has('assignment_group_weights')) {
          const items: SetupFinding[] = []
          if (course !== null && course.apply_assignment_group_weights === true) {
            const total = assignmentGroups.reduce((sum, g) => sum + (g.group_weight ?? 0), 0)
            if (Math.abs(total - 100) > 0.5) {
              items.push({
                type: 'course',
                id: courseId,
                name: course.name,
                detail: `weighting enabled; group weights sum to ${total.toFixed(2)}, not 100`,
              })
            }
          }
          results.push({ check: 'assignment_group_weights', severity: 'warn', items })
        }

        // ── check: ungraded_setup ─────────────────────────────────────
        if (activeChecks.has('ungraded_setup')) {
          const items: SetupFinding[] = []
          for (const a of assignments) {
            if (a.published !== true) continue
            if (a.grading_type !== 'not_graded' && a.points_possible === 0) {
              items.push({
                type: 'assignment',
                id: a.id,
                name: a.name,
                detail: `grading_type is "${a.grading_type}" but points_possible is 0 — will not affect gradebook totals`,
              })
            }
          }
          results.push({ check: 'ungraded_setup', severity: 'warn', items })
        }

        const totalFindings = results.reduce((n, r) => n + r.items.length, 0)

        return {
          summary: {
            course_id: courseId,
            checks_run: results.map((r) => r.check),
            total_findings: totalFindings,
          },
          findings: results,
        }
      },
    },
  ]
}
