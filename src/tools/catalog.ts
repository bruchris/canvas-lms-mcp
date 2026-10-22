import type { CanvasClient } from '../canvas'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import { accountTools } from './accounts'
import { assignmentSubmissionTools } from './assignment-submission'
import { analyticsTools } from './analytics'
import { attentionTools } from './attention'
import { assignmentTools } from './assignments'
import { assignmentOverrideTools } from './assignment-overrides'
import { calendarTools } from './calendar'
import { contentExportsTools } from './content-exports'
import { contentMigrationsTools } from './content-migrations'
import { conversationTools } from './conversations'
import { courseSetupTools } from './course-setup'
import { courseTools } from './courses'
import { dashboardTools } from './dashboard'
import { discussionTools } from './discussions'
import { enrollmentTools } from './enrollments'
import { fileTools } from './files'
import { gradebookHistoryTools } from './gradebook-history'
import { gradeExplanationTools } from './grade-explanation'
import { gradeProjectionTools } from './grade-projection'
import { gradingPolicyTools } from './grading-policy'
import { gradingStandardsTools } from './grading-standards'
import { groupTools } from './groups'
import { healthTools } from './health'
import { moduleTools } from './modules'
import { outcomeTools } from './outcomes'
import { pageTools } from './pages'
import { peerReviewTools } from './peer-reviews'
import { quizTools } from './quizzes'
import { quizQuestionResponseTools } from './quiz-question-responses'
import { quizAccommodationTools } from './quiz-accommodations'
import { newQuizAccommodationTools } from './new-quiz-accommodations'
import { newQuizTools } from './new-quizzes'
import { rubricTools } from './rubrics'
import { studentTools } from './student'
import { studentSearchTools } from './student-search'
import { submissionTools } from './submissions'
import { submissionFileTools } from './submission-files'
import { submissionsAwaitingGradingTools } from './submissions-awaiting-grading'
import type { ToolAudience, ToolDefinition, ToolFeatureFlags } from './types'
import type { CanvasToolset } from './toolsets'
import { userTools } from './users'
import { linkAuditTools } from './link-audit'
import { accessibilityAuditTools } from './accessibility-audit'
import { appointmentGroupTools } from './appointment-groups'

/**
 * Feature-flag keys usable as a domain `gate`. Only the boolean flags qualify.
 *
 * A gate is evaluated for truthiness, and every non-empty string mode of a
 * policy flag such as `destructiveTools` is truthy — so `gate: 'destructiveTools'`
 * would read as permanently on, including when the deployer set `block`.
 * Constraining the key here makes that unrepresentable instead of latent.
 */
export type ToolDomainGateKey = {
  [K in keyof ToolFeatureFlags]-?: boolean extends NonNullable<ToolFeatureFlags[K]> ? K : never
}[keyof ToolFeatureFlags]

export interface ToolDomainRegistration {
  domain: string
  defaultPrimaryAudience: ToolAudience
  /**
   * The one toolset this domain belongs to (GH #442 Phase 1, BRU-3128).
   *
   * Required, and single-valued, on purpose. Required means a new domain cannot
   * be added without classifying it — omitting it is a compile error, not a
   * tool that silently vanishes from every toolset. Single-valued means "every
   * domain maps to exactly one toolset" is a property of the type rather than
   * something a test has to police: a second assignment is unrepresentable.
   */
  toolset: CanvasToolset
  getTools: (canvas: CanvasClient, pseudonymizer?: Pseudonymizer) => ToolDefinition[]
  /** Feature-flag key that must be enabled for this domain to register. Omitted = always on. */
  gate?: ToolDomainGateKey
}

export const toolDomainCatalog: readonly ToolDomainRegistration[] = [
  {
    domain: 'health',
    toolset: 'core',
    defaultPrimaryAudience: 'shared',
    getTools: healthTools,
  },
  {
    domain: 'courses',
    toolset: 'core',
    defaultPrimaryAudience: 'shared',
    getTools: courseTools,
  },
  {
    domain: 'assignments',
    toolset: 'core',
    defaultPrimaryAudience: 'educator',
    getTools: assignmentTools,
  },
  {
    domain: 'submissions',
    toolset: 'grading',
    defaultPrimaryAudience: 'educator',
    getTools: submissionTools,
  },
  {
    domain: 'submission_files',
    toolset: 'grading',
    defaultPrimaryAudience: 'educator',
    getTools: submissionFileTools,
  },
  {
    domain: 'submissions_awaiting_grading',
    toolset: 'grading',
    defaultPrimaryAudience: 'educator',
    getTools: submissionsAwaitingGradingTools,
  },
  {
    domain: 'rubrics',
    toolset: 'grading',
    defaultPrimaryAudience: 'educator',
    getTools: rubricTools,
  },
  {
    domain: 'quizzes',
    toolset: 'quizzes',
    defaultPrimaryAudience: 'educator',
    getTools: quizTools,
  },
  {
    domain: 'new_quizzes',
    toolset: 'quizzes',
    defaultPrimaryAudience: 'educator',
    getTools: newQuizTools,
  },
  {
    domain: 'quiz_question_responses',
    toolset: 'quizzes',
    defaultPrimaryAudience: 'educator',
    getTools: quizQuestionResponseTools,
  },
  {
    domain: 'files',
    toolset: 'core',
    defaultPrimaryAudience: 'shared',
    getTools: fileTools,
  },
  {
    domain: 'gradebook_history',
    toolset: 'grading',
    defaultPrimaryAudience: 'educator',
    getTools: gradebookHistoryTools,
  },
  {
    domain: 'users',
    toolset: 'people',
    defaultPrimaryAudience: 'educator',
    getTools: userTools,
  },
  {
    domain: 'groups',
    toolset: 'people',
    defaultPrimaryAudience: 'shared',
    getTools: groupTools,
  },
  {
    domain: 'enrollments',
    toolset: 'people',
    defaultPrimaryAudience: 'admin',
    getTools: enrollmentTools,
  },
  {
    domain: 'discussions',
    toolset: 'communication',
    defaultPrimaryAudience: 'shared',
    getTools: discussionTools,
  },
  {
    domain: 'modules',
    toolset: 'core',
    defaultPrimaryAudience: 'educator',
    getTools: moduleTools,
  },
  {
    domain: 'pages',
    toolset: 'core',
    defaultPrimaryAudience: 'educator',
    getTools: pageTools,
  },
  {
    domain: 'calendar',
    toolset: 'course_ops',
    defaultPrimaryAudience: 'shared',
    getTools: calendarTools,
  },
  {
    domain: 'conversations',
    toolset: 'communication',
    defaultPrimaryAudience: 'shared',
    getTools: conversationTools,
  },
  {
    domain: 'peer_reviews',
    toolset: 'grading',
    defaultPrimaryAudience: 'shared',
    getTools: peerReviewTools,
  },
  {
    domain: 'accounts',
    toolset: 'account',
    defaultPrimaryAudience: 'admin',
    getTools: accountTools,
  },
  {
    domain: 'analytics',
    toolset: 'grading',
    defaultPrimaryAudience: 'educator',
    getTools: analyticsTools,
  },
  {
    domain: 'outcomes',
    toolset: 'outcomes',
    defaultPrimaryAudience: 'educator',
    getTools: outcomeTools,
  },
  {
    domain: 'student',
    toolset: 'student',
    defaultPrimaryAudience: 'student',
    getTools: studentTools,
  },
  {
    domain: 'student_search',
    toolset: 'people',
    defaultPrimaryAudience: 'educator',
    getTools: studentSearchTools,
  },
  {
    domain: 'dashboard',
    toolset: 'student',
    defaultPrimaryAudience: 'student',
    getTools: dashboardTools,
  },
  {
    domain: 'attention',
    toolset: 'grading',
    defaultPrimaryAudience: 'educator',
    getTools: attentionTools,
  },
  {
    domain: 'content_exports',
    toolset: 'course_ops',
    defaultPrimaryAudience: 'educator',
    getTools: contentExportsTools,
  },
  {
    domain: 'content_migrations',
    toolset: 'course_ops',
    defaultPrimaryAudience: 'educator',
    getTools: contentMigrationsTools,
  },
  {
    domain: 'grading_standards',
    toolset: 'grading',
    defaultPrimaryAudience: 'educator',
    getTools: gradingStandardsTools,
  },
  {
    domain: 'quiz_accommodations',
    toolset: 'quizzes',
    defaultPrimaryAudience: 'educator',
    getTools: quizAccommodationTools,
  },
  {
    domain: 'new_quiz_accommodations',
    toolset: 'quizzes',
    defaultPrimaryAudience: 'educator',
    getTools: newQuizAccommodationTools,
  },
  {
    domain: 'assignment_overrides',
    toolset: 'course_ops',
    defaultPrimaryAudience: 'educator',
    getTools: assignmentOverrideTools,
  },
  {
    domain: 'course_setup',
    toolset: 'course_ops',
    defaultPrimaryAudience: 'educator',
    getTools: courseSetupTools,
  },
  {
    domain: 'grade_explanation',
    toolset: 'grading',
    defaultPrimaryAudience: 'shared',
    getTools: gradeExplanationTools,
  },
  {
    domain: 'grading_policy',
    toolset: 'grading',
    defaultPrimaryAudience: 'shared',
    getTools: gradingPolicyTools,
  },
  {
    domain: 'grade_projection',
    toolset: 'grading',
    defaultPrimaryAudience: 'shared',
    getTools: gradeProjectionTools,
  },
  {
    domain: 'link_audit',
    toolset: 'course_ops',
    defaultPrimaryAudience: 'educator',
    getTools: linkAuditTools,
  },
  {
    domain: 'accessibility_audit',
    toolset: 'course_ops',
    defaultPrimaryAudience: 'educator',
    getTools: accessibilityAuditTools,
  },
  {
    domain: 'appointment_groups',
    toolset: 'course_ops',
    defaultPrimaryAudience: 'educator',
    getTools: appointmentGroupTools,
  },
  {
    domain: 'assignment_submission',
    toolset: 'student',
    defaultPrimaryAudience: 'student',
    gate: 'assignmentSubmission',
    getTools: assignmentSubmissionTools,
  },
]
