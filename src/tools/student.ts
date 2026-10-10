import { z } from 'zod'
import { CanvasApiError } from '../canvas'
import type { CanvasClient } from '../canvas'
import type { SubmissionListInclude } from '../canvas/submissions'
import type { CanvasSubmission, CanvasSubmissionComment } from '../canvas/types'
import { submissionCommentAuthorKey } from '../pseudonym/pseudonymizer'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'
import { type CanvasId, canvasIdInput } from '../canvas/id'

const MY_SUBMISSION_FEEDBACK_INCLUDE = [
  'submission_comments',
  'user',
  'assignment',
  'course',
  'read_status',
] as const satisfies ReadonlyArray<SubmissionListInclude>

/**
 * Default cap on `get_my_activity_stream`. Canvas serves the endpoint at
 * `per_page=100`, so this is one page: enough for a daily "what changed"
 * question without following the whole retention window.
 */
const ACTIVITY_STREAM_DEFAULT_MAX_ITEMS = 100

/**
 * Always returned by `get_my_activity_stream`, never computed. Canvas expires
 * stream items with `Setting.get("stream_items_ttl", 4.weeks)`, an instance
 * setting with no API surface — so the horizon is real, unknowable from here,
 * and must be stated rather than inferred.
 */
const ACTIVITY_STREAM_RETENTION_NOTE =
  'Canvas keeps activity-stream items for a limited window — typically the last ~4 weeks, set ' +
  'per Canvas instance (stream_items_ttl) and not readable through the API. Items older than ' +
  'that window are gone from this endpoint even though the underlying courses, discussions and ' +
  'submissions still exist, so an empty or short result is not evidence that nothing happened.'

/** Default cap on `list_my_planner_items`, matching the activity stream's convention. */
const PLANNER_ITEMS_DEFAULT_MAX_ITEMS = 100

/** Canvas's own default planner window when neither date is supplied (`planner_controller.rb#set_date_range`). */
const PLANNER_DEFAULT_WINDOW_DAYS = 14

/** A context-code regex matching Canvas's `course_<id>` / `group_<id>` form, canonical-id only (no leading zeros). */
const PLANNER_CONTEXT_CODE_PATTERN = /^(course|group)_[1-9][0-9]{0,18}$/

/**
 * UTC midnight `daysFromNow` days from today, as an ISO 8601 string. Mirrors
 * Canvas's `N.weeks.ago.beginning_of_day` / `N.weeks.from_now.beginning_of_day`
 * default closely enough to give the caller SOME visibility into the window
 * actually queried — Canvas's own response never echoes back the dates it
 * resolved to (BRU-2797 §1 C9, §7.1).
 */
function isoDateAtUtcMidnight(daysFromNow: number): string {
  const date = new Date()
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() + daysFromNow)
  return date.toISOString()
}

type CommentAuthorRole = 'self' | 'teacher' | 'peer'

interface FeedbackComment {
  id: CanvasId
  author_role: CommentAuthorRole
  author_name: string
  comment: string
  created_at: string
}

interface SubmissionFeedback {
  course_id: CanvasId
  course_name: string | null
  assignment_id: CanvasId
  assignment_name: string | null
  submission_id: CanvasId
  workflow_state: string
  score: number | null
  read_status: 'read' | 'unread' | null
  feedback_author_roles: CommentAuthorRole[] // deduped, excludes 'self'
  latest_feedback_comment: FeedbackComment
  comments: FeedbackComment[] // full thread, chronological, includes 'self' comments
  html_url: string | null
}

function classifyCommentAuthor(
  comment: CanvasSubmissionComment,
  submission: CanvasSubmission,
): CommentAuthorRole {
  if (comment.author_id === submission.user_id) return 'self'
  if (submission.grader_id != null && comment.author_id === submission.grader_id) return 'teacher'
  return 'peer'
}

function toFeedbackComment(
  comment: CanvasSubmissionComment,
  role: CommentAuthorRole,
): FeedbackComment {
  return {
    id: comment.id,
    author_role: role,
    author_name: comment.author_name,
    comment: comment.comment,
    created_at: comment.created_at,
  }
}

export function studentTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
  return [
    {
      name: 'get_my_courses',
      title: 'Get My Courses',
      description: 'List active courses for the authenticated student.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        return canvas.courses.list({ enrollment_state: 'active' })
      },
    },
    {
      name: 'get_my_grades',
      title: 'Get My Grades',
      description:
        'Get grade data for the authenticated student. If course_id is omitted, returns grades across all enrolled courses.',
      inputSchema: {
        course_id: canvasIdInput()
          .optional()
          .describe('The Canvas course ID (omit for all courses)'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId | undefined
        return canvas.enrollments.listMyGrades(course_id)
      },
    },
    {
      name: 'get_my_submissions',
      title: 'Get My Submissions',
      description: 'List all submissions for the authenticated student in a course.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        return canvas.submissions.listMy(course_id)
      },
    },
    {
      name: 'get_my_upcoming_assignments',
      title: 'Get My Upcoming Assignments',
      description:
        'List upcoming assignment events for the authenticated student. Canvas caps this ' +
        'endpoint at roughly the next 1 week and at most 20 events server-side — neither limit ' +
        'is adjustable, and results silently stop there even if more assignments fall later. ' +
        'For a longer or specific date range, use `list_calendar_events` with `type="assignment"` ' +
        'and explicit `start_date`/`end_date` instead.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        return canvas.users.getUpcomingAssignments()
      },
    },
    {
      name: 'get_my_submission_feedback',
      title: 'Get My Submission Feedback',
      description:
        "List the authenticated student's own submissions that carry feedback comments from an " +
        'instructor or a peer reviewer — comments left by the student themselves do not count as ' +
        'feedback and submissions with no non-self comments are omitted. Omit `course_id` to scan ' +
        'every active course; a course that errors during a scan is skipped and reported in ' +
        '`courses_failed` rather than failing the whole call. Sorted most-recent-feedback-first. ' +
        'Comment author role is best-effort: ' +
        "'teacher' is only identified when the author is the submission's recorded grader; other " +
        "non-self authors are labeled 'peer', including any staff member who comments without being " +
        'the recorded grader.',
      inputSchema: {
        course_id: canvasIdInput()
          .optional()
          .describe("The Canvas course ID. Omit to scan all of the student's active courses."),
        unread_only: z
          .boolean()
          .optional()
          .describe(
            "Only include submissions the student hasn't opened yet (Canvas read_status). " +
              'Defaults to false.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseIdParam = params.course_id as CanvasId | undefined
        const unreadOnly = (params.unread_only as boolean | undefined) ?? false

        const courseIds =
          courseIdParam !== undefined
            ? [courseIdParam]
            : (await canvas.courses.list({ enrollment_state: 'active' })).map((c) => c.id)

        const perCourse: Array<{ courseId: CanvasId; submissions: CanvasSubmission[] }> = []
        const coursesFailed: Array<{
          course_id: CanvasId
          status: number | null
          message: string
        }> = []

        if (courseIdParam !== undefined) {
          // Explicit single course: fail fast so an explicit request surfaces the
          // real Canvas error to the caller.
          perCourse.push({
            courseId: courseIdParam,
            submissions: await canvas.submissions.listMy(courseIdParam, {
              include: MY_SUBMISSION_FEEDBACK_INCLUDE,
            }),
          })
        } else {
          // All-courses scan: tolerate a single course failing (a concluded-but-
          // still-"active" enrollment, or a course that 403s the student-
          // submissions endpoint) so one bad course does not hide the feedback in
          // every other course. Failures are surfaced in `courses_failed`. Each
          // call is wrapped so the failing course id stays associated with its
          // error (Promise.allSettled would drop it).
          const results = await Promise.all(
            courseIds.map(async (courseId) => {
              try {
                const submissions = await canvas.submissions.listMy(courseId, {
                  include: MY_SUBMISSION_FEEDBACK_INCLUDE,
                })
                return { ok: true as const, courseId, submissions }
              } catch (err) {
                return { ok: false as const, courseId, err }
              }
            }),
          )
          for (const result of results) {
            if (result.ok) {
              perCourse.push({ courseId: result.courseId, submissions: result.submissions })
            } else {
              coursesFailed.push({
                course_id: result.courseId,
                status: result.err instanceof CanvasApiError ? result.err.status : null,
                message:
                  result.err instanceof CanvasApiError ? result.err.message : String(result.err),
              })
            }
          }
        }

        let submissionsScanned = 0
        const candidates: Array<{ courseId: CanvasId; submission: CanvasSubmission }> = []
        for (const { courseId, submissions } of perCourse) {
          for (const submission of submissions) {
            submissionsScanned += 1
            const comments = submission.submission_comments ?? []
            if (comments.length === 0) continue
            const hasFeedback = comments.some(
              (c) => classifyCommentAuthor(c, submission) !== 'self',
            )
            if (!hasFeedback) continue
            if (unreadOnly && submission.read_status !== 'unread') continue
            candidates.push({ courseId, submission })
          }
        }

        if (pseudonymizer?.isEnabled()) {
          const peerAuthors = new Map<string, { courseId: CanvasId; id: CanvasId; name: string }>()
          for (const { courseId, submission } of candidates) {
            for (const comment of submission.submission_comments ?? []) {
              // A comment whose author the viewer may not read carries no
              // identity to key a pseudonym on, and needs none: Canvas has
              // already anonymized it — `submission_comment_json` sets
              // `author_id: nil` together with `author: {}` and `author_name:
              // "Anonymous User"` (lib/api/v1/submission_comment.rb:68-72 at
              // Canvas 1c9f0bb8013ed69c4f2efe11fd483025469b7e6c).
              // `classifyCommentAuthor` reads that nil as 'peer', since it
              // matches neither `user_id` nor `grader_id`, so the guard is
              // here rather than in the classification: warming it would key
              // the shared course map on the string `"null"` and spend a
              // pseudonym index on a non-person, shifting `Student N` for
              // every real student warmed after it (BRU-2865). The key comes
              // from the pseudonymizer so this site and the read side in
              // `anonymizeSubmissionComments` can never disagree about which
              // comments have an author (BRU-2864 was exactly that drift).
              const authorKey = submissionCommentAuthorKey(comment)
              if (authorKey === null) continue
              if (classifyCommentAuthor(comment, submission) === 'peer') {
                peerAuthors.set(`${courseId}:${authorKey}`, {
                  courseId,
                  id: authorKey,
                  name: comment.author_name,
                })
              }
            }
          }
          await Promise.all(
            [...peerAuthors.values()].map((p) =>
              pseudonymizer.anonymizeUser(p.courseId, { id: p.id, name: p.name }),
            ),
          )
        }

        const findings: SubmissionFeedback[] = []
        for (const { courseId, submission } of candidates) {
          const roles = new Map<CanvasId, CommentAuthorRole>()
          for (const c of submission.submission_comments ?? []) {
            roles.set(c.id, classifyCommentAuthor(c, submission))
          }

          const resolved = pseudonymizer?.isEnabled()
            ? await pseudonymizer.anonymizeSubmission(courseId, submission)
            : submission

          const originalNameById = new Map(
            (submission.submission_comments ?? []).map((c) => [c.id, c.author_name]),
          )
          const comments = (resolved.submission_comments ?? []).map((c) => {
            const role = roles.get(c.id) ?? 'peer'
            // A comment from the submission's recorded grader is staff and must
            // keep its real name — even if that same user_id was pre-warmed as a
            // peer on a different submission in this course (the shared per-course
            // pseudonym map is keyed by user_id, not role, so anonymizeSubmission
            // would otherwise mask this teacher comment too).
            const author_name =
              role === 'teacher' ? (originalNameById.get(c.id) ?? c.author_name) : c.author_name
            return toFeedbackComment({ ...c, author_name }, role)
          })
          const feedbackComments = comments.filter((c) => c.author_role !== 'self')
          const latest = feedbackComments.reduce((a, b) => (a.created_at >= b.created_at ? a : b))

          findings.push({
            course_id: courseId,
            course_name: resolved.course?.name ?? null,
            assignment_id: resolved.assignment_id,
            assignment_name: resolved.assignment?.name ?? null,
            submission_id: resolved.id,
            workflow_state: resolved.workflow_state,
            score: resolved.score,
            read_status: resolved.read_status ?? null,
            feedback_author_roles: [...new Set(feedbackComments.map((c) => c.author_role))],
            latest_feedback_comment: latest,
            comments,
            html_url: resolved.html_url ?? null,
          })
        }

        findings.sort((a, b) => {
          const A = a.latest_feedback_comment.created_at
          const B = b.latest_feedback_comment.created_at
          return A === B ? 0 : A < B ? 1 : -1
        })

        return {
          courses_scanned: courseIds.length,
          courses_failed: coursesFailed,
          submissions_scanned: submissionsScanned,
          findings_count: findings.length,
          findings,
        }
      },
    },
    {
      name: 'get_my_activity_stream_summary',
      title: 'Get My Activity Stream Summary',
      description:
        "Count unread and total items in the authenticated student's cross-course activity " +
        'stream, grouped by Canvas item type (e.g. DiscussionTopic, Announcement, Submission, ' +
        'Conversation). No item content — counts only. A good first call in a daily workflow ' +
        'to check "is there anything to look at?" before fetching the full stream.',
      inputSchema: {
        only_active_courses: z
          .boolean()
          .optional()
          .describe(
            'Only count activity in courses the student is actively participating in. ' +
              'Omit to count across all courses, including concluded ones.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const onlyActiveCourses = params.only_active_courses as boolean | undefined
        return canvas.activityStream.getSummary(onlyActiveCourses)
      },
    },
    {
      name: 'get_my_activity_stream',
      title: 'Get My Activity Stream',
      description:
        "The authenticated student's cross-course activity stream: new discussion posts, " +
        'announcements, conversation messages, graded submissions, peer-review requests and ' +
        'conference invitations from every course at once, newest first. Four caveats, none of ' +
        'them visible in the response: (1) RECENT ACTIVITY ONLY — typically the last ~4 weeks; ' +
        'the retention window is a per-Canvas-instance setting and cannot be read through the ' +
        'API, so "nothing found" is not evidence that nothing happened. (2) Each item\'s ' +
        '`message` was truncated to 4096 characters when Canvas stored it, with no marker — ' +
        "follow the item's `html_url` object with get_discussion or get_conversation for the " +
        'full text. (3) At most 3 `root_discussion_entries` per discussion item and 3 ' +
        '`latest_messages` per conversation item. (4) Exactly one of `course_id` / `group_id` ' +
        'is present on each item and the other key is ABSENT, not null — join on `course_id`, ' +
        'and read `context_type` to tell which you have.',
      inputSchema: {
        only_active_courses: z
          .boolean()
          .optional()
          .describe(
            'Only return activity in courses the student is actively participating in. ' +
              'Omit to include all courses, including concluded ones.',
          ),
        max_items: z
          .number()
          .int()
          .positive()
          .max(500)
          .optional()
          .describe(
            `Maximum items to return (default ${ACTIVITY_STREAM_DEFAULT_MAX_ITEMS}). When the ` +
              'limit is reached, `truncated` is true and `truncation_note` explains how to ' +
              'narrow the query.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const onlyActiveCourses = params.only_active_courses as boolean | undefined
        const limit = (params.max_items as number | undefined) ?? ACTIVITY_STREAM_DEFAULT_MAX_ITEMS

        // One item past the limit, deliberately: `paginate()` reports how many
        // items it accumulated, never whether more were waiting. Asking for
        // exactly `limit` makes "there are exactly `limit` items" and "there
        // are more" indistinguishable, so `truncated` would be unknowable.
        // The probe costs no extra request in the common case — the extra item
        // comes out of a page we were already going to fetch.
        const fetched = await canvas.activityStream.getStream({
          onlyActiveCourses,
          maxItems: limit + 1,
        })
        const truncated = fetched.length > limit
        const page = truncated ? fetched.slice(0, limit) : fetched

        const items = pseudonymizer?.isEnabled()
          ? await pseudonymizer.anonymizeActivityStream(page)
          : page

        return {
          items,
          total_items: items.length,
          truncated,
          truncation_note: truncated
            ? `Stopped after max_items (${limit}) items; more recent activity exists. ` +
              'Raise max_items (maximum 500), or set only_active_courses to true to drop ' +
              'concluded courses. get_my_activity_stream_summary gives per-type counts for ' +
              'the whole window without fetching items.'
            : null,
          // Unconditional on purpose. `truncated` answers "did WE stop early?";
          // it cannot answer "did Canvas already forget?", and that horizon is
          // an instance Setting invisible to the API — there is no value to
          // compute and no condition under which the flag could be set
          // correctly. A nullable note would read as "not truncated by
          // retention", which this server can never assert.
          retention_note: ACTIVITY_STREAM_RETENTION_NOTE,
        }
      },
    },
    {
      name: 'list_my_planner_items',
      title: 'List My Planner Items',
      description:
        "The authenticated student's planner: assignments, ungraded quizzes, planner notes, " +
        'wiki pages, ungraded discussions, calendar events, peer reviews, sub-assignments and ' +
        'peer-review sub-assignments — everything with a due or to-do date, across every course ' +
        'and group at once. Strictly richer than get_todo_items, which covers only assignments ' +
        'needing submitting or grading. Four caveats: (1) start_date and end_date must be given ' +
        'TOGETHER or OMITTED TOGETHER — supplying only one makes Canvas silently default the ' +
        'other side to a ten-year window, so a half-specified range is rejected outright; ' +
        "omitting both resolves to Canvas's own ~2-week default, echoed back as the response's " +
        '`start_date`/`end_date`. (2) `context_codes` (e.g. "course_123", "group_7") restricts ' +
        'to those contexts; omit it for every context the student belongs to — an empty array ' +
        'is rejected rather than silently meaning "all". (3) `submissions` is `false` when the ' +
        'item has no gradable submission, or an object when it does — never null. (4) a planner ' +
        'note has no `html_url` (Canvas exposes none for individual planner notes).',
      inputSchema: {
        start_date: z
          .string()
          .optional()
          .describe(
            'Inclusive start, YYYY-MM-DD or ISO 8601. Must be given together with end_date.',
          ),
        end_date: z
          .string()
          .optional()
          .describe(
            'Inclusive end, YYYY-MM-DD or ISO 8601. Must be given together with start_date.',
          ),
        context_codes: z
          .array(
            z
              .string()
              .regex(
                PLANNER_CONTEXT_CODE_PATTERN,
                'Each context code must be "course_<id>" or "group_<id>" (no leading zeros)',
              ),
          )
          .min(
            1,
            'context_codes must not be empty — omit the field for every context the student ' +
              'belongs to, rather than sending an empty list.',
          )
          .optional()
          .describe(
            'Restrict to these contexts, e.g. ["course_123","group_7"]. Defaults to every ' +
              'context the student belongs to.',
          ),
        filter: z
          .enum(['new_activity', 'incomplete_items', 'complete_items'])
          .optional()
          .describe(
            'new_activity = unread/new only; incomplete_items / complete_items filter on ' +
              'planner-override completion and submission state.',
          ),
        max_items: z
          .number()
          .int()
          .positive()
          .max(500)
          .optional()
          .describe(
            `Maximum items to return (default ${PLANNER_ITEMS_DEFAULT_MAX_ITEMS}). When the ` +
              'limit is reached, `truncated` is true and `truncation_note` explains how to ' +
              'narrow the query.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const startDate = params.start_date as string | undefined
        const endDate = params.end_date as string | undefined
        if ((startDate === undefined) !== (endDate === undefined)) {
          throw new Error(
            'start_date and end_date must be given together, or neither. Canvas fills a ' +
              'missing side with its own 10-year default (10 years ago or 10 years from now), ' +
              'silently producing a window up to a decade wide — supply both explicitly, or ' +
              "omit both to use Canvas's ~2-week default.",
          )
        }

        const contextCodes = params.context_codes as string[] | undefined
        const filter = params.filter as
          'new_activity' | 'incomplete_items' | 'complete_items' | undefined
        const limit = (params.max_items as number | undefined) ?? PLANNER_ITEMS_DEFAULT_MAX_ITEMS

        // One item past the limit, deliberately — see the identical comment on
        // get_my_activity_stream above: paginate() reports what it
        // accumulated, never whether more was waiting.
        const fetched = await canvas.planner.listItems({
          startDate,
          endDate,
          contextCodes,
          filter,
          maxItems: limit + 1,
        })
        const truncated = fetched.length > limit
        const items = truncated ? fetched.slice(0, limit) : fetched

        return {
          items,
          total_items: items.length,
          truncated,
          truncation_note: truncated
            ? `Stopped after max_items (${limit}) items; more planner items exist in this ` +
              'window. Raise max_items (maximum 500), or narrow start_date/end_date or context_codes.'
            : null,
          // Resolved window: when the caller passed neither date, Canvas
          // applies its own ±2-week default server-side and never echoes it
          // back. This is computed independently rather than read off the
          // response, so it is an approximation of what Canvas used, not a
          // read of it (BRU-2797 §7.1).
          start_date: startDate ?? isoDateAtUtcMidnight(-PLANNER_DEFAULT_WINDOW_DAYS),
          end_date: endDate ?? isoDateAtUtcMidnight(PLANNER_DEFAULT_WINDOW_DAYS),
        }
      },
    },
  ]
}
