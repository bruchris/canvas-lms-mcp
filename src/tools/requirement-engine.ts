/**
 * The student course requirement graph's **pure** state engine.
 *
 * Stage 2 of four, per §12 PR 2 of
 * `docs/superpowers/specs/2026-10-15-bru-2952-student-course-requirement-graph.md`.
 * Every function here is total, synchronous and side-effect free: no network, no
 * client, no tool registration. Stage 3 wires it to `get_my_course_requirements`.
 *
 * Every rule is derived from `instructure/canvas-lms` at the design's pinned SHA
 * `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`, and the four files Stage 2 relies on
 * (`app/models/context_module.rb`, `app/models/context_module_progression.rb`,
 * `app/models/discussion_topic.rb`, `lib/api/v1/locked.rb`) were re-fetched at
 * `master` on 2026-10-22 and are byte-identical to that tree.
 *
 * ## Why this module is tool-free and client-free
 *
 * §3.2 of the design makes it a code-level invariant that a `context` value
 * (planner items, page bodies, `plannable_date`, assignment descriptions) can never
 * promote a row. The enforcement is structural rather than conventional: the
 * evidence types below have no member a context value could arrive in, so a planner
 * field is not merely unread at the call site where state is decided — it is
 * unrepresentable. For the same reason `SubmissionEvidence` is a narrow projection
 * rather than a `CanvasSubmission`: it declares no `user`, `user_id`, `assignment`,
 * `course` or `group` member, so no third-party user record can reach a row (§6.5).
 * Both properties are policed by a source-level guard in
 * `tests/tools/requirement-engine.test.ts`, because this repo's `tsconfig.json`
 * excludes `tests/` and a type-level assertion written in a test is never checked.
 *
 * ## Row precedence, in order
 *
 * The order is the reviewable artifact, so it is stated once here rather than being
 * inferred from the control flow:
 *
 * | # | Condition | Verdict | Source |
 * | - | --- | --- | --- |
 * | 1 | no `completion_requirement` | `not_required` | §3.1 |
 * | 2 | `type` outside the six | `unknown` | §1.1 |
 * | 3 | matching submission `excused === true` | `satisfied` | §4.1 |
 * | 4 | `completed === true` | `satisfied` | §3.1 |
 * | 5 | locked (`locked_for_user` / module `state` / prerequisite) | `blocked` | §3.1, §5.5 |
 * | 6 | `completed` **absent** | `unknown` | §1.3 |
 * | 7 | `completed === false` | per type, §4.2–§4.4 | §3.3 |
 *
 * Two orderings are decisions rather than transcriptions of the source, and both are
 * flagged in the PR for review:
 *
 * - **3 before 5, and 4 before 5.** A requirement Canvas already records as met (or
 *   as excused) needs no action, so reporting `blocked` would tell a student they
 *   still owe work behind a lock they have already cleared. `blocked` exists for
 *   "you cannot act on this yet", which is moot once it is satisfied.
 * - **1 before 5.** `blocked` presupposes a requirement to block; an item carrying
 *   none has nothing to act on either way.
 *
 * `not_required` is a *fact*; `unknown` is an *absence of fact*. Nothing in this
 * module may collapse one into the other.
 */
import type {
  CanvasCompletionRequirement,
  CanvasCompletionRequirementType,
  CanvasModuleItemContentDetails,
} from '../canvas/types'

// ── Canvas-derived constant sets ───────────────────────────────────────────

/**
 * The six completion-requirement types `ContextModule#validate_completion_requirements`
 * accepts — `%w[must_view must_mark_done must_contribute]` plus
 * `scoreable_types = %w[must_submit min_score min_percentage]`. The Canvas
 * documentation page foregrounds five and omits `min_percentage`, which is
 * serialized under its own key.
 */
export const COMPLETION_REQUIREMENT_TYPES = [
  'must_view',
  'must_contribute',
  'must_submit',
  'must_mark_done',
  'min_score',
  'min_percentage',
] as const satisfies readonly CanvasCompletionRequirementType[]

/**
 * Compile-time proof that the runtime array above covers the whole union, checked
 * in `src/` where CI's `pnpm typecheck` actually looks. Dropping a member makes
 * `Exclude<…>` non-`never` and the build fails.
 */
type AssertNever<T extends never> = T
export type RequirementTypesAreExhaustive = AssertNever<
  Exclude<CanvasCompletionRequirementType, (typeof COMPLETION_REQUIREMENT_TYPES)[number]>
>

/**
 * Recomputed on every evaluation rather than latched: the
 * `CompletedRequirementCalculator` constructor drops stored numeric actions with
 * `actions_done.reject! { |r| r[:type] == "min_score" || r[:type] == "min_percentage" }`.
 * So a numeric requirement can revert from met to unmet with no student action — a
 * grade change, a posting-policy change, a regrade. The other four cannot.
 */
export const NUMERIC_REQUIREMENT_TYPES = ['min_score', 'min_percentage'] as const

/**
 * Latched: `calc.check_action!(req, false)` on every pass, set only by a
 * side-effecting in-app event (`ContextModule#update_for`). No other endpoint can
 * corroborate them, and §9 forbids deriving `must_contribute` from discussion
 * entries — the two are set by different code paths and can legitimately disagree.
 */
export const LATCHED_REQUIREMENT_TYPES = ['must_contribute', 'must_mark_done'] as const

/** The four states `must_submit` counts as submitted, from the `elsif` in `evaluate_uncompleted_requirements`. */
export const SUBMITTED_WORKFLOW_STATES = [
  'submitted',
  'graded',
  'complete',
  'pending_review',
] as const

/**
 * Item types whose activity happens outside Canvas. The serializer emits
 * `external_url` and a sessionless launch URL and nothing about what the student
 * did inside the tool. A New Quizzes assignment is **not** here: it arrives as an
 * ordinary `Assignment` item and goes through the same submission evidence.
 */
export const OPAQUE_ITEM_TYPES = ['ExternalTool', 'ExternalUrl'] as const

export function isCompletionRequirementType(
  value: unknown,
): value is CanvasCompletionRequirementType {
  return (COMPLETION_REQUIREMENT_TYPES as readonly unknown[]).includes(value)
}

// ── States and provenance ──────────────────────────────────────────────────

export type RequirementState = 'satisfied' | 'unsatisfied' | 'unknown' | 'blocked' | 'not_required'

/** A module rollup is never `not_required`: a module with no requirements is vacuously satisfied. */
export type ModuleDerivedState = 'satisfied' | 'unsatisfied' | 'unknown' | 'blocked'

export type ProvenanceSource =
  | 'module_item.completion_requirement'
  | 'discussion_topic.user_can_see_posts'
  | 'submission.workflow_state'
  | 'checkpoint_submission'
  | 'module_item.content_details.locked_for_user'
  | 'module.state'
  | 'module.prerequisite'

export interface Provenance {
  source: ProvenanceSource
  /** The exact Canvas path the fact came from. Supplied by the caller; never synthesized here. */
  endpoint: string
  /** The exact field read. */
  field: string
  /**
   * Set on every rule in §4 that produces a surprising verdict. Excusal (§4.1) and
   * the unposted-score case (§4.2) are *correct* `satisfied` / `unknown` verdicts
   * that a student will misread without the sentence, so this is not decoration.
   *
   * Authored by this module and therefore trusted. Canvas-authored text — notably
   * `lock_explanation`, which interpolates course content — is deliberately **not**
   * copied in here; Stage 3 surfaces it separately through the provenance-fencing
   * path so untrusted text never rides inside a field we author.
   */
  caveat: string | null
}

export interface RequirementRow {
  state: RequirementState
  /**
   * The requirement, projected to its type and the one threshold key that applies.
   * `min_score` and `min_percentage` are separate keys, not one threshold field.
   * `completed` is deliberately dropped — the row's `state` is the answer, and
   * re-exposing the raw tri-state invites a consumer to misread the absent case.
   */
  requirement: {
    type: CanvasCompletionRequirementType | string
    min_score?: number
    min_percentage?: number
  } | null
  provenance: Provenance
}

// ── Evidence ───────────────────────────────────────────────────────────────

/**
 * The fields §4 reads from the caller's **own** submission, and nothing else.
 *
 * Deliberately not `CanvasSubmission`: that type carries `user`, `assignment`,
 * `course` and `group`, and projecting here means the PII question never arises
 * (§6.5). Do not widen this interface without re-reading §6.5.
 */
export interface SubmissionEvidence {
  workflow_state: string
  attempt: number | null
  score: number | null
  posted_at?: string | null
  excused?: boolean | null
  /**
   * `points_possible`, needed only by `min_percentage`
   * (`validate_min_percentage_requirement` divides by `sub.assignment.points_possible`).
   * Stage 3 fills it from `content_details.points_possible`, which §5.5's truthiness
   * guard omits when it is `0` — so absent and `0` are indistinguishable here, and
   * both make the percentage unevaluable. That is handled, not assumed.
   */
  points_possible?: number | null
}

export interface ModuleLockEvidence {
  /** The module's `state`, verbatim. `'locked'` blocks. */
  state?: string | null
  /** True when a prerequisite module is not satisfied. Resolved by the caller. */
  prerequisiteUnsatisfied?: boolean
  /**
   * Present for the caveat only. `require_sequential_progress` alone can **never**
   * establish a block, because the progression's `current_position` is not
   * serialized by any endpoint — the only observable per-item signal is
   * `content_details.locked_for_user`. So this field explains a block; it does not
   * create one.
   */
  requireSequentialProgress?: boolean
}

export interface ItemEvidence {
  /** `module_item.type` verbatim, e.g. `'Assignment'`, `'Discussion'`, `'ExternalTool'`. */
  itemType: string
  endpoint: string
  /** Absent or `null` ⇒ the item carries no requirement ⇒ `not_required`. */
  requirement?: CanvasCompletionRequirement | null
  contentDetails?: CanvasModuleItemContentDetails | null
  /**
   * The caller's own submission for this item's assignment:
   *
   * - a `SubmissionEvidence` — looked up and found;
   * - `null` — looked up, the student has none;
   * - **absent** — *not looked up*. The §4.2 disambiguation is then unavailable, so
   *   an unsatisfied numeric row is `unknown`, not `unsatisfied`. This is the same
   *   absence-is-not-false discipline as §1.3, one layer out.
   */
  submission?: SubmissionEvidence | null
  module?: ModuleLockEvidence
}

export interface InitialPostEvidence {
  endpoint: string
  /**
   * The §5.3 gate. `user_can_see_posts?` short-circuits on
   * `grants_right?(user, session, :read_as_admin)`, and
   * `user_ids_who_have_posted_and_admins` counts admins as having posted — so for a
   * teacher, TA, admin or account token the derivation *always* reads satisfied and
   * is worthless. Without this gate the tool reports "you have posted everywhere"
   * to every educator caller.
   */
  callerIsStudent: boolean
  requireInitialPost?: boolean
  userCanSeePosts?: boolean
}

export interface CheckpointEvidence {
  endpoint: string
  /** `reply_to_entry_required_count`: the requirement, never the progress. */
  replyToEntryRequiredCount?: number
  /** `CheckpointLabels::REPLY_TO_TOPIC`'s sub-assignment submission. Absent ⇒ not reachable. */
  replyToTopicSubmission?: SubmissionEvidence | null
  /** `CheckpointLabels::REPLY_TO_ENTRY`'s sub-assignment submission. Absent ⇒ not reachable. */
  replyToEntrySubmission?: SubmissionEvidence | null
}

export interface ModuleRollupInput {
  /**
   * `ContextModule#requirement_type` is `(completion_requirements.present? &&
   * requirement_count == 1) ? "one" : "all"` and is serialized unconditionally,
   * whereas `requirement_count` is serialized only behind
   * `requirement_count_api_enabled?`. Branch on this, never on the integer's
   * presence. Defaults to `'all'`, matching the Ruby.
   */
  requirementType?: 'all' | 'one'
  rows: readonly RequirementRow[]
  /** The module's progression `state`, verbatim, for the §4.5 disagreement report. */
  canvasState?: string | null
  prerequisiteUnsatisfied?: boolean
}

export interface ModuleRollup {
  derivedState: ModuleDerivedState
  canvasState: string | null
  /**
   * §4.5: report `canvas_state` alongside the derived rollup and flag a
   * disagreement rather than preferring one. A disagreement means either our rules
   * are wrong or the progression is stale (`outdated?` / `mark_as_outdated` exist on
   * the model), and both are things a caller should hear about rather than have
   * resolved for them.
   */
  stateDisagreement: boolean
}

export interface RequirementSummary {
  satisfied: number
  unsatisfied: number
  unknown: number
  blocked: number
  not_required: number
}

// ── Internals ──────────────────────────────────────────────────────────────

function join(...parts: (string | null | undefined)[]): string | null {
  const kept = parts.filter((p): p is string => typeof p === 'string' && p.length > 0)
  return kept.length > 0 ? kept.join(' ') : null
}

function isOpaque(itemType: string): boolean {
  return (OPAQUE_ITEM_TYPES as readonly string[]).includes(itemType)
}

const OPACITY_CAVEAT =
  'This item’s activity happens outside Canvas, which reports nothing about what the student did inside the tool.'

function projectRequirement(
  requirement: CanvasCompletionRequirement,
): RequirementRow['requirement'] {
  const projected: RequirementRow['requirement'] = { type: requirement.type }
  if (requirement.type === 'min_score' && typeof requirement.min_score === 'number') {
    projected.min_score = requirement.min_score
  }
  if (requirement.type === 'min_percentage' && typeof requirement.min_percentage === 'number') {
    projected.min_percentage = requirement.min_percentage
  }
  return projected
}

function row(
  state: RequirementState,
  requirement: RequirementRow['requirement'],
  source: ProvenanceSource,
  endpoint: string,
  field: string,
  caveat: string | null,
): RequirementRow {
  return { state, requirement, provenance: { source, endpoint, field, caveat } }
}

/**
 * `validate_min_score_requirement`:
 *   `new_score = near_enough?(score, score.round) ? score.round : score`
 *   `new_score.to_f >= requirement[:min_score].to_f`
 */
function meetsMinScore(score: number, threshold: number): boolean {
  const rounded = Math.round(score)
  const effective = Math.abs(score - rounded) < 1e-6 ? rounded : score
  return effective >= threshold
}

function resolveBlock(
  contentDetails: CanvasModuleItemContentDetails | null | undefined,
  mod: ModuleLockEvidence | undefined,
): { source: ProvenanceSource; field: string; caveat: string } | null {
  // `locked_json` always sets `locked_for_user`, and adds `lock_info` /
  // `lock_explanation` only when locked. `content_details.locked` is NOT the
  // authoritative signal: `content_details` copies with `if (val = item.try(attr))`,
  // a truthiness test, so `locked: false` is omitted from the hash entirely and its
  // absence must not be read either way.
  if (contentDetails?.locked_for_user === true) {
    return {
      source: 'module_item.content_details.locked_for_user',
      field: 'content_details.locked_for_user',
      caveat: join(
        'Canvas reports this item as locked for the calling user, so the requirement cannot be acted on yet.',
        mod?.requireSequentialProgress === true
          ? 'The module requires sequential progress; Canvas does not serialize the progression’s current_position, so this per-item lock is the only observable evidence of where the student has reached.'
          : null,
      ) as string,
    }
  }
  if (mod?.state === 'locked') {
    return {
      source: 'module.state',
      field: 'module.state',
      caveat: 'The module itself is locked, so none of its requirements can be acted on yet.',
    }
  }
  if (mod?.prerequisiteUnsatisfied === true) {
    return {
      source: 'module.prerequisite',
      field: 'module.prerequisite_module_ids',
      caveat:
        'A prerequisite module is not yet satisfied, so this requirement cannot be acted on yet.',
    }
  }
  return null
}

/**
 * §4.2. The hard case: `evaluate_numeric_requirement_met` early-returns on an
 * unposted submission, so the action is never recorded and `completed` serializes
 * as `false` — identically to scoring below the threshold. Canvas keeps the
 * discriminating detail in `incomplete_requirements` (`score: nil` for unposted
 * versus a number for below-threshold) and **does not serialize it** from
 * `module_json` or `module_item_json`. There is no `include[]` that exposes it, so
 * the only way to a truthful row is the student's own submission.
 */
function numericRow(
  requirement: CanvasCompletionRequirement,
  projected: RequirementRow['requirement'],
  submission: SubmissionEvidence | null | undefined,
  endpoint: string,
  extra: string | null,
): RequirementRow {
  const threshold =
    requirement.type === 'min_score' ? requirement.min_score : requirement.min_percentage
  const label = requirement.type === 'min_score' ? 'min_score' : 'min_percentage'

  if (submission === undefined) {
    return row(
      'unknown',
      projected,
      'module_item.completion_requirement',
      endpoint,
      'completion_requirement.completed',
      join(
        'Canvas records this numeric requirement as not met, but the student’s submission was not retrieved, so an unposted grade cannot be told apart from a score below the threshold.',
        extra,
      ),
    )
  }

  if (submission === null) {
    return row(
      'unsatisfied',
      projected,
      'submission.workflow_state',
      endpoint,
      'submission',
      join('Nothing submitted: the student has no submission for this item.', extra),
    )
  }

  if (submission.workflow_state === 'unsubmitted') {
    return row(
      'unsatisfied',
      projected,
      'submission.workflow_state',
      endpoint,
      'submission.workflow_state',
      join('Nothing submitted: the submission is in the unsubmitted state.', extra),
    )
  }

  // Destructured so the narrowing below reaches `score`: an `unposted` boolean
  // would leave it `number | null` for the rest of the function.
  const { posted_at: postedAt, score } = submission
  if (postedAt == null || score === null) {
    return row(
      'unknown',
      projected,
      'submission.workflow_state',
      endpoint,
      'submission.posted_at',
      join(
        'Submitted, but the grade is not yet posted, so Canvas cannot evaluate the threshold and records the requirement as not met. This is indistinguishable from a failing score in the module payload.',
        extra,
      ),
    )
  }

  if (requirement.type === 'min_percentage') {
    const pointsPossible = submission.points_possible
    // `validate_min_percentage_requirement`:
    //   `return unless points_possible && points_possible.to_f > 0`
    // so Canvas can never mark the requirement met, and we cannot reproduce the
    // comparison either. Report Canvas's verdict and say why, rather than inventing
    // a percentage.
    if (typeof pointsPossible !== 'number' || pointsPossible <= 0) {
      return row(
        'unsatisfied',
        projected,
        'submission.workflow_state',
        endpoint,
        'submission.points_possible',
        join(
          `Canvas records this ${label} requirement as not met. It cannot evaluate a percentage without a positive points_possible, and content_details omits points_possible when it is zero, so the comparison cannot be reproduced here.`,
          extra,
        ),
      )
    }
    const percentage = (score / pointsPossible) * 100
    const met = percentage >= (threshold ?? 0)
    if (met) {
      return row(
        'unknown',
        projected,
        'submission.workflow_state',
        endpoint,
        'submission.score',
        join(
          `Canvas and this evidence disagree: the posted score meets the ${label} threshold of ${String(threshold)}, yet Canvas records the requirement as not met. The progression may be stale, or our reading of the rule may be wrong; neither side is preferred here.`,
          extra,
        ),
      )
    }
    return row(
      'unsatisfied',
      projected,
      'submission.workflow_state',
      endpoint,
      'submission.score',
      join(`The posted score is below the ${label} threshold of ${String(threshold)}.`, extra),
    )
  }

  const met = meetsMinScore(score, threshold ?? 0)
  if (met) {
    return row(
      'unknown',
      projected,
      'submission.workflow_state',
      endpoint,
      'submission.score',
      join(
        `Canvas and this evidence disagree: the posted score ${String(score)} meets the ${label} threshold of ${String(threshold)}, yet Canvas records the requirement as not met. The progression may be stale, or our reading of the rule may be wrong; neither side is preferred here.`,
        extra,
      ),
    )
  }
  return row(
    'unsatisfied',
    projected,
    'submission.workflow_state',
    endpoint,
    'submission.score',
    join(
      `The posted score ${String(score)} is below the ${label} threshold of ${String(threshold)}.`,
      extra,
    ),
  )
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Decide one module item's requirement row. Total: every input shape yields a row.
 * See the precedence table in this module's header comment.
 */
export function deriveItemRow(evidence: ItemEvidence): RequirementRow {
  const { itemType, endpoint, requirement, contentDetails, submission, module: mod } = evidence
  const opacity = isOpaque(itemType) ? OPACITY_CAVEAT : null

  // 1. No requirement at all. A fact, not an absence of fact — and nothing for a
  //    lock to block, so this precedes the `blocked` check.
  if (requirement === undefined || requirement === null) {
    return row(
      'not_required',
      null,
      'module_item.completion_requirement',
      endpoint,
      'completion_requirement',
      null,
    )
  }

  const projected = projectRequirement(requirement)

  // 2. A type from a newer Canvas than this union was derived against. Canvas
  //    enforces the set on write, so this is only reachable across versions —
  //    but falling through to a default arm would report it confidently.
  if (!isCompletionRequirementType(requirement.type)) {
    return row(
      'unknown',
      projected,
      'module_item.completion_requirement',
      endpoint,
      'completion_requirement.type',
      join(
        `Unrecognized completion-requirement type ${JSON.stringify(requirement.type)}; it is outside the six types this server derived from Canvas and may come from a newer Canvas.`,
        opacity,
      ),
    )
  }

  const type = requirement.type

  // 3. Excusal, which `evaluate_uncompleted_requirements` applies BEFORE the type
  //    is examined: `subs = get_submissions(tag) if tag.scoreable?` then
  //    `if subs&.any? { … sub.excused? } → check_action!(req, true); next`.
  //    Note this is broader than §4.1's prose, which names only the three scoreable
  //    *requirement* types: `tag.scoreable?` is a property of the content tag
  //    (`content_tag.rb`: `content_type_quiz? || graded?`), so an excused submission
  //    satisfies ANY requirement type on an assignment or quiz tag. Having a
  //    submission for the item is itself evidence the tag was scoreable.
  if (submission != null && submission.excused === true) {
    return row(
      'satisfied',
      projected,
      'submission.workflow_state',
      endpoint,
      'submission.excused',
      join(
        'Canvas marks this requirement met because the submission is excused; the student may never have attempted the work.',
        requirement.completed === false
          ? 'Canvas and this evidence disagree: the module payload records completed:false for this requirement.'
          : null,
        opacity,
      ),
    )
  }

  // 4. Canvas's own positive verdict, reported verbatim.
  if (requirement.completed === true) {
    return row(
      'satisfied',
      projected,
      'module_item.completion_requirement',
      endpoint,
      'completion_requirement.completed',
      join(
        type === 'must_view'
          ? 'Canvas resolves must_view last, against the type-agnostic action set (`check_view_requirements`), so a completed submit action on the same item also satisfies it — viewing is not necessarily what happened.'
          : null,
        (NUMERIC_REQUIREMENT_TYPES as readonly string[]).includes(type)
          ? 'Numeric requirements are recomputed on every evaluation rather than latched, so this can revert to unmet with no student action — a grade change, a posting-policy change or a regrade.'
          : null,
        opacity,
      ),
    )
  }

  // 5. Locked.
  const block = resolveBlock(contentDetails, mod)
  if (block) {
    return row(
      'blocked',
      projected,
      block.source,
      endpoint,
      block.field,
      join(block.caveat, opacity),
    )
  }

  // 6. §1.3 — the single most important fact in the design. `completed` is attached
  //    only `if progression`, and a progression exists only when the controllers'
  //    `find_student` resolved a student. Absent is not false.
  if (requirement.completed === undefined) {
    return row(
      'unknown',
      projected,
      'module_item.completion_requirement',
      endpoint,
      'completion_requirement.completed',
      join(
        'Canvas attached no `completed` key to this requirement, which means no progression was loaded — the caller is not a student in this course, or is an unauthenticated reader of a public course. An absent key is not `false`.',
        opacity,
      ),
    )
  }

  // 7. `completed === false`, by type.
  if ((NUMERIC_REQUIREMENT_TYPES as readonly string[]).includes(type)) {
    return numericRow(requirement, projected, submission, endpoint, opacity)
  }

  if ((LATCHED_REQUIREMENT_TYPES as readonly string[]).includes(type)) {
    return row(
      'unsatisfied',
      projected,
      'module_item.completion_requirement',
      endpoint,
      'completion_requirement.completed',
      join(
        `Canvas records ${type} as not met. Canvas sets this only from an in-app action, and no other endpoint can corroborate it, so it cannot be confirmed from any second source. In particular this server does not infer must_contribute from a student’s discussion entries: the two are set by different code paths and can legitimately disagree.`,
        opacity,
      ),
    )
  }

  if (type === 'must_view') {
    return row(
      'unsatisfied',
      projected,
      'module_item.completion_requirement',
      endpoint,
      'completion_requirement.completed',
      join(
        'Canvas records must_view as not met. It resolves must_view last against the type-agnostic action set, so a completed submit action on the same item would also have satisfied it.',
        opacity,
      ),
    )
  }

  // must_submit. Canvas's own answer is already correct and encodes the
  // manual-grade carve-out (`workflow_state == "graded" && attempt.nil?` does NOT
  // count, except on a checkpointed discussion). A second implementation of that
  // rule would be a second place to be wrong, so the verdict is Canvas's verbatim
  // and the submission is used only to explain it.
  const manualGrade =
    submission != null && submission.workflow_state === 'graded' && submission.attempt === null
  return row(
    'unsatisfied',
    projected,
    'module_item.completion_requirement',
    endpoint,
    'completion_requirement.completed',
    join(
      'Canvas records must_submit as not met.',
      manualGrade
        ? 'The student has a graded submission with a null attempt — a grade entered by hand, which Canvas does not count as a submission (the carve-out is disabled only on a checkpointed discussion).'
        : null,
      opacity,
    ),
  )
}

/**
 * §5.3. The two-field initial-post derivation, and the gate that makes it safe.
 *
 * `serialize_additional_topic_fields` emits `require_initial_post` and
 * `user_can_see_posts` unconditionally, and the predicate is
 *   `!require_initial_post? || grants_right?(user, session, :read_as_admin) ||
 *    ([user.id] + associated_user_ids).intersect?(user_ids_who_have_posted_and_admins)`
 *
 * This is strictly better than probing the entries endpoint, which costs a request
 * per topic and answers with a 403 that is ambiguous between "you have not posted"
 * and "you cannot read this topic".
 */
export function deriveInitialPostRow(evidence: InitialPostEvidence): RequirementRow {
  const { endpoint, callerIsStudent, requireInitialPost, userCanSeePosts } = evidence
  const source: ProvenanceSource = 'discussion_topic.user_can_see_posts'

  // The gate comes first, before the table. Both of the predicate's escape hatches
  // read "true" for a privileged caller, so the derivation is not merely imprecise
  // for an educator — it is confidently wrong in the reassuring direction.
  if (!callerIsStudent) {
    return row(
      'unknown',
      null,
      source,
      endpoint,
      'user_can_see_posts',
      'The caller is not a student in this course, so this derivation cannot be used: `user_can_see_posts?` short-circuits on `grants_right?(:read_as_admin)`, and `user_ids_who_have_posted_and_admins` counts admins as having posted. For a teacher, TA or admin token it always reads as satisfied.',
    )
  }

  if (requireInitialPost === undefined || userCanSeePosts === undefined) {
    return row(
      'unknown',
      null,
      source,
      endpoint,
      'require_initial_post',
      'The discussion topic’s require_initial_post / user_can_see_posts fields were not retrieved, so the initial-post obligation cannot be evaluated.',
    )
  }

  if (!requireInitialPost) {
    if (userCanSeePosts) {
      return row('not_required', null, source, endpoint, 'require_initial_post', null)
    }
    // Unreachable for an authenticated caller: the predicate's first disjunct
    // `!require_initial_post?` returns true. Observing it means our model of the
    // predicate is wrong, which is worth reporting rather than resolving.
    return row(
      'unknown',
      null,
      source,
      endpoint,
      'user_can_see_posts',
      'Canvas reports no initial-post requirement yet also that the caller cannot see posts. That combination is unreachable for an authenticated caller through `user_can_see_posts?`, so this server’s model of the predicate may be wrong.',
    )
  }

  if (userCanSeePosts) {
    return row(
      'satisfied',
      null,
      source,
      endpoint,
      'user_can_see_posts',
      'Derived: the topic requires an initial post and Canvas reports the student can see posts, which for a student caller means they have posted.',
    )
  }
  return row(
    'unsatisfied',
    null,
    source,
    endpoint,
    'user_can_see_posts',
    'Derived: the topic requires an initial post and Canvas reports the student cannot see posts, which for a student caller is positive evidence that they have not posted — not an inference from silence.',
  )
}

/**
 * §5.4. A checkpointed discussion is **two** rows, from two sub-assignments
 * (`CheckpointLabels::REPLY_TO_TOPIC` and `CheckpointLabels::REPLY_TO_ENTRY`), each
 * with its own due date and its own submission.
 *
 * `reply_to_entry_required_count` is the **requirement**, never the progress:
 * Canvas exposes no per-student "replies made" counter on either the topic or the
 * planner item, so this module never renders "2 of 3 replies done". That figure
 * does not exist in the API and would be fabricated.
 *
 * §4.4's manual-grade carve-out applies here **in reverse**: on a checkpointed
 * discussion a hand-entered grade *does* satisfy the checkpoint, because
 * `tag.content_type_discussion? && tag.content&.assignment&.checkpoints_parent?`
 * disables the exclusion.
 */
export function deriveCheckpointRows(evidence: CheckpointEvidence): RequirementRow[] {
  const { endpoint, replyToEntryRequiredCount, replyToTopicSubmission, replyToEntrySubmission } =
    evidence

  const checkpointRow = (
    submission: SubmissionEvidence | null | undefined,
    extra: string | null,
  ): RequirementRow => {
    if (submission === undefined) {
      return row(
        'unknown',
        null,
        'checkpoint_submission',
        endpoint,
        'sub_assignment_submissions',
        join(
          'The checkpoint sub-assignment’s submission was not reachable, so its state is undetermined.',
          extra,
        ),
      )
    }
    if (submission === null) {
      return row(
        'unsatisfied',
        null,
        'checkpoint_submission',
        endpoint,
        'sub_assignment_submissions',
        join('The student has no submission for this checkpoint.', extra),
      )
    }
    const submitted = (SUBMITTED_WORKFLOW_STATES as readonly string[]).includes(
      submission.workflow_state,
    )
    return row(
      submitted ? 'satisfied' : 'unsatisfied',
      null,
      'checkpoint_submission',
      endpoint,
      'sub_assignment_submissions.workflow_state',
      join(
        submitted && submission.attempt === null
          ? 'Satisfied by a grade entered without an attempt: on a checkpointed discussion Canvas disables the manual-grade carve-out, so a hand-entered grade does count.'
          : null,
        extra,
      ),
    )
  }

  const countSentence =
    typeof replyToEntryRequiredCount === 'number'
      ? `Canvas requires ${String(replyToEntryRequiredCount)} reply-to-entry posts. Canvas exposes no per-student count of replies made, so this row reports the checkpoint sub-assignment’s submission state only, not progress toward that number.`
      : 'Canvas exposes no per-student count of replies made, so this row reports the checkpoint sub-assignment’s submission state only.'

  return [
    checkpointRow(replyToTopicSubmission, 'This is the reply-to-topic checkpoint.'),
    checkpointRow(replyToEntrySubmission, countSentence),
  ]
}

/**
 * §4.5. Roll per-row states up to a module verdict.
 *
 * `blocked` on the module overrides the row rollup, and Stage 3 still returns the
 * rows — a student needs to see what is waiting behind the lock.
 *
 * A `blocked` **row** contributes as `unknown`: the block hides whatever the
 * underlying evidence said, so claiming either `satisfied` or `unsatisfied` for it
 * would be inventing a fact. `not_required` rows are excluded entirely; they are not
 * requirements.
 */
export function rollUpModule(input: ModuleRollupInput): ModuleRollup {
  const { requirementType = 'all', rows, canvasState, prerequisiteUnsatisfied } = input

  let derivedState: ModuleDerivedState

  if (canvasState === 'locked' || prerequisiteUnsatisfied === true) {
    derivedState = 'blocked'
  } else {
    const states = rows
      .filter((r) => r.state !== 'not_required')
      .map((r) => (r.state === 'blocked' ? 'unknown' : r.state))

    if (states.length === 0) {
      // `CompletedRequirementCalculator#all_met?` is `!@any_unmet`, and an empty
      // `completion_requirements` loop never sets `@any_unmet`, so Canvas marks a
      // module with no requirements "completed".
      derivedState = 'satisfied'
    } else if (requirementType === 'one') {
      // `evaluate_requirements_met`: `count_needed > 0 && met_requirement_count >=
      // count_needed`. With `requirement_count == 1`, any single met requirement
      // completes the module — so counting unsatisfied rows here would tell a
      // student to do work Canvas does not require.
      derivedState = states.includes('satisfied')
        ? 'satisfied'
        : states.includes('unknown')
          ? 'unknown'
          : 'unsatisfied'
    } else {
      derivedState = states.every((s) => s === 'satisfied')
        ? 'satisfied'
        : states.includes('unsatisfied')
          ? 'unsatisfied'
          : 'unknown'
    }
  }

  // An `unknown` rollup cannot contradict anything, so it is never a disagreement.
  let stateDisagreement = false
  if (typeof canvasState === 'string' && canvasState.length > 0 && derivedState !== 'unknown') {
    if (canvasState === 'completed') stateDisagreement = derivedState !== 'satisfied'
    else if (canvasState === 'locked') stateDisagreement = derivedState !== 'blocked'
    else stateDisagreement = derivedState === 'satisfied'
  }

  return { derivedState, canvasState: canvasState ?? null, stateDisagreement }
}

/**
 * Five counts, never one "things left to do" number. A single number cannot be
 * computed honestly across mixed `requirement_type` values and a non-zero `unknown`
 * count, and inventing one is the failure mode this whole design argues against.
 */
export function summarize(rows: readonly RequirementRow[]): RequirementSummary {
  const summary: RequirementSummary = {
    satisfied: 0,
    unsatisfied: 0,
    unknown: 0,
    blocked: 0,
    not_required: 0,
  }
  for (const r of rows) summary[r.state] += 1
  return summary
}
