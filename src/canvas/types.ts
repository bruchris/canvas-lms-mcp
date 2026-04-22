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
  id: number
  name: string
  course_code: string
  workflow_state: string
  enrollment_term_id?: number
  total_students?: number
  syllabus_body?: string
  term?: CanvasTerm
  enrollments?: CanvasEnrollment[]
}

export interface CanvasTerm {
  id: number
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
  id: number
  course_id: number
  user_id: number
  type: string
  role: string
  enrollment_state: string
  created_at?: string
  grades?: CanvasEnrollmentGrades
}

export interface CreateCourseParams {
  account_id: number
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
}

// --- Assignments ---

export interface CanvasAssignment {
  id: number
  name: string
  description: string | null
  due_at: string | null
  points_possible: number
  grading_type: string
  submission_types: string[]
  course_id: number
  rubric_settings?: { id: number }
  group_category_id?: number | null
  quiz_id?: number | null
  allowed_attempts: number
}

export interface CanvasAssignmentGroup {
  id: number
  name: string
  position: number
  group_weight: number
  assignments?: CanvasAssignment[]
}

export interface CanvasUpcomingEvent {
  id: number
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
  id: number
  assignment_id: number
  user_id: number
  submitted_at: string | null
  score: number | null
  grade: string | null
  body: string | null
  url: string | null
  attempt: number | null
  workflow_state: string
  custom_grade_status_id?: number | null
  attachments?: CanvasAttachment[]
  submission_comments?: CanvasSubmissionComment[]
}

export interface CanvasAttachment {
  id: number
  filename: string
  display_name: string
  url: string
  content_type: string
  size: number
}

export interface CanvasSubmissionComment {
  id: number
  author_id: number
  author_name: string
  comment: string
  created_at: string
}

export interface CanvasGradebookHistoryGrader {
  id: number
  name: string
  assignments: number[]
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
  grader_id?: number | null
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
  submission_id: number
  versions: CanvasGradebookHistorySubmissionVersion[] | null
}

// --- Rubrics ---

export interface CanvasRubric {
  id: number
  title: string
  points_possible: number
  data: CanvasRubricCriterion[]
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

export interface CanvasRubricAssessment {
  id: number
  rubric_id: number
  score: number
  data: Array<{
    criterion_id: string
    points: number
    comments: string
  }>
}

// --- Quizzes ---

export interface CanvasQuiz {
  id: number
  title: string
  quiz_type: string
  points_possible: number
  question_count: number
  due_at: string | null
  published: boolean
}

export interface CanvasQuizSubmission {
  id: number
  quiz_id: number
  user_id: number
  submission_id: number
  attempt: number
  score: number | null
  kept_score: number | null
  workflow_state: string
}

export interface CanvasQuizQuestion {
  id: number
  quiz_id: number
  position: number
  question_text: string
  question_type: string
  points_possible: number
  answers?: Array<{ id: number; text: string; weight: number }>
}

export interface CanvasQuizSubmissionQuestion {
  id: number
  quiz_id: number
  answer: string | number | null
  flagged: boolean
}

// --- Files ---

export interface CanvasFile {
  id: number
  filename?: string
  display_name: string
  content_type: string
  url: string
  size: number
  folder_id: number
  created_at?: string
  updated_at?: string
}

export interface CanvasFolder {
  id: number
  name: string
  full_name: string
  parent_folder_id: number | null
  created_at?: string
  files_count?: number
  folders_count?: number
}

export interface CanvasFileUploadInfo {
  upload_url: string
  upload_params: Record<string, string>
}

// --- Users ---

export interface CanvasUser {
  id: number
  name: string
  login_id?: string
  email?: string
  avatar_url?: string
}

export interface CanvasUserProfile {
  id: number
  name: string
  primary_email: string
  login_id: string
  avatar_url: string
  time_zone: string
  locale: string
}

// --- Groups ---

export interface CanvasGroup {
  id: number
  name: string
  group_category_id: number
  members_count: number
}

// --- Modules ---

export interface CanvasModule {
  id: number
  name: string
  position: number
  items_count: number
  items_url?: string
  state?: string
  published?: boolean
  unlock_at?: string | null
}

export interface CanvasModuleItem {
  id: number
  module_id: number
  title: string
  position: number
  type: string
  content_id?: number
  html_url?: string
  indent?: number
  published?: boolean
  external_url?: string
}

// --- Pages ---

export interface CanvasPage {
  page_id: number
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
  id: number
  title: string
  message: string | null
  posted_at: string
  discussion_type: string
  published: boolean
}

export interface CanvasDiscussionEntry {
  id: number
  user_id: number
  message: string
  created_at: string
}

export interface CanvasAnnouncement {
  id: number
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
}

export interface UpdateDiscussionParams {
  title?: string
  message?: string
  published?: boolean
  require_initial_post?: boolean
}

// --- Calendar ---

export interface CanvasCalendarEvent {
  id: number
  title: string
  description?: string | null
  start_at: string
  end_at: string | null
  all_day?: boolean
  workflow_state?: string
  context_code: string
  location_name?: string | null
  type: string
}

// --- Conversations ---

export interface CanvasConversation {
  id: number
  subject: string
  last_message: string
  last_message_at: string
  message_count: number
  participants: Array<{ id: number; name: string }>
}

export interface CanvasConversationMessage {
  id: number
  created_at: string
  body: string
  author_id: number
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
  id: number
  url: string
  context_id: number | null
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
  id: number
  url: string
  context_id: number | null
  context_type: 'Account' | 'Course' | 'Global' | (string & {})
  title: string
  description?: string | null
  vendor_guid?: string | null
  subgroups_url?: string
  outcomes_url?: string
  can_edit?: boolean
}

export interface CanvasOutcomeLink {
  id: number | string
  url?: string
  context_id?: number | null
  context_type?: 'Account' | 'Course' | 'Global' | (string & {})
  outcome_group?: CanvasOutcomeGroup | null
  outcome?: CanvasOutcome | null
  assessed?: boolean
}

export interface CanvasOutcomeAlignment {
  id: number
  assignment_id: number | null
  assessment_id: number | null
  submission_types?: string | null
  url?: string | null
  title: string
}

export interface CanvasOutcomeResult {
  id: number
  score: number | null
  submitted_or_assessed_at: string | null
  links: {
    user: string | number
    learning_outcome: string | number
    alignment: string | number
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
    outcome: string | number
  }
}

export interface CanvasOutcomeRollup {
  scores: CanvasOutcomeRollupScore[] | null
  name: string
  links: {
    course?: number
    user?: number
    section?: number
  }
}

export interface CanvasOutcomeRollupsResponse {
  rollups: CanvasOutcomeRollup[]
  linked?: {
    users?: CanvasUser[]
    outcomes?: CanvasOutcome[]
    outcome_groups?: CanvasOutcomeGroup[]
    courses?: CanvasCourse[]
    sections?: Array<{ id: number; name: string }>
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

export interface CanvasAccount {
  id: number
  name: string
  parent_account_id: number | null
  root_account_id: number | null
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
    id: number
    report: string
    status: 'created' | 'running' | 'complete' | 'error'
    created_at: string
    started_at: string | null
    ended_at: string | null
    attachment: CanvasFile | null
  } | null
}

// --- Assignments (params) ---

export interface CreateAssignmentParams {
  name: string
  description?: string
  points_possible?: number
  due_at?: string
  submission_types?: string[]
  assignment_group_id?: number
}

export type UpdateAssignmentParams = Partial<CreateAssignmentParams>

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

export interface CourseSearchResult {
  id: number
  title: string
  type: 'page' | 'assignment' | 'discussion' | 'announcement'
  url?: string
  course_id: number
}

// --- Dashboard & Notifications ---

export interface CanvasDashboardCard {
  id: number
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
  courseId: number
  position: number | null
}

export interface CanvasTodoItem {
  type: string
  assignment?: {
    id: number
    name: string
    due_at: string | null
    course_id: number
    points_possible: number
  }
  quiz?: {
    id: number
    title: string
    due_at: string | null
    course_id: number
  }
  ignore: string
  ignore_permanently: string
  html_url: string
  needs_grading_count?: number
  context_type: string
  course_id?: number
  group_id?: number
}

export interface CanvasMissingSubmission {
  id: number
  name: string
  due_at: string | null
  course_id: number
  points_possible: number
  submission_types: string[]
  html_url: string
}

// --- Peer Reviews ---

export interface CanvasPeerReview {
  id: number
  /** The user ID of the reviewer (the person doing the reviewing). */
  assessor_id: number
  /** The user ID of the reviewee (the student whose submission is being reviewed). */
  user_id: number
  asset_id: number
  asset_type: 'Submission'
  workflow_state: 'assigned' | 'completed'
}
