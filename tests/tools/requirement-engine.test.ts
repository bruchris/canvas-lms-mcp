import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import {
  COMPLETION_REQUIREMENT_TYPES,
  SUBMITTED_WORKFLOW_STATES,
  isCompletionRequirementType,
  deriveItemRow,
  deriveInitialPostRow,
  deriveCheckpointRows,
  rollUpModule,
  summarize,
  type ItemEvidence,
  type RequirementRow,
  type SubmissionEvidence,
} from '../../src/tools/requirement-engine'

// ───────────────────────────────────────────────────────────────────────────
// Fixtures.
//
// Every fixture below is traceable to a named file in `instructure/canvas-lms`
// at the design's pinned SHA 1c9f0bb8013ed69c4f2efe11fd483025469b7e6c. All four
// files Stage 2 depends on were re-fetched at `master` on 2026-10-22 and are
// byte-identical to the pinned tree (see the PR body). Per §11.1 of the design,
// a fixture with no citation is an assumption wearing a test's clothes.
// ───────────────────────────────────────────────────────────────────────────

const MODULES_ENDPOINT = '/api/v1/courses/1/modules/7/items'
const TOPICS_ENDPOINT = '/api/v1/courses/1/discussion_topics'

/** A minimal item evidence bag. `itemType: 'Assignment'` is `scoreable?` in Canvas. */
function item(over: Partial<ItemEvidence> = {}): ItemEvidence {
  return { itemType: 'Assignment', endpoint: MODULES_ENDPOINT, ...over }
}

/**
 * A submission as `evaluate_numeric_requirement_met` and the `must_submit` arm of
 * `evaluate_uncompleted_requirements` read it
 * (`app/models/context_module_progression.rb`).
 */
function submission(over: Partial<SubmissionEvidence> = {}): SubmissionEvidence {
  return {
    workflow_state: 'graded',
    attempt: 1,
    score: 90,
    posted_at: '2026-10-01T00:00:00Z',
    points_possible: 100,
    ...over,
  }
}

function rowOf(state: RequirementRow['state']): RequirementRow {
  return {
    state,
    requirement: { type: 'must_view' },
    provenance: {
      source: 'module_item.completion_requirement',
      endpoint: '',
      field: '',
      caveat: null,
    },
  }
}

// ───────────────────────────────────────────────────────────────────────────
// §1.1 — six requirement types, not five
// ───────────────────────────────────────────────────────────────────────────

describe('§1.1 the validated requirement-type set has six members', () => {
  // `app/models/context_module.rb` `validate_completion_requirements`:
  // scoreable_types = %w[must_submit min_score min_percentage]
  // plus %w[must_view must_mark_done must_contribute].
  it('declares exactly the six types Canvas validates', () => {
    expect([...COMPLETION_REQUIREMENT_TYPES].sort()).toEqual(
      [
        'min_percentage',
        'min_score',
        'must_contribute',
        'must_mark_done',
        'must_submit',
        'must_view',
      ].sort(),
    )
  })

  it('accepts min_percentage and rejects a value outside the set', () => {
    expect(isCompletionRequirementType('min_percentage')).toBe(true)
    expect(isCompletionRequirementType('must_frobnicate')).toBe(false)
    expect(isCompletionRequirementType(undefined)).toBe(false)
  })

  // `lib/api/v1/context_module.rb` emits the threshold under a DIFFERENT key:
  //   ch["min_percentage"] = criterion[:min_percentage] if criterion[:type] == "min_percentage"
  it('carries a min_percentage threshold through as min_percentage, not min_score', () => {
    const row = deriveItemRow(
      item({
        requirement: { type: 'min_percentage', min_percentage: 80, completed: true },
      }),
    )
    expect(row.requirement).toEqual({ type: 'min_percentage', min_percentage: 80 })
    expect(row.requirement).not.toHaveProperty('min_score')
  })

  it('reports an unrecognized type from a newer Canvas as unknown, not as a default arm', () => {
    const row = deriveItemRow(
      item({
        requirement: { type: 'must_teleport' as never, completed: false },
      }),
    )
    expect(row.state).toBe('unknown')
    expect(row.provenance.caveat).toMatch(/unrecognized|newer/i)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// §1.3 — `completed` absent is not `false`
// ───────────────────────────────────────────────────────────────────────────

describe('§1.3 an absent `completed` is unknown, never unsatisfied', () => {
  // `lib/api/v1/context_module.rb`:
  //   ch["completed"] = !!(progression.requirements_met.present? && …) if progression
  // and a progression exists only when `find_student` resolved a student.
  it('is unknown when the serializer attached no `completed` key', () => {
    const row = deriveItemRow(item({ requirement: { type: 'must_view' } }))
    expect(row.state).toBe('unknown')
    expect(row.state).not.toBe('unsatisfied')
    expect(row.provenance.caveat).toMatch(/progression|not a student|absent/i)
  })

  it('is unsatisfied when `completed` is explicitly false — the control', () => {
    const row = deriveItemRow(item({ requirement: { type: 'must_view', completed: false } }))
    expect(row.state).toBe('unsatisfied')
  })

  it('reports every requirement in an educator-caller module as unknown, not unsatisfied', () => {
    // The wrong-answer control for the §1.3 trap: a teacher token gets no
    // `completed` on ANY row, and the naive reading reports a whole course
    // incomplete.
    const types = [...COMPLETION_REQUIREMENT_TYPES]
    const rows = types.map((type) => deriveItemRow(item({ requirement: { type } })))
    expect(rows.every((r) => r.state === 'unknown')).toBe(true)
    expect(summarize(rows)).toMatchObject({ unknown: 6, unsatisfied: 0 })
  })
})

// ───────────────────────────────────────────────────────────────────────────
// §3.1 — not_required, blocked
// ───────────────────────────────────────────────────────────────────────────

describe('§3.1 not_required is a fact, unknown is an absence of fact', () => {
  it('is not_required when the item carries no completion_requirement', () => {
    const row = deriveItemRow(item())
    expect(row.state).toBe('not_required')
    expect(row.requirement).toBeNull()
  })

  it('stays not_required even when the item is locked — there is nothing to block', () => {
    const row = deriveItemRow(item({ contentDetails: { locked_for_user: true } }))
    expect(row.state).toBe('not_required')
  })
})

describe('§3.1/§5.5 blocked comes from locked_for_user, not from `locked`', () => {
  // `lib/api/v1/locked.rb` `locked_json` always sets `locked_for_user`; `lock_info`
  // and `lock_explanation` are added only when locked.
  it('is blocked on content_details.locked_for_user === true', () => {
    const row = deriveItemRow(
      item({
        requirement: { type: 'must_view', completed: false },
        contentDetails: {
          locked_for_user: true,
          lock_explanation: 'This module is locked until Oct 30.',
        },
      }),
    )
    expect(row.state).toBe('blocked')
    expect(row.provenance.source).toBe('module_item.content_details.locked_for_user')
  })

  // `lib/api/v1/context_module.rb` `content_details` copies with
  // `if (val = item.try(attr))` — a TRUTHINESS test. So `locked: false` and
  // `points_possible: 0` are omitted from the hash entirely.
  it('does not read an ABSENT `locked` key as locked, nor as unlocked evidence', () => {
    const row = deriveItemRow(
      item({
        requirement: { type: 'must_view', completed: false },
        contentDetails: { due_at: '2026-11-01T00:00:00Z' },
      }),
    )
    expect(row.state).toBe('unsatisfied')
  })

  it('does not treat a truthiness-dropped `locked` as a lock when locked_for_user is false', () => {
    const row = deriveItemRow(
      item({
        requirement: { type: 'must_view', completed: true },
        contentDetails: { locked_for_user: false },
      }),
    )
    expect(row.state).toBe('satisfied')
  })

  it('is blocked on module state === locked', () => {
    const row = deriveItemRow(
      item({ requirement: { type: 'must_view', completed: false }, module: { state: 'locked' } }),
    )
    expect(row.state).toBe('blocked')
    expect(row.provenance.source).toBe('module.state')
  })

  it('is blocked on an unsatisfied prerequisite module', () => {
    const row = deriveItemRow(
      item({
        requirement: { type: 'must_view', completed: false },
        module: { prerequisiteUnsatisfied: true },
      }),
    )
    expect(row.state).toBe('blocked')
    expect(row.provenance.source).toBe('module.prerequisite')
  })

  // §5.5: the progression's `current_position` is NOT serialized, so
  // require_sequential_progress alone can never establish a block. It only
  // explains one.
  it('does not block on require_sequential_progress alone — current_position is not serialized', () => {
    const row = deriveItemRow(
      item({
        requirement: { type: 'must_view', completed: false },
        module: { requireSequentialProgress: true },
      }),
    )
    expect(row.state).toBe('unsatisfied')
  })

  it('names sequential progress in the caveat when the item IS locked_for_user', () => {
    const row = deriveItemRow(
      item({
        requirement: { type: 'must_view', completed: false },
        contentDetails: { locked_for_user: true },
        module: { requireSequentialProgress: true },
      }),
    )
    expect(row.state).toBe('blocked')
    expect(row.provenance.caveat).toMatch(/sequential/i)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// §4.1 — excusal
// ───────────────────────────────────────────────────────────────────────────

describe('§4.1 excusal beats everything, and says so', () => {
  // `app/models/context_module_progression.rb`:
  //   subs = get_submissions(tag) if tag.scoreable?
  //   if subs&.any? { |sub| … sub.excused? }
  //     calc.check_action!(req, true); next
  // The branch runs BEFORE `req[:type]` is examined.
  it('is satisfied with an excusal caveat on a min_score requirement with nothing submitted', () => {
    const row = deriveItemRow(
      item({
        requirement: { type: 'min_score', min_score: 70, completed: true },
        submission: submission({
          workflow_state: 'unsubmitted',
          attempt: null,
          score: null,
          excused: true,
        }),
      }),
    )
    expect(row.state).toBe('satisfied')
    expect(row.provenance.caveat).toMatch(/excus/i)
  })

  it('satisfies a must_view requirement too — the excusal branch precedes the type switch', () => {
    // This is BROADER than §4.1's prose, which names only the three scoreable
    // requirement types. `tag.scoreable?` is a property of the CONTENT TAG
    // (`content_tag.rb`: `content_type_quiz? || graded?`, and `graded?` is true for
    // `content_type == "Assignment"`), not of the requirement type. So an excused
    // submission satisfies ANY requirement type on an assignment tag.
    const row = deriveItemRow(
      item({
        requirement: { type: 'must_view', completed: true },
        submission: submission({ excused: true }),
      }),
    )
    expect(row.state).toBe('satisfied')
    expect(row.provenance.caveat).toMatch(/excus/i)
  })

  it('reports excusal as satisfied even where Canvas says completed:false, and flags the disagreement', () => {
    const row = deriveItemRow(
      item({
        requirement: { type: 'must_submit', completed: false },
        submission: submission({ excused: true }),
      }),
    )
    expect(row.state).toBe('satisfied')
    expect(row.provenance.caveat).toMatch(/excus/i)
    expect(row.provenance.caveat).toMatch(/disagree|Canvas records/i)
  })

  it('does not fire on excused: false or excused: null — the control', () => {
    for (const excused of [false, null, undefined]) {
      const row = deriveItemRow(
        item({
          requirement: { type: 'min_score', min_score: 70, completed: false },
          submission: submission({ score: 50, excused }),
        }),
      )
      expect(row.state).toBe('unsatisfied')
      expect(row.provenance.caveat ?? '').not.toMatch(/excus/i)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// §4.2 — numeric requirements: unposted vs below-threshold
// ───────────────────────────────────────────────────────────────────────────

describe('§4.2 an unposted numeric grade is unknown, not unsatisfied', () => {
  // `evaluate_numeric_requirement_met`:
  //   if (unposted_sub = subs.detect { |sub| … !sub.posted? })
  //     update_incomplete_requirement!(requirement, nil) unless unposted_sub.unsubmitted?
  //     return
  //   end
  // The early `return` yields nil, the action is never added, so `completed`
  // serializes as false — identically to scoring below the threshold. The
  // discriminator lives in `incomplete_requirements`, which `module_json` and
  // `module_item_json` do not serialize.
  it('is unknown when the submission is submitted but posted_at is null', () => {
    const row = deriveItemRow(
      item({
        requirement: { type: 'min_score', min_score: 70, completed: false },
        submission: submission({ workflow_state: 'submitted', score: null, posted_at: null }),
      }),
    )
    expect(row.state).toBe('unknown')
    expect(row.provenance.caveat).toMatch(/not yet posted|unposted/i)
  })

  it('is unknown when score is null and the submission is not unsubmitted', () => {
    const row = deriveItemRow(
      item({
        requirement: { type: 'min_percentage', min_percentage: 80, completed: false },
        submission: submission({ workflow_state: 'pending_review', score: null }),
      }),
    )
    expect(row.state).toBe('unknown')
  })

  it('is unsatisfied on a POSTED score below min_score — the control proving the row above is not trivially unknown', () => {
    const row = deriveItemRow(
      item({
        requirement: { type: 'min_score', min_score: 70, completed: false },
        submission: submission({ score: 55 }),
      }),
    )
    expect(row.state).toBe('unsatisfied')
    expect(row.provenance.caveat).toContain('55')
    expect(row.provenance.caveat).toContain('70')
  })

  it('is unsatisfied on a posted percentage below min_percentage, with both figures in the caveat', () => {
    const row = deriveItemRow(
      item({
        requirement: { type: 'min_percentage', min_percentage: 80, completed: false },
        submission: submission({ score: 60, points_possible: 100 }),
      }),
    )
    expect(row.state).toBe('unsatisfied')
    expect(row.provenance.caveat).toContain('80')
  })

  it('is unsatisfied with a "nothing submitted" caveat when the lookup found no submission', () => {
    const row = deriveItemRow(
      item({
        requirement: { type: 'min_score', min_score: 70, completed: false },
        submission: null,
      }),
    )
    expect(row.state).toBe('unsatisfied')
    expect(row.provenance.caveat).toMatch(/nothing submitted|no submission/i)
  })

  it('is UNKNOWN when the submission was never looked up — absent is not "none"', () => {
    // A partial/truncated read. `submission: undefined` means the §4.2
    // disambiguation is unavailable, which is a different fact from
    // `submission: null` ("looked up, the student has none") above.
    const row = deriveItemRow(
      item({ requirement: { type: 'min_score', min_score: 70, completed: false } }),
    )
    expect(row.state).toBe('unknown')
    expect(row.provenance.caveat).toMatch(/not (retrieved|looked up)|unavailable/i)
  })

  // `validate_min_percentage_requirement`:
  //   points_possible = sub.assignment.points_possible
  //   return unless points_possible && points_possible.to_f > 0
  // A nil/zero points_possible makes the percentage unevaluable, so Canvas can
  // never mark the requirement met. And §5.5's truthiness drop means
  // `points_possible: 0` is ABSENT from content_details, so the two collapse.
  it('does not fabricate a percentage when points_possible is unusable', () => {
    for (const points_possible of [0, null, undefined]) {
      const row = deriveItemRow(
        item({
          requirement: { type: 'min_percentage', min_percentage: 80, completed: false },
          submission: submission({ score: 60, points_possible }),
        }),
      )
      expect(row.state).toBe('unsatisfied')
      expect(row.provenance.caveat).toMatch(
        /points_possible|cannot be reproduced|not reproducible/i,
      )
      expect(row.provenance.caveat ?? '').not.toMatch(/\d+%\s*(of|below)/i)
    }
  })

  it('flags a disagreement when our arithmetic says met but Canvas recorded completed:false', () => {
    // Required by the task's acceptance criteria: "disagreement between Canvas
    // and derived state". §4.5's rule is to flag, never to prefer one side.
    const row = deriveItemRow(
      item({
        requirement: { type: 'min_score', min_score: 70, completed: false },
        submission: submission({ score: 95 }),
      }),
    )
    expect(row.state).toBe('unknown')
    expect(row.provenance.caveat).toMatch(/disagree/i)
  })

  it('does not re-evaluate a numeric requirement Canvas already recorded as met', () => {
    const row = deriveItemRow(
      item({
        requirement: { type: 'min_score', min_score: 70, completed: true },
        submission: submission({ score: 12 }),
      }),
    )
    expect(row.state).toBe('satisfied')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// §4.3 — latched requirements and must_view
// ───────────────────────────────────────────────────────────────────────────

describe('§4.3 must_contribute and must_mark_done are latched and uncorroborable', () => {
  // `evaluate_uncompleted_requirements`:
  //   elsif %w[must_contribute must_mark_done].include? req[:type]
  //     # must_contribute is handled by ContextModule#update_for
  //     calc.check_action!(req, false)
  // Re-evaluated as false on every pass; only a side-effecting in-app event sets
  // them. §9 forbids deriving must_contribute from discussion entries.
  it('trusts Canvas verbatim and says no other endpoint can corroborate', () => {
    for (const type of ['must_contribute', 'must_mark_done'] as const) {
      const row = deriveItemRow(item({ requirement: { type, completed: false } }))
      expect(row.state).toBe('unsatisfied')
      expect(row.provenance.caveat).toMatch(/in-app|corroborat|cannot be confirmed/i)
    }
  })

  it('does not promote must_contribute from a submission', () => {
    const row = deriveItemRow(
      item({
        requirement: { type: 'must_contribute', completed: false },
        submission: submission({ workflow_state: 'submitted' }),
      }),
    )
    expect(row.state).toBe('unsatisfied')
  })
})

describe('§4.3 must_view can be satisfied by a submit action', () => {
  // `check_view_requirements` resolves must_view LAST, against the type-agnostic
  // action set: `check_action!(req, requirement_met?(req, include_type: false))`.
  it('records in the caveat that a submit action also satisfies must_view', () => {
    const row = deriveItemRow(item({ requirement: { type: 'must_view', completed: true } }))
    expect(row.state).toBe('satisfied')
    expect(row.provenance.caveat).toMatch(/submit/i)
  })

  it('says the same on the UNSATISFIED path, and still names must_view', () => {
    // Added because injection I11 (delete the must_view arm) scored ZERO: the
    // satisfied-path assertion above is reached through the `completed === true`
    // branch, so nothing covered the must_view arm of the `completed === false`
    // switch. Without this fixture the arm is decoration.
    const row = deriveItemRow(item({ requirement: { type: 'must_view', completed: false } }))
    expect(row.state).toBe('unsatisfied')
    expect(row.provenance.caveat).toMatch(/must_view/)
    expect(row.provenance.caveat).toMatch(/type-agnostic|submit action/i)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// §4.4 — must_submit and the manual-grade carve-out
// ───────────────────────────────────────────────────────────────────────────

describe('§4.4 must_submit is reported verbatim, never re-derived from workflow_state', () => {
  // `evaluate_uncompleted_requirements`:
  //   if sub.workflow_state == "graded" && sub.attempt.nil? && !(
  //     tag.content_type_discussion? && tag.content&.assignment&.checkpoints_parent?)
  //     false
  //   elsif %w[submitted graded complete pending_review].include?(sub.workflow_state)
  //     true
  // §4.4's rule: a second implementation of this is a second place to be wrong.
  it('names the four submitted workflow states exactly', () => {
    expect([...SUBMITTED_WORKFLOW_STATES].sort()).toEqual(
      ['complete', 'graded', 'pending_review', 'submitted'].sort(),
    )
  })

  it('stays unsatisfied on a hand-entered grade with attempt: null', () => {
    const row = deriveItemRow(
      item({
        requirement: { type: 'must_submit', completed: false },
        submission: submission({ workflow_state: 'graded', attempt: null }),
      }),
    )
    expect(row.state).toBe('unsatisfied')
    expect(row.provenance.caveat).toMatch(/manual|hand-entered|attempt/i)
  })

  it('does NOT promote a graded-with-attempt submission over Canvas’s completed:false', () => {
    const row = deriveItemRow(
      item({
        requirement: { type: 'must_submit', completed: false },
        submission: submission({ workflow_state: 'submitted', attempt: 2 }),
      }),
    )
    expect(row.state).toBe('unsatisfied')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// §5.6 — opaque item types
// ───────────────────────────────────────────────────────────────────────────

describe('§5.6 ExternalTool and ExternalUrl are opaque by construction', () => {
  it('is unknown with an outside-Canvas caveat when `completed` is absent', () => {
    for (const itemType of ['ExternalTool', 'ExternalUrl']) {
      const row = deriveItemRow(item({ itemType, requirement: { type: 'must_view' } }))
      expect(row.state).toBe('unknown')
      expect(row.provenance.caveat).toMatch(/outside Canvas|external/i)
    }
  })

  it('reports `completed` verbatim when present, still with the opacity caveat', () => {
    const satisfied = deriveItemRow(
      item({ itemType: 'ExternalTool', requirement: { type: 'must_view', completed: true } }),
    )
    expect(satisfied.state).toBe('satisfied')
    expect(satisfied.provenance.caveat).toMatch(/outside Canvas|external/i)

    const unsatisfied = deriveItemRow(
      item({
        itemType: 'ExternalTool',
        requirement: { type: 'must_contribute', completed: false },
      }),
    )
    expect(unsatisfied.state).toBe('unsatisfied')
    expect(unsatisfied.provenance.caveat).toMatch(/outside Canvas|external/i)
  })

  it('treats a New Quizzes item as an ordinary Assignment, with no special casing', () => {
    // A New Quizzes assignment appears as a module item of type `Assignment`.
    const row = deriveItemRow(
      item({
        itemType: 'Assignment',
        requirement: { type: 'min_score', min_score: 70, completed: false },
        submission: submission({ score: 40 }),
      }),
    )
    expect(row.state).toBe('unsatisfied')
    expect(row.provenance.caveat ?? '').not.toMatch(/outside Canvas/i)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// §5.3 — require_initial_post, and the gate that makes it safe
// ───────────────────────────────────────────────────────────────────────────

describe('§5.3 the initial-post derivation is valid only for a student caller', () => {
  // `app/models/discussion_topic.rb`:
  //   def user_can_see_posts?(user, session = nil, associated_user_ids = [])
  //     return false unless user
  //     !require_initial_post? || grants_right?(user, session, :read_as_admin) ||
  //       ([user.id] + associated_user_ids).intersect?(user_ids_who_have_posted_and_admins)
  //   end
  // `serialize_additional_topic_fields` (`lib/api/v1/discussion_topics.rb`) emits
  // both fields unconditionally.
  it('is unsatisfied when require_initial_post is true and user_can_see_posts is false', () => {
    const row = deriveInitialPostRow({
      endpoint: TOPICS_ENDPOINT,
      callerIsStudent: true,
      requireInitialPost: true,
      userCanSeePosts: false,
    })
    expect(row.state).toBe('unsatisfied')
    expect(row.provenance.source).toBe('discussion_topic.user_can_see_posts')
  })

  it('is satisfied when both are true', () => {
    const row = deriveInitialPostRow({
      endpoint: TOPICS_ENDPOINT,
      callerIsStudent: true,
      requireInitialPost: true,
      userCanSeePosts: true,
    })
    expect(row.state).toBe('satisfied')
  })

  it('is not_required when there is no initial-post obligation', () => {
    const row = deriveInitialPostRow({
      endpoint: TOPICS_ENDPOINT,
      callerIsStudent: true,
      requireInitialPost: false,
      userCanSeePosts: true,
    })
    expect(row.state).toBe('not_required')
  })

  it('is unknown on the unreachable false/false corner — it means our model of the predicate is wrong', () => {
    const row = deriveInitialPostRow({
      endpoint: TOPICS_ENDPOINT,
      callerIsStudent: true,
      requireInitialPost: false,
      userCanSeePosts: false,
    })
    expect(row.state).toBe('unknown')
    expect(row.provenance.caveat).toMatch(/unreachable|predicate/i)
  })

  it('GATE: is unknown for a non-student caller, never satisfied', () => {
    // `grants_right?(:read_as_admin)` short-circuits to true and
    // `user_ids_who_have_posted_and_admins` counts admins as having posted, so for
    // a teacher/TA/admin token the derivation ALWAYS reads satisfied and is
    // worthless. This is the wrong-answer control for an educator caller.
    for (const [requireInitialPost, userCanSeePosts] of [
      [true, true],
      [true, false],
      [false, true],
    ] as const) {
      const row = deriveInitialPostRow({
        endpoint: TOPICS_ENDPOINT,
        callerIsStudent: false,
        requireInitialPost,
        userCanSeePosts,
      })
      expect(row.state).toBe('unknown')
      expect(row.provenance.caveat).toMatch(/admin|read_as_admin|short-circuit/i)
    }
  })

  it('is unknown when the topic fields were not retrieved at all', () => {
    const row = deriveInitialPostRow({ endpoint: TOPICS_ENDPOINT, callerIsStudent: true })
    expect(row.state).toBe('unknown')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// §5.4 — checkpointed discussions
// ───────────────────────────────────────────────────────────────────────────

describe('§5.4 a checkpointed discussion is two rows, and never "N of M replies"', () => {
  // `app/models/discussion_topic.rb`: two sub-assignments,
  // CheckpointLabels::REPLY_TO_TOPIC and CheckpointLabels::REPLY_TO_ENTRY, each
  // with its own due date and its own submission. Canvas exposes no per-student
  // "replies made" counter on either the topic or the planner item.
  it('emits exactly two rows: reply-to-topic and reply-to-entry', () => {
    const rows = deriveCheckpointRows({
      endpoint: TOPICS_ENDPOINT,
      replyToEntryRequiredCount: 3,
      replyToTopicSubmission: { submitted_at: '2026-10-01T09:00:00Z', score: null },
      replyToEntrySubmission: null,
    })
    expect(rows).toHaveLength(2)
    expect(rows[0].state).toBe('satisfied')
    expect(rows.every((r) => r.provenance.source === 'checkpoint_submission')).toBe(true)
  })

  it('carries the required count as the REQUIREMENT and never as progress', () => {
    const rows = deriveCheckpointRows({
      endpoint: TOPICS_ENDPOINT,
      replyToEntryRequiredCount: 3,
      replyToTopicSubmission: null,
      replyToEntrySubmission: { submitted_at: '2026-10-02T09:00:00Z', score: 10 },
    })
    const entryRow = rows[1]
    expect(entryRow.state).toBe('satisfied')
    expect(JSON.stringify(rows)).not.toMatch(/\b\d+\s*(of|\/)\s*3\b/)
    expect(entryRow.provenance.caveat).toMatch(/3/)
  })

  it('CARVE-OUT: a grade with no submitted_at DOES satisfy a checkpoint', () => {
    // The §4.4 exception, in reverse. `tag.content_type_discussion? &&
    // tag.content&.assignment&.checkpoints_parent?` disables the manual-grade
    // exclusion. Read off `score` rather than `workflow_state`/`attempt`, which
    // `sub_assignment_submission_json`'s 17-key slice does not serialize.
    const rows = deriveCheckpointRows({
      endpoint: TOPICS_ENDPOINT,
      replyToEntryRequiredCount: 1,
      replyToTopicSubmission: { submitted_at: null, score: 8 },
      replyToEntrySubmission: null,
    })
    expect(rows[0].state).toBe('satisfied')
    expect(rows[0].provenance.field).toBe('sub_assignment_submissions.score')
    expect(rows[0].provenance.caveat).toMatch(/hand-entered grade/)
  })

  it('the slice carries no workflow_state, so no row ever cites one', () => {
    // The Stage 3 source finding (§12.3), pinned: `sub_assignment_submission_json`
    // slices to 17 keys and `workflow_state` is not among them. A provenance
    // string naming it would be a claim about a field Canvas never sends.
    const rows = deriveCheckpointRows({
      endpoint: TOPICS_ENDPOINT,
      replyToEntryRequiredCount: 2,
      replyToTopicSubmission: { submitted_at: '2026-10-01T09:00:00Z' },
      replyToEntrySubmission: { submitted_at: null, score: null },
    })
    expect(rows.map((r) => r.state)).toEqual(['satisfied', 'unsatisfied'])
    expect(JSON.stringify(rows)).not.toContain('workflow_state')
    expect(JSON.stringify(rows)).not.toContain('attempt')
  })

  it('an EXCUSED checkpoint is satisfied with nothing posted, and says so', () => {
    // §4.1 reaches the checkpoint too: `excused` survives the slice.
    const rows = deriveCheckpointRows({
      endpoint: TOPICS_ENDPOINT,
      replyToEntryRequiredCount: 1,
      replyToTopicSubmission: { submitted_at: null, score: null, excused: true },
      replyToEntrySubmission: null,
    })
    expect(rows[0].state).toBe('satisfied')
    expect(rows[0].provenance.field).toBe('sub_assignment_submissions.excused')
    expect(rows[0].provenance.caveat).toMatch(/EXCUSED/)
  })

  it('PAIR: the same shape on a NON-checkpointed item stays unsatisfied', () => {
    // One fixture alone cannot show the asymmetry, so this is the other half.
    const row = deriveItemRow(
      item({
        itemType: 'Discussion',
        requirement: { type: 'must_submit', completed: false },
        submission: submission({ workflow_state: 'graded', attempt: null }),
      }),
    )
    expect(row.state).toBe('unsatisfied')
  })

  it('is unknown where the sub-assignment submission is not reachable', () => {
    const rows = deriveCheckpointRows({ endpoint: TOPICS_ENDPOINT, replyToEntryRequiredCount: 2 })
    expect(rows.map((r) => r.state)).toEqual(['unknown', 'unknown'])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// §4.5 — rollup
// ───────────────────────────────────────────────────────────────────────────

describe('§4.5 rollup under requirement_type', () => {
  // `ContextModule#requirement_type`:
  //   (completion_requirements.present? && requirement_count == 1) ? "one" : "all"
  // `evaluate_requirements_met`:
  //   count_needed > 0 && result.met_requirement_count >= count_needed → "completed"
  it('"one": a single satisfied row completes a module showing five unsatisfied ones', () => {
    // §1.2's whole point: counting unsatisfied rows here reports "5 things left
    // to do" and makes a student do unnecessary work. `requirement_count` is
    // WITHHELD in this fixture (it is serialized only behind
    // `requirement_count_api_enabled?`), so the rollup must branch on
    // `requirement_type` and never on the integer's presence.
    const rows = [rowOf('satisfied'), ...Array.from({ length: 5 }, () => rowOf('unsatisfied'))]
    expect(rollUpModule({ requirementType: 'one', rows }).derivedState).toBe('satisfied')
  })

  it('"one": unknown when nothing is satisfied but something is unknown', () => {
    const rows = [rowOf('unsatisfied'), rowOf('unknown')]
    expect(rollUpModule({ requirementType: 'one', rows }).derivedState).toBe('unknown')
  })

  it('"one": unsatisfied only when every row is unsatisfied', () => {
    const rows = [rowOf('unsatisfied'), rowOf('unsatisfied')]
    expect(rollUpModule({ requirementType: 'one', rows }).derivedState).toBe('unsatisfied')
  })

  it('"all": satisfied only when every requirement row is satisfied', () => {
    expect(
      rollUpModule({ requirementType: 'all', rows: [rowOf('satisfied'), rowOf('satisfied')] })
        .derivedState,
    ).toBe('satisfied')
    expect(
      rollUpModule({ requirementType: 'all', rows: [rowOf('satisfied'), rowOf('unsatisfied')] })
        .derivedState,
    ).toBe('unsatisfied')
  })

  it('"all": unknown when a row is unknown and none is unsatisfied', () => {
    const rows = [rowOf('satisfied'), rowOf('unknown')]
    expect(rollUpModule({ requirementType: 'all', rows }).derivedState).toBe('unknown')
  })

  it('"all": unsatisfied wins over unknown', () => {
    const rows = [rowOf('unknown'), rowOf('unsatisfied')]
    expect(rollUpModule({ requirementType: 'all', rows }).derivedState).toBe('unsatisfied')
  })

  it('excludes not_required rows from the rollup', () => {
    const rows = [rowOf('satisfied'), rowOf('not_required'), rowOf('not_required')]
    expect(rollUpModule({ requirementType: 'all', rows }).derivedState).toBe('satisfied')
  })

  it('treats a blocked row as unknown for rollup purposes, never as satisfied or unsatisfied', () => {
    // A blocked row's underlying state is hidden by the block, so the honest
    // rollup contribution is "we do not know".
    expect(
      rollUpModule({ requirementType: 'all', rows: [rowOf('satisfied'), rowOf('blocked')] })
        .derivedState,
    ).toBe('unknown')
    expect(rollUpModule({ requirementType: 'one', rows: [rowOf('blocked')] }).derivedState).toBe(
      'unknown',
    )
  })

  it('is vacuously satisfied with no requirement rows at all', () => {
    // `CompletedRequirementCalculator#all_met?` is `!@any_unmet`, and an empty
    // `completion_requirements` loop never sets `@any_unmet`, so Canvas marks
    // such a module "completed".
    expect(rollUpModule({ requirementType: 'all', rows: [] }).derivedState).toBe('satisfied')
    expect(
      rollUpModule({ requirementType: 'all', rows: [rowOf('not_required')] }).derivedState,
    ).toBe('satisfied')
  })

  it('defaults to "all" when requirement_type is absent', () => {
    const rows = [rowOf('satisfied'), rowOf('unsatisfied')]
    expect(rollUpModule({ rows }).derivedState).toBe('unsatisfied')
  })
})

describe('§4.5 blocked overrides the row rollup, and the rows are still returned', () => {
  it('is blocked when the module state is locked, whatever the rows say', () => {
    const result = rollUpModule({
      requirementType: 'one',
      rows: [rowOf('satisfied')],
      canvasState: 'locked',
    })
    expect(result.derivedState).toBe('blocked')
  })

  it('is blocked on an unsatisfied prerequisite module', () => {
    const result = rollUpModule({
      requirementType: 'all',
      rows: [rowOf('satisfied')],
      prerequisiteUnsatisfied: true,
    })
    expect(result.derivedState).toBe('blocked')
  })
})

describe('§4.5 canvas_state is reported alongside the derived state, and disagreement is flagged', () => {
  it('flags a stale progression: Canvas says completed, the rows do not', () => {
    const result = rollUpModule({
      requirementType: 'all',
      rows: [rowOf('unsatisfied')],
      canvasState: 'completed',
    })
    expect(result.derivedState).toBe('unsatisfied')
    expect(result.canvasState).toBe('completed')
    expect(result.stateDisagreement).toBe(true)
  })

  it('flags the opposite disagreement: the rows are all satisfied, Canvas says started', () => {
    const result = rollUpModule({
      requirementType: 'all',
      rows: [rowOf('satisfied')],
      canvasState: 'started',
    })
    expect(result.derivedState).toBe('satisfied')
    expect(result.stateDisagreement).toBe(true)
  })

  it('does not flag agreement', () => {
    expect(
      rollUpModule({ requirementType: 'all', rows: [rowOf('satisfied')], canvasState: 'completed' })
        .stateDisagreement,
    ).toBe(false)
    expect(
      rollUpModule({ requirementType: 'all', rows: [rowOf('unsatisfied')], canvasState: 'started' })
        .stateDisagreement,
    ).toBe(false)
  })

  it('does not flag anything when canvas_state is absent — there is nothing to compare', () => {
    const result = rollUpModule({ requirementType: 'all', rows: [rowOf('unknown')] })
    expect(result.canvasState).toBeNull()
    expect(result.stateDisagreement).toBe(false)
  })

  it('does not flag an unknown derived state against any canvas_state', () => {
    for (const canvasState of ['locked', 'unlocked', 'started', 'completed']) {
      const result = rollUpModule({ requirementType: 'all', rows: [rowOf('unknown')], canvasState })
      if (canvasState !== 'locked') expect(result.stateDisagreement).toBe(false)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// summary
// ───────────────────────────────────────────────────────────────────────────

describe('summary reports five counts, never one "things left to do" number', () => {
  it('counts every state separately', () => {
    const rows = [
      rowOf('satisfied'),
      rowOf('satisfied'),
      rowOf('unsatisfied'),
      rowOf('unknown'),
      rowOf('blocked'),
      rowOf('not_required'),
    ]
    expect(summarize(rows)).toEqual({
      satisfied: 2,
      unsatisfied: 1,
      unknown: 1,
      blocked: 1,
      not_required: 1,
    })
  })

  it('is all zeros on no rows', () => {
    expect(summarize([])).toEqual({
      satisfied: 0,
      unsatisfied: 0,
      unknown: 0,
      blocked: 0,
      not_required: 0,
    })
  })
})

// ───────────────────────────────────────────────────────────────────────────
// §3.2 / §6.5 — the engine cannot see context, and cannot see a user
// ───────────────────────────────────────────────────────────────────────────

describe('§6.5 no third-party user record can reach a row', () => {
  const REAL_NAME = 'Alice Q. Realname'

  it('projects a user object out of the evidence rather than passing it through', () => {
    const hostile = {
      ...submission({ score: 55 }),
      user: { id: 9, name: REAL_NAME, sortable_name: REAL_NAME, short_name: REAL_NAME },
      user_id: 9,
    } as SubmissionEvidence
    const row = deriveItemRow(
      item({
        requirement: { type: 'min_score', min_score: 70, completed: false },
        submission: hostile,
      }),
    )
    expect(JSON.stringify(row)).not.toContain('Realname')
  })

  it('CONTROL: the name really is in the input, so the sweep above is not looking in the wrong place', () => {
    const hostile = { ...submission(), user: { name: REAL_NAME } } as SubmissionEvidence
    expect(JSON.stringify(hostile)).toContain('Realname')
  })

  it('does not echo a hostile content_details field into the row', () => {
    const row = deriveItemRow(
      item({
        requirement: { type: 'must_view', completed: true },
        contentDetails: { display_name: REAL_NAME, locked_for_user: false },
      }),
    )
    expect(JSON.stringify(row)).not.toContain('Realname')
  })
})

describe('§3.2 `context` is unrepresentable in the evidence the state function reads', () => {
  const SRC = resolve(__dirname, '../../src/tools/requirement-engine.ts')

  function membersOf(text: string, interfaceName: string): string[] {
    const sf = ts.createSourceFile('requirement-engine.ts', text, ts.ScriptTarget.Latest, true)
    const found: string[] = []
    const walk = (node: ts.Node): void => {
      if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
        for (const m of node.members) {
          if ((ts.isPropertySignature(m) || ts.isMethodSignature(m)) && m.name) {
            found.push(m.name.getText(sf))
          }
        }
      }
      ts.forEachChild(node, walk)
    }
    walk(sf)
    return found
  }

  const text = readFileSync(SRC, 'utf8')

  it('finds a non-empty member list (anti-vacuity floor)', () => {
    expect(membersOf(text, 'ItemEvidence').length).toBeGreaterThanOrEqual(4)
    expect(membersOf(text, 'SubmissionEvidence').length).toBeGreaterThanOrEqual(4)
  })

  it('ItemEvidence declares no `context`, `planner` or `plannable` member', () => {
    const members = membersOf(text, 'ItemEvidence')
    for (const banned of ['context', 'planner', 'plannable_date', 'plannable']) {
      expect(members).not.toContain(banned)
    }
  })

  it('SubmissionEvidence declares no user-bearing member', () => {
    const members = membersOf(text, 'SubmissionEvidence')
    for (const banned of [
      'user',
      'user_id',
      'name',
      'sortable_name',
      'short_name',
      'assignment',
      'course',
      'group',
    ]) {
      expect(members).not.toContain(banned)
    }
  })

  it('INJECTION: the member walk fires when a banned member is added', () => {
    const injected = text.replace(
      'export interface SubmissionEvidence {',
      'export interface SubmissionEvidence {\n  user?: { name: string }',
    )
    expect(injected).not.toBe(text)
    expect(membersOf(injected, 'SubmissionEvidence')).toContain('user')
  })

  it('INJECTION: the anti-vacuity floor fires on a tree with no such interface', () => {
    expect(membersOf('export const x = 1', 'SubmissionEvidence')).toEqual([])
  })
})
