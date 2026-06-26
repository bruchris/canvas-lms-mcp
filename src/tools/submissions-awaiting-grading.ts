import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { CanvasAssignment, CanvasSubmission } from '../canvas/types'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'

// ── Caveats ──────────────────────────────────────────────────────────────────

/** Always appended: New Quizzes manage their own grading queue outside the REST API. */
const NEW_QUIZZES_CAVEAT =
  'New Quizzes (Quizzes.Next) manage their own grading queue and their submission records ' +
  "may not appear with 'pending_review' workflow state here. Use SpeedGrader or the New " +
  'Quizzes interface to check for pending New Quiz grading.'

/** Appended unless only_pending_review is set: fill-in-the-blank auto-grade gaps are invisible. */
const FILL_IN_BLANK_CAVEAT =
  'Fill-in-the-blank submissions that Canvas auto-marked as graded are not included, even if ' +
  'the answer-key variant was incomplete.'

/** Defensive: Canvas returned a submission whose assignment was not in the fetch set. */
const UNMATCHED_CAVEAT = 'Some submissions could not be matched to an assignment and were excluded.'

// ── Output shape ─────────────────────────────────────────────────────────────

interface AwaitingSubmissionRow {
  submission_id: number
  /** Always the raw Canvas numeric ID; never pseudonymized. */
  user_id: number
  /** Pseudonymized when the flag is on; null when the user object was not sideloaded. */
  user_name: string | null
  workflow_state: 'submitted' | 'pending_review'
  submitted_at: string | null
  /** True when the submission is in pending_review (quiz questions await manual scoring). */
  has_pending_manual_questions: boolean
}

interface AwaitingItem {
  assignment_id: number
  assignment_name: string
  type: 'classic_quiz' | 'assignment'
  due_at: string | null
  submissions_awaiting_count: number
  submissions: AwaitingSubmissionRow[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Classic Quizzes carry both is_quiz_assignment and a non-null quiz_id. */
function isClassicQuiz(a: CanvasAssignment): boolean {
  return a.is_quiz_assignment === true && a.quiz_id != null
}

/** Oldest submitted_at across a group's submissions, or Infinity when all are null. */
function oldestSubmittedAt(submissions: ReadonlyArray<AwaitingSubmissionRow>): number {
  return submissions
    .filter((s) => s.submitted_at)
    .map((s) => Date.parse(s.submitted_at as string))
    .reduce((min, t) => (t < min ? t : min), Infinity)
}

// ── Tool definition ──────────────────────────────────────────────────────────

export function submissionsAwaitingGradingTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
  return [
    {
      name: 'list_submissions_awaiting_grading',
      description:
        'Lists all submissions in a course that still need a human grade, sorted oldest-waiting ' +
        'first.\n\n' +
        'Surfaces two categories:\n' +
        '- workflow_state=submitted: assignments submitted by students but not yet graded at all.\n' +
        '- workflow_state=pending_review: Classic Quiz submissions where Canvas auto-graded the ' +
        'objective questions but left essays or manually-scored questions for the instructor.\n\n' +
        'Returns a triage list grouped by assignment or Classic Quiz, with per-submission details: ' +
        'student identity, workflow state, submitted_at, and whether the submission has pending ' +
        'manual-grading questions.\n\n' +
        'Parameters:\n' +
        '- course_id (required): Canvas course ID to scan.\n' +
        '- assignment_ids (optional): limit the scan to specific assignment IDs.\n' +
        '- include_quizzes (default true): include Classic Quiz assignments in the scan.\n' +
        '- include_assignments (default true): include non-quiz assignments.\n' +
        '- only_pending_review (default false): when true, return only pending_review submissions ' +
        '(quiz essays awaiting manual scoring), omitting regular ungraded assignments.\n\n' +
        'Known limitations:\n' +
        "- New Quizzes (Quizzes.Next) may not appear with 'pending_review' workflow state here; " +
        'use SpeedGrader or the New Quizzes interface for their grading queue.\n' +
        '- Fill-in-the-blank answers that Canvas auto-marked are not surfaced.\n' +
        '- V1 returns submission-level state only; per-question detail is not included.\n' +
        '- When CANVAS_PSEUDONYMIZE_STUDENTS is enabled, student names are replaced with ' +
        'pseudonyms. Use resolve_pseudonym to look up the real identity.',
      inputSchema: {
        course_id: z
          .number()
          .int()
          .positive()
          .describe('Canvas course ID to scan for submissions awaiting grading.'),
        assignment_ids: z
          .array(z.number().int().positive())
          .optional()
          .describe(
            'Limit the scan to these specific assignment IDs (numeric Canvas IDs). ' +
              'When omitted, all assignments in the course are scanned.',
          ),
        include_quizzes: z
          .boolean()
          .default(true)
          .describe(
            'Include Classic Quiz assignments in the scan. Default: true. New Quizzes are always ' +
              'covered by the global New Quizzes caveat — see response.caveats.',
          ),
        include_assignments: z
          .boolean()
          .default(true)
          .describe('Include non-quiz assignments in the scan. Default: true.'),
        only_pending_review: z
          .boolean()
          .default(false)
          .describe(
            'When true, return only submissions with workflow_state=pending_review — quiz essays ' +
              'and manually-scored questions that Canvas auto-graded but left for human review. ' +
              'When false (default), return both submitted (ungraded) and pending_review submissions.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const assignmentIds = params.assignment_ids as number[] | undefined
        // Zod defaults are not applied when the handler is invoked directly (tests),
        // so the toggles are interpreted with explicit comparisons: undefined means
        // "use the default" (include = true, only_pending_review = false).
        const includeQuizzes = params.include_quizzes as boolean | undefined
        const includeAssignments = params.include_assignments as boolean | undefined
        const onlyPendingReview = params.only_pending_review as boolean | undefined

        // Guard: at least one assignment category must be in scope.
        if (includeQuizzes === false && includeAssignments === false) {
          throw new Error('At least one of include_quizzes or include_assignments must be true.')
        }

        // Step 1: fetch the assignment list, optionally scoped by assignment_ids.
        const allAssignments = await canvas.assignments.list(
          courseId,
          assignmentIds && assignmentIds.length > 0 ? { assignment_ids: assignmentIds } : {},
        )

        // Step 2-3: classify and apply the include toggles.
        const eligibleAssignments = allAssignments.filter((a) =>
          isClassicQuiz(a) ? includeQuizzes !== false : includeAssignments !== false,
        )

        // Step 4: pre-filter by needs_grading_count. When the field is absent
        // (undefined), `?? 0` excludes the assignment — conservative and correct.
        const toFetch = eligibleAssignments.filter((a) => (a.needs_grading_count ?? 0) > 0)

        // Step 5: build caveats.
        const caveats: string[] = [NEW_QUIZZES_CAVEAT]
        if (onlyPendingReview !== true) {
          caveats.push(FILL_IN_BLANK_CAVEAT)
        }

        // Step 5b: surface assignments dropped because Canvas did not report
        // needs_grading_count at all (undefined, not 0). Without this caveat an
        // empty/partial result is indistinguishable from "nothing to grade" when
        // the token lacks grading permission on those assignments — silent data
        // loss. Computed before the early-return so the all-empty case is covered.
        const missingCountCount = eligibleAssignments.filter(
          (a) => a.needs_grading_count === undefined,
        ).length
        if (missingCountCount > 0) {
          caveats.push(
            `Canvas did not report needs_grading_count for ${missingCountCount} assignment(s); they ` +
              'were skipped and any ungraded work on them is NOT shown here. This usually means the ' +
              'token lacks grading permission on those assignments, or the Canvas instance requires ' +
              'needs_grading_count_by_section. Verify in SpeedGrader.',
          )
        }

        // Step 6: early-return when nothing needs fetching.
        if (toFetch.length === 0) {
          return { course_id: courseId, total_submissions_awaiting: 0, items: [], caveats }
        }

        // Step 7: bulk-fetch submissions for the filtered assignments. workflow_state
        // is omitted intentionally: the API accepts a single value, but we need both
        // 'submitted' and 'pending_review', so filtering happens client-side below.
        const rawSubmissions = await canvas.submissions.listForStudents(courseId, {
          student_ids: ['all'],
          assignment_ids: toFetch.map((a) => a.id),
          include: ['user'],
        })

        // Step 8: filter to the target workflow states.
        const targetStates = new Set<string>(
          onlyPendingReview === true ? ['pending_review'] : ['submitted', 'pending_review'],
        )
        const awaitingSubmissions = rawSubmissions.filter((s) => targetStates.has(s.workflow_state))

        // Step 9: pseudonymize when enabled and a user object is present.
        const processedSubmissions: CanvasSubmission[] = await Promise.all(
          awaitingSubmissions.map((s) =>
            pseudonymizer?.isEnabled() && s.user
              ? pseudonymizer.anonymizeSubmission(courseId, s)
              : Promise.resolve(s),
          ),
        )

        // Step 10: group by assignment_id.
        const byAssignment = new Map<number, CanvasSubmission[]>()
        for (const sub of processedSubmissions) {
          const group = byAssignment.get(sub.assignment_id) ?? []
          group.push(sub)
          byAssignment.set(sub.assignment_id, group)
        }

        // Step 11: assignment lookup.
        const assignmentById = new Map(toFetch.map((a) => [a.id, a]))

        // Step 12: assemble items; submissions within each item sorted oldest-first.
        // Stray submissions (assignment not in toFetch) are skipped defensively.
        const unmatchedIds: number[] = []
        const items: AwaitingItem[] = [...byAssignment.entries()].flatMap(
          ([assignmentId, subs]) => {
            const assignment = assignmentById.get(assignmentId)
            if (!assignment) {
              unmatchedIds.push(assignmentId)
              return []
            }
            const sortedSubs = [...subs].sort((a, b) => {
              if (!a.submitted_at) return 1 // null sorts last
              if (!b.submitted_at) return -1
              return a.submitted_at < b.submitted_at ? -1 : 1
            })
            return [
              {
                assignment_id: assignmentId,
                assignment_name: assignment.name,
                type: isClassicQuiz(assignment)
                  ? ('classic_quiz' as const)
                  : ('assignment' as const),
                due_at: assignment.due_at,
                submissions_awaiting_count: sortedSubs.length,
                submissions: sortedSubs.map((s) => ({
                  submission_id: s.id,
                  user_id: s.user_id,
                  user_name: s.user?.name ?? null,
                  workflow_state: s.workflow_state as 'submitted' | 'pending_review',
                  submitted_at: s.submitted_at,
                  has_pending_manual_questions: s.workflow_state === 'pending_review',
                })),
              },
            ]
          },
        )

        // Step 13: sort items by oldest submitted_at (ascending; all-null sorts last).
        items.sort((a, b) => {
          const aOldest = oldestSubmittedAt(a.submissions)
          const bOldest = oldestSubmittedAt(b.submissions)
          // Infinity - Infinity is NaN (violates the sort contract); treat as a tie.
          if (aOldest === Infinity && bOldest === Infinity) return 0
          return aOldest - bOldest
        })

        // Step 14: surface the defensive skip if it happened.
        if (unmatchedIds.length > 0) {
          caveats.push(UNMATCHED_CAVEAT)
        }

        return {
          course_id: courseId,
          total_submissions_awaiting: items.reduce(
            (sum, i) => sum + i.submissions_awaiting_count,
            0,
          ),
          items,
          caveats,
        }
      },
    },
  ]
}
