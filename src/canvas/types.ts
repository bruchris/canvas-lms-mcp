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

export interface CanvasEnrollment {
  id: number
  course_id: number
  user_id: number
  type: string
  role: string
  enrollment_state: string
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
  display_name: string
  content_type: string
  url: string
  size: number
  folder_id: number
}

export interface CanvasFolder {
  id: number
  name: string
  full_name: string
  parent_folder_id: number | null
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
  state?: string
  published?: boolean
}

export interface CanvasModuleItem {
  id: number
  module_id: number
  title: string
  position: number
  type: string
  content_id?: number
  html_url?: string
}

// --- Pages ---

export interface CanvasPage {
  page_id: number
  url: string
  title: string
  body?: string
  published: boolean
  updated_at: string
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

// --- Calendar ---

export interface CanvasCalendarEvent {
  id: number
  title: string
  start_at: string
  end_at: string | null
  type: string
  context_code: string
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
  parameters_schema: Record<string, unknown>[] | null
  last_run: {
    id: number
    report: string
    status: string
    created_at: string
    started_at: string | null
    ended_at: string | null
    attachment: CanvasFile | null
  } | null
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
