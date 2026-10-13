// Pseudonymizer — opt-in, server-side replacement of student PII in tool output.
//
// Tamper-resistant: the on/off decision is made from `process.env` only, never
// from tool arguments, MCP request fields, or HTTP headers.
//
// Stable: each Canvas user_id maps to the same `Student N` for the lifetime of
// the course's pseudonym file. Re-enrollment restores the original pseudonym;
// dropped students are marked `historical` and their slot is NEVER reused.
//
// See `docs/superpowers/specs/2026-05-25-ferpa-pseudonymization.md` for the
// full threat model and rationale.

import type { CanvasId } from '../canvas/id'
import type {
  CanvasActivityStreamEntry,
  CanvasActivityStreamRootEntry,
  CanvasAppointmentGroup,
  CanvasCalendarEvent,
  CanvasConversation,
  CanvasConversationDetail,
  CanvasEnrollment,
  CanvasOutcomeResultsResponse,
  CanvasOutcomeRollupsResponse,
  CanvasPlannerItem,
  CanvasSubmission,
  CanvasSubmissionComment,
  CanvasSubmissionDiscussionEntry,
  CanvasUser,
  CanvasUserDisplay,
} from '../canvas/types'
import { isEnvTruthy } from '../env'
import { conversationsFilePath, mapFilePath, normalizeHost, resolvePseudonymDir } from './paths'
import { classifyRole, shouldPseudonymize, type Role } from './roles'
import {
  emptyConversationMap,
  emptyCourseMap,
  loadMap,
  saveMap,
  type ConversationMap,
  type CourseMap,
  type StudentEntry,
} from './store'

/**
 * Pseudonym scope for an activity-stream item that carries neither `course_id`
 * nor `group_id`. Unreachable on a well-formed response — every name-bearing
 * arm of `stream_item_json` has a context — and it exists so that an
 * unexpected shape fails CLOSED (a pseudonym from an isolated bucket) rather
 * than open (a real name). Distinct from any course and from any
 * `_group_<id>` / `_apptgrp_<id>` scope, so no identity map is ever merged.
 */
const STREAM_NO_CONTEXT_SCOPE = '_stream_nocontext'

/**
 * Replacement for `author_name` on a `DiscussionEntry` activity-stream item.
 *
 * The serializer emits that name with no identifier anywhere in the item, so
 * there is nothing to key a stable pseudonym on — and inventing one keyed by
 * the name itself would write real names into the on-disk map as keys. A fixed
 * literal is the honest encoding: it says the name was withheld rather than
 * implying a `Student N` the caller could correlate.
 */
export const WITHHELD_AUTHOR_NAME = 'Author name withheld'

export interface PseudonymizerConfig {
  /** Canvas base URL — used to key the per-host map directory. */
  baseUrl: string
  /** Root directory for map files. Defaults to platform/XDG location. */
  rootDir?: string
  /** Env reader; defaults to `process.env`. Injection point for tests. */
  env?: NodeJS.ProcessEnv
  /** Audit log writer for `resolve_pseudonym` calls; defaults to `console.error`. */
  auditLog?: (line: string) => void
  /**
   * True when this instance is shared by callers that authenticate with
   * **different** Canvas credentials — i.e. the HTTP transport, where one
   * process-wide map is read and written on behalf of every caller.
   *
   * Reverse lookup is then permanently unavailable on this instance, whatever
   * `CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP` says. The map is seeded by whichever
   * caller happened to fetch a roster first and `resolve_pseudonym` performs no
   * Canvas-side authorization, so honouring the flag would let an unrelated
   * caller recover a real `user_id` that only the seeding caller's token could
   * legitimately have produced (BRU-2511).
   *
   * The caller states a fact about its deployment; the policy is derived here,
   * so "shared instance with reverse lookup on" is not representable.
   */
  sharedAcrossCallers?: boolean
}

export interface ReverseLookupResult {
  user_id: number
  pseudonym: string
  status: 'active' | 'historical'
}

/**
 * Result of the pseudonymizer's per-request status check. The fields here are
 * the inputs the tool-response wrapper needs to attach `_meta.pseudonymized`.
 */
export interface PseudonymizationStatus {
  enabled: boolean
  reverseLookupEnabled: boolean
}

/**
 * Single-process pseudonymizer. One instance per running server. Construct
 * once at startup and re-use across requests; an HTTP server that creates a
 * fresh MCP server per request still shares this singleton — and must say so
 * with `sharedAcrossCallers: true`, which disables reverse lookup on the
 * instance (BRU-2511).
 */
export class Pseudonymizer {
  private readonly host: string | null
  private readonly rootDir: string
  private readonly env: NodeJS.ProcessEnv
  private readonly auditLog: (line: string) => void

  /**
   * See `PseudonymizerConfig.sharedAcrossCallers`. Public so a transport can
   * assert the arrangement it built rather than trusting it.
   */
  readonly sharedAcrossCallers: boolean

  // In-memory caches of loaded maps, keyed by `<host>/<courseId>` or
  // `<host>/_conversations`. Loaded lazily; written through on mutation.
  private readonly courseMaps = new Map<string, CourseMap>()
  private readonly conversationMaps = new Map<string, ConversationMap>()

  // Per-target async locks. A second mutator awaits the prior promise so that
  // pseudonym allocation cannot race within a single Node process. Cross-
  // process concurrency falls back to last-writer-wins (documented).
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(config: PseudonymizerConfig) {
    this.host = normalizeHost(config.baseUrl)
    this.rootDir = config.rootDir ?? resolvePseudonymDir({ env: config.env })
    this.env = config.env ?? process.env
    this.auditLog = config.auditLog ?? ((line) => console.error(line))
    this.sharedAcrossCallers = config.sharedAcrossCallers ?? false
  }

  /**
   * True when `CANVAS_PSEUDONYMIZE_STUDENTS` is set to a truthy value. Read
   * from env on every call so that test setup can flip the flag mid-process.
   */
  isEnabled(): boolean {
    return isEnvTruthy(this.env.CANVAS_PSEUDONYMIZE_STUDENTS)
  }

  /**
   * True when reverse lookup is enabled. Only meaningful when `isEnabled()`.
   *
   * Always false on a `sharedAcrossCallers` instance — this is what keeps
   * `resolve_pseudonym` out of `tools/list` on the HTTP transport, which is
   * strictly stronger than registering it and erroring: the MCP protocol layer
   * refuses the call before it reaches us.
   */
  isReverseLookupEnabled(): boolean {
    if (this.sharedAcrossCallers) return false
    return this.isEnabled() && isEnvTruthy(this.env.CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP)
  }

  status(): PseudonymizationStatus {
    return {
      enabled: this.isEnabled(),
      reverseLookupEnabled: this.isReverseLookupEnabled(),
    }
  }

  /**
   * Pseudonymize a single user when classified as student/unknown. Staff and
   * unknown-host (unparseable base URL) calls pass through unchanged.
   */
  async anonymizeUser(
    courseId: number | string,
    user: CanvasUser,
    enrollments?: ReadonlyArray<CanvasEnrollment>,
  ): Promise<CanvasUser> {
    if (!this.isEnabled() || !this.host) return user
    const role = classifyRole(user, enrollments)
    if (!shouldPseudonymize(role)) return user
    const entry = await this.assignPseudonym(this.host, courseId, user.id)
    return applyPseudonymToUser(user, entry.pseudonym)
  }

  async anonymizeUsers(
    courseId: number | string,
    users: ReadonlyArray<CanvasUser>,
  ): Promise<CanvasUser[]> {
    if (!this.isEnabled() || !this.host) return [...users]
    const out: CanvasUser[] = []
    for (const u of users) {
      out.push(await this.anonymizeUser(courseId, u))
    }
    return out
  }

  /**
   * Pseudonymize an enrollment in place: scrubs `sis_user_id` and rewrites
   * the embedded `user` when present.
   */
  async anonymizeEnrollment(
    courseId: number | string,
    enrollment: CanvasEnrollment,
  ): Promise<CanvasEnrollment> {
    if (!this.isEnabled() || !this.host) return enrollment
    const role = enrollment.user
      ? classifyRole(enrollment.user, [enrollment])
      : classifyRoleFromEnrollment(enrollment)
    if (!shouldPseudonymize(role)) return enrollment

    const out: CanvasEnrollment = { ...enrollment, sis_user_id: null }
    if (enrollment.user) {
      const entry = await this.assignPseudonym(this.host, courseId, enrollment.user.id)
      out.user = applyPseudonymToUser(enrollment.user, entry.pseudonym)
    }
    return out
  }

  /**
   * Pseudonymize a submission: rewrites `submission.user` and any
   * student-authored `submission_comments` based on the per-course map.
   * Comment authors whose role cannot be inferred fall back to "if we have
   * a pseudonym for this user_id, use it; otherwise pass through" — see
   * design doc, "submission_comments[].author_name when the author is a
   * student (peer feedback)".
   */
  async anonymizeSubmission(
    courseId: number | string,
    submission: CanvasSubmission,
  ): Promise<CanvasSubmission> {
    if (!this.isEnabled() || !this.host) return submission

    const out: CanvasSubmission = { ...submission }

    if (submission.user) {
      const role = classifyRole(submission.user)
      if (shouldPseudonymize(role)) {
        const entry = await this.assignPseudonym(this.host, courseId, submission.user.id)
        out.user = applyPseudonymToUser(submission.user, entry.pseudonym)
      }
    }

    if (submission.submission_comments && submission.submission_comments.length > 0) {
      out.submission_comments = await this.anonymizeSubmissionComments(
        courseId,
        submission.submission_comments,
      )
    }

    return out
  }

  /**
   * Pseudonymize all participants in a conversation. Conversations span
   * courses, so we use a cross-course `_conversations.json` pool keyed only
   * by host — conservative because we cannot reliably classify role without
   * a course context.
   */
  async anonymizeConversation<T extends CanvasConversation | CanvasConversationDetail>(
    conversation: T,
  ): Promise<T> {
    if (!this.isEnabled() || !this.host) return conversation

    const participants = await Promise.all(
      conversation.participants.map(async (p) => {
        const pseudonym = await this.assignConversationPseudonym(this.host as string, p.id)
        return { ...p, name: pseudonym }
      }),
    )

    return { ...conversation, participants } as T
  }

  /**
   * Pseudonymize the `linked.users` array of an outcome results / rollups
   * response.
   */
  async anonymizeOutcomeResults<
    T extends CanvasOutcomeResultsResponse | CanvasOutcomeRollupsResponse,
  >(courseId: number | string, response: T): Promise<T> {
    if (!this.isEnabled() || !this.host) return response
    if (!response.linked?.users || response.linked.users.length === 0) return response

    const users = await this.anonymizeUsers(courseId, response.linked.users)
    return { ...response, linked: { ...response.linked, users } } as T
  }

  /**
   * Pseudonymize `child_events[].user` fields embedded in an appointment group
   * response (present when the caller requests `include[]=appointments,child_events`
   * and the group is viewed under the `manageable` scope). Each reservation event
   * may carry the booking participant as `user`. We key the pseudonym namespace
   * on `_apptgrp_<group.id>` for consistency with `list_appointment_group_users`.
   */
  async anonymizeAppointmentGroupResponse(
    group: CanvasAppointmentGroup,
  ): Promise<CanvasAppointmentGroup> {
    if (!this.isEnabled() || !this.host || !group.appointments?.length) return group

    const appointments = await Promise.all(
      group.appointments.map(async (slot) => {
        if (!slot.child_events?.length) return slot
        const child_events = await Promise.all(
          slot.child_events.map((event) => this.anonymizeCalendarEventUser(group.id, event)),
        )
        return { ...slot, child_events }
      }),
    )
    return { ...group, appointments }
  }

  /**
   * Pseudonymize the PII arms of a `GET /users/self/activity_stream` response.
   *
   * **Scope.** The stream is cross-course by construction, so there is no single
   * course to key the pseudonym map on. Each item is scoped individually by its
   * own `course_id`, which is what every other wrapped tool already does — so
   * the stream agrees with `list_submissions` on the same student in the same
   * course. A group-context item carries no `course_id` at all (Canvas emits one
   * key, named after the context type), and gets the isolated synthetic scope
   * `_group_<group_id>`, following the `_apptgrp_<id>` precedent above. Course
   * and group identity maps are never merged.
   *
   * **Three arms carry a name; the fourth does not.** Measured against
   * `lib/api/v1/stream_item.rb#stream_item_json`:
   *
   * - `root_discussion_entries[].user.user_name` — a name WITH an id, so it gets
   *   an ordinary scope-stable pseudonym.
   * - the `Submission` arm's `user` + `submission_comments[].author_name` —
   *   delegated to `anonymizeSubmission`, after pre-warming the non-grader
   *   comment authors so a peer reviewer's name cannot survive on a
   *   single-submission payload (see the inline note below).
   * - `author_name` on a `DiscussionEntry` item — a name with NO identifier
   *   anywhere in the item, so no stable pseudonym is derivable. Withheld
   *   outright rather than left in place: failing closed is the only safe
   *   reading, and `html_url` still reaches the pseudonymized entry through
   *   `get_discussion`.
   * - the `Conversation` arm's `latest_messages[]` is `{id, created_at,
   *   author_id, message, participating_user_ids}` — identifiers and text, no
   *   name. Nothing to rewrite; ids are preserved by every existing
   *   `anonymize*` method too (`applyPseudonymToUser` keeps `user.id`), and the
   *   message text is provenance-fenced rather than pseudonymized.
   */
  async anonymizeActivityStream(
    items: ReadonlyArray<CanvasActivityStreamEntry>,
  ): Promise<CanvasActivityStreamEntry[]> {
    if (!this.isEnabled() || !this.host) return [...items]
    const out: CanvasActivityStreamEntry[] = []
    for (const item of items) {
      out.push(await this.anonymizeActivityStreamEntry(item))
    }
    return out
  }

  /**
   * Pseudonymize the PII arm of a `GET /planner/items` response (BRU-2878).
   *
   * `submissions.feedback` (from `submission_statuses_for`) carries an
   * `author_name` with NO identifier anywhere on the item — the plannable set
   * includes `assessment_request` / `peer_review_sub_assignment`, where this
   * feedback can originate from a peer reviewer rather than the grader, and
   * there is no `author_id` sibling to classify against like
   * `anonymizeSubmission` does. This is the exact shape already handled for
   * `author_name` on a `DiscussionEntry` activity-stream item above: nothing
   * to key a stable pseudonym on, so it is withheld outright rather than left
   * in place — failing closed is the only safe reading. `author_avatar_url` is
   * cleared alongside it, matching `applyPseudonymToUser`'s treatment of
   * `avatar_url`: a masked name next to the real author's photo would defeat
   * the point. No other arm of a planner item carries a third-party name.
   */
  async anonymizePlannerItems(
    items: ReadonlyArray<CanvasPlannerItem>,
  ): Promise<CanvasPlannerItem[]> {
    if (!this.isEnabled()) return [...items]
    return items.map((item) => {
      if (item.submissions === false) return item
      const feedback = item.submissions.feedback
      if (typeof feedback?.author_name !== 'string' || feedback.author_name.length === 0) {
        return item
      }
      return {
        ...item,
        submissions: {
          ...item.submissions,
          feedback: {
            ...feedback,
            author_name: WITHHELD_AUTHOR_NAME,
            author_avatar_url:
              feedback.author_avatar_url == null ? feedback.author_avatar_url : null,
          },
        },
      }
    })
  }

  /**
   * Look up the real user_id behind a pseudonym. Returns `null` when reverse
   * lookup is disabled, the host is invalid, or the pseudonym is unknown.
   * Audit-logs every successful and failed lookup.
   */
  async reverseLookup(
    courseId: number | string,
    pseudonym: string,
  ): Promise<ReverseLookupResult | null> {
    // Deny before the map is read, and before any miss reason is computed:
    // a shared instance must not distinguish "no such pseudonym" from "not
    // allowed", or the miss reasons become an oracle. `isReverseLookupEnabled`
    // already covers this case; the explicit guard is what makes the denial
    // auditable and keeps it correct if that predicate is ever refactored.
    if (this.sharedAcrossCallers) {
      this.audit(
        `reverse_lookup denied course=${courseId} pseudonym=${pseudonym} reason=shared-instance`,
      )
      return null
    }
    if (!this.isReverseLookupEnabled() || !this.host) return null

    const map = await this.loadCourseMap(this.host, courseId)
    if (!map) {
      this.audit(`reverse_lookup miss course=${courseId} pseudonym=${pseudonym} reason=no-map`)
      return null
    }

    for (const [userIdStr, entry] of Object.entries(map.students)) {
      if (entry.pseudonym === pseudonym) {
        const userId = Number(userIdStr)
        this.audit(
          `reverse_lookup hit course=${courseId} pseudonym=${pseudonym} status=${entry.status}`,
        )
        return { user_id: userId, pseudonym: entry.pseudonym, status: entry.status }
      }
    }

    this.audit(`reverse_lookup miss course=${courseId} pseudonym=${pseudonym} reason=not-found`)
    return null
  }

  // --- Internals --------------------------------------------------------------

  /**
   * The pseudonym scope for one activity-stream item. Exactly one of
   * `course_id` / `group_id` is present on a real item; `STREAM_NO_CONTEXT_SCOPE`
   * is the fail-closed backstop for neither, so an unexpected shape still gets
   * a pseudonym rather than passing a real name through.
   */
  private activityStreamScope(item: CanvasActivityStreamEntry): CanvasId | string {
    if (item.course_id !== undefined) return item.course_id
    if (item.group_id !== undefined) return `_group_${item.group_id}`
    return STREAM_NO_CONTEXT_SCOPE
  }

  private async anonymizeActivityStreamEntry(
    item: CanvasActivityStreamEntry,
  ): Promise<CanvasActivityStreamEntry> {
    const scope = this.activityStreamScope(item)
    let out = item

    if (item.root_discussion_entries && item.root_discussion_entries.length > 0) {
      const entries: CanvasActivityStreamRootEntry[] = []
      for (const entry of item.root_discussion_entries) {
        if (!entry.user) {
          entries.push(entry)
          continue
        }
        // Routed through anonymizeUser so role classification stays in one
        // place, then only the resolved name is read back — the stream's
        // `{user_id, user_name}` pair is not a CanvasUser and must keep its
        // own key names. A missing/null `user_id` (BRU-2868: the pinned
        // serializer can emit this nested `user` object with no usable
        // identity) has nothing to key a stable pseudonym on, so it is
        // withheld outright rather than passed to `anonymizeUser` — doing so
        // would stringify the invalid id into a `"null"`/`"undefined"` key on
        // the shared, persisted course map and fabricate a `Student N` for no
        // one, the same fail-closed reading already used for
        // `recent_replies[].user_name` below.
        const rootUserId = entry.user.user_id
        const resolvedName =
          rootUserId === undefined || rootUserId === null
            ? WITHHELD_AUTHOR_NAME
            : (
                await this.anonymizeUser(scope, {
                  id: rootUserId,
                  name: entry.user.user_name,
                } as CanvasUser)
              ).name
        entries.push({ ...entry, user: { ...entry.user, user_name: resolvedName } })
      }
      out = { ...out, root_discussion_entries: entries }
    }

    if (typeof item.author_name === 'string' && item.author_name.length > 0) {
      out = { ...out, author_name: WITHHELD_AUTHOR_NAME }
    }

    if (item.user !== undefined || item.submission_comments !== undefined) {
      // Pre-warm the comment authors. `anonymizeSubmission` rewrites an
      // `author_name` only when that author is ALREADY in the scope's map, so
      // on a single submission a peer reviewer's real name survives otherwise.
      // `list_submissions` gets away with it because listing the course warms
      // the map; a stream item is one submission, so it does not.
      //
      // The recorded grader is excluded, so staff feedback stays attributable —
      // the same call `get_my_submission_feedback` makes on this exact payload
      // shape. When `grader_id` is absent the loop warms every author, which
      // fails closed (a masked teacher name) rather than open (a leaked peer).
      //
      // The submitting student first, so pseudonym indices are allocated in the
      // order a reader of the payload would expect (the submitter, then their
      // commenters) rather than in comment order.
      if (item.user !== undefined) await this.anonymizeUser(scope, item.user)

      const graderKey = item.grader_id == null ? null : String(item.grader_id)
      for (const comment of item.submission_comments ?? []) {
        // A comment whose author the viewer may not read carries no identity to
        // key a pseudonym on, and needs none: `submission_comment_json` sets
        // `author: {}`, `author_id: nil` and `author_name: "Anonymous User"`
        // TOGETHER in that branch (lib/api/v1/submission_comment.rb:68-72 at
        // Canvas 1c9f0bb8013ed69c4f2efe11fd483025469b7e6c), so Canvas has
        // already anonymized it. Warming it would key the course map on the
        // string `"null"`, spend a pseudonym index on a non-person, and rename
        // Canvas's own "Anonymous User" byline. `CanvasSubmissionComment`
        // declares `author_id` non-null, which that branch contradicts; the
        // guard follows the serializer, not the declaration.
        const authorKey = submissionCommentAuthorKey(comment)
        if (authorKey === null) continue
        if (graderKey !== null && authorKey === graderKey) continue
        await this.anonymizeUser(scope, {
          id: comment.author_id,
          name: comment.author_name,
        } as CanvasUser)
      }

      const anonymized = await this.anonymizeSubmission(scope, item as unknown as CanvasSubmission)
      out = { ...out }
      if (anonymized.user !== undefined) out.user = anonymized.user
      if (anonymized.submission_comments !== undefined) {
        out.submission_comments = anonymized.submission_comments
      }
    }

    // The two remaining default-on `SUBMISSION_OTHER_FIELDS` that carry a name.
    // Both are reached through the merged `submission_json` and so are present
    // only on a `Submission` item, but neither is gated on `user` /
    // `submission_comments` being present — a discussion submission with no
    // comments still has `discussion_entries` — so they are resolved
    // unconditionally rather than inside the block above.
    if (item.discussion_entries && item.discussion_entries.length > 0) {
      out = {
        ...out,
        discussion_entries: await this.anonymizeSubmissionDiscussionEntries(
          scope,
          item.discussion_entries,
        ),
      }
    }

    // `proxy_submitter` is `attempt.proxy_submitter.short_name` — a BARE
    // STRING, with its id in the sibling `proxy_submitter_id`. A proxy
    // submitter is staff in practice, but the stream gives us no enrollments to
    // prove it: `classifyRole({id, name})` returns `'unknown'`, which
    // `shouldPseudonymize` treats as needing a pseudonym. That is the intended
    // direction — masking a teacher who submitted on a student's behalf costs
    // attribution, whereas preserving an identity we could not classify costs a
    // real name. With no id there is nothing to key a stable pseudonym on, so
    // the name is withheld outright.
    if (typeof item.proxy_submitter === 'string' && item.proxy_submitter.length > 0) {
      const id = item.proxy_submitter_id
      const resolved =
        id === undefined || id === null
          ? WITHHELD_AUTHOR_NAME
          : (
              await this.anonymizeUser(scope, {
                id,
                name: item.proxy_submitter,
              } as CanvasUser)
            ).name
      out = { ...out, proxy_submitter: resolved }
    }

    return out
  }

  private async anonymizeCalendarEventUser(
    apptGroupId: CanvasId,
    event: CanvasCalendarEvent,
  ): Promise<CanvasCalendarEvent> {
    if (!event.user) return event
    const anonymizedUser = await this.anonymizeUser(`_apptgrp_${apptGroupId}`, event.user)
    return { ...event, user: anonymizedUser }
  }

  /**
   * Allocate (or restore) the pseudonym for a given (host, courseId, userId).
   * Holds an in-memory async lock on the target so two concurrent allocations
   * cannot collide on `next_pseudonym_index`.
   */
  private async assignPseudonym(
    host: string,
    courseId: number | string,
    userId: CanvasId,
  ): Promise<StudentEntry> {
    const key = `${host}/${courseId}`
    return this.withLock(key, async () => {
      const map = (await this.loadCourseMap(host, courseId)) ?? emptyCourseMap(host, courseId)
      const userKey = String(userId)
      const existing = map.students[userKey]

      if (existing) {
        // Re-enrollment: restore historical entries to active without changing
        // the assigned pseudonym.
        if (existing.status === 'historical') {
          const restored: StudentEntry = {
            ...existing,
            status: 'active',
          }
          delete restored.marked_historical_at
          map.students[userKey] = restored
          await this.persistCourseMap(host, courseId, map)
          return restored
        }
        return existing
      }

      const entry: StudentEntry = {
        pseudonym: `Student ${map.next_pseudonym_index}`,
        status: 'active',
        first_seen: new Date().toISOString(),
      }
      map.students[userKey] = entry
      map.next_pseudonym_index += 1
      await this.persistCourseMap(host, courseId, map)
      return entry
    })
  }

  private async assignConversationPseudonym(host: string, userId: CanvasId): Promise<string> {
    const key = `${host}/_conversations`
    return this.withLock(key, async () => {
      const map = (await this.loadConversationMap(host)) ?? emptyConversationMap(host)
      const userKey = String(userId)
      const existing = map.participants[userKey]
      if (existing) return existing.pseudonym

      const entry: StudentEntry = {
        pseudonym: `Person ${map.next_pseudonym_index}`,
        status: 'active',
        first_seen: new Date().toISOString(),
      }
      map.participants[userKey] = entry
      map.next_pseudonym_index += 1
      await this.persistConversationMap(host, map)
      return entry.pseudonym
    })
  }

  private async anonymizeSubmissionComments(
    courseId: number | string,
    comments: ReadonlyArray<CanvasSubmissionComment>,
  ): Promise<CanvasSubmissionComment[]> {
    const map = this.host ? ((await this.loadCourseMap(this.host, courseId)) ?? null) : null
    const out: CanvasSubmissionComment[] = []
    for (const c of comments) {
      const authorKey = submissionCommentAuthorKey(c)
      const pseudonym = authorKey === null ? undefined : map?.students[authorKey]?.pseudonym
      const next: CanvasSubmissionComment = { ...c }
      if (pseudonym) {
        next.author_name = pseudonym
        // `submission_comment_json` also emits `author` =
        // `user_display_json(comment.author, …)` whenever the viewer holds
        // `:read_author`, which spells the same person's name as
        // `display_name`. Rewriting only `author_name` leaves the real name one
        // key over. Gated on the SAME map hit as `author_name` deliberately, so
        // the two keys can never disagree about who wrote the comment — a miss
        // means the recorded grader, whose name stays attributable.
        if (c.author) next.author = applyPseudonymToDisplay(c.author, pseudonym)
      }
      out.push(next)
    }
    return out
  }

  /**
   * Pseudonymize a Canvas `user_display_json` object, which spells the name
   * `display_name` rather than `name`.
   *
   * Role classification runs through {@link anonymizeUser}, so staff keep their
   * name here exactly as they do everywhere else. A display object with a name
   * but NO `id` has nothing to key a stable pseudonym on, so the name is
   * withheld rather than passed through — the same fail-closed reading as the
   * `DiscussionEntry` arm's bare `author_name`.
   */
  private async anonymizeDisplayUser(
    scope: CanvasId | string,
    display: CanvasUserDisplay,
  ): Promise<CanvasUserDisplay> {
    const name = display.display_name
    if (typeof name !== 'string' || name.length === 0) return display

    if (display.id === undefined || display.id === null) {
      return applyPseudonymToDisplay(display, WITHHELD_AUTHOR_NAME)
    }
    const resolved = await this.anonymizeUser(scope, {
      id: display.id,
      name,
    } as CanvasUser)
    // Unchanged means staff: leave the avatar and pronouns alone too, so a
    // teacher's byline stays whole rather than half-scrubbed.
    if (resolved.name === name) return display
    return applyPseudonymToDisplay(display, resolved.name)
  }

  /**
   * Pseudonymize a `discussion_entries[]` array from the Submission arm,
   * recursing through `recent_replies`.
   *
   * Three identity surfaces per entry and they do not co-occur — `user_name`
   * and `user_id` are dropped on a deleted entry while the `user` display
   * object survives it — so each is resolved independently. Both resolve
   * through the same per-user map entry, so one person gets one label however
   * many keys spell their name.
   */
  private async anonymizeSubmissionDiscussionEntries(
    scope: CanvasId | string,
    entries: ReadonlyArray<CanvasSubmissionDiscussionEntry>,
  ): Promise<CanvasSubmissionDiscussionEntry[]> {
    const out: CanvasSubmissionDiscussionEntry[] = []
    for (const entry of entries) {
      let next = entry

      if (typeof entry.user_name === 'string' && entry.user_name.length > 0) {
        const resolved =
          entry.user_id === undefined || entry.user_id === null
            ? WITHHELD_AUTHOR_NAME
            : (
                await this.anonymizeUser(scope, {
                  id: entry.user_id,
                  name: entry.user_name,
                } as CanvasUser)
              ).name
        next = { ...next, user_name: resolved }
      }

      if (entry.user) {
        next = { ...next, user: await this.anonymizeDisplayUser(scope, entry.user) }
      }

      if (entry.recent_replies && entry.recent_replies.length > 0) {
        next = {
          ...next,
          recent_replies: await this.anonymizeSubmissionDiscussionEntries(
            scope,
            entry.recent_replies,
          ),
        }
      }

      out.push(next)
    }
    return out
  }

  private async loadCourseMap(host: string, courseId: number | string): Promise<CourseMap | null> {
    const cacheKey = `${host}/${courseId}`
    const cached = this.courseMaps.get(cacheKey)
    if (cached) return cached
    const path = mapFilePath(this.rootDir, host, courseId)
    const loaded = await loadMap<CourseMap>(path)
    if (loaded) this.courseMaps.set(cacheKey, loaded)
    return loaded
  }

  private async persistCourseMap(
    host: string,
    courseId: number | string,
    map: CourseMap,
  ): Promise<void> {
    const path = mapFilePath(this.rootDir, host, courseId)
    map.generated_at = new Date().toISOString()
    await saveMap(path, map)
    this.courseMaps.set(`${host}/${courseId}`, map)
  }

  private async loadConversationMap(host: string): Promise<ConversationMap | null> {
    const cacheKey = `${host}/_conversations`
    const cached = this.conversationMaps.get(cacheKey)
    if (cached) return cached
    const path = conversationsFilePath(this.rootDir, host)
    const loaded = await loadMap<ConversationMap>(path)
    if (loaded) this.conversationMaps.set(cacheKey, loaded)
    return loaded
  }

  private async persistConversationMap(host: string, map: ConversationMap): Promise<void> {
    const path = conversationsFilePath(this.rootDir, host)
    map.generated_at = new Date().toISOString()
    await saveMap(path, map)
    this.conversationMaps.set(`${host}/_conversations`, map)
  }

  /**
   * Serialize work on a per-key basis. Each new task chains off the previous
   * one so that callers naturally observe FIFO ordering and do not race on
   * `next_pseudonym_index`.
   */
  private withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve()
    const next = prev.then(task, task)
    this.locks.set(
      key,
      next.catch(() => undefined),
    )
    return next
  }

  private audit(line: string): void {
    const stamped = `[${new Date().toISOString()}] canvas-lms-mcp pseudonym ${line}`
    try {
      this.auditLog(stamped)
    } catch (err) {
      // Never let a logging failure tear down a tool response.
      console.error('pseudonym audit log failed:', err)
    }
    const filePath = this.env.CANVAS_PSEUDONYM_AUDIT_LOG
    if (filePath) {
      // Best-effort append; failures are stderr-logged and swallowed.
      void appendAuditFile(filePath, stamped)
    }
  }
}

/**
 * The single expression that turns a submission comment into a course-map key,
 * used by BOTH the pre-warm that writes the map and the read that looks a
 * pseudonym up. `null` means "this comment carries no identity at all", which
 * is what `submission_comment_json` emits when the viewer lacks `:read_author`:
 * `author_id: nil` together with `author: {}` and `author_name: "Anonymous
 * User"` (lib/api/v1/submission_comment.rb:68-72 at the pinned Canvas SHA
 * 1c9f0bb8013ed69c4f2efe11fd483025469b7e6c).
 *
 * Both sides must refuse that comment, not just the write side. The course map
 * is shared per (host, course) and persisted, so a `"null"` key written by any
 * other caller — `get_my_submission_feedback` warmed one until BRU-2865,
 * because `classifyCommentAuthor` (src/tools/student.ts) reads a nil
 * `author_id` as a 'peer' — would otherwise be found by an unguarded
 * `String(c.author_id)`, renaming Canvas's own "Anonymous User" byline to a
 * pseudonym and inventing a `display_name` on the object the serializer
 * deliberately emptied. The read guard stays load-bearing now that both
 * writers refuse the shape: maps on disk from ≤ 2.1.0 can already hold a
 * `"null"` key, and nothing migrates them. Deriving every key here is also
 * what stops the sites drifting apart again (BRU-2864 was exactly that drift).
 *
 * Exported for the same reason (BRU-2865): `get_my_submission_feedback` warms
 * comment authors itself, and that warm has to refuse exactly the comments the
 * read refuses. Every caller derives the key here rather than spelling
 * `String(c.author_id)` again — a third copy is a third chance to drift.
 */
export function submissionCommentAuthorKey(
  comment: Pick<CanvasSubmissionComment, 'author_id'>,
): string | null {
  return comment.author_id == null ? null : String(comment.author_id)
}

function classifyRoleFromEnrollment(enrollment: CanvasEnrollment): Role {
  return classifyRole({}, [enrollment])
}

/**
 * The `user_display_json` counterpart of {@link applyPseudonymToUser}.
 *
 * Rewrites `display_name` and nulls the two sibling fields that re-identify the
 * person beside a masked name — `avatar_image_url` (their face) and `pronouns`
 * — exactly as `applyPseudonymToUser` already does for `avatar_url` / `pronouns`
 * on a full `CanvasUser`. `id`, `anonymous_id` and `html_url` are identifiers
 * and are preserved, because nothing in this layer ever rewrites an id.
 *
 * Only ever called with a non-empty `display_name`; callers decide whether the
 * replacement is a pseudonym or {@link WITHHELD_AUTHOR_NAME}.
 */
function applyPseudonymToDisplay(display: CanvasUserDisplay, pseudonym: string): CanvasUserDisplay {
  const out: CanvasUserDisplay = { ...display, display_name: pseudonym }
  if (display.avatar_image_url !== undefined) out.avatar_image_url = null
  if (display.pronouns !== undefined) out.pronouns = null
  return out
}

function applyPseudonymToUser(user: CanvasUser, pseudonym: string): CanvasUser {
  const out: CanvasUser = {
    ...user,
    name: pseudonym,
    short_name: pseudonym,
    sortable_name: pseudonym,
  }

  if (user.email !== undefined) {
    const slug = pseudonym.toLowerCase().replace(/\s+/g, '-')
    out.email = `${slug}@anon.invalid`
  }
  if (user.login_id !== undefined) {
    out.login_id = pseudonym.toLowerCase().replace(/\s+/g, '-')
  }

  // Explicit null-out — these would otherwise leak identity.
  out.sis_user_id = null
  out.integration_id = null
  if (user.avatar_url !== undefined) out.avatar_url = undefined
  if (user.bio !== undefined) out.bio = null
  if (user.pronouns !== undefined) out.pronouns = null
  if (user.last_login !== undefined) out.last_login = null

  return out
}

/**
 * Configuration for {@link createSharedPseudonymizer}. Deliberately narrower
 * than {@link PseudonymizerConfig}: it has no `sharedAcrossCallers` field,
 * because the whole point of this construction is that the answer is fixed.
 */
export interface SharedPseudonymizerConfig {
  /** Canvas base URL — used to key the per-host map directory. */
  baseUrl: string
  /** Root directory for map files. Defaults to the platform/XDG location. */
  rootDir?: string
  /**
   * Audit log writer. Defaults to `console.error`. On a shared instance the
   * only lines written are reverse-lookup **denials**, which is what makes an
   * attempt visible to a hosted deployment's log pipeline.
   */
  auditLog?: (line: string) => void
}

/**
 * The supported way to build a pseudonymizer for a process that serves callers
 * authenticating with **different** Canvas credentials — a hosted deployment, a
 * multi-tenant gateway, or any custom MCP transport that reuses one server
 * process across users.
 *
 * Reverse lookup is permanently unavailable on the returned instance, whatever
 * `CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP` says, so `resolve_pseudonym` is never
 * registered on a server built with it. `resolve_pseudonym` performs no
 * Canvas-side authorization and reads a map seeded by whichever caller fetched
 * a roster first, so honouring the flag here would let an unrelated caller
 * recover a real `user_id` (BRU-2511).
 *
 * The fields are copied across explicitly rather than spread, so an untyped
 * (JavaScript) caller cannot smuggle `sharedAcrossCallers: false` through this
 * function and get a private instance back from a name that promises a shared
 * one.
 *
 * ```ts
 * import { createSharedPseudonymizer, createCanvasMCPServer } from 'canvas-lms-mcp'
 *
 * // Once, at startup:
 * const pseudonymizer = createSharedPseudonymizer({ baseUrl: process.env.CANVAS_BASE_URL! })
 *
 * // Per request, with that caller's own token:
 * const { server } = createCanvasMCPServer({ token, baseUrl, pseudonymizer })
 * ```
 */
export function createSharedPseudonymizer(config: SharedPseudonymizerConfig): Pseudonymizer {
  return new Pseudonymizer({
    baseUrl: config.baseUrl,
    rootDir: config.rootDir,
    auditLog: config.auditLog,
    sharedAcrossCallers: true,
  })
}

async function appendAuditFile(filePath: string, line: string): Promise<void> {
  try {
    const { appendFile, mkdir } = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
    await appendFile(filePath, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch (err) {
    console.error('pseudonym audit file append failed:', err)
  }
}
