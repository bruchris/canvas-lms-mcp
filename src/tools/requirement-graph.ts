// `get_my_course_requirements` — the student course requirement graph.
//
// Stage 3 of four, per §12 PR 3 of
// `docs/superpowers/specs/2026-10-15-bru-2952-student-course-requirement-graph.md`.
// Stage 1 added the types and the two request options; Stage 2 added the pure
// state engine (`./requirement-engine`). This module is the plumbing: the
// bounded fan-out of §5.2, the §5.3 `caller_is_student` gate, the §5.1
// oversized-module recovery, and the output contract.
//
// Two rules this file exists to keep, both of which a later "simplification"
// would break:
//
//  1. **It must never call `getCourseStructure`** (§7.2). That method projects
//     each item to a 9-key allowlist which drops `completion_requirement`, and
//     each module to a 5-key shape which drops `state` / `requirement_type` —
//     i.e. it fetches this tool's entire evidence base and throws it away.
//  2. **`context` can never promote a row** (§3.2). The engine's derive
//     functions take only the evidence subtree, so a planner field is not in
//     scope at the call site where state is decided. `context` is attached to
//     the row *after* `deriveItemRow` has returned; there is no code path by
//     which it can reach a state decision.

import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type {
  CanvasCourse,
  CanvasDiscussionTopic,
  CanvasModule,
  CanvasModuleItem,
  CanvasModuleItemContentDetails,
  CanvasPlannerItem,
  CanvasSubmission,
} from '../canvas/types'
import { type CanvasId, canvasIdInput } from '../canvas/id'
import type { ToolDefinition } from './types'
import { objectOutput } from './output/contract'
import {
  type CheckpointSubmissionEvidence,
  type ItemEvidence,
  type ModuleDerivedState,
  type RequirementRow,
  type SubmissionEvidence,
  type ProvenanceSource,
  PROVENANCE_SOURCES,
  deriveCheckpointRows,
  deriveInitialPostRow,
  deriveItemRow,
  rollUpModule,
  summarize,
} from './requirement-engine'

/** §5.2's module bound. Modules, never items — the §5.1 recovery handles items. */
const DEFAULT_MAX_MODULES = 50
const MAX_MAX_MODULES = 200

/**
 * §5.2's hard cap on the §5.1 recovery path. Past it, the remaining oversized
 * modules are returned with no rows, `items_truncated: true` and a
 * `derived_state` of `unknown` — never a rollup over zero rows, which would read
 * as a vacuously completed module.
 */
const MAX_OVERSIZED_MODULE_RECOVERIES = 10

/** §5.2's cap on the group-child-topic reads of §5.3's group path. */
const MAX_GROUP_TOPIC_READS = 5

/** Planner is `context` only (§1.4), so its own bound is generous and off the critical path. */
const CONTEXT_MAX_PLANNER_ITEMS = 200

/** `Enrollment::SIS_TYPES['StudentEnrollment']`, which is what `course_json` emits. */
const STUDENT_SIS_TYPE = 'student'
/** What the enrollments endpoints emit for the same row. Both forms are accepted. */
const STUDENT_ENROLLMENT_TYPE = 'StudentEnrollment'

/** Module-item `type` values whose `content_id` is an assignment id or resolvable to one. */
const SUBMISSION_EVIDENCE_ITEM_TYPES = ['Assignment', 'Quiz'] as const

/** `PlannerHelper::PLANNABLE_TYPES` keys, by the module-item type they correspond to. */
const PLANNABLE_TYPE_BY_ITEM_TYPE: Readonly<Record<string, string>> = {
  Assignment: 'assignment',
  Quiz: 'quiz',
  Discussion: 'discussion_topic',
  Page: 'wiki_page',
}

// ── Response shape (all of it authored here, therefore all of it strict) ────

// Every closed set below is advertised as `z.string()`, not `z.enum`, and that is
// a decision rather than an oversight. Two reasons, in order of weight:
//
//  1. An enum in an output schema is a PROMISE that the set never grows, and this
//     design's own history is the counter-example: the brief specified five
//     states and §3.1 needed a sixth (`not_required`) before a line was written.
//     A client validating against a five-member enum would then reject the whole
//     call. The vocabularies are documented in the tool description and in
//     `./requirement-engine`'s exported types, where a client can read them
//     without being broken by them.
//  2. `tests/tools/output-contract.test.ts` bans `enum` (alongside `format`,
//     `pattern` and the length/range keywords) anywhere in an advertised output
//     schema. `requirement_type` makes the ban's stated reason literally true
//     here: it is Canvas's own derived value, so pinning it to `all | one` would
//     be a constraint on data this server does not produce.
//
// `PROVENANCE_SOURCES` is still imported, as the compile-time check that this
// file's own notion of the source vocabulary cannot drift from the engine's.
const _PROVENANCE_SOURCES_ARE_THE_ENGINE_S: readonly ProvenanceSource[] = PROVENANCE_SOURCES
void _PROVENANCE_SOURCES_ARE_THE_ENGINE_S

const provenanceSchema = z.strictObject({
  source: z.string(),
  endpoint: z.string(),
  field: z.string(),
  caveat: z.string().nullable(),
})

const requirementSchema = z.strictObject({
  type: z.string(),
  min_score: z.number().optional(),
  min_percentage: z.number().optional(),
})

const rowItemSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  content_id: z.string().nullable(),
  html_url: z.string().nullable(),
  position: z.number().nullable(),
})

const rowDatesSchema = z.strictObject({
  due_at: z.string().nullable(),
  unlock_at: z.string().nullable(),
  lock_at: z.string().nullable(),
})

/**
 * §3.2's `context`. Strict like the rest, because this handler chooses every key
 * it copies — except `submissions`, which is Canvas's own `submission_status`
 * union (`false` or an object it extends freely) and so is left unconstrained.
 */
const rowContextSchema = z.strictObject({
  plannable_type: z.string().nullable(),
  plannable_date: z.string().nullable(),
  submissions: z.unknown().nullish(),
})

const rowSchema = z.strictObject({
  item: rowItemSchema.nullable(),
  state: z.string(),
  requirement: requirementSchema.nullable(),
  provenance: provenanceSchema,
  counts_toward_module: z.boolean(),
  dates: rowDatesSchema.nullable(),
  locked_for_user: z.boolean().nullable(),
  lock_explanation: z.string().nullable(),
  context: rowContextSchema.nullable(),
})

const moduleSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  position: z.number().nullable(),
  requirement_type: z.string(),
  requirement_count: z.number().nullable(),
  canvas_state: z.string().nullable(),
  derived_state: z.string(),
  state_disagreement: z.boolean(),
  items_truncated: z.boolean(),
  rows: z.array(rowSchema),
})

export const courseRequirementGraphSchema = z.strictObject({
  course_id: z.string(),
  course_name: z.string().nullable(),
  caller_is_student: z.boolean(),
  modules: z.array(moduleSchema),
  summary: z.strictObject({
    satisfied: z.number(),
    unsatisfied: z.number(),
    unknown: z.number(),
    blocked: z.number(),
    not_required: z.number(),
  }),
  truncated: z.boolean(),
  truncation_note: z.string().nullable(),
  notes: z.array(z.string()),
})

type GraphRow = z.infer<typeof rowSchema>
type GraphModule = z.infer<typeof moduleSchema>

// ── Internals ──────────────────────────────────────────────────────────────

/**
 * §5.3's gate, resolved from the course read itself.
 *
 * `CoursesController#show` always passes
 * `@course.current_enrollments.where(user_id: @current_user)` to `course_json`,
 * and `CourseJson#to_hash` sets `hash["enrollments"]` unconditionally
 * (`clear_unneeded_fields` drops it only when it is `nil`). So one
 * `GET /api/v1/courses/:id` answers both "what is this course called" and "is the
 * caller a student in it" — no second request.
 *
 * Two shapes of the same field: `default_enrollment_attributes` emits
 * `type: enrollment.sis_type` (`'student'`), whereas the enrollments endpoints
 * emit the class name (`'StudentEnrollment'`). Both are accepted so this does not
 * depend on which endpoint fed the object.
 *
 * `Enrollment.sis_type` falls back to `'student'` for any type outside
 * `SIS_TYPES`, which is why a non-active student row is reported in `notes`
 * rather than silently treated as a student: `participate_as_student` — the right
 * `find_student` grants — needs an active enrollment.
 */
function resolveCallerIsStudent(course: CanvasCourse): {
  callerIsStudent: boolean
  note: string | null
} {
  const enrollments = course.enrollments
  if (enrollments === undefined) {
    return {
      callerIsStudent: false,
      note:
        'The course response carried no `enrollments`, so this server could not confirm the ' +
        'caller is a student. Discussion initial-post rows are reported as `unknown` rather ' +
        'than derived — see each row’s provenance caveat.',
    }
  }
  const studentRows = enrollments.filter(
    (e) => e.type === STUDENT_SIS_TYPE || e.type === STUDENT_ENROLLMENT_TYPE,
  )
  const active = studentRows.filter((e) => e.enrollment_state === 'active')
  if (active.length > 0) return { callerIsStudent: true, note: null }
  if (studentRows.length > 0) {
    return {
      callerIsStudent: false,
      note:
        'The caller has a student enrollment in this course but it is not active (states: ' +
        `${studentRows.map((e) => e.enrollment_state).join(', ')}). Canvas gates the module ` +
        'progression on `participate_as_student`, which an inactive or invited enrollment does ' +
        'not grant, so requirement states will largely be `unknown`.',
    }
  }
  return {
    callerIsStudent: false,
    note:
      'The caller is not an active student in this course, so Canvas loads no module ' +
      'progression: `completion_requirement.completed` is absent on every item and the rows ' +
      'below are `unknown` rather than unsatisfied. This tool has no `student_id` parameter by ' +
      'design — it reports the calling user’s own requirements only.',
  }
}

/**
 * §4.1/§4.2's evidence, projected to the six fields the engine reads.
 *
 * `points_possible` prefers the submission's own assignment over
 * `content_details.points_possible`, because §5.5's truthiness guard omits the
 * latter when it is `0` — so the assignment is the only source that can tell
 * "zero points" apart from "field withheld", and §12.2's `min_percentage` corner
 * turns on exactly that distinction.
 */
function submissionEvidence(
  sub: CanvasSubmission,
  contentDetails: CanvasModuleItemContentDetails | null,
): SubmissionEvidence {
  return {
    workflow_state: sub.workflow_state,
    attempt: sub.attempt ?? null,
    score: sub.score ?? null,
    posted_at: sub.posted_at ?? null,
    excused: sub.excused ?? null,
    points_possible: sub.assignment?.points_possible ?? contentDetails?.points_possible ?? null,
  }
}

/** The 17-key slice of `sub_assignment_submission_json`, keyed by `sub_assignment_tag`. */
interface RawSubAssignmentSubmission {
  sub_assignment_tag?: string | null
  submitted_at?: string | null
  score?: number | null
  excused?: boolean | null
}

function checkpointEvidence(
  raw: RawSubAssignmentSubmission | undefined,
): CheckpointSubmissionEvidence | null | undefined {
  if (raw === undefined) return undefined
  return {
    submitted_at: raw.submitted_at ?? null,
    score: raw.score ?? null,
    excused: raw.excused ?? null,
  }
}

function dates(contentDetails: CanvasModuleItemContentDetails | null): GraphRow['dates'] {
  if (contentDetails === null) return null
  return {
    due_at: contentDetails.due_at ?? null,
    unlock_at: contentDetails.unlock_at ?? null,
    lock_at: contentDetails.lock_at ?? null,
  }
}

function itemOf(item: CanvasModuleItem): GraphRow['item'] {
  return {
    id: String(item.id),
    title: item.title,
    type: item.type,
    content_id: item.content_id === undefined ? null : String(item.content_id),
    html_url: item.html_url ?? null,
    position: typeof item.position === 'number' ? item.position : null,
  }
}

/**
 * Wrap an engine row for the wire. The engine row's three fields are spread
 * verbatim; everything else is presentation attached afterwards, which is the
 * mechanism behind the §3.2 invariant — `context` arrives here, after the state
 * decision, and the engine never sees it.
 */
function wrapRow(
  row: RequirementRow,
  item: CanvasModuleItem,
  contentDetails: CanvasModuleItemContentDetails | null,
  countsTowardModule: boolean,
  context: GraphRow['context'],
): GraphRow {
  return {
    item: itemOf(item),
    state: row.state,
    requirement: row.requirement,
    provenance: row.provenance,
    counts_toward_module: countsTowardModule,
    dates: dates(contentDetails),
    locked_for_user:
      contentDetails === null || contentDetails.locked_for_user === undefined
        ? null
        : contentDetails.locked_for_user,
    lock_explanation: contentDetails?.lock_explanation ?? null,
    context,
  }
}

/**
 * Whether every prerequisite of `mod` is satisfied, read from **Canvas's own**
 * module states rather than from this tool's rollup.
 *
 * Deliberately not circular: using our own rollup would make a `blocked` row
 * depend on a rollup that depends on `blocked` rows. Canvas's progression
 * `state` is the fact, and `undefined` — not `false` — is the answer when a
 * prerequisite's state is absent (no progression was loaded, §1.3) or the
 * prerequisite module fell outside `max_modules`.
 */
function prerequisiteUnsatisfied(
  mod: CanvasModule,
  stateById: ReadonlyMap<string, string | undefined>,
): boolean | undefined {
  const ids = mod.prerequisite_module_ids
  if (ids === undefined || ids.length === 0) return false
  const states = ids.map((id) => stateById.get(String(id)))
  if (states.some((s) => s === undefined || s === null || s === '')) return undefined
  return states.some((s) => s !== 'completed')
}

const MODULES_WITH_ITEMS_ENDPOINT = (courseId: CanvasId): string =>
  `/api/v1/courses/${courseId}/modules?include[]=items&include[]=content_details`

const MODULE_ITEMS_ENDPOINT = (courseId: CanvasId, moduleId: CanvasId): string =>
  `/api/v1/courses/${courseId}/modules/${moduleId}/items?include[]=content_details`

const TOPICS_ENDPOINT = (courseId: CanvasId): string =>
  `/api/v1/courses/${courseId}/discussion_topics`

const GROUP_TOPIC_ENDPOINT = (groupId: CanvasId, topicId: CanvasId): string =>
  `/api/v1/groups/${groupId}/discussion_topics/${topicId}`

const SUBMISSIONS_ENDPOINT = (courseId: CanvasId): string =>
  `/api/v1/courses/${courseId}/students/submissions?student_ids[]=self` +
  '&include[]=assignment&include[]=sub_assignment_submissions'

export function requirementGraphTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'get_my_course_requirements',
      title: 'Get My Course Requirements',
      description:
        'What the authenticated student still has to DO in one course: a per-module ' +
        'requirement graph where every row names the Canvas endpoint and field its verdict ' +
        'came from. Richer than list_modules plus list_module_items, which return a raw ' +
        '`completion_requirement` without the cross-references that make it truthful; for ' +
        'grade outcomes use project_grade or explain_grade instead, and for cross-course ' +
        'context list_my_planner_items. Five things to read before acting on the output: ' +
        '(1) `unknown` is a real state and is NOT "unsatisfied" — Canvas attaches ' +
        '`completion_requirement.completed` only where it loaded a module progression, which ' +
        'happens only for a student caller, so an educator or admin token gets `unknown` on ' +
        'every row rather than a course full of incomplete work. (2) A module with ' +
        '`requirement_type: "one"` is COMPLETE as soon as any single requirement is met, so ' +
        'counting its unsatisfied rows invents work. (3) `summary` gives five counts and never ' +
        'one "things left to do" number: that number cannot be computed honestly across mixed ' +
        '`requirement_type` values and a non-zero `unknown` count. (4) Numeric threshold rows ' +
        'are re-evaluated by Canvas on every pass and can revert from met to unmet with no ' +
        'student action (a regrade, a posting-policy change); the other four requirement types ' +
        'latch. (5) `canvas_state` and `derived_state` are both reported and a mismatch is ' +
        'flagged in `state_disagreement` rather than resolved. Read-only and current-user-only: ' +
        'no student_id parameter, no attempt started, no LTI launch, nothing marked as viewed ' +
        'or done.',
      inputSchema: {
        course_id: canvasIdInput().describe('Canvas course ID.'),
        include_discussions: z
          .boolean()
          .optional()
          .describe(
            'Add the discussion obligations that are not module completion requirements: the ' +
              '`require_initial_post` row (derived from the topic’s `require_initial_post` and ' +
              '`user_can_see_posts`, valid only for a student caller) and the two rows of a ' +
              'checkpointed discussion. Default true. Costs one course-level discussions call, ' +
              'plus one call per group the student owns a child topic in.',
          ),
        include_context: z
          .boolean()
          .optional()
          .describe(
            'Attach planner context (`plannable_date`, submission status) to each row. ' +
              'Default false. Context NEVER changes a row’s state — it is attached after the ' +
              'state is decided. Note Canvas’s planner defaults to a ~2-week window, so most ' +
              'rows will have `context: null` even with this on.',
          ),
        max_modules: z
          .number()
          .int()
          .positive()
          .max(MAX_MAX_MODULES)
          .optional()
          .describe(
            `Maximum modules to walk (default ${DEFAULT_MAX_MODULES}, maximum ` +
              `${MAX_MAX_MODULES}). When the limit is reached, \`truncated\` is true and ` +
              '`truncation_note` says what to change.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      audience: 'student',
      output: objectOutput(courseRequirementGraphSchema),
      handler: async (params) => {
        const courseId = params.course_id as CanvasId
        const includeDiscussions = (params.include_discussions as boolean | undefined) ?? true
        const includeContext = (params.include_context as boolean | undefined) ?? false
        const maxModules = (params.max_modules as number | undefined) ?? DEFAULT_MAX_MODULES
        const notes: string[] = []

        // ── 1. Course name and the §5.3 gate, in one request.
        const course = await canvas.courses.get(courseId)
        const { callerIsStudent, note: enrollmentNote } = resolveCallerIsStudent(course)
        if (enrollmentNote !== null) notes.push(enrollmentNote)

        // ── 2. Modules with items and content_details.
        //
        // One module past the limit, deliberately: `paginate()` reports how many
        // items it accumulated, never whether more were waiting, so asking for
        // exactly `maxModules` makes "there are exactly that many" and "there are
        // more" indistinguishable and `truncated` unknowable.
        const fetchedModules = await canvas.modules.listWithItems(courseId, {
          contentDetails: true,
          maxItems: maxModules + 1,
        })
        const truncated = fetchedModules.length > maxModules
        const modules = truncated ? fetchedModules.slice(0, maxModules) : fetchedModules

        // ── 3. §5.1 recovery. `include[]=items` is served only when
        // `count <= Api::MAX_PER_PAGE` (100), and a module past that comes back
        // with NO `items` key — not a truncated array, not an error. So the test
        // is `items.length !== items_count`, never `items ?? []`: an `items: []`
        // module with `items_count: 0` is a genuinely empty module and takes the
        // other branch, because `[]` is truthy.
        const itemsByModule = new Map<string, CanvasModuleItem[] | null>()
        const endpointByModule = new Map<string, string>()
        let recoveries = 0
        for (const mod of modules) {
          const key = String(mod.id)
          const inlined = mod.items
          const expected = typeof mod.items_count === 'number' ? mod.items_count : null
          if (inlined !== undefined && expected !== null && inlined.length === expected) {
            itemsByModule.set(key, inlined)
            endpointByModule.set(key, MODULES_WITH_ITEMS_ENDPOINT(courseId))
            continue
          }
          if (recoveries >= MAX_OVERSIZED_MODULE_RECOVERIES) {
            itemsByModule.set(key, null)
            endpointByModule.set(key, MODULE_ITEMS_ENDPOINT(courseId, mod.id))
            continue
          }
          recoveries += 1
          const recovered = await canvas.modules.listItems(courseId, mod.id, {
            contentDetails: true,
          })
          itemsByModule.set(key, recovered)
          endpointByModule.set(key, MODULE_ITEMS_ENDPOINT(courseId, mod.id))
          notes.push(
            `Module ${key} ("${mod.name}") inlined ${
              inlined === undefined ? 'no' : String(inlined.length)
            } of ${expected === null ? 'an unstated number of' : String(expected)} items, so its ` +
              'items were re-read from the paginating per-module endpoint. Canvas omits the ' +
              '`items` key entirely for a module with more than 100 items.',
          )
        }
        if (recoveries >= MAX_OVERSIZED_MODULE_RECOVERIES) {
          const unresolved = [...itemsByModule.values()].filter((v) => v === null).length
          if (unresolved > 0) {
            notes.push(
              `${String(unresolved)} module(s) needed the per-module item re-read but the ` +
                `per-call cap of ${String(MAX_OVERSIZED_MODULE_RECOVERIES)} was already spent. ` +
                'Those modules are returned with no rows, `items_truncated: true` and a ' +
                '`derived_state` of `unknown`. Narrow `max_modules` and call again to reach them.',
            )
          }
        }

        const allItems = modules.flatMap((mod) => itemsByModule.get(String(mod.id)) ?? [])

        // ── 4. Discussion topics. One course-level call, and only when a
        // Discussion item is actually present — never one call per topic.
        const topicsById = new Map<string, CanvasDiscussionTopic>()
        const hasDiscussionItem = allItems.some((i) => i.type === 'Discussion')
        if (includeDiscussions && hasDiscussionItem) {
          for (const topic of await canvas.discussions.list(courseId)) {
            topicsById.set(String(topic.id), topic)
          }
        }

        // ── 5. §5.3's group path. A per-group discussion's obligation lives on
        // the CHILD topic the student's own group owns; the root topic's
        // `user_can_see_posts` describes the root. Resolved through
        // `/users/self/groups`, not `/courses/:id/groups` — the latter is gated on
        // `:read_roster` and returns every group in the course, so a student with
        // roster access would read back groups they are not in and this would
        // attribute another group's child topic to them.
        const childTopicByRoot = new Map<string, CanvasDiscussionTopic | null>()
        const groupRoots = [...topicsById.values()].filter(
          (t) => (t.group_topic_children ?? []).length > 0,
        )
        if (groupRoots.length > 0) {
          const myGroupIds = new Set(
            (await canvas.groups.listMine({ contextType: 'Course' }))
              .filter((g) => g.course_id !== undefined && String(g.course_id) === String(courseId))
              .map((g) => String(g.id)),
          )
          let groupReads = 0
          for (const root of groupRoots) {
            const child = (root.group_topic_children ?? []).find((c) =>
              myGroupIds.has(String(c.group_id)),
            )
            if (child === undefined) {
              childTopicByRoot.set(String(root.id), null)
              continue
            }
            if (groupReads >= MAX_GROUP_TOPIC_READS) {
              notes.push(
                `The per-call cap of ${String(MAX_GROUP_TOPIC_READS)} group child-topic reads ` +
                  'was reached, so some per-group discussions are reported as `unknown`.',
              )
              break
            }
            groupReads += 1
            childTopicByRoot.set(
              String(root.id),
              await canvas.discussions.getForGroup(child.group_id, child.id),
            )
          }
        }

        // ── 6. Submissions. §5.2: ONE call for the whole course, and skipped
        // entirely unless something actually needs it. Two conditions:
        //
        //  - an unsatisfied numeric requirement on an Assignment or Quiz item,
        //    where §4.2 cannot tell an unposted grade from a below-threshold one
        //    without the student's own submission; and
        //  - a checkpointed discussion, whose two sub-assignment submissions ride
        //    on the parent submission under `include[]=sub_assignment_submissions`.
        //
        // Submission evidence is attached ONLY to Assignment and Quiz items. A
        // Discussion item's `content_id` is the TOPIC id, not an assignment id, so
        // joining it to a submission needs the topic — and §4.4 says to report
        // Canvas's own `must_submit` verdict verbatim rather than re-deriving it.
        const checkpointTopicIds = new Set(
          [...topicsById.values()]
            .filter((t) => t.is_checkpointed === true)
            .map((t) => String(t.id)),
        )
        const needsNumericEvidence = allItems.some((item) => {
          if (!(SUBMISSION_EVIDENCE_ITEM_TYPES as readonly string[]).includes(item.type)) {
            return false
          }
          const req = item.completion_requirement
          if (req === undefined) return false
          return (
            (req.type === 'min_score' || req.type === 'min_percentage') && req.completed === false
          )
        })
        const needsCheckpointEvidence = allItems.some(
          (item) =>
            item.type === 'Discussion' &&
            item.content_id !== undefined &&
            checkpointTopicIds.has(String(item.content_id)),
        )

        const submissionByAssignmentId = new Map<string, CanvasSubmission>()
        const submissionByQuizId = new Map<string, CanvasSubmission>()
        let submissionsLoaded = false
        if (needsNumericEvidence || needsCheckpointEvidence) {
          submissionsLoaded = true
          // `include[]=assignment` is what makes a Quiz item joinable: a Quiz
          // module item's `content_id` is the QUIZ id, while a submission is keyed
          // by `assignment_id`. The assignment carries `quiz_id`, so this stays one
          // request rather than a second assignments walk.
          const submissions = await canvas.submissions.listMy(courseId, {
            include: ['assignment', 'sub_assignment_submissions'],
          })
          for (const sub of submissions) {
            submissionByAssignmentId.set(String(sub.assignment_id), sub)
            const quizId = sub.assignment?.quiz_id
            if (quizId !== undefined && quizId !== null) {
              submissionByQuizId.set(String(quizId), sub)
            }
          }
        }

        // ── 7. Planner context (§3.2), opt-in and off the critical path.
        const contextByKey = new Map<string, GraphRow['context']>()
        if (includeContext) {
          const plannerItems: CanvasPlannerItem[] = await canvas.planner.listItems({
            contextCodes: [`course_${String(courseId)}`],
            maxItems: CONTEXT_MAX_PLANNER_ITEMS,
          })
          for (const planner of plannerItems) {
            contextByKey.set(`${planner.plannable_type}:${String(planner.plannable_id)}`, {
              plannable_type: planner.plannable_type,
              plannable_date: planner.plannable_date ?? null,
              submissions: planner.submissions,
            })
          }
        }

        function contextFor(item: CanvasModuleItem): GraphRow['context'] {
          if (!includeContext || item.content_id === undefined) return null
          const plannableType = PLANNABLE_TYPE_BY_ITEM_TYPE[item.type]
          if (plannableType === undefined) return null
          return contextByKey.get(`${plannableType}:${String(item.content_id)}`) ?? null
        }

        function submissionFor(
          item: CanvasModuleItem,
        ): { submission: SubmissionEvidence | null } | Record<string, never> {
          // An ABSENT key, not `null`: absent means "not looked up", which makes
          // §4.2 unavailable and an unsatisfied numeric row `unknown`. `null` means
          // "looked up, the student has none", which is positive evidence of
          // unsatisfied. Collapsing the two is §1.3's mistake one layer out.
          if (!submissionsLoaded) return {}
          if (!(SUBMISSION_EVIDENCE_ITEM_TYPES as readonly string[]).includes(item.type)) return {}
          if (item.content_id === undefined) return {}
          const key = String(item.content_id)
          const sub =
            item.type === 'Quiz' ? submissionByQuizId.get(key) : submissionByAssignmentId.get(key)
          return {
            submission:
              sub === undefined ? null : submissionEvidence(sub, item.content_details ?? null),
          }
        }

        // ── 8. Rows.
        const canvasStateById = new Map<string, string | undefined>(
          modules.map((mod) => [String(mod.id), mod.state]),
        )
        const graphModules: GraphModule[] = []
        const everyRow: RequirementRow[] = []

        for (const mod of modules) {
          const key = String(mod.id)
          const items = itemsByModule.get(key)
          const endpoint = endpointByModule.get(key) ?? MODULES_WITH_ITEMS_ENDPOINT(courseId)
          const prereq = prerequisiteUnsatisfied(mod, canvasStateById)
          const rows: GraphRow[] = []
          // The engine rows are kept alongside the wire rows rather than
          // reconstructed from them. Reconstructing would mean widening the wire
          // row's `state`/`source` enums back to the engine's unions, i.e. a cast,
          // and a cast here is a place for the two shapes to disagree silently.
          const engineRows: RequirementRow[] = []
          const moduleRequirementRows: RequirementRow[] = []
          const push = (
            row: RequirementRow,
            item: CanvasModuleItem,
            contentDetails: CanvasModuleItemContentDetails | null,
            countsTowardModule: boolean,
            context: GraphRow['context'],
          ): void => {
            rows.push(wrapRow(row, item, contentDetails, countsTowardModule, context))
            engineRows.push(row)
            if (countsTowardModule) moduleRequirementRows.push(row)
          }

          for (const item of items ?? []) {
            const contentDetails = item.content_details ?? null
            const evidence: ItemEvidence = {
              itemType: item.type,
              endpoint,
              requirement: item.completion_requirement ?? null,
              contentDetails,
              module: {
                state: mod.state ?? null,
                ...(prereq === undefined ? {} : { prerequisiteUnsatisfied: prereq }),
                ...(mod.require_sequential_progress === undefined
                  ? {}
                  : { requireSequentialProgress: mod.require_sequential_progress }),
              },
              ...submissionFor(item),
            }
            const context = contextFor(item)
            push(deriveItemRow(evidence), item, contentDetails, true, context)

            if (!includeDiscussions || item.type !== 'Discussion') continue
            const rootTopic =
              item.content_id === undefined ? undefined : topicsById.get(String(item.content_id))
            if (rootTopic === undefined) continue

            // A per-group discussion's obligation is on the child topic, so the
            // root's own two fields are not the student's evidence. Where the
            // child could not be resolved, the fields are withheld and the engine
            // reports `unknown` rather than reading the root's.
            const isGroupRoot = (rootTopic.group_topic_children ?? []).length > 0
            const resolvedTopic = isGroupRoot
              ? childTopicByRoot.get(String(rootTopic.id))
              : rootTopic
            const topicEndpoint =
              isGroupRoot && resolvedTopic != null
                ? GROUP_TOPIC_ENDPOINT(
                    (rootTopic.group_topic_children ?? []).find(
                      (c) => String(c.id) === String(resolvedTopic.id),
                    )?.group_id ?? '',
                    resolvedTopic.id,
                  )
                : TOPICS_ENDPOINT(courseId)

            const initialPost = deriveInitialPostRow({
              endpoint: topicEndpoint,
              callerIsStudent,
              ...(resolvedTopic == null
                ? {}
                : {
                    ...(resolvedTopic.require_initial_post === undefined
                      ? {}
                      : { requireInitialPost: resolvedTopic.require_initial_post }),
                    ...(resolvedTopic.user_can_see_posts === undefined
                      ? {}
                      : { userCanSeePosts: resolvedTopic.user_can_see_posts }),
                  }),
            })
            push(initialPost, item, contentDetails, false, context)

            if (rootTopic.is_checkpointed !== true) continue
            const parent =
              rootTopic.assignment_id == null
                ? undefined
                : submissionByAssignmentId.get(String(rootTopic.assignment_id))
            const subs = (parent as { sub_assignment_submissions?: RawSubAssignmentSubmission[] })
              ?.sub_assignment_submissions
            const byTag = (tag: string): RawSubAssignmentSubmission | undefined =>
              subs?.find((s) => s.sub_assignment_tag === tag)
            const checkpointRows = deriveCheckpointRows({
              endpoint: SUBMISSIONS_ENDPOINT(courseId),
              ...(typeof rootTopic.reply_to_entry_required_count === 'number'
                ? { replyToEntryRequiredCount: rootTopic.reply_to_entry_required_count }
                : {}),
              // Absent when the parent submission was never read, which the engine
              // reports as `unknown`. Present-but-missing-tag is `null`.
              ...(subs === undefined
                ? {}
                : {
                    replyToTopicSubmission: checkpointEvidence(byTag('reply_to_topic')) ?? null,
                    replyToEntrySubmission: checkpointEvidence(byTag('reply_to_entry')) ?? null,
                  }),
            })
            for (const cp of checkpointRows) {
              push(cp, item, contentDetails, false, context)
            }
          }

          const rollup = rollUpModule({
            ...(mod.requirement_type === undefined
              ? {}
              : { requirementType: mod.requirement_type }),
            rows: moduleRequirementRows,
            canvasState: mod.state ?? null,
            ...(prereq === true ? { prerequisiteUnsatisfied: true } : {}),
          })

          // A module whose items could not be read has no rows to roll up, and
          // `rollUpModule` reads zero requirement rows as a vacuously satisfied
          // module (which is correct for a module that genuinely has none). Here it
          // would assert completion from an absence of evidence, so the rollup is
          // overridden rather than consulted.
          const itemsUnavailable = items === null || items === undefined
          const derivedState: ModuleDerivedState = itemsUnavailable
            ? 'unknown'
            : rollup.derivedState

          graphModules.push({
            id: key,
            name: mod.name,
            position: typeof mod.position === 'number' ? mod.position : null,
            requirement_type: mod.requirement_type ?? 'all',
            requirement_count: mod.requirement_count ?? null,
            canvas_state: rollup.canvasState,
            derived_state: derivedState,
            state_disagreement: itemsUnavailable ? false : rollup.stateDisagreement,
            items_truncated: itemsUnavailable,
            rows,
          })
          everyRow.push(...engineRows)
        }

        return {
          course_id: String(courseId),
          course_name: course.name ?? null,
          caller_is_student: callerIsStudent,
          modules: graphModules,
          summary: summarize(everyRow),
          truncated,
          truncation_note: truncated
            ? `Stopped after max_modules (${String(maxModules)}) modules; this course has more. ` +
              `Raise max_modules (maximum ${String(MAX_MAX_MODULES)}).`
            : null,
          notes,
        }
      },
    },
  ]
}
