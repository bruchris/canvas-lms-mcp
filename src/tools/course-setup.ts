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
  'submissions_open_past_due',
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

// submission_types values that mean there is no Canvas drop box to lock — an
// in-class / paper / no-submission assignment would otherwise flag forever once
// its due date passed (design-unknown §1).
const NON_SUBMITTABLE_TYPES = new Set(['none', 'not_graded', 'on_paper'])

// Defensive `?? []`: submission_types is a required field on CanvasAssignment and
// Canvas always populates it, but guarding against an absent value keeps the check
// from throwing on a partial response (and on test fixtures that omit it). An empty
// or absent submission_types is conservatively treated as "no drop box".
function hasDigitalDropBox(a: CanvasAssignment): boolean {
  return (a.submission_types ?? []).some((t) => !NON_SUBMITTABLE_TYPES.has(t))
}

interface DateSet {
  due_at: string | null
  unlock_at: string | null
  lock_at: string | null
  base: boolean
  title?: string
}

// One date set per relevant audience (base + each override). When all_dates is
// empty, synthesize a single base set from the top-level dates. When the base is
// not visible to anyone (only_visible_to_overrides), drop it so a phantom
// "everyone" audience no student is bound by cannot produce a finding.
function buildDateSets(a: CanvasAssignment): DateSet[] {
  const raw = a.all_dates ?? []
  const sets: DateSet[] =
    raw.length > 0
      ? raw.map((d) => ({
          due_at: d.due_at,
          unlock_at: d.unlock_at,
          lock_at: d.lock_at,
          base: d.base === true,
          title: d.title,
        }))
      : [
          {
            due_at: a.due_at,
            unlock_at: a.unlock_at ?? null,
            lock_at: a.lock_at ?? null,
            base: true,
          },
        ]
  return a.only_visible_to_overrides === true ? sets.filter((d) => !d.base) : sets
}

// "Right now" predicate: the due date has passed, the assignment is already
// unlocked (unlock_at null or in the past), and it has not yet locked (lock_at
// null or in the future) — i.e. Canvas is accepting submissions this instant.
function isOpenPastDue(d: DateSet, nowMs: number): boolean {
  if (d.due_at === null) return false
  if (new Date(d.due_at).getTime() >= nowMs) return false
  if (d.unlock_at !== null && new Date(d.unlock_at).getTime() > nowMs) return false
  if (d.lock_at !== null && new Date(d.lock_at).getTime() <= nowMs) return false
  return true
}

// Earliest-due open date set drives the finding. Strict `<` keeps the first
// entry (typically the base) on an exact due_at tie — a stated, intentional
// tie-break (design-unknown §2).
function pickEarliestOpen(openSets: DateSet[]): DateSet {
  return openSets.reduce((earliest, d) =>
    new Date(d.due_at as string).getTime() < new Date(earliest.due_at as string).getTime()
      ? d
      : earliest,
  )
}

export function courseSetupTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'check_course_setup',
      description:
        'Run a factual course-readiness report that surfaces common configuration problems — ' +
        'assignments missing due dates, unpublished items students will not see, ' +
        'gradebook weighting gaps, graded assignments with no points, and published assignments ' +
        'still accepting submissions after their due date. ' +
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
              'submissions_open_past_due',
            ]),
          )
          .optional()
          .describe(
            'Subset of checks to run. Omit to run all five checks. ' +
              'Valid values: missing_due_dates, unpublished_items, ' +
              'assignment_group_weights, ungraded_setup, submissions_open_past_due.',
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

        // ── check: submissions_open_past_due ──────────────────────────
        // Evaluated against "right now," not "was this ever open past due" — see spec
        // design-unknown §1. A lock_at already in the past means the instructor closed
        // it (even via a grace period); only a null or still-future lock_at is flagged.
        // Assignments with no digital drop box (on_paper / none / not_graded) are
        // skipped — there is nothing to "still be open."
        if (activeChecks.has('submissions_open_past_due')) {
          const items: SetupFinding[] = []
          const nowMs = Date.now()
          for (const a of assignments) {
            if (a.published !== true) continue
            if (!hasDigitalDropBox(a)) continue
            const dateSets = buildDateSets(a)
            const openSets = dateSets.filter((d) => isOpenPastDue(d, nowMs))
            if (openSets.length === 0) continue
            const chosen = pickEarliestOpen(openSets)
            const lockDisplay = chosen.lock_at ?? 'not set'
            const scopeText = chosen.base
              ? ''
              : ` for override "${chosen.title ?? 'untitled override'}"`
            const moreText =
              openSets.length > 1 ? ` (+${openSets.length - 1} more date set(s) also open)` : ''
            items.push({
              type: 'assignment',
              id: a.id,
              name: a.name,
              detail: `due ${chosen.due_at}${scopeText} has passed; lock_at is ${lockDisplay} — submissions still open${moreText}`,
            })
          }
          results.push({ check: 'submissions_open_past_due', severity: 'warn', items })
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
