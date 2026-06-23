import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import { CanvasApiError } from '../canvas/client'
import type { CanvasLatePolicy } from '../canvas/types'
import type { ToolDefinition } from './types'

/**
 * Synthetic policy used when Canvas returns 404 for `late_policy` — i.e. the
 * course has never had a late policy saved, so no automation is in effect.
 */
const DEFAULT_LATE_POLICY: CanvasLatePolicy = {
  late_submission_deduction_enabled: false,
  late_submission_deduction: 0,
  late_submission_interval: 'day',
  late_submission_minimum_percent_enabled: false,
  late_submission_minimum_percent: 0,
  missing_submission_deduction_enabled: false,
  missing_submission_deduction: 0,
}

type PolicySource = 'api' | 'default'

interface MissingPolicyOut {
  source: PolicySource
  enabled: boolean
  deduction_percent: number
}

interface LatePolicyOut {
  source: PolicySource
  enabled: boolean
  deduction_percent: number
  interval: 'hour' | 'day'
  minimum_percent_enabled: boolean
  minimum_percent: number
}

interface GroupWeightOut {
  id: number
  name: string
  weight: number
}

/** Assemble the plain-language summary paragraph from the structured policy. */
function buildSummary(
  missing: MissingPolicyOut | null,
  late: LatePolicyOut | null,
  weighted: boolean,
  groups: ReadonlyArray<GroupWeightOut>,
  schemeApplied: boolean,
  schemeTitle: string | null,
  policyUnavailable: boolean,
): string {
  const blocks: string[] = []

  if (missing !== null) {
    if (missing.enabled) {
      if (missing.deduction_percent === 100) {
        blocks.push('Missing work is automatically scored 0% (auto-zero).')
      } else if (missing.deduction_percent === 0) {
        blocks.push('Missing work policy is enabled with no deduction (0%).')
      } else {
        blocks.push(
          `Missing work loses ${missing.deduction_percent}% of possible points automatically.`,
        )
      }
    } else {
      blocks.push('No automatic missing-work penalty.')
    }
  }

  if (late !== null) {
    if (late.enabled) {
      let sentence = `Late submissions lose ${late.deduction_percent}% per ${late.interval}.`
      if (late.minimum_percent_enabled) {
        sentence += ` Grade cannot fall below ${late.minimum_percent}%.`
      }
      blocks.push(sentence)
    } else {
      blocks.push('No automatic late penalty.')
    }
  }

  if (weighted && groups.length > 0) {
    const list = groups.map((g) => `${g.name} (${g.weight}%)`).join(', ')
    blocks.push(`Assignment groups are weighted: ${list}.`)
  } else if (weighted) {
    // Flagged for weighting but no groups configured yet — avoid emitting a
    // malformed "weighted: ." with an empty list.
    blocks.push(
      'Assignment groups are set to be weighted, but no assignment groups are configured.',
    )
  } else {
    blocks.push('Assignment groups are not weighted — all assignments contribute equally.')
  }

  if (schemeApplied && schemeTitle !== null) {
    blocks.push(`A letter-grade scheme is applied ("${schemeTitle}").`)
  } else if (schemeApplied && schemeTitle === null) {
    blocks.push('A letter-grade scheme is applied (title unavailable).')
  } else {
    blocks.push('No letter-grade scheme is applied.')
  }

  let summary = blocks.join(' ')
  if (policyUnavailable) {
    summary += ' Late/missing penalty details require instructor permissions and are not available.'
  }
  return summary
}

export function gradingPolicyTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'explain_grading_policy',
      description:
        'Explains the grading automation rules configured for a Canvas course:\n' +
        '- Missing-submission policy: whether blank/unsubmitted work is automatically scored 0 (or ' +
        'another deduction), or left unpenalised.\n' +
        '- Late-submission policy: whether Canvas applies a per-day or per-hour percentage deduction ' +
        'to late submissions, and whether there is a floor below which the grade cannot fall.\n' +
        '- Assignment-group weighting: whether the course uses weighted groups, and the weight of ' +
        'each group.\n' +
        '- Grading scheme: whether a letter-grade scheme (A/B/C/F mapping) is applied to the final ' +
        'score.\n\n' +
        'Also returns a plain-language summary paragraph you can share with students or instructors.\n\n' +
        'Note: the late/missing policy section requires instructor or admin permissions. Students ' +
        'receive the group-weighting and grading-scheme sections only, with a caveat noting what is ' +
        'unavailable. Use explain_grade to compute the actual weighted grade for a specific student.',
      inputSchema: {
        course_id: z
          .number()
          .int()
          .positive()
          .describe('Canvas course ID to explain the grading policy for.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number

        // Calls 1–3 are independent. allSettled (not all) lets a 403/404 on the
        // late-policy call leave the course + groups results intact.
        const [latePolicyResult, courseResult, groupsResult] = await Promise.allSettled([
          canvas.latePolicy.get(courseId),
          canvas.courses.get(courseId),
          canvas.assignments.listGroups(courseId),
        ])

        // Course + assignment groups are required — the tool cannot produce
        // meaningful output without them. Re-throw so buildHandler() (in
        // src/tools/index.ts) maps the CanvasApiError via formatError().
        if (courseResult.status === 'rejected') throw courseResult.reason
        if (groupsResult.status === 'rejected') throw groupsResult.reason
        const course = courseResult.value
        const groups = groupsResult.value

        const caveats: string[] = []

        // Call 1: late policy — only 403 (no permission) and 404 (no policy row
        // yet) are handled gracefully; any other error propagates.
        let latePolicySource: PolicySource = 'default'
        let rawLatePolicy: CanvasLatePolicy = DEFAULT_LATE_POLICY
        let policyUnavailable = false

        if (latePolicyResult.status === 'fulfilled') {
          rawLatePolicy = latePolicyResult.value
          latePolicySource = 'api'
        } else {
          const err = latePolicyResult.reason
          if (err instanceof CanvasApiError && err.status === 403) {
            policyUnavailable = true
          } else if (err instanceof CanvasApiError && err.status === 404) {
            latePolicySource = 'default'
          } else {
            throw err
          }
        }

        if (policyUnavailable) {
          caveats.push(
            'Late/missing submission policy requires instructor or admin permissions — policy ' +
              'details are not accessible with this token.',
          )
        }

        // Call 4 (conditional): resolve the grading-standard title. The course
        // endpoint returns only course-owned standards, so fall back to the
        // account standard when the id is not found at the course level.
        //
        // The title is non-essential — a missing/unreadable standard degrades to
        // a null title + caveat rather than failing the whole tool. So a
        // CanvasApiError here (e.g. an instructor who can read the course but not
        // the account-level standards list → 403) is caught and degraded, which
        // keeps the allSettled partial-data contract intact. Non-Canvas errors
        // still propagate.
        let standardTitle: string | null = null
        if (course.grading_standard_id != null) {
          try {
            const courseStandards = await canvas.gradingStandards.listForCourse(courseId)
            const found = courseStandards.find((s) => s.id === course.grading_standard_id)
            if (found) {
              standardTitle = found.title
            } else if (course.account_id != null) {
              const accountStandards = await canvas.gradingStandards.listForAccount(
                course.account_id,
              )
              const foundInAccount = accountStandards.find(
                (s) => s.id === course.grading_standard_id,
              )
              if (foundInAccount) {
                standardTitle = foundInAccount.title
              }
            }
          } catch (err) {
            if (!(err instanceof CanvasApiError)) throw err
            // Only "not retrievable for a non-error reason" degrades to a caveat:
            // 403 (no permission to read the account standards list) and 404
            // (the referenced standard is gone). Transient/actionable failures
            // (5xx, 429, 401) propagate to formatError() with their specific
            // message — mirroring the late-policy handling above, so a retryable
            // error is never masked as a permanent "could not be retrieved".
            if (err.status !== 403 && err.status !== 404) throw err
          }
          if (standardTitle === null) {
            caveats.push(
              `Grading standard (id: ${course.grading_standard_id}) could not be retrieved.`,
            )
          }
        }

        const missingPolicy: MissingPolicyOut | null = policyUnavailable
          ? null
          : {
              source: latePolicySource,
              enabled: rawLatePolicy.missing_submission_deduction_enabled,
              deduction_percent: rawLatePolicy.missing_submission_deduction,
            }

        const latePolicy: LatePolicyOut | null = policyUnavailable
          ? null
          : {
              source: latePolicySource,
              enabled: rawLatePolicy.late_submission_deduction_enabled,
              deduction_percent: rawLatePolicy.late_submission_deduction,
              interval: rawLatePolicy.late_submission_interval,
              minimum_percent_enabled: rawLatePolicy.late_submission_minimum_percent_enabled,
              minimum_percent: rawLatePolicy.late_submission_minimum_percent,
            }

        const weighted = course.apply_assignment_group_weights ?? false
        const groupWeighting: GroupWeightOut[] = groups.map((g) => ({
          id: g.id,
          name: g.name,
          weight: g.group_weight,
        }))

        const schemeApplied = course.grading_standard_id != null
        const summary = buildSummary(
          missingPolicy,
          latePolicy,
          weighted,
          groupWeighting,
          schemeApplied,
          standardTitle,
          policyUnavailable,
        )

        return {
          course: { id: course.id, name: course.name },
          missing_submission_policy: missingPolicy,
          late_submission_policy: latePolicy,
          group_weighting: { weighted, groups: groupWeighting },
          grading_scheme: {
            applied: schemeApplied,
            standard_id: course.grading_standard_id ?? null,
            standard_title: standardTitle,
          },
          summary,
          caveats,
        }
      },
    },
  ]
}
