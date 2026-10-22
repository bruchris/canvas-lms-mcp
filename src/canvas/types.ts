import type { CanvasId } from './id'

// --- Config ---

export interface CanvasClientConfig {
  token: string
  baseUrl: string
  maxPaginationPages?: number
}

// --- Error ---

export interface CanvasErrorResponse {
  errors?: Array<{ message: string }>
  message?: string
}

// --- Courses ---

export interface CanvasCourse {
  id: CanvasId
  name: string
  course_code: string
  workflow_state: string
  enrollment_term_id?: CanvasId
  total_students?: number
  syllabus_body?: string
  term?: CanvasTerm
  enrollments?: CanvasEnrollment[]
  account_id?: CanvasId
  root_account_id?: CanvasId
  is_public?: boolean
  is_public_to_auth_users?: boolean
  public_syllabus?: boolean
  public_syllabus_to_auth?: boolean
  public_description?: string | null
  storage_quota_mb?: number
  storage_quota_used_mb?: number
  hide_final_grades?: boolean
  license?: string | null
  allow_student_assignment_edits?: boolean
  allow_wiki_comments?: boolean
  allow_student_forum_attachments?: boolean
  open_enrollment?: boolean
  self_enrollment?: boolean
  restrict_enrollments_to_course_dates?: boolean
  course_format?: string | null
  access_restricted_by_date?: boolean
  time_zone?: string
  blueprint?: boolean
  template?: boolean
  created_at?: string
  start_at?: string | null
  end_at?: string | null
  default_view?: string
  locale?: string
  apply_assignment_group_weights?: boolean
  permissions?: Record<string, boolean>
  sections?: CanvasCourseSection[]
  teachers?: Array<{
    id: CanvasId
    anonymous_id?: string
    display_name: string
    avatar_image_url?: string | null
    html_url?: string
    pronouns?: string | null
  }>
  course_progress?: CanvasCourseProgress
  image_download_url?: string | null
  banner_image_download_url?: string | null
  concluded?: boolean
  post_manually?: boolean
  grading_standard_id?: CanvasId | null
}

export interface CanvasCourseSection {
  id: CanvasId
  name: string
  start_at?: string | null
  end_at?: string | null
  created_at?: string
  restrict_enrollments_to_section_dates?: boolean
  nonxlist_course_id?: CanvasId | null
  sis_section_id?: string | null
  sis_course_id?: string | null
}

export interface CanvasCourseProgress {
  requirement_count: number
  requirement_completed_count: number
  next_requirement_url?: string | null
  completed_at?: string | null
}

export interface CanvasTerm {
  id: CanvasId
  name: string
  start_at: string | null
  end_at: string | null
}

export interface CanvasEnrollmentGrades {
  current_grade: string | null
  current_score: number | null
  final_grade: string | null
  final_score: number | null
}

export interface CanvasEnrollment {
  id: CanvasId
  course_id: CanvasId
  user_id: CanvasId
  type: string
  role: string
  role_id?: CanvasId
  enrollment_state: string
  created_at?: string
  updated_at?: string
  start_at?: string | null
  end_at?: string | null
  course_section_id?: CanvasId
  last_activity_at?: string | null
  last_attended_at?: string | null
  total_activity_time?: number
  html_url?: string
  sis_account_id?: string | null
  sis_course_id?: string | null
  sis_section_id?: string | null
  sis_user_id?: string | null
  grades?: CanvasEnrollmentGrades
  user?: CanvasUser
  current_points?: number | null
  locked?: boolean
  can_be_removed?: boolean
  avatar_url?: string
  observed_users?: CanvasUser[]
  group_ids?: CanvasId[]
  uuid?: string
}

// The `*Params` interfaces below are REQUEST bodies, not response shapes, so
// their ID-named properties migrate with the input side in PR 1b. They live in
// `types.ts`, which §3.6's declaration walk excludes wholesale — correct for
// response types, which are PR 2a's, and a gap for these six. Noted in the PR.
export interface CreateCourseParams {
  account_id: CanvasId
  name: string
  course_code?: string
  start_at?: string
  end_at?: string
}

export interface UpdateCourseParams {
  name?: string
  course_code?: string
  start_at?: string
  end_at?: string
  default_view?: 'feed' | 'wiki' | 'modules' | 'assignments' | 'syllabus'
  syllabus_body?: string
  grading_standard_id?: CanvasId | null
  apply_assignment_group_weights?: boolean
  hide_final_grades?: boolean
}

// --- Assignments ---

export interface CanvasAssignment {
  id: CanvasId
  name: string
  description: string | null
  due_at: string | null
  unlock_at?: string | null
  lock_at?: string | null
  points_possible: number
  grading_type: string
  submission_types: string[]
  course_id: CanvasId
  rubric_settings?: { id: CanvasId }
  group_category_id?: CanvasId | null
  quiz_id?: CanvasId | null
  allowed_attempts: number
  assignment_group_id?: CanvasId
  position?: number
  muted?: boolean
  published?: boolean
  only_visible_to_overrides?: boolean
  locked_for_user?: boolean
  html_url?: string
  all_dates?: CanvasAssignmentDate[]
  overrides?: CanvasAssignmentOverride[]
  submission?: CanvasSubmission | CanvasSubmission[]
  has_submitted_submissions?: boolean
  needs_grading_count?: number
  can_edit?: boolean
  score_statistics?: {
    min: number
    max: number
    mean: number
    upper_q?: number
    median?: number
    lower_q?: number
  }
  assignment_visibility?: CanvasId[]
  is_quiz_assignment?: boolean
  is_quiz_lti_assignment?: boolean // true when backed by the New Quizzes (Quizzes.Next) LTI tool
  in_closed_grading_period?: boolean
  post_to_sis?: boolean
  integration_id?: string | null
  integration_data?: Record<string, unknown>
}

export interface CanvasAssignmentDate {
  id?: CanvasId
  base?: boolean
  title?: string
  due_at: string | null
  unlock_at: string | null
  lock_at: string | null
}

export interface CanvasAssignmentOverride {
  id: CanvasId
  assignment_id: CanvasId
  title: string
  due_at?: string | null
  unlock_at?: string | null
  lock_at?: string | null
  all_day?: boolean
  all_day_date?: string | null
  student_ids?: CanvasId[]
  group_id?: CanvasId
  course_section_id?: CanvasId
}

export interface CanvasAssignmentGroup {
  id: CanvasId
  name: string
  position: number
  group_weight: number
  sis_source_id?: string | null
  integration_data?: Record<string, unknown>
  rules?: {
    drop_lowest?: number
    drop_highest?: number
    never_drop?: CanvasId[]
  }
  assignments?: CanvasAssignment[]
  any_assignment_in_closed_grading_period?: boolean
}

export interface CanvasUpcomingEvent {
  id: CanvasId
  title: string
  type: string
  workflow_state?: string
  context_code: string
  start_at: string | null
  end_at: string | null
  url?: string | null
  html_url?: string
  assignment?: CanvasAssignment
}

// --- Submissions ---

export interface CanvasSubmission {
  id: CanvasId
  assignment_id: CanvasId
  user_id: CanvasId
  grader_id?: CanvasId | null
  submitted_at: string | null
  graded_at?: string | null
  posted_at?: string | null
  score: number | null
  entered_score?: number | null
  grade: string | null
  entered_grade?: string | null
  body: string | null
  url: string | null
  attempt: number | null
  workflow_state: string
  late?: boolean
  missing?: boolean
  late_policy_status?: string | null
  points_deducted?: number | null
  seconds_late?: number
  excused?: boolean | null
  grade_matches_current_submission?: boolean
  assignment_visible?: boolean
  anonymous_id?: string
  preview_url?: string
  html_url?: string
  read_status?: 'read' | 'unread'
  custom_grade_status_id?: CanvasId | null
  attachments?: CanvasAttachment[]
  submission_comments?: CanvasSubmissionComment[]
  submission_history?: CanvasSubmission[]
  rubric_assessment?: Record<
    string,
    { points?: number | null; comments?: string | null; rating_id?: string | null }
  >
  user?: CanvasUser
  assignment?: CanvasAssignment
  course?: CanvasCourse
  group?: CanvasGroup
}

export interface CanvasAttachment {
  id: CanvasId
  filename: string
  display_name: string
  url: string
  content_type: string
  size: number
}

/**
 * Canvas's `user_display_json` (`lib/api/v1/user.rb`): `{id, anonymous_id,
 * display_name, avatar_image_url, html_url, pronouns}`, where `display_name` is
 * `user.short_name` — a REAL NAME. It is returned `{}` when the user is nil, so
 * every field is optional.
 *
 * This shape shows up wherever Canvas wants "enough to render a byline", and it
 * is easy to miss because it spells the name `display_name` rather than `name`:
 * a wrapper that looks for `name` / `user_name` / `author_name` walks straight
 * past it. The pseudonymizer rewrites `display_name` and nulls the sibling
 * `avatar_image_url` / `pronouns` — a face and a pronoun set beside a masked
 * name are the same leak — but never `id` / `anonymous_id` / `html_url`, which
 * are identifiers, and identifiers are preserved everywhere in this layer.
 */
export interface CanvasUserDisplay {
  id?: CanvasId
  anonymous_id?: string
  display_name?: string
  avatar_image_url?: string | null
  html_url?: string
  pronouns?: string | null
  [key: string]: unknown
}

export interface CanvasSubmissionComment {
  id: CanvasId
  /**
   * `null` when the viewer lacks `:read_author` on the comment:
   * `submission_comment_json`'s `else` branch sets `author_id: nil` together
   * with `author: {}` and `author_name: "Anonymous User"`
   * (lib/api/v1/submission_comment.rb:68-72 at the pinned Canvas SHA
   * 1c9f0bb8013ed69c4f2efe11fd483025469b7e6c).
   *
   * ~~Declared non-null.~~ Widened 2026-10-10 (BRU-2865): the declaration had
   * contradicted that branch since the branch was first cited, and the two
   * sites that key a pseudonym off this field were written against the
   * declaration rather than the serializer. Derive the key with
   * `submissionCommentAuthorKey` rather than `String(author_id)` — `null`
   * means "this comment carries no identity at all", not "key the map on the
   * string `null`".
   */
  author_id: CanvasId | null
  author_name: string
  comment: string
  created_at: string
  /**
   * `submission_comment_json` sets this to `user_display_json(comment.author,
   * …)` whenever the viewer holds `:read_author` — so a comment normally
   * carries the author's `display_name` BESIDE `author_name`, and masking only
   * `author_name` leaves the real name one key over.
   *
   * ~~Optional because the anonymous-moderated branch replaces it with `{}`.~~
   * Corrected 2026-10-10 (BRU-2864): it is `submission_comment_json`'s OWN
   * `else` branch that sets `author: {}`, together with `author_id: nil` and
   * `author_name: "Anonymous User"`, when the viewer lacks `:read_author`
   * (lib/api/v1/submission_comment.rb:68-72 at the pinned Canvas SHA
   * 1c9f0bb8013ed69c4f2efe11fd483025469b7e6c).
   * `anonymous_moderated_submission_comments_json` — the serializer that does
   * `json.delete(:author_id)` — never emits this key at all, because
   * `ANONYMOUS_MODERATED_JSON_ATTRIBUTES` (lines 24-36) has no `author` entry.
   * So there is no shape in either serializer where `author.id` survives an
   * absent `author_id`, and this key is never a fallback source for it.
   */
  author?: CanvasUserDisplay
}

export interface CanvasGradebookHistoryGrader {
  id: CanvasId
  name: string
  assignments: CanvasId[]
}

export interface CanvasGradebookHistoryDay {
  date: string
  graders: CanvasGradebookHistoryGrader[]
}

export interface CanvasGradebookHistorySubmissionVersion extends CanvasSubmission {
  assignment_name?: string
  current_grade?: string | null
  current_graded_at?: string | null
  current_grader?: string | null
  grade_matches_current_submission?: boolean
  graded_at?: string | null
  grader?: string | null
  grader_id?: CanvasId | null
  new_grade?: string | null
  new_graded_at?: string | null
  new_grader?: string | null
  previous_grade?: string | null
  previous_graded_at?: string | null
  previous_grader?: string | null
  user_name?: string
  submission_type?: string | null
}

export interface CanvasGradebookHistorySubmission {
  submission_id: CanvasId
  versions: CanvasGradebookHistorySubmissionVersion[] | null
}

// --- Rubrics ---

export interface CanvasRubric {
  id: CanvasId
  title: string
  points_possible: number
  data: CanvasRubricCriterion[]
  /** Present only when the rubric is fetched with an association include. */
  associations?: CanvasRubricAssociation[]
}

/** POST /courses/:id/rubrics result; the association is present only when one was requested. */
export interface CanvasRubricCreateResult {
  rubric: CanvasRubric
  rubric_association?: CanvasRubricAssociation
}

export interface CanvasRubricCriterion {
  id: string
  description: string
  points: number
  ratings: CanvasRubricRating[]
}

export interface CanvasRubricRating {
  id: string
  description: string
  points: number
}

/** A rubric ↔ assignment link, as returned by `POST /courses/:id/rubric_associations`. */
export interface CanvasRubricAssociation {
  id: CanvasId
  rubric_id: CanvasId
  association_id: CanvasId
  association_type: string
  use_for_grading: boolean
  purpose: string
  hide_score_total?: boolean
  hide_points?: boolean
  hide_outcome_results?: boolean
  /** Canvas adds this to the association returned from a create. */
  association_count?: number
}

export interface CanvasRubricAssessment {
  id: CanvasId
  rubric_id: CanvasId
  score: number
  data: Array<{
    criterion_id: string
    points: number
    comments: string
  }>
}

// --- Quizzes ---

export interface CanvasQuiz {
  id: CanvasId
  title: string
  quiz_type: string
  description?: string | null // HTML shown above the quiz's questions
  points_possible: number
  question_count: number
  due_at: string | null
  published: boolean
  time_limit?: number | null // quiz duration in minutes; null if untimed
  /**
   * The assignment Canvas created for this quiz, when one exists. Always
   * serialized (`quiz_serializer.rb:79` is unconditional — this is a
   * required key, not optional), but the VALUE is `null` for a
   * `practice_quiz` or an ungraded `survey`: `Quiz#for_assignment?` requires
   * both an `assignment_id` and `submission_types == 'online_quiz'`. Needed
   * to reach a submitted attempt's answer text via the Submissions API —
   * see `src/tools/quiz-question-responses.ts` and BRU-3080.
   */
  assignment_id: CanvasId | null
  /**
   * Survey-only: Canvas's serializer filters this key to `quiz.survey?`
   * (`quiz_serializer.rb:275-276`), so it is emitted ONLY for `survey` /
   * `graded_survey` `quiz_type` — absent, not `false`, on every other quiz.
   * `true` means `Quiz#anonymous_survey?`, which also disables the
   * submission-history answer-text lookup (no `include[]=user`-free way to
   * join an anonymous survey's identity back to its submission).
   */
  anonymous_submissions?: boolean
}

/**
 * The real domain of a Classic Quiz answer's correctness, from
 * `Quizzes::QuizQuestion::UserAnswer#correctness` (pinned SHA
 * 1c9f0bb8013ed69c4f2efe11fd483025469b7e6c): `true`/`false` once every part
 * of a question is scored, `'partial'` for a part-credit multi-part answer,
 * `'no_score'` for a `text_only_question` (zero answerable parts),
 * `'undefined'` — the literal STRING, not the JS value — for every
 * manually-graded (essay / file-upload) question pending a human score, and
 * `'defined'` once `update_scores` has written a manual score
 * (`quiz_submission.rb:781`). See BRU-3080.
 */
export type CanvasQuizCorrectness = boolean | 'partial' | 'no_score' | 'undefined' | 'defined'

export interface CanvasQuizSubmission {
  id: CanvasId
  quiz_id: CanvasId
  user_id: CanvasId
  submission_id: CanvasId
  attempt: number
  score: number | null
  kept_score: number | null
  workflow_state: string
  // Per-student accommodation stored on the submission record. Canvas sets these
  // when a quiz extension is applied (POST .../extensions); they are the only
  // documented way to READ a student's extra time / attempts back.
  extra_time?: number | null // extra time in minutes
  extra_attempts?: number | null
}

export interface CanvasQuizQuestion {
  id: CanvasId
  quiz_id: CanvasId
  position: number
  question_text: string
  question_type: string
  points_possible: number
  answers?: Array<{ id: CanvasId; text: string; weight: number }>
}

export interface CanvasQuizSubmissionQuestion {
  id: CanvasId
  quiz_id: CanvasId
  /**
   * Present ONLY while the attempt is `untaken` (still in progress):
   * `quiz_submission_question_json`'s `if qs.submission_data.is_a? Hash`
   * branch (the ungraded shape) is the only one that assigns `data[:answer]`
   * — once an attempt is `complete` or `pending_review`, `submission_data`
   * is an Array and the `else` branch never assigns this key at all. So for
   * every submitted attempt this field is unconditionally absent, not
   * nullable-but-present. See `getSubmissionAnswers`'s doc comment and
   * BRU-3080 — the submitted value lives in the Submissions API's
   * `submission_history` instead (`CanvasQuizSubmissionHistoryAnswer`).
   */
  answer?: string | number | string[] | Record<string, unknown> | null
  /**
   * The raw {@link CanvasQuizCorrectness} domain. Optional because the
   * `else` branch's `return data if question_data.empty?` guard omits both
   * `correct` and `flagged` entirely when the submission has no graded entry
   * for this question (e.g. served but unanswered, or added after the
   * attempt). See
   * docs/superpowers/specs/2026-07-09-issue-240-quiz-question-responses.md
   * §3 (post-implementation correction, BRU-3080).
   */
  correct?: CanvasQuizCorrectness
  /**
   * Meaningful ONLY while the attempt is `untaken`. For a submitted attempt,
   * the `else` branch hardcodes `data[:flagged] = false` whenever
   * `question_data` is non-empty — never the student's real flag state post-
   * submission — and omits the key entirely on the empty-question-data path.
   * Declared optional so a submitted-attempt response can omit this
   * structurally-false/absent value rather than assert something untrue;
   * `get_quiz_question_responses` drops it from its output for exactly that
   * reason (BRU-3080).
   */
  flagged?: boolean
}

/**
 * One entry of `QuizSubmission#submission_data` for a GRADED attempt (an
 * Array, not the in-progress Hash — see `Quizzes::SubmissionGrader#grade_submission`),
 * reached via the Submissions API's quiz branch:
 * `GET .../assignments/:id/submissions?include[]=submission_history` →
 * `submission_history[].submission_data[]`
 * (`lib/api/v1/submission.rb` `quiz_submission_attempt_json`). This is NOT a
 * `CanvasQuizSubmissionQuestion` — it is the Submissions API's view of the
 * same answer, keyed by `question_id` rather than by quiz-submission-
 * question id, and it is the only place a completed attempt's actual
 * submitted answer value survives. See BRU-3080.
 *
 * `answer_details` (everything beyond `question_id`/`correct`/`points`)
 * varies by Classic Quiz question type (`Quizzes::QuizQuestion::UserAnswer`
 * and its per-type subclasses):
 * - `essay_question`: `text` (HTML-sanitized free text)
 * - `file_upload_question`: `attachment_ids` (REPLACES `answer_details`; no `text`)
 * - `multiple_choice` / `true_false` / `short_answer` / `numerical` / `calculated`: `text` + `answer_id`
 * - `multiple_answers_question`: `text` + one `answer_<answerId>` key per option (`"1"` | `"0"`)
 * - `fill_in_multiple_blanks` / `multiple_dropdowns`: `text` + `answer_for_<blank>` + `answer_id_for_<blank>` per blank
 * - `matching_question`: per-part keys
 *
 * The dynamic per-type keys above have no fixed name, so they are reachable
 * only through the index signature — never widen this type to enumerate
 * them; that would re-guess an exact shape this server has not independently
 * verified against a live Canvas instance (see BRU-3080 §5).
 */
export interface CanvasQuizSubmissionHistoryAnswer {
  question_id: CanvasId
  /** Same {@link CanvasQuizCorrectness} domain as `CanvasQuizSubmissionQuestion.correct`. */
  correct?: CanvasQuizCorrectness
  points?: number | null
  /** Present for choice-type questions; this server's id normalizer stringifies it unconditionally (`/(^|_)id$/i`). */
  answer_id?: CanvasId
  /** `file_upload_question` only; replaces the rest of `answer_details`. */
  attachment_ids?: CanvasId[]
  /** The free-text or raw submitted value. Never transformed by ID normalization — it is not an identifier. */
  text?: string
  [key: string]: unknown
}

/**
 * One `submission_history[]` entry on a quiz assignment's submission —
 * `lib/api/v1/submission.rb` `quiz_submission_attempt_json`. NOT a
 * `CanvasSubmission`: Canvas replaces the normal submission-version shape
 * with this one whenever `submission.quiz_submission && assignment.quiz &&
 * !assignment.quiz.anonymous_survey?`, overwriting `attempt` to the QUIZ
 * attempt number so it joins directly against
 * `CanvasQuizSubmission.attempt` / `CanvasQuizSubmissionQuestion`. See
 * BRU-3080 §5.
 */
export interface CanvasQuizSubmissionHistoryEntry {
  attempt: number
  submission_data: CanvasQuizSubmissionHistoryAnswer[]
  [key: string]: unknown
}

export interface CanvasQuizExtension {
  user_id: CanvasId
  // Canvas field name (minutes); tool output renames this to extra_time_minutes.
  extra_time: number | null
  extra_attempts: number | null
}

// --- Quiz Submission Events ---

export interface CanvasQuizSubmissionEvent {
  // Canvas returns a stable per-event id as a string (e.g. "3409").
  id: string
  event_type: string
  created_at: string
  // Per the Canvas API, event_data is a single object of contextual key/value
  // pairs (e.g. { answer: "42" } on question_answered) or null (e.g. on
  // page_blurred / page_focused) — never an array. The keys vary by event_type,
  // so the value bag is left opaque.
  event_data: Record<string, unknown> | null
}

export interface CanvasQuizSubmissionEventsResponse {
  // `| null` is a defensive allowance: Canvas returns an empty array for an
  // empty log, but the client null-guards the field rather than assume it.
  quiz_submission_events: CanvasQuizSubmissionEvent[] | null
}

// --- Files ---

export interface CanvasFile {
  id: CanvasId
  filename?: string
  display_name: string
  content_type: string
  url: string
  size: number
  folder_id: CanvasId
  created_at?: string
  updated_at?: string
}

export interface CanvasFolder {
  id: CanvasId
  name: string
  full_name: string
  parent_folder_id: CanvasId | null
  created_at?: string
  files_count?: number
  folders_count?: number
}

export interface CanvasFileUploadInfo {
  upload_url: string
  upload_params: Record<string, string>
}

export interface DownloadedFile {
  type: 'text' | 'resource'
  filename: string
  contentType: string
  size: number
  text?: string
  base64?: string
}

// --- Users ---

export interface CanvasUser {
  id: CanvasId
  name: string
  sortable_name?: string
  short_name?: string
  login_id?: string
  sis_user_id?: string | null
  integration_id?: string | null
  email?: string
  avatar_url?: string
  time_zone?: string
  locale?: string | null
  last_login?: string | null
  bio?: string | null
  pronouns?: string | null
  uuid?: string
  created_at?: string
  effective_locale?: string
  enrollments?: CanvasEnrollment[]
  permissions?: Record<string, boolean>
  custom_links?: Array<{ text: string; url: string; tool_id?: string; icon_class?: string }>
  locked?: boolean
}

export interface CanvasUserProfile {
  id: CanvasId
  name: string
  primary_email: string
  login_id: string
  avatar_url: string
  time_zone: string
  locale: string
}

// --- Groups ---

/**
 * Canvas's `group_json` (`lib/api/v1/group.rb`).
 *
 * `leader` is the identity surface, and it is NOT behind an include:
 * `hash["leader"] = group.leader ? user_display_json(group.leader, group) : nil`
 * runs on every render, so every endpoint that returns a group carries its
 * leader's real `display_name`, avatar and pronouns. Both read paths —
 * `GET /courses/:id/groups` and `GET /appointment_groups/:id/groups` — must run
 * it through {@link Pseudonymizer.anonymizeGroups} (#441); the two write paths
 * strip it instead (#438).
 *
 * `users` IS behind `include[]=users`, which no call site here sends. It is
 * declared because the handlers that strip or pseudonymize it should do so
 * against a type that admits the field rather than an inline intersection —
 * the previous type stopped at four fields, which is a large part of why the
 * leader leak went unnoticed for two releases.
 */
export interface CanvasGroup {
  id: CanvasId
  name: string
  group_category_id: CanvasId
  members_count: number
  description?: string | null
  is_public?: boolean
  join_level?: string
  max_membership?: number | null
  created_at?: string
  storage_quota_mb?: number
  context_type?: string
  course_id?: CanvasId
  account_id?: CanvasId
  context_name?: string
  avatar_url?: string | null
  role?: string | null
  leader?: CanvasUserDisplay | null
  users?: CanvasUser[]
}

/** A group set. Group assignments point at a category through `group_category_id`. */
export interface CanvasGroupCategory {
  id: CanvasId
  name: string
  role?: string | null
  self_signup?: string | null
  group_limit?: number | null
  context_type?: string
  course_id?: CanvasId
  groups_count?: number
}

/** Canvas serializes only these fields for a membership (no user names). */
export interface CanvasGroupMembership {
  id: CanvasId
  group_id: CanvasId
  user_id: CanvasId
  workflow_state: string
  moderator: boolean
  just_created?: boolean
}

// --- Modules ---

/**
 * The completion-requirement types Canvas validates. There are **six**, not the five
 * the Canvas documentation page foregrounds: `min_percentage` is in
 * `ContextModule#validate_completion_requirements`'s
 * `scoreable_types = %w[must_submit min_score min_percentage]` and is serialized under
 * its own key, separate from `min_score`
 * (`app/models/context_module.rb`, `lib/api/v1/context_module.rb`).
 *
 * Canvas enforces the set on write — `validate_completion_requirements` drops anything
 * outside it — so a value outside this union can only arrive from a newer Canvas than
 * the one this union was derived against. Consumers must still carry an unrecognized
 * arm rather than assume exhaustiveness at runtime.
 */
export type CanvasCompletionRequirementType =
  | 'must_view'
  | 'must_contribute'
  | 'must_submit'
  | 'must_mark_done'
  | 'min_score'
  | 'min_percentage'

/**
 * A module item's completion requirement, as `module_item_json` emits it
 * (`lib/api/v1/context_module.rb`).
 *
 * `completed` is **optional on purpose, and its absence is not `false`.** The
 * serializer attaches it only when a progression object was passed:
 *
 * ```ruby
 * ch["completed"] = !!(progression.requirements_met.present? && …) if progression
 * ```
 *
 * and a progression exists only when the controllers' `find_student` resolved a
 * student — either `params[:student_id]`, or the caller being able to
 * `participate_as_student`. So a teacher, a TA, an admin, or an unauthenticated reader
 * of a public course receives requirement objects with **no `completed` key at all**.
 * Reading `completed === false` as "not satisfied" reports an entire course as
 * incomplete for those callers. Treat absence as *unknown*, never as unsatisfied.
 *
 * `min_score` is present only when `type === 'min_score'`, and `min_percentage` only
 * when `type === 'min_percentage'`; they are separate keys, not one threshold field.
 */
export interface CanvasCompletionRequirement {
  type: CanvasCompletionRequirementType
  /** Threshold for `type === 'min_score'` only. */
  min_score?: number
  /** Threshold for `type === 'min_percentage'` only. Absent when `type` is `min_score`. */
  min_percentage?: number
  /** Absent when no progression was loaded — see the interface doc. Never default to `false`. */
  completed?: boolean
}

/**
 * `content_details` on a module item, from `include[]=content_details`
 * (`Api::V1::ContextModule#content_details`).
 *
 * Two traps are modelled here rather than commented at the call site:
 *
 * 1. **Every field below is dropped when falsy.** The serializer copies with
 *    `if (val = item.try(attr))`, a truthiness test — so `locked: false` and
 *    `points_possible: 0` are omitted from the hash entirely. Absence of `locked` must
 *    not be read as "not locked"; absence of `points_possible` must not be read as
 *    "no points".
 * 2. **`locked_for_user` is the authoritative lock signal, not `locked`.** It comes from
 *    `locked_json`, which always sets `locked_for_user` and adds `lock_info` /
 *    `lock_explanation` only when locked (`lib/api/v1/locked.rb`). `locked_for_user` is
 *    therefore the only one of the two that is reliably present.
 *
 * `due_at`, `unlock_at` and `lock_at` are the **effective** dates for the calling user:
 * `content_details` applies `item.overridden_for(current_user)` before reading them, so
 * they already carry the caller's assignment overrides and must not be reconstructed
 * from the overrides endpoints.
 *
 * `lock_explanation` is server-generated text with interpolated course content, so it is
 * Canvas-authored untrusted content for fencing purposes.
 *
 * Indexed so a field a newer Canvas adds survives rather than being a type error.
 */
export interface CanvasModuleItemContentDetails {
  /** Always present: `locked_json` sets it unconditionally. */
  locked_for_user?: boolean
  /** Present only when locked. Shape is Canvas's `locked_for?` return value. */
  lock_info?: Record<string, unknown>
  /** Present only when locked. Untrusted Canvas-authored text. */
  lock_explanation?: string
  /** Dropped when `false` — absence is not "unlocked". Prefer `locked_for_user`. */
  locked?: boolean
  /** Dropped when `false`. */
  hidden?: boolean
  /** Effective due date for the calling user (overrides already applied). */
  due_at?: string | null
  unlock_at?: string | null
  lock_at?: string | null
  /** Dropped when `0` — absence is not "no points". */
  points_possible?: number
  display_name?: string
  usage_rights?: Record<string, unknown>
  thumbnail_url?: string
  [key: string]: unknown
}

export interface CanvasModule {
  id: CanvasId
  name: string
  position: number
  items_count: number
  items_url?: string
  /**
   * The caller's own progression `workflow_state`, emitted only `if progression` —
   * absent for a caller `find_student` could not resolve to a student. Same gate as
   * `CanvasCompletionRequirement.completed`, so absence here is unknown, not "unlocked".
   */
  state?: string
  /** Emitted only `if progression`, alongside `state`. */
  completed_at?: string | null
  published?: boolean
  unlock_at?: string | null
  /**
   * Whether the module's requirements are conjunctive. Derived and serialized
   * unconditionally: `(completion_requirements.present? && requirement_count == 1) ? "one" : "all"`.
   *
   * Under `'one'` the module completes when **any single** requirement is met, so a
   * module with five unsatisfied rows and one satisfied row is a *completed* module.
   * Branch on this field, never on the presence of `requirement_count`.
   */
  requirement_type?: 'all' | 'one'
  /**
   * The count behind `requirement_type`. Serialized only when
   * `opts[:can_have_requirement_count]` is set from `@context.requirement_count_api_enabled?`,
   * so the integer can be withheld while `requirement_type` is still readable.
   */
  requirement_count?: number | null
  /** Serialized unconditionally. The progression's `current_position` is **not** exposed. */
  require_sequential_progress?: boolean
  /** Serialized unconditionally; `context_module` prerequisites only. */
  prerequisite_module_ids?: CanvasId[]
  publish_final_grade?: boolean
}

export interface CanvasModuleItem {
  id: CanvasId
  module_id: CanvasId
  title: string
  position: number
  type: string
  content_id?: CanvasId
  html_url?: string
  page_url?: string
  indent?: number
  published?: boolean
  external_url?: string
  /** Present only when the item carries a completion requirement. */
  completion_requirement?: CanvasCompletionRequirement
  content_details?: CanvasModuleItemContentDetails
}

export interface CanvasCourseStructureModule {
  id: CanvasId
  name: string
  position: number
  state: string
  unlock_at: string | null | undefined
  items: Array<
    Pick<
      CanvasModuleItem,
      | 'id'
      | 'title'
      | 'type'
      | 'position'
      | 'published'
      | 'html_url'
      | 'page_url'
      | 'content_id'
      | 'content_details'
    >
  >
}

export interface CanvasCourseStructure {
  modules: CanvasCourseStructureModule[]
  summary: {
    total_modules: number
    total_items: number
    items_by_type: Record<string, number>
  }
}

// --- Pages ---

export interface CanvasPage {
  page_id: CanvasId
  url: string
  title: string
  body?: string
  published: boolean
  created_at?: string
  updated_at: string
  editing_roles?: string
}

// --- Discussions ---

export interface CanvasDiscussionTopic {
  id: CanvasId
  title: string
  message: string | null
  posted_at: string
  discussion_type: string
  published: boolean
  /**
   * Canvas's own record of whether this topic is an announcement. Canvas silently
   * downgrades an `is_announcement: true` create/update request to a regular topic
   * (still HTTP 200) when the caller lacks announcement-create permission, so callers
   * must check this field rather than assume the request was honored.
   */
  is_announcement?: boolean
  /**
   * Whether the topic requires an initial post before the student can read others'
   * posts. Serialized unconditionally in `serialize_additional_topic_fields`
   * (`lib/api/v1/discussion_topics.rb`), paired with `user_can_see_posts`.
   */
  require_initial_post?: boolean
  /**
   * `topic.user_can_see_posts?(user)`, serialized unconditionally. Its predicate is
   *
   * ```ruby
   * !require_initial_post? || grants_right?(user, session, :read_as_admin) ||
   *   ([user.id] + associated_user_ids).intersect?(user_ids_who_have_posted_and_admins)
   * ```
   *
   * so with `require_initial_post === true` this field is **positive evidence** about
   * whether the caller has posted — not an inference from silence.
   *
   * **It is only valid when the caller's own enrollment in the course is a student
   * enrollment.** `read_as_admin` short-circuits the predicate to `true`, and
   * `user_ids_who_have_posted_and_admins` counts admins as having posted, so for a
   * teacher, TA, admin or account-level token this field always reads `true` and says
   * nothing about anyone's posting. Gate any derivation on the caller being a student.
   */
  user_can_see_posts?: boolean
  /** `topic.locked?`, serialized unconditionally. */
  locked?: boolean
  /**
   * IDs of the per-group child topics of a group discussion, from
   * `topic.child_topics.active.pluck(:id, :context_id)` on a root topic; `[]` otherwise.
   */
  topic_children?: CanvasId[]
  /** The same child topics as `topic_children`, paired with the group that owns each. */
  group_topic_children?: Array<{ id: CanvasId; group_id: CanvasId }>
  /**
   * Emitted **only** `if topic.checkpoints?`, together with
   * `reply_to_entry_required_count`. Absence means "not checkpointed".
   */
  is_checkpointed?: boolean
  /**
   * How many replies-to-entries the topic *requires*. Emitted only `if topic.checkpoints?`.
   *
   * This is a **required** count and never a **completed** one: Canvas exposes no
   * per-student "replies made" counter on the topic or on the planner item. The
   * checkable half lives in the two checkpoint sub-assignments
   * (`CheckpointLabels::REPLY_TO_TOPIC` / `REPLY_TO_ENTRY`), each with its own
   * submission. Rendering "2 of 3 replies done" from this field would be fabrication.
   */
  reply_to_entry_required_count?: number
  /** Anonymity mode of the topic. When set, `author` is nulled by the serializer. */
  anonymous_state?: string | null
  // `author` (`user_display_json(topic.user, …)`) is deliberately NOT modelled here.
  // It is a third-party user display object — exactly the shape BRU-2863 and BRU-2864
  // leaked through — and nothing that reads a topic for requirement evidence has any
  // use for it. Leaving it off the type keeps it from being passed through by default;
  // a consumer that genuinely needs it must route through the pseudonymizer and say so.
}

export interface CanvasDiscussionEntry {
  id: CanvasId
  user_id: CanvasId
  message: string
  created_at: string
}

export interface CanvasAnnouncement {
  id: CanvasId
  title: string
  message: string
  posted_at: string
}

export interface CreateDiscussionParams {
  title: string
  message?: string
  discussion_type?: 'side_comment' | 'threaded'
  published?: boolean
  require_initial_post?: boolean
  is_announcement?: boolean
  delayed_post_at?: string
}

export interface UpdateDiscussionParams {
  title?: string
  message?: string
  published?: boolean
  require_initial_post?: boolean
  is_announcement?: boolean
  delayed_post_at?: string
}

// --- Calendar ---

export interface CanvasCalendarEvent {
  id: CanvasId
  title: string
  description?: string | null
  start_at: string
  end_at: string | null
  all_day?: boolean
  workflow_state?: string
  context_code: string
  location_name?: string | null
  type: string
  /** Reservation events nested under an appointment slot (present when include[]=child_events). */
  child_events?: CanvasCalendarEvent[]
  /** Participant user on a reservation event when viewed by a manager. Contains student PII. */
  user?: CanvasUser
}

// --- Appointment Groups ---

export interface CanvasAppointmentGroup {
  id: CanvasId
  title: string
  context_codes: string[]
  sub_context_codes?: string[]
  workflow_state: string
  created_at: string
  updated_at: string
  start_at?: string | null
  end_at?: string | null
  description?: string | null
  location_name?: string | null
  location_address?: string | null
  participant_count?: number
  reserved_times?: Array<{ id: CanvasId; start_at: string; end_at: string }>
  appointment_count?: number
  appointments?: CanvasCalendarEvent[]
  participant_type?: string
  participant_visibility?: string
  max_appointments_per_participant?: number | null
  min_appointments_per_participant?: number | null
  html_url?: string
}

// --- Conversations ---

export interface CanvasConversation {
  id: CanvasId
  subject: string
  last_message: string
  last_message_at: string
  message_count: number
  participants: Array<{ id: CanvasId; name: string }>
}

export interface CanvasConversationMessage {
  id: CanvasId
  created_at: string
  body: string
  author_id: CanvasId
  generated: boolean
  media_comment?: { media_id: string; media_type: string; url: string }
  attachments?: Pick<CanvasAttachment, 'id' | 'filename' | 'url'>[]
}

export interface CanvasConversationDetail extends CanvasConversation {
  messages: CanvasConversationMessage[]
}

export interface CanvasConversationUnreadCount {
  unread_count: number
}

// --- Outcomes ---

export type CanvasOutcomeContextType = 'account' | 'course'

export interface CanvasOutcomeRating {
  description: string
  points: number
  mastery?: boolean
  color?: string | null
}

export interface CanvasOutcome {
  id: CanvasId
  url: string
  context_id: CanvasId | null
  context_type: 'Account' | 'Course' | 'Global' | (string & {})
  title: string
  display_name?: string | null
  description?: string
  vendor_guid?: string | null
  points_possible?: number
  mastery_points?: number | null
  calculation_method?: string | null
  calculation_int?: number | null
  ratings?: CanvasOutcomeRating[]
}

export interface CanvasOutcomeGroup {
  id: CanvasId
  url: string
  context_id: CanvasId | null
  context_type: 'Account' | 'Course' | 'Global' | (string & {})
  title: string
  description?: string | null
  vendor_guid?: string | null
  subgroups_url?: string
  outcomes_url?: string
  can_edit?: boolean
}

export interface CanvasOutcomeLink {
  id: CanvasId
  url?: string
  context_id?: CanvasId | null
  context_type?: 'Account' | 'Course' | 'Global' | (string & {})
  outcome_group?: CanvasOutcomeGroup | null
  outcome?: CanvasOutcome | null
  assessed?: boolean
}

export interface CanvasOutcomeAlignment {
  id: CanvasId
  assignment_id: CanvasId | null
  assessment_id: CanvasId | null
  submission_types?: string | null
  url?: string | null
  title: string
}

export interface CanvasOutcomeResult {
  id: CanvasId
  score: number | null
  submitted_or_assessed_at: string | null
  links: {
    user: CanvasId
    learning_outcome: CanvasId
    alignment: CanvasId
  }
  percent: number | null
}

export interface CanvasOutcomeResultsResponse {
  outcome_results: CanvasOutcomeResult[]
  linked?: {
    users?: CanvasUser[]
    outcomes?: CanvasOutcome[]
    outcome_groups?: CanvasOutcomeGroup[]
    alignments?: CanvasOutcomeAlignment[]
  }
}

export interface CanvasOutcomeRollupScore {
  score: number | null
  count: number
  links: {
    outcome: CanvasId
  }
}

export interface CanvasOutcomeRollup {
  scores: CanvasOutcomeRollupScore[] | null
  name: string
  links: {
    course?: CanvasId
    user?: CanvasId
    section?: CanvasId
  }
}

export interface CanvasOutcomeRollupsResponse {
  rollups: CanvasOutcomeRollup[]
  linked?: {
    users?: CanvasUser[]
    outcomes?: CanvasOutcome[]
    outcome_groups?: CanvasOutcomeGroup[]
    courses?: CanvasCourse[]
    sections?: Array<{ id: CanvasId; name: string }>
  }
}

export interface CanvasOutcomeContributingScoresResponse {
  scores: Array<Record<string, unknown>>
  linked?: {
    users?: CanvasUser[]
    outcomes?: CanvasOutcome[]
    outcome_groups?: CanvasOutcomeGroup[]
    alignments?: CanvasOutcomeAlignment[]
  }
}

export interface CanvasOutcomeMasteryDistributionResponse {
  linked?: {
    outcomes?: CanvasOutcome[]
    outcome_groups?: CanvasOutcomeGroup[]
    alignments?: CanvasOutcomeAlignment[]
  }
  outcomes?: Array<Record<string, unknown>>
}

// --- Accounts ---

export interface CanvasAccountNotification {
  id: CanvasId
  subject: string
  message: string
  start_at: string
  end_at: string | null
  icon: string
}

export interface CanvasAccount {
  id: CanvasId
  name: string
  parent_account_id: CanvasId | null
  root_account_id: CanvasId | null
  uuid: string
  default_storage_quota_mb: number
  default_user_storage_quota_mb: number
  default_group_storage_quota_mb: number
  workflow_state: 'active' | 'deleted'
}

export interface CanvasAccountReport {
  report: string
  title: string
  parameters: Record<string, { required?: boolean; description?: string }> | null
  last_run: {
    id: CanvasId
    report: string
    status: 'created' | 'running' | 'complete' | 'error'
    created_at: string
    started_at: string | null
    ended_at: string | null
    attachment: CanvasFile | null
  } | null
}

// --- Grading Standards ---

export interface CanvasGradingSchemeEntry {
  name: string
  value: number
}

export type CanvasGradingStandardContextType = 'Course' | 'Account'

export interface CanvasGradingStandard {
  id: CanvasId
  title: string
  context_type: CanvasGradingStandardContextType
  context_id: CanvasId
  grading_scheme: CanvasGradingSchemeEntry[]
}

// --- Late policy ---

/**
 * A course's late/missing submission automation policy. Returned (wrapped in a
 * `{ late_policy: ... }` envelope) by `GET /api/v1/courses/:id/late_policy`,
 * which requires the `manage_grades` permission — student tokens receive 403.
 * Canvas creates the underlying row lazily, so a course that has never had a
 * policy saved returns 404.
 */
export interface CanvasLatePolicy {
  id?: CanvasId
  course_id?: CanvasId
  late_submission_deduction_enabled: boolean
  /** Percent deducted per interval (0–100; used as-is, no normalization). */
  late_submission_deduction: number
  late_submission_interval: 'hour' | 'day'
  late_submission_minimum_percent_enabled: boolean
  /** Floor: the grade cannot fall below this percent (0–100). */
  late_submission_minimum_percent: number
  missing_submission_deduction_enabled: boolean
  /** Percent deducted for missing work (typically 100 for auto-zero). */
  missing_submission_deduction: number
}

// --- Assignments (params) ---

export interface CreateAssignmentParams {
  name: string
  description?: string
  points_possible?: number
  due_at?: string
  lock_at?: string
  unlock_at?: string
  submission_types?: string[]
  assignment_group_id?: CanvasId
  published?: boolean
  omit_from_final_grade?: boolean
  grade_group_students_individually?: boolean
}

export type UpdateAssignmentParams = Partial<CreateAssignmentParams>

export interface CreateAssignmentOverrideParams {
  title?: string
  student_ids?: CanvasId[]
  group_id?: CanvasId
  course_section_id?: CanvasId
  due_at?: string | null
  unlock_at?: string | null
  lock_at?: string | null
}

// --- Analytics ---

export interface CanvasCourseActivitySummary {
  date: string
  views: number
  participations: number
}

export interface CanvasStudentActivitySummary {
  page_views: Record<string, number>
  participations: Array<{ created_at: string; url: string }>
}

export interface CanvasActivityStreamItem {
  type:
    | 'Submission'
    | 'DiscussionTopic'
    | 'Announcement'
    | 'Conversation'
    | 'Message'
    | 'Conference'
    | 'Collaboration'
    | 'AssessmentRequest'
    | (string & {})
  count: number
  unread_count: number
}

/**
 * One entry from GET /users/self/activity_stream/summary — `{type, count,
 * unread_count}`. `CanvasActivityStreamItem` above already models this exact
 * shape under a misleading name (it is used for the *course* activity stream
 * summary, not a stream item); this is the correctly-named declaration for the
 * cross-course summary endpoint. Renaming the existing type is tracked
 * separately (BRU-2797 §1 C2, §11 Q4) and is not bundled here.
 */
export interface CanvasActivityStreamSummaryEntry {
  type: string
  count: number
  unread_count: number
}

/**
 * One `root_discussion_entries[]` entry on a `DiscussionTopic` / `Announcement`
 * activity-stream item. Canvas caps the array at `StreamItem::LATEST_ENTRY_LIMIT`
 * (3) at write time, and the nested `user` is the only place the stream spells a
 * discussion author with an identifier beside the name.
 *
 * `user_id` can be missing or `null` — the pinned serializer SHA
 * (1c9f0bb8013ed69c4f2efe11fd483025469b7e6c) can emit this nested `user`
 * object with no usable identity (BRU-2868). There is nothing to key a stable
 * pseudonym on in that case; see `anonymizeActivityStreamEntry`.
 */
export interface CanvasActivityStreamRootEntry {
  user: { user_id?: CanvasId | null; user_name: string }
  message: string | null
}

/**
 * One `latest_messages[]` entry on a `Conversation` activity-stream item, built
 * by `StreamItem#prepare_conversation`: `{id, created_at, author_id, message,
 * participating_user_ids}`.
 *
 * Note what is NOT here: no name of any kind. The stream's conversation arm
 * carries identifiers and message text only, which is why
 * `Pseudonymizer.anonymizeActivityStream` has nothing to rewrite on it (the
 * pseudonymizer rewrites names, never ids — `applyPseudonymToUser` preserves
 * `user.id`). The message body is handled by provenance fencing instead.
 */
export interface CanvasActivityStreamConversationMessage {
  id: CanvasId
  created_at: string
  author_id: CanvasId
  message: string
  participating_user_ids: CanvasId[]
}

/**
 * One `discussion_entries[]` entry on the activity stream's `Submission` arm.
 *
 * `submission_attempt_json` emits `discussion_entries` for any submission to a
 * `discussion_topic` assignment — it is in the default-on
 * `SUBMISSION_OTHER_FIELDS`, and the stream narrows nothing — by calling
 * `discussion_entry_api_json(entries, topic.context, user, session)` with four
 * arguments, i.e. under the default `includes = %i[user_name subentries
 * display_user]`.
 *
 * All three identity surfaces below can carry a real name, and they do NOT
 * appear together. Per `serialize_entry`, `user_name` and `user_id` are both
 * omitted when the entry is deleted, while `user` is emitted whenever
 * `:display_user` is in includes — that guard has no `deleted?` check. So a
 * deleted entry is `{user: {id, display_name, …}}` with no `user_id` and no
 * `user_name`: keying off `user_name` alone silently passes that name through.
 *
 * `recent_replies` is the recursion and the only subentry key upstream emits
 * (`discussion_entry_subentries`, capped at 10 with `has_more_replies`).
 * Upstream nests exactly one level — the method returns `{}` unless
 * `entry.root_entry_id.nil?` — but this type and its pseudonymizer are
 * recursive regardless, because a depth assumption is not worth a leak.
 */
export interface CanvasSubmissionDiscussionEntry {
  id?: CanvasId
  created_at?: string
  updated_at?: string
  parent_id?: CanvasId | null
  /** Omitted when the entry is deleted. */
  user_id?: CanvasId
  /** Omitted when the entry is deleted. */
  user_name?: string
  /** Present even on a deleted entry — see the note above. */
  user?: CanvasUserDisplay
  editor_id?: CanvasId
  message?: string
  deleted?: boolean
  recent_replies?: CanvasSubmissionDiscussionEntry[]
  has_more_replies?: boolean
  [key: string]: unknown
}

/**
 * One entry from `GET /users/self/activity_stream`.
 *
 * `context_type` is `"Course"` | `"Group"` and EXACTLY ONE of `course_id` /
 * `group_id` is present — the key name is derived from the context type by
 * Canvas's `Api::V1::Context#context_data`, so the other key is ABSENT, not
 * null. Canvas's own doc block shows both keys with `group_id: null`; it is
 * wrong. Every optional field is therefore `?` and never `| null`: a
 * `null`-checking consumer cannot detect an absent key.
 *
 * The index signature is deliberate, not laziness. The `Submission` arm merges a
 * whole `submission_json(submission, assignment, …, includes = %w[submission_comments
 * assignment course html_url user])` into the item, so the key set of that one arm
 * is as wide as Canvas's submission serializer and grows with it. The fields named
 * below are the ones this server reads, pseudonymizes or fences; everything else
 * passes through untyped rather than being silently dropped from the declaration.
 */
export interface CanvasActivityStreamEntry {
  /** The stream item's own id, not the underlying object's. */
  id: CanvasId
  created_at: string
  updated_at: string
  title: string | null
  message: string | null
  /**
   * A Ruby class name (`stream_item.data.class.name`), overwritten to
   * `"WebConference"` / `"Collaboration"` for those arms. Not a closed set —
   * `(string & {})` keeps it open, because the value is computed at runtime and
   * the serializer's `else` arm raises rather than enumerating.
   */
  type:
    | 'DiscussionTopic'
    | 'Announcement'
    | 'Conversation'
    | 'Message'
    | 'Submission'
    | 'WebConference'
    | 'Collaboration'
    | 'AssessmentRequest'
    | 'DiscussionEntry'
    | (string & {})
  /** Re-derived from `conversation_participants` on the `Conversation` arm, where it may be null. */
  read_state: boolean | null
  context_type?: 'Course' | 'Group' | (string & {})
  course_id?: CanvasId
  group_id?: CanvasId
  html_url?: string
  /** `Message` items set `url` alongside `html_url`, both from `data.url`. */
  url?: string

  // DiscussionTopic / Announcement
  discussion_topic_id?: CanvasId
  announcement_id?: CanvasId
  total_root_discussion_entries?: number
  require_initial_post?: boolean | null
  user_has_posted?: boolean | null
  root_discussion_entries?: CanvasActivityStreamRootEntry[]

  // Conversation
  conversation_id?: CanvasId
  private?: boolean
  participant_count?: number
  latest_messages?: CanvasActivityStreamConversationMessage[]

  // Message (a notification, not user-authored text)
  message_id?: CanvasId
  notification_category?: string | null

  // Submission — plus everything else `submission_json` merges in.
  submission_id?: CanvasId
  assignment_id?: CanvasId
  user_id?: CanvasId
  grader_id?: CanvasId | null
  body?: string | null
  user?: CanvasUser
  submission_comments?: CanvasSubmissionComment[]
  /**
   * Discussion-topic submissions only, but default-on when they occur — see
   * {@link CanvasSubmissionDiscussionEntry}. Name-bearing and recursive.
   */
  discussion_entries?: CanvasSubmissionDiscussionEntry[]
  /**
   * `attempt.proxy_submitter.short_name` — a BARE STRING, not a user object,
   * emitted with its `proxy_submitter_id` sibling whenever
   * `attempt.proxy_submission?`. Because it is a naked string there is no
   * `user`-shaped container for a generic walker to find.
   */
  proxy_submitter?: string
  proxy_submitter_id?: CanvasId

  // WebConference / Collaboration
  web_conference_id?: CanvasId
  collaboration_id?: CanvasId

  // AssessmentRequest
  assessment_request_id?: CanvasId

  /**
   * `DiscussionEntry` only. The serializer emits this name with NO accompanying
   * identifier (`hash["author_name"] = discussion_entry.author_name` is the whole
   * arm beside `message`), so a stable pseudonym is not derivable for it — see
   * `Pseudonymizer.anonymizeActivityStream`.
   */
  author_name?: string

  [key: string]: unknown
}

/**
 * `PlannerOverride` json from `planner_override_json` — present only when the
 * student has toggled an item's planner visibility ("mark as done" /
 * "dismiss"). It is `api_json` on the AR record plus a re-derived
 * `plannable_type` and `assignment_id`. None of its fields identify anyone
 * but the authenticated caller — it is their own planner override.
 */
export interface CanvasPlannerOverride {
  id: CanvasId
  plannable_id: CanvasId
  plannable_type: string
  user_id: CanvasId
  assignment_id: CanvasId | null
  marked_complete: boolean
  dismissed: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
  [key: string]: unknown
}

/**
 * The caller's own submission status on a planner item's underlying
 * Assignment / SubAssignment / PeerReviewSubAssignment, from
 * `submission_statuses_for` → `submission_statuses`.
 */
export interface CanvasPlannerSubmissionStatus {
  submitted?: boolean
  excused?: boolean
  graded?: boolean
  posted_at?: string | null
  late?: boolean
  missing?: boolean
  needs_grading?: boolean
  has_feedback?: boolean
  redo_request?: boolean
  feedback?: {
    comment: string
    is_media: boolean
    author_name?: string
    author_avatar_url?: string | null
  }
  [key: string]: unknown
}

/**
 * One entry from `GET /planner/items`.
 *
 * `context_type` / `course_id` / `group_id` share the exact derivation and
 * absent-not-null caveat as {@link CanvasActivityStreamEntry}
 * (`Api::V1::Context#context_data`, BRU-2797 §1 C7) — a group-context item
 * has no `course_id` key at all, not a null one.
 *
 * `plannable` is the polymorphic underlying object; its shape is keyed by
 * `plannable_type` and varies per arm (`lib/api/v1/planner_item.rb`
 * `planner_item_json`, pinned SHA 1c9f0bb8013ed69c4f2efe11fd483025469b7e6c).
 * No arm carries a third-party user record — the richest is `planner_note`,
 * whose own `user_id` is the authenticated caller's own id, never another
 * student's (BRU-2797 §6.1) — so this is declared as a loose object rather
 * than a per-arm union.
 */
export interface CanvasPlannerItem {
  context_type?: 'Course' | 'Group' | (string & {})
  course_id?: CanvasId
  group_id?: CanvasId
  /** The caller's own course nickname when set, else the course name — join on `course_id`, never this. */
  context_name?: string
  context_image?: string | null
  plannable_id: CanvasId
  /**
   * A `PlannerHelper::PLANNABLE_TYPES` key — snake_case, NOT the Ruby class
   * name, unlike the activity stream's `type`. Not a closed set — kept open
   * with `(string & {})` for the same reason as the activity stream's `type`.
   */
  plannable_type:
    | 'assignment'
    | 'quiz'
    | 'planner_note'
    | 'wiki_page'
    | 'discussion_topic'
    | 'announcement'
    | 'calendar_event'
    | 'assessment_request'
    | 'sub_assignment'
    | 'peer_review_sub_assignment'
    | (string & {})
  /** `null` unless the student has toggled this item's planner visibility. */
  planner_override: CanvasPlannerOverride | null
  /**
   * `false` or an object — a union, not a nullable object. Canvas initialises
   * `submission_status = { submissions: false }` and only replaces it with a
   * hash for a submittable plannable; a consumer writing
   * `item.submissions?.graded` would silently read `undefined` on the
   * boolean arm if this were declared `CanvasPlannerSubmissionStatus | null`.
   */
  submissions: false | CanvasPlannerSubmissionStatus
  new_activity: boolean
  plannable_date: string
  /** The polymorphic underlying object. Shape varies by `plannable_type`; no arm carries a third-party user record. */
  plannable: Record<string, unknown>
  /** Absent for `planner_note` items — Canvas has no html_url for individual planner notes. */
  html_url?: string
  /** `sub_assignment` discussion-checkpoint items only. */
  details?: { reply_to_entry_required_count: number }
  [key: string]: unknown
}

export interface CanvasStudentSummary {
  id: CanvasId
  page_views: number
  max_page_views?: number
  page_views_level?: number
  participations: number
  max_participations?: number
  participations_level?: number
  tardiness_breakdown: {
    total: number
    on_time: number
    late: number
    missing: number
    floating: number
  }
}

/**
 * The one response type PR 1b widens (BRU-2730 §8). It is the sink for the
 * four `analytics.ts` inline response-shape sites, so Phase 1 cannot leave it
 * `number`; §8's ordering constraint exists because of this — **PR 2a must not
 * widen `CourseSearchResult` again.**
 */
export interface CourseSearchResult {
  id: CanvasId
  title: string
  type: 'page' | 'assignment' | 'discussion' | 'announcement'
  url?: string
  course_id: CanvasId
}

export interface CanvasAssignmentAnalytics {
  assignment_id: CanvasId
  title: string
  points_possible: number
  due_at: string | null
  unlock_at: string | null
  muted: boolean
  min_score: number | null
  max_score: number | null
  median: number | null
  first_quartile: number | null
  third_quartile: number | null
  tardiness_breakdown: {
    total: number
    on_time: number
    late: number
    missing: number
    floating: number
  }
  non_digital_submission: boolean
  submission_count: number
}

// --- Dashboard & Notifications ---

export interface CanvasDashboardCard {
  id: CanvasId
  shortName: string
  originalName: string
  courseCode: string
  assetString: string
  href: string
  term: string | null
  subtitle: string
  enrollmentType: string
  observee: string | null
  color: string | null
  image: string | null
  isFavorited: boolean
  enrollmentState: string
  pagesUrl: string
  frontPageTitle: string | null
  canChangeCourseState: boolean
  defaultView: string
  longName: string
  courseId: CanvasId
  position: number | null
}

export interface CanvasTodoItem {
  type: string
  assignment?: {
    id: CanvasId
    name: string
    due_at: string | null
    course_id: CanvasId
    points_possible: number
  }
  quiz?: {
    id: CanvasId
    title: string
    due_at: string | null
    course_id: CanvasId
  }
  ignore: string
  ignore_permanently: string
  html_url: string
  needs_grading_count?: number
  context_type: string
  course_id?: CanvasId
  group_id?: CanvasId
}

export interface CanvasMissingSubmission {
  id: CanvasId
  name: string
  due_at: string | null
  course_id: CanvasId
  points_possible: number
  submission_types: string[]
  html_url: string
}

// --- New Quizzes ---

export interface CanvasNewQuiz {
  id: CanvasId
  title: string
  instructions: string | null
  points_possible: number
  due_at: string | null
  unlock_at: string | null
  lock_at: string | null
  published: boolean
  assignment_id: CanvasId
}

export interface CanvasNewQuizItem {
  id: string
  position: number
  points_possible: number
  entry_type: 'Item' | 'Stimulus'
  entry: {
    interaction_type_slug: string
    item_body: string
    interaction_data: Record<string, unknown>
    properties: Record<string, unknown>
    scoring_data?: Record<string, unknown>
    scoring_algorithm?: string
    feedback?: Record<string, unknown>
  }
}

export interface CanvasNewQuizAccommodation {
  user_id: CanvasId
  time_multiplier: number | null
  extra_attempts: number | null
}

// --- Peer Reviews ---

export interface CanvasPeerReview {
  id: CanvasId
  /** The user ID of the reviewer (the person doing the reviewing). */
  assessor_id: CanvasId
  /** The user ID of the reviewee (the student whose submission is being reviewed). */
  user_id: CanvasId
  asset_id: CanvasId
  asset_type: 'Submission'
  workflow_state: 'assigned' | 'completed'
}

// --- Content Exports ---

export type ContentExportType = 'common_cartridge' | 'qti' | 'zip'

export type ContentExportWorkflowState =
  | 'created'
  | 'exporting'
  | 'exported'
  | 'failed'
  // Canvas may emit undocumented states (e.g. 'waiting_for_external_tool'); keep the
  // union open as a hint type without losing autocomplete on the known states.
  | (string & {})

export interface CanvasContentExportAttachment {
  url: string
  filename: string
}

export interface CanvasContentExport {
  id: CanvasId
  export_type: ContentExportType
  workflow_state: ContentExportWorkflowState
  /** null while 'created'; a Canvas progress URL once 'exporting'/'exported'. */
  progress_url: string | null
  /** Non-null (time-limited download link) only when workflow_state === 'exported'. */
  attachment: CanvasContentExportAttachment | null
  /** Opaque integer — the teacher/admin who initiated the export, not a student identifier. */
  user_id?: CanvasId
  created_at: string
  updated_at: string
}

// --- Content Migrations ---

export type ContentMigrationWorkflowState =
  'created' | 'queued' | 'running' | 'waiting_for_select' | 'completed' | 'failed' | (string & {})

export interface CanvasContentMigration {
  id: CanvasId
  migration_type: string
  migration_type_title?: string
  workflow_state: ContentMigrationWorkflowState
  /** URL to poll for async progress. Present once the migration is queued. */
  progress_url: string | null
  migration_issues_url: string
  finished_at: string | null
  started_at: string | null
  created_at: string
  updated_at: string
  user_id?: CanvasId
  attachment?: {
    url: string
    filename: string
  } | null
  /** Set when migration_type is 'course_copy_importer'. */
  settings?: Record<string, unknown>
}

export interface CanvasContentMigrator {
  type: string
  name: string
  requires_file_upload: boolean
  specification_url: string | null
}

export interface CanvasMigrationIssue {
  id: CanvasId
  content_migration_url: string
  description: string
  workflow_state: 'active' | 'resolved'
  fix_issue_html_url?: string
  issue_type: 'todo' | 'warning' | 'error'
  error_message?: string
  error_report_html_url?: string
  created_at: string
  updated_at: string
}
